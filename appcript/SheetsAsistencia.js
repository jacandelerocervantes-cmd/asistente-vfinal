/**
 * Registra las asistencias con formato numérico (1/0) y encabezado compacto (DD/MM-S#).
 */
function handleLogAsistencia(payload) {
  const { calificaciones_spreadsheet_id, fecha, unidad, sesion, asistencias } = payload;
  Logger.log("Registrando asistencia: " + JSON.stringify(payload).substring(0, 100) + "...");

  if (!calificaciones_spreadsheet_id || !asistencias || !fecha || !unidad || !sesion) { 
    throw new Error("Faltan datos para registrar la asistencia."); 
  }

  try {
    const reporteSheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
    const nombreHoja = `Unidad ${unidad}`;
    let unitSheet = reporteSheet.getSheetByName(nombreHoja);
    
    // Si no existe la hoja, la creamos
    if (!unitSheet) {
      unitSheet = reporteSheet.insertSheet(nombreHoja);
      unitSheet.appendRow(["Matrícula", "Nombre Completo"]);
      unitSheet.getRange("A1:B1").setFontWeight("bold");
      unitSheet.setFrozenRows(1);
      unitSheet.setFrozenColumns(2);
    }
    
    const dataRange = unitSheet.getDataRange();
    const sheetData = dataRange.getValues();
    const headers = sheetData[0];

    // --- 1. CONSTRUIR ENCABEZADO (DD/MM-Sesion) ---
    // fecha viene como YYYY-MM-DD (ej. 2025-11-20)
    const [year, month, day] = fecha.split('-');
    const textoEncabezado = `${day}/${month}-${sesion}`; // Resultado: "20/11-1"

    // Buscar si ya existe esa columna
    let sessionColIndex = headers.indexOf(textoEncabezado);

    // Si no existe, crearla al final
    if (sessionColIndex === -1) {
      sessionColIndex = headers.length;
      sheetData[0][sessionColIndex] = textoEncabezado;
      // Rellenar filas con vacío
      for (let i = 1; i < sheetData.length; i++) sheetData[i][sessionColIndex] = '';
    }

    // Mapear matrículas a filas
    const matriculaToRowIndex = new Map();
    for (let i = 1; i < sheetData.length; i++) {
      const matricula = String(sheetData[i][0]).trim().toUpperCase();
      if (matricula) matriculaToRowIndex.set(matricula, i);
    }

    // --- 2. ESCRIBIR 1 o 0 ---
    let registrosEscritos = 0;
    asistencias.forEach(data => {
      const matriculaNorm = String(data.matricula).trim().toUpperCase();
      const rowIndex = matriculaToRowIndex.get(matriculaNorm);
      
      if (rowIndex !== undefined) {
        // AQUÍ ESTÁ EL CAMBIO: 1 si presente, 0 si no
        sheetData[rowIndex][sessionColIndex] = data.presente ? 1 : 0;
        registrosEscritos++;
      }
    });

    // Guardar en hoja
    const newNumCols = sheetData[0].length;
    unitSheet.getRange(1, 1, sheetData.length, newNumCols).setValues(sheetData);

    // Formateo visual
    if (sessionColIndex === headers.length - 1) {
      unitSheet.getRange(1, sessionColIndex + 1).setFontWeight('bold').setHorizontalAlignment("center");
    }
    // Centrar los 1 y 0
    unitSheet.getRange(2, sessionColIndex + 1, sheetData.length - 1, 1).setHorizontalAlignment("center");

    SpreadsheetApp.flush(); 
    return `Asistencia registrada en ${nombreHoja} bajo "${textoEncabezado}". (${registrosEscritos} alumnos).`;

  } catch (e) {
    Logger.log(e);
    throw new Error('Error al registrar asistencia: ' + e.message);
  }
}

/**
 * Calcula el % de asistencia contando los 1s y 0s en la hoja.
 */
function handleCerrarUnidadAsistencia(payload) {
  const { calificaciones_spreadsheet_id, unidad } = payload;
  if (!calificaciones_spreadsheet_id || !unidad) throw new Error("Faltan datos.");

  const reporteSheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  const nombreHoja = `Unidad ${unidad}`;
  const sheet = reporteSheet.getSheetByName(nombreHoja);
  
  if (!sheet) return `No se encontró la hoja "${nombreHoja}".`;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Identificar columnas de sesión (las que tienen guion "-" y barra "/")
  const indicesSesion = [];
  headers.forEach((h, index) => {
    if (typeof h === 'string' && h.includes('/') && h.includes('-')) {
      indicesSesion.push(index);
    }
  });

  if (indicesSesion.length === 0) return "No hay sesiones registradas para calcular.";

  // Buscar o crear columna de Porcentaje
  let pctColIndex = headers.indexOf("% Asistencia");
  if (pctColIndex === -1) {
    pctColIndex = headers.length;
    data[0][pctColIndex] = "% Asistencia";
  }

  // Calcular para cada alumno
  for (let i = 1; i < data.length; i++) {
    let suma = 0;
    let total = 0;
    indicesSesion.forEach(colIdx => {
      const valor = data[i][colIdx];
      if (valor === 1 || valor === 0) { // Solo contar si hay registro
        suma += valor;
        total++;
      }
    });
    
    const promedio = total > 0 ? (suma / total) : 0;
    data[i][pctColIndex] = promedio;
  }

  // Guardar
  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  // Formato porcentaje
  sheet.getRange(2, pctColIndex + 1, data.length - 1, 1).setNumberFormat("0%");
  sheet.getRange(1, pctColIndex + 1).setFontWeight("bold");

  return `Unidad cerrada. Porcentajes calculados sobre ${indicesSesion.length} sesiones.`;
}

/**
 * Crea O ACTUALIZA la hoja "Lista de Alumnos" (Archivo separado).
 * Esta se mantiene igual, una sola lista general.
 */
function crearListaDeAlumnosSheet(carpetaPadre, alumnos) {
  // ... (MANTÉN EL CÓDIGO DE ESTA FUNCIÓN QUE TE DI EN EL TURNO ANTERIOR)
  const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_LISTA_ALUMNOS);
  let spreadsheet = files.hasNext() ? SpreadsheetApp.open(files.next()) : SpreadsheetApp.create(NOMBRE_SHEET_LISTA_ALUMNOS);
  if(!files.hasNext()) moveFileToFolder(spreadsheet.getId(), carpetaPadre, NOMBRE_SHEET_LISTA_ALUMNOS);

  let sheet = spreadsheet.getSheetByName("Alumnos");
  if(!sheet) sheet = spreadsheet.getSheets()[0].setName("Alumnos");
 
   const headers = ["Matrícula", "Nombre", "Apellido"];
   const filas = [headers];
   if (Array.isArray(alumnos)) {
       alumnos.forEach(a => filas.push([a.matricula||'', a.nombre||'', a.apellido||'']));
   }
   sheet.clearContents();
   if(filas.length > 0) {
     sheet.getRange(1, 1, filas.length, 3).setValues(filas);
     sheet.getRange("A1:C1").setFontWeight("bold");
   }
 }
 
 /**
  * Crea/Actualiza las hojas de asistencia (Mantiene lógica de pestañas).
  */
 function crearAsistenciasSheet(carpetaPadre, alumnos, numeroDeUnidades) {
   const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
   let spreadsheet;
 
   if (files.hasNext()) {
     spreadsheet = SpreadsheetApp.open(files.next());
   } else {
     spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_ASISTENCIA);
     moveFileToFolder(spreadsheet.getId(), carpetaPadre, NOMBRE_SHEET_ASISTENCIA);
   }
 
   const numUnits = parseInt(numeroDeUnidades, 10) || 1;
 
   for (let i = 1; i <= numUnits; i++) {
     const nombreHoja = `Unidad ${i}`;
     let sheet = spreadsheet.getSheetByName(nombreHoja);
 
     if (!sheet) {
       if (spreadsheet.getSheets().length === 1 && spreadsheet.getSheets()[0].getName().startsWith("Hoja")) {
          sheet = spreadsheet.getSheets()[0].setName(nombreHoja);
       } else {
          sheet = spreadsheet.insertSheet(nombreHoja, i - 1);
       }
       sheet.appendRow(["Matrícula", "Nombre Completo"]);
       sheet.getRange("A1:B1").setFontWeight("bold");
       sheet.setFrozenRows(1);
       sheet.setFrozenColumns(2);
     }
     _actualizarAlumnosEnHoja(sheet, alumnos);
   }
   return spreadsheet;
 }
 
 function _actualizarAlumnosEnHoja(sheet, alumnos) {
     const data = sheet.getDataRange().getValues();
     const existingMatriculas = new Set();
     for (let r = 1; r < data.length; r++) {
         const mat = String(data[r][0]).trim().toUpperCase();
         if (mat) existingMatriculas.add(mat);
     }
     const nuevos = [];
     if (Array.isArray(alumnos)) {
         alumnos.forEach(a => {
             const mat = String(a.matricula || '').trim().toUpperCase();
             if (mat && !existingMatriculas.has(mat)) {
                 const row = new Array(2).fill(""); 
                 row[0] = a.matricula;
                 row[1] = `${a.nombre || ''} ${a.apellido || ''}`.trim();
                 nuevos.push(row);
             }
         });
     }
     if (nuevos.length > 0) {
         sheet.getRange(sheet.getLastRow() + 1, 1, nuevos.length, 2).setValues(nuevos);
     }
 }
 
 function handleLeerDatosAsistencia(payload) { return { asistencias: [] }; }