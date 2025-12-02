/**
 * Registra las asistencias con formato numérico (1/0) y encabezado compacto (DD/MM-S#).
 */
function handleLogAsistencia(payload) {
  const { calificaciones_spreadsheet_id, fecha, unidad, sesion, asistencias } = payload;
  if (!calificaciones_spreadsheet_id || !asistencias || !fecha || !unidad || !sesion) throw new Error("Faltan datos.");

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
    let sessionColIndex = headers.indexOf(textoEncabezado);

    // Si no existe, crearla al final
    if (sessionColIndex === -1) {
      sessionColIndex = headers.length;
      sheetData[0][sessionColIndex] = textoEncabezado;
      for (let i = 1; i < sheetData.length; i++) sheetData[i][sessionColIndex] = '';
    }

    // Mapear matrículas a filas
    const matriculaToRowIndex = new Map();
    for (let i = 1; i < sheetData.length; i++) {
      const mat = String(sheetData[i][0]).trim().toUpperCase();
      if (mat) matriculaToRowIndex.set(mat, i);
    }

    // --- 2. ESCRIBIR 1 o 0 ---
    asistencias.forEach(data => {
      const rowIndex = matriculaToRowIndex.get(String(data.matricula).trim().toUpperCase());
      
      if (rowIndex !== undefined) {
        // AQUÍ ESTÁ EL CAMBIO: 1 si presente, 0 si no
        sheetData[rowIndex][sessionColIndex] = data.presente ? 1 : 0;
      }
    });

    // Guardar en hoja
    const newNumCols = sheetData[0].length;
    unitSheet.getRange(1, 1, sheetData.length, newNumCols).setValues(sheetData);
    // Centrar los 1 y 0
    unitSheet.getRange(2, sessionColIndex + 1, sheetData.length - 1, 1).setHorizontalAlignment("center");

    SpreadsheetApp.flush(); 
    return `Ok`;

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
  
  if (!sheet) return "Hoja no encontrada.";

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Identificar columnas de sesión (las que tienen guion "-" y barra "/")
  const indicesSesion = headers.map((h, i) => (typeof h === 'string' && h.includes('/') && h.includes('-')) ? i : -1).filter(i => i !== -1);

  if (indicesSesion.length === 0) return "Sin sesiones.";

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
      if (valor === 1 || valor === 0) {
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

  return "Unidad cerrada.";
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
   let ss = files.hasNext() ? SpreadsheetApp.open(files.next()) : SpreadsheetApp.create(NOMBRE_SHEET_ASISTENCIA);
   if (!files.hasNext()) moveFileToFolder(ss.getId(), carpetaPadre, NOMBRE_SHEET_ASISTENCIA);
 
   const numUnits = parseInt(numeroDeUnidades, 10) || 1;
 
   for (let i = 1; i <= numUnits; i++) {
     const name = `Unidad ${i}`;
     let sheet = ss.getSheetByName(name);
 
     if (!sheet) {
       sheet = ss.insertSheet(name, i - 1);
       sheet.appendRow(["Matrícula", "Nombre Completo"]);
       sheet.setFrozenRows(1);
       sheet.setFrozenColumns(2);
     }
     _actualizarAlumnosEnHoja(sheet, alumnos);
   }

   // --- NUEVO BLOQUE DE LIMPIEZA ---
   // Eliminamos la hoja por defecto creada por Google si existe y no es la única
   const hojasPorDefecto = ["Hoja 1", "Sheet1"];
   hojasPorDefecto.forEach(nombre => {
     const sheetDefault = ss.getSheetByName(nombre);
     // Verificamos que haya más de 1 hoja antes de borrar para no romper el archivo
     if (sheetDefault && ss.getSheets().length > 1) {
       try {
         ss.deleteSheet(sheetDefault);
         Logger.log(`Hoja por defecto "${nombre}" eliminada.`);
       } catch (e) {
         Logger.log(`No se pudo eliminar "${nombre}": ${e.message}`);
       }
     }
   });
   // --------------------------------
 
    return ss;
 }
 
 function _actualizarAlumnosEnHoja(sheet, alumnos) {
     const data = sheet.getDataRange().getValues();
     const existing = new Set();
     for (let r = 1; r < data.length; r++) {
         existing.add(String(data[r][0]).trim().toUpperCase());
     }
     
     const nuevos = [];
     if (Array.isArray(alumnos)) {
         alumnos.forEach(a => {
             if (a.matricula && !existing.has(String(a.matricula).trim().toUpperCase())) {
                 const row = new Array(2).fill(""); 
                 row[0] = a.matricula;
                 row[1] = `${a.nombre} ${a.apellido}`;
                 nuevos.push(row);
             }
         });
     }
     if (nuevos.length > 0) {
         sheet.getRange(sheet.getLastRow() + 1, 1, nuevos.length, 2).setValues(nuevos);
     }
 }
 
 function handleLeerDatosAsistencia(payload) {
  const { calificaciones_spreadsheet_id } = payload;
  if (!calificaciones_spreadsheet_id) throw new Error("Faltan datos.");

  const ss = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  const sheets = ss.getSheets();
  const asistencias = [];
  const year = new Date().getFullYear(); // Asumimos año actual

  sheets.forEach(sheet => {
    const name = sheet.getName();
    if (name.startsWith("Unidad ")) {
      const unidad = parseInt(name.replace("Unidad ", ""), 10);
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return; // Hoja vacía

      const headers = data[0];
      
      // Buscar columnas de sesión (formato DD/MM-S#)
      headers.forEach((h, colIndex) => {
        if (typeof h === 'string' && h.includes('/') && h.includes('-')) {
           // Parsear: "21/11-1"
           const [fechaPart, sesionPart] = h.split('-'); 
           const [day, month] = fechaPart.split('/'); 
           const sesion = parseInt(sesionPart, 10);
           
           // Reconstruir fecha ISO: 2025-11-21
           const fechaISO = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

           // Leer filas
           for (let r = 1; r < data.length; r++) {
             const matricula = String(data[r][0]).trim().toUpperCase();
             if (!matricula) continue;
             
             const val = data[r][colIndex];
             // Consideramos dato válido solo si es 1 o 0 (o TRUE/FALSE)
             // Si la celda está vacía, NO enviamos nada (no sobreescribimos con falta)
             if (val === 1 || val === 0 || val === true || val === false) {
                asistencias.push({
                  matricula,
                  fecha: fechaISO,
                  unidad,
                  sesion,
                  presente: (val == 1 || val === true)
                });
             }
           }
        }
      });
    }
  });

  Logger.log(`Leídos ${asistencias.length} registros de asistencia.`);
  return { asistencias };
}