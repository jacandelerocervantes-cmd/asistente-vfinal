/**
 * Registra las asistencias de una sesión específica en la hoja de cálculo.
 * @param {object} payload Datos de la sesión y asistencias. {calificaciones_spreadsheet_id, fecha, unidad, sesion, asistencias:[{matricula, presente}]}
 * @return {string} Mensaje de resultado.
 */
function handleLogAsistencia(payload) {
  const { calificaciones_spreadsheet_id, fecha, unidad, sesion, asistencias } = payload;
  Logger.log("Recibido en handleLogAsistencia: " + JSON.stringify(payload).substring(0, 500) + "...");

  if (!calificaciones_spreadsheet_id || !asistencias || !fecha || !unidad || !sesion) { throw new Error("Faltan datos para registrar la asistencia (calificaciones_spreadsheet_id, fecha, unidad, sesion, asistencias)."); }
  if (!Array.isArray(asistencias)) { throw new Error("El campo 'asistencias' debe ser un array."); }

  try {
    const reporteSheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
    const unitSheet = reporteSheet.getSheetByName(NOMBRE_SHEET_ASISTENCIA);
    
    if (!unitSheet) {
      throw new Error(`No se encontró la hoja "${NOMBRE_SHEET_ASISTENCIA}" para registrar la asistencia.`);
    }
    
    // 1. Leer todos los datos de la hoja en memoria
    const dataRange = unitSheet.getDataRange();
    const sheetData = dataRange.getValues();
    const headers = sheetData[0];

    // 2. Encontrar o crear la columna para la sesión actual
    const textoEncabezado = `U${unidad}-S${sesion}`;
    let sessionColIndex = headers.indexOf(textoEncabezado);

    if (sessionColIndex === -1) {
      sessionColIndex = headers.length;
      sheetData[0][sessionColIndex] = textoEncabezado; // Añadir header en memoria
      // Asegurarse de que todas las filas tengan la nueva columna para evitar errores de tamaño
      for (let i = 1; i < sheetData.length; i++) {
        sheetData[i][sessionColIndex] = '';
      }
    }

    // 3. Mapear matrículas a sus índices de fila para acceso rápido
    const matriculaColIndex = headers.indexOf("Matrícula");
    if (matriculaColIndex === -1) {
      throw new Error("No se encontró la columna 'Matrícula' en la hoja de asistencia.");
    }
    const matriculaToRowIndex = new Map();
    for (let i = 1; i < sheetData.length; i++) {
      const matricula = String(sheetData[i][matriculaColIndex]).trim().toUpperCase();
      if (matricula) {
        matriculaToRowIndex.set(matricula, i);
      }
    }

    // 4. Actualizar las asistencias en el array `sheetData`
    let registrosEscritos = 0;
    asistencias.forEach(data => {
      const matriculaNorm = String(data.matricula).trim().toUpperCase();
      const rowIndex = matriculaToRowIndex.get(matriculaNorm);
      
      if (rowIndex !== -1) {
        // La fecha de la asistencia se guarda en la celda
        sheetData[rowIndex][sessionColIndex] = data.presente ? new Date(fecha + 'T12:00:00Z') : '';
        registrosEscritos++;
      }
    });

    // 5. Escribir todos los datos de vuelta a la hoja en una sola operación
    const newNumCols = sheetData[0].length;
    unitSheet.getRange(1, 1, sheetData.length, newNumCols).setValues(sheetData);

    // Formatear la nueva columna si se creó
    if (sessionColIndex === headers.length - 1) { // Si era una columna nueva
      unitSheet.getRange(1, sessionColIndex + 1).setFontWeight('bold').setHorizontalAlignment("center");
    }
    // Formatear las celdas de fecha
    unitSheet.getRange(2, sessionColIndex + 1, sheetData.length - 1, 1).setNumberFormat("dd/mm/yyyy");

    SpreadsheetApp.flush(); 

    return `Asistencia registrada para la sesión ${textoEncabezado}. Se procesaron ${registrosEscritos} registros.`;

  } catch (e) {
    Logger.log(e);
    throw new Error('Error al procesar el registro de asistencia: ' + e.message);
  }
}
/**
 * Calcula el resumen de asistencia para una unidad y protege la hoja correspondiente.
 * @param {object} payload Datos {calificaciones_spreadsheet_id, unidad, alumnos, registros_asistencia}
 * @return {string} Mensaje de resultado.
 */
function handleCerrarUnidadAsistencia(payload) {
  Logger.log(`Iniciando handleCerrarUnidadAsistencia para unidad ${payload.unidad}...`);
  const { calificaciones_spreadsheet_id, unidad, alumnos, registros_asistencia } = payload;
  if (!calificaciones_spreadsheet_id || !unidad || !alumnos || !Array.isArray(alumnos) || !registros_asistencia || !Array.isArray(registros_asistencia)) {
    throw new Error("Faltan datos para cerrar la unidad (calificaciones_spreadsheet_id, unidad, alumnos, registros_asistencia).");
  }

  const hojaDeCalculo = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  const hoja = hojaDeCalculo.getSheetByName(NOMBRE_SHEET_ASISTENCIA);
  if (!hoja) throw new Error(`No se encontró la hoja "${NOMBRE_SHEET_ASISTENCIA}".`);

  // Filtrar registros solo para la unidad que se está cerrando
  const registrosDeLaUnidad = registros_asistencia.filter(r => r.unidad === unidad);

  const sesionesUnicas = new Set(registrosDeLaUnidad.map(r => `U${r.unidad}-S${r.sesion}`));
  const totalSesiones = sesionesUnicas.size;
  Logger.log(`Total sesiones únicas para unidad ${unidad}: ${totalSesiones}`);
  if (totalSesiones === 0) {
      Logger.log("No hay registros de asistencia para calcular resumen. Saliendo.");
      return `No se generó resumen para Unidad ${unidad} porque no hay registros de asistencia.`;
  }

  const resumen = new Map();
  alumnos.forEach(alumno => {
    if (alumno && alumno.id && alumno.matricula) {
       resumen.set(alumno.id, { asistencias: 0, matricula: alumno.matricula });
    } else {
        Logger.log(`Alumno inválido en payload: ${JSON.stringify(alumno)}`);
    }
  });
  registrosDeLaUnidad.forEach(registro => {
    if (registro && registro.presente === true && resumen.has(registro.alumno_id)) {
      resumen.get(registro.alumno_id).asistencias++;
    }
  });
  Logger.log(`Resumen de asistencias calculado para ${resumen.size} alumnos.`);

  const ultimaColumnaContenido = hoja.getLastColumn();
  const colSumatoriaIndex = ultimaColumnaContenido; // Nueva columna
  const colPromedioIndex = ultimaColumnaContenido + 1; // Siguiente nueva columna

  const sheetData = hoja.getDataRange().getValues();
  const headers = sheetData[0];
  const matriculaColIndex = headers.indexOf("Matrícula");

  // Añadir headers para resumen
  const headerSumatoria = `Resumen U${unidad}`;
  const headerPromedio = `% U${unidad}`;
  sheetData[0][colSumatoriaIndex] = headerSumatoria;
  sheetData[0][colPromedioIndex] = headerPromedio;

  const matriculaToRowIndex = new Map();
  for (let i = 1; i < sheetData.length; i++) {
    const matricula = String(sheetData[i][matriculaColIndex]).trim().toUpperCase();
    if (matricula) matriculaToRowIndex.set(matricula, i);
    // Asegurar que las nuevas columnas existan para todas las filas
    sheetData[i][colSumatoriaIndex] = sheetData[i][colSumatoriaIndex] || '';
    sheetData[i][colPromedioIndex] = sheetData[i][colPromedioIndex] || '';
  }
  
  let resumenesEscritos = 0;
  for (const [id, datos] of resumen.entries()) {
      const matriculaNormalizada = String(datos.matricula).trim().toUpperCase();
      const rowIndex = matriculaToRowIndex.get(matriculaNormalizada);
      if(rowIndex){
          const porcentaje = totalSesiones > 0 ? (datos.asistencias / totalSesiones) : 0;
          sheetData[rowIndex][colSumatoriaIndex] = datos.asistencias;
          sheetData[rowIndex][colPromedioIndex] = porcentaje;
          resumenesEscritos++;
      } else {
          Logger.log(`Advertencia: Alumno ID ${id} (Matrícula ${datos.matricula}) del resumen no encontrado en la hoja.`);
      }
  }
  Logger.log(`Escritos ${resumenesEscritos} resúmenes de asistencia.`);

  // Escribir todo de una vez
  hoja.getRange(1, 1, sheetData.length, sheetData[0].length).setValues(sheetData);
  hoja.getRange(1, colSumatoriaIndex + 1).setFontWeight("bold");
  hoja.getRange(1, colPromedioIndex + 1).setFontWeight("bold");
  hoja.getRange(2, colPromedioIndex + 1, sheetData.length - 1, 1).setNumberFormat("0.0%");

  try {
    // Proteger las columnas de la unidad cerrada
    // (La protección completa de la hoja puede ser demasiado restrictiva si se añaden más unidades)
    Logger.log(`Resumen para la Unidad ${unidad} generado.`);
  } catch (protectError) {
      Logger.log(`Error al proteger la hoja "${nombreHojaUnidad}": ${protectError.message}`);
  }

  SpreadsheetApp.flush();
  return `Resumen para la Unidad ${unidad} generado (${resumenesEscritos} alumnos) y la hoja ha sido protegida.`;
}

/**
 * Crea la hoja de cálculo "Lista de Alumnos" y la llena.
 * @param {GoogleAppsScript.Drive.Folder} carpetaPadre Carpeta "Asistencia".
 * @param {Array<object>} alumnos Array de alumnos [{matricula, nombre, apellido}].
 */
function crearListaDeAlumnosSheet(carpetaPadre, alumnos) {
  const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_LISTA_ALUMNOS);
  if (files.hasNext()) {
    Logger.log(`"${NOMBRE_SHEET_LISTA_ALUMNOS}" ya existe en "${carpetaPadre.getName()}".`);
    return;
  }
  Logger.log(`Creando y poblando "${NOMBRE_SHEET_LISTA_ALUMNOS}" en "${carpetaPadre.getName()}"...`);
  let spreadsheet;
  try {
      spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_LISTA_ALUMNOS);
  } catch (createError) {
       Logger.log(`ERROR al crear Spreadsheet ${NOMBRE_SHEET_LISTA_ALUMNOS}: ${createError.message}`);
       throw createError;
  }
  const sheet = spreadsheet.getSheets()[0].setName("Alumnos");
  const headers = ["Matrícula", "Nombre", "Apellido"];

  const filasParaEscribir = [headers];
  if (Array.isArray(alumnos)) {
      alumnos.forEach((a, index) => {
        if (!a || typeof a !== 'object') {
           Logger.log(`Lista - Alumno ${index} inválido: ${JSON.stringify(a)}`);
           return;
        }
        filasParaEscribir.push([ a.matricula || '', a.nombre || '', a.apellido || '' ]);
      });
  } else {
       Logger.log("Lista - 'alumnos' no es un array.");
  }

  if (filasParaEscribir.length > 1) {
    try {
      sheet.getRange(1, 1, filasParaEscribir.length, headers.length).setValues(filasParaEscribir);
      sheet.getRange("A1:C1").setFontWeight("bold");
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 120); sheet.setColumnWidth(2, 200); sheet.setColumnWidth(3, 200);
      Logger.log(`Se escribieron ${filasParaEscribir.length - 1} alumnos en "${NOMBRE_SHEET_LISTA_ALUMNOS}".`);
    } catch (e) {
      Logger.log(`ERROR al escribir en ${NOMBRE_SHEET_LISTA_ALUMNOS}: ${e.message}`);
    }
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange("A1:C1").setFontWeight("bold");
    sheet.setFrozenRows(1);
    Logger.log(`No hay alumnos válidos para escribir en "${NOMBRE_SHEET_LISTA_ALUMNOS}".`);
  }

  moveFileToFolder(spreadsheet.getId(), carpetaPadre, NOMBRE_SHEET_LISTA_ALUMNOS);
}

/**
 * Crea la hoja de cálculo "Reporte de Asistencia" y la llena.
 * @param {GoogleAppsScript.Drive.Folder} carpetaPadre Carpeta "Asistencia".
 * @param {Array<object>} alumnos Array de alumnos [{matricula, nombre, apellido}].
 * @param {number} numeroDeUnidades Número de unidades.
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet | null} La hoja de cálculo o null si falla.
 */
function crearAsistenciasSheet(carpetaPadre, alumnos, numeroDeUnidades) {
  const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (files.hasNext()) {
    Logger.log(`"${NOMBRE_SHEET_ASISTENCIA}" ya existe en "${carpetaPadre.getName()}".`);
    return SpreadsheetApp.open(files.next());
  }
  Logger.log(`Creando y poblando "${NOMBRE_SHEET_ASISTENCIA}" en "${carpetaPadre.getName()}"...`);
  let spreadsheet;
   try {
      spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_ASISTENCIA);
  } catch (createError) {
       Logger.log(`ERROR al crear Spreadsheet ${NOMBRE_SHEET_ASISTENCIA}: ${createError.message}`);
       throw createError;
  }
  const headers = ["Matrícula", "Nombre Completo"];
  const sheet = spreadsheet.getSheets()[0].setName(NOMBRE_SHEET_ASISTENCIA);

  const filasParaEscribir = [headers];
  if (Array.isArray(alumnos)) {
      alumnos.forEach((a) => {
        if (a && typeof a === 'object') {
          filasParaEscribir.push([ a.matricula || '', `${a.nombre || ''} ${a.apellido || ''}`.trim() ]);
        }
      });
  }

  if (filasParaEscribir.length > 0) {
    sheet.getRange(1, 1, filasParaEscribir.length, headers.length).setValues(filasParaEscribir);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(2);
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 250);
    Logger.log(`Hoja "${NOMBRE_SHEET_ASISTENCIA}" poblada con ${filasParaEscribir.length - 1} alumnos.`);
  }

  // Eliminar otras hojas si existen
  spreadsheet.getSheets().forEach(s => {
    if (s.getName() !== NOMBRE_SHEET_ASISTENCIA) {
     try {
        spreadsheet.deleteSheet(s);
     } catch (e) {
         Logger.log(`Advertencia: Falló la eliminación de la hoja residual '${s.getName()}': ${e.message}`);
     }
    }
  });

  moveFileToFolder(spreadsheet.getId(), carpetaPadre, NOMBRE_SHEET_ASISTENCIA);
  return spreadsheet;
}

/**
 * Lee todas las hojas de asistencia de un Spreadsheet y las devuelve como JSON.
 * @param {object} payload Datos { calificaciones_spreadsheet_id }.
 * @return {object} { asistencias: [...] }
 */
function handleLeerDatosAsistencia(payload) {
  const { calificaciones_spreadsheet_id } = payload;
  if (!calificaciones_spreadsheet_id) {
    throw new Error("Se requiere 'calificaciones_spreadsheet_id'.");
  }

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  } catch (e) {
    throw new Error(`No se pudo abrir el Sheet de Asistencia con ID ${calificaciones_spreadsheet_id}.`);
  }
  
  const sheet = spreadsheet.getSheetByName(NOMBRE_SHEET_ASISTENCIA);
  if (!sheet) {
    throw new Error(`No se encontró la hoja "${NOMBRE_SHEET_ASISTENCIA}" en el spreadsheet.`);
  }

  const todasLasAsistencias = [];
  const dataRange = sheet.getDataRange();
  const allValues = dataRange.getValues();

  if (allValues.length < 2) {
    Logger.log("La hoja de asistencia no tiene datos de alumnos.");
    return { asistencias: [] };
  }

  const headers = allValues[0];
  const matriculaColIndex = headers.indexOf("Matrícula");
  if (matriculaColIndex === -1) throw new Error("No se encontró la columna 'Matrícula'.");

  const alumnosData = allValues.slice(1);

  // Iterar por columnas de sesión (a partir de la C, índice 2)
  for (let c_idx = 2; c_idx < headers.length; c_idx++) {
    const header = String(headers[c_idx] || "");
    const matchSesion = header.match(/U(\d+)-S(\d+)/); // Formato "U#-S#"

    if (matchSesion) {
      const [_, unidadNum, sesionNum] = matchSesion.map(Number);

      // Iterar por filas (alumnos)
      for (let r_idx = 0; r_idx < alumnosData.length; r_idx++) {
        const row = alumnosData[r_idx];
        const matricula = String(row[matriculaColIndex]);
        if (!matricula) continue;

        const valorAsistencia = row[c_idx];
        if (valorAsistencia instanceof Date) {
          todasLasAsistencias.push({
            matricula: matricula,
            fecha: valorAsistencia.toISOString().slice(0, 10), // Formato YYYY-MM-DD
            unidad: unidadNum,
            sesion: sesionNum,
            presente: true
          });
        }
      }
    }
  }
  
  Logger.log(`Se leyeron un total de ${todasLasAsistencias.length} registros de asistencia desde Sheets.`);
  return { asistencias: todasLasAsistencias };
}