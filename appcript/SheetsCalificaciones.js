// appcript/SheetsCalificaciones.js
// Asume que las funciones de Utilities.js (extractDriveIdFromUrl) y DriveSetup.js (getOrCreateFolder, getOrCreateSheet) están disponibles.

/**
 * Cuenta el número de actividades y evaluaciones registradas en Sheets para una unidad.
 * @param {object} payload Datos { unidad, sheets_ids }
 * @return {object} { counts: { actividades: X, evaluaciones: Y } }
 */
function handleGetComponentCountsForUnit(payload) {
  Logger.log(`Iniciando handleGetComponentCountsForUnit para Unidad ${payload.unidad}...`);
  const { unidad, sheets_ids } = payload;
  if (!unidad || !sheets_ids || !sheets_ids.calificaciones_spreadsheet_id || !sheets_ids.actividades_drive_url) {
    throw new Error("Faltan 'unidad' o 'sheets_ids' (con calificaciones_spreadsheet_id y actividades_drive_url).");
  }
  
  let countActividades = 0;
  let countEvaluaciones = 0;

  try {
    // 1. Contar Actividades
    const carpetaMateriaId = extractDriveIdFromUrl(sheets_ids.actividades_drive_url);
    if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${sheets_ids.actividades_drive_url}`);
    
    const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
    const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
    const nombreCarpetaUnidad = `Unidad ${unidad}`;
    const carpetaUnidad = getOrCreateFolder(carpetaActividades, nombreCarpetaUnidad);

    const nombreResumen = `Resumen Calificaciones - Unidad ${unidad}`;
    const resumenUnidadSS = getOrCreateSheet(carpetaUnidad, nombreResumen);
    const sheetResumen = resumenUnidadSS.getSheetByName("Resumen");

    if (sheetResumen && sheetResumen.getLastColumn() > 0) {
      const headers = sheetResumen.getRange(1, 1, 1, sheetResumen.getLastColumn()).getValues()[0];
      // Contar columnas que NO son 'Matrícula' o 'Nombre Alumno'
      countActividades = headers.filter(h => h && String(h).toLowerCase() !== 'matrícula' && String(h).toLowerCase() !== 'nombre alumno').length;
      Logger.log(`Encontradas ${countActividades} columnas de actividad.`);
    } else {
      Logger.log(`Hoja 'Resumen' de actividades no encontrada o vacía para U${unidad}.`);
    }
  } catch (e) {
    Logger.log(`Advertencia: No se pudo leer el resumen de actividades para U${unidad}. ${e.message}`);
  }

  try {
    // 2. Contar Evaluaciones
    const reporteSheet = SpreadsheetApp.openById(sheets_ids.calificaciones_spreadsheet_id);
    const sheetEvaluaciones = reporteSheet.getSheetByName("Reporte Evaluaciones");

    if (sheetEvaluaciones && sheetEvaluaciones.getLastRow() > 1) {
      const data = sheetEvaluaciones.getDataRange().getValues();
      const headers = data[0];
      const unidadColIndex = headers.indexOf("Unidad");
      if (unidadColIndex === -1) throw new Error("No se encontró la columna 'Unidad' en 'Reporte Evaluaciones'.");

      const evaluacionesUnicas = new Set();
      const evaluacionColIndex = headers.indexOf("Evaluación"); // Nombre de la evaluación

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][unidadColIndex]) === String(unidad)) {
          evaluacionesUnicas.add(data[i][evaluacionColIndex]);
        }
      }
      countEvaluaciones = evaluacionesUnicas.size;
      Logger.log(`Encontradas ${countEvaluaciones} evaluaciones únicas para U${unidad}.`);
    } else {
       Logger.log(`Hoja 'Reporte Evaluaciones' no encontrada o vacía.`);
    }
  } catch (e) {
    Logger.log(`Advertencia: No se pudo leer 'Reporte Evaluaciones' para U${unidad}. ${e.message}`);
  }

  return { status: "success", counts: { actividades: countActividades, evaluaciones: countEvaluaciones } };
}

/**
 * Calcula y guarda la calificación final ponderada para una unidad.
 * @param {object} payload Datos { unidad, weights, sheets_ids }
 * @return {object} Mensaje de éxito.
 */
function handleCalculateAndSaveFinalGrade(payload) {
  Logger.log(`Iniciando handleCalculateAndSaveFinalGrade para Unidad ${payload.unidad}...`);
  const { unidad, weights, sheets_ids } = payload;
  if (!unidad || !weights || !sheets_ids || !sheets_ids.calificaciones_spreadsheet_id || !sheets_ids.actividades_drive_url) {
    throw new Error("Faltan 'unidad', 'weights' o 'sheets_ids'.");
  }

  const reporteSheet = SpreadsheetApp.openById(sheets_ids.calificaciones_spreadsheet_id);
  
  // 1. MAPA DE ASISTENCIA
  const mapAsistencia = new Map();
  const mapNombres = new Map(); // Mapa maestro de alumnos
  try {
    const sheetAsistencia = reporteSheet.getSheetByName(NOMBRE_SHEET_ASISTENCIA);
    const dataAsistencia = sheetAsistencia.getDataRange().getValues();
    const headersAsistencia = dataAsistencia[0];
    const matriculaColAsist = headersAsistencia.indexOf("Matrícula");
    const nombreColAsist = headersAsistencia.indexOf("Nombre Completo");
    const pctColAsist = headersAsistencia.indexOf(`% U${unidad}`);

    if (matriculaColAsist === -1 || pctColAsist === -1 || nombreColAsist === -1) {
      Logger.log(`Advertencia: Faltan columnas en '${NOMBRE_SHEET_ASISTENCIA}' (Matrícula, Nombre Completo, o % U${unidad}). Se usará 0.`);
    } else {
      for (let i = 1; i < dataAsistencia.length; i++) {
        const matricula = String(dataAsistencia[i][matriculaColAsist]).trim().toUpperCase();
        if (matricula) {
          mapNombres.set(matricula, dataAsistencia[i][nombreColAsist]);
          mapAsistencia.set(matricula, (parseFloat(dataAsistencia[i][pctColAsist]) || 0) * 100); // Convertir 0.85 -> 85
        }
      }
    }
    Logger.log(`Mapa de Asistencia creado para ${mapAsistencia.size} alumnos.`);
  } catch (e) {
    Logger.log(`Error al leer Asistencias: ${e.message}. Se usará 0.`);
  }

  // 2. MAPA DE ACTIVIDADES
  const mapActividades = new Map();
  try {
    const carpetaMateriaId = extractDriveIdFromUrl(sheets_ids.actividades_drive_url);
    const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
    const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
    const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${unidad}`);
    const resumenUnidadSS = getOrCreateSheet(carpetaUnidad, `Resumen Calificaciones - Unidad ${unidad}`);
    const sheetResumen = resumenUnidadSS.getSheetByName("Resumen");

    const dataActividades = sheetResumen.getDataRange().getValues();
    const headersActividades = dataActividades[0];
    const matriculaColAct = headersActividades.indexOf("Matrícula");

    for (let i = 1; i < dataActividades.length; i++) { // Filas (alumnos)
      const matricula = String(dataActividades[i][matriculaColAct]).trim().toUpperCase();
      if (matricula) {
        let suma = 0;
        let count = 0;
        for (let j = 0; j < headersActividades.length; j++) { // Columnas (actividades)
          if (j !== matriculaColAct && String(headersActividades[j]).toLowerCase() !== 'nombre alumno') {
            const calif = parseFloat(dataActividades[i][j]);
            if (!isNaN(calif)) {
              suma += calif;
              count++;
            }
          }
        }
        const promedio = (count > 0) ? (suma / count) : 0;
        mapActividades.set(matricula, promedio);
        if (!mapNombres.has(matricula)) mapNombres.set(matricula, dataActividades[i][headersActividades.indexOf("Nombre Alumno")]);
      }
    }
    Logger.log(`Mapa de Actividades (Promedio) creado para ${mapActividades.size} alumnos.`);
  } catch (e) {
    Logger.log(`Error al leer Actividades: ${e.message}. Se usará 0.`);
  }

  // 3. MAPA DE EVALUACIONES
  const mapEvaluaciones = new Map();
  try {
    const sheetEvaluaciones = reporteSheet.getSheetByName("Reporte Evaluaciones");
    const dataEvaluaciones = sheetEvaluaciones.getDataRange().getValues();
    const headersEvaluaciones = dataEvaluaciones[0];
    const matriculaColEval = headersEvaluaciones.indexOf("Matrícula");
    const unidadColEval = headersEvaluaciones.indexOf("Unidad");
    const califColEval = headersEvaluaciones.indexOf("Calificación Final");
    const nombreColEval = headersEvaluaciones.indexOf("Nombre Alumno");

    const sumasEval = new Map(); // { matricula: { suma: X, count: Y } }
    
    for (let i = 1; i < dataEvaluaciones.length; i++) {
      const matricula = String(dataEvaluaciones[i][matriculaColEval]).trim().toUpperCase();
      const unidadEval = String(dataEvaluaciones[i][unidadColEval]);
      
      if (matricula && unidadEval === String(unidad)) {
        const calif = parseFloat(dataEvaluaciones[i][califColEval]);
        if (!isNaN(calif)) {
          const actual = sumasEval.get(matricula) || { suma: 0, count: 0 };
          actual.suma += calif;
          actual.count++;
          sumasEval.set(matricula, actual);
        }
        if (!mapNombres.has(matricula)) mapNombres.set(matricula, dataEvaluaciones[i][nombreColEval]);
      }
    }
    
    sumasEval.forEach((val, matricula) => {
      mapEvaluaciones.set(matricula, (val.suma / val.count));
    });
    Logger.log(`Mapa de Evaluaciones (Promedio) creado para ${mapEvaluaciones.size} alumnos.`);
  } catch (e) {
    Logger.log(`Error al leer Evaluaciones: ${e.message}. Se usará 0.`);
  }

  // 4. CALCULAR Y ESCRIBIR REPORTE DE UNIDAD
  const nombreHojaUnidad = `Calificación Final - U${unidad}`;
  let sheetUnidad = reporteSheet.getSheetByName(nombreHojaUnidad);
  if (sheetUnidad) {
    sheetUnidad.clear(); 
  } else {
    sheetUnidad = reporteSheet.insertSheet(nombreHojaUnidad);
  }

  const headersFinales = [
    "Matrícula", 
    "Nombre Alumno", 
    `Asistencia (Ponderado ${weights.asistencia}pts)`, 
    `Actividades (Ponderado ${weights.actividades}pts)`, 
    `Evaluaciones (Ponderado ${weights.evaluaciones}pts)`, 
    "CALIFICACIÓN FINAL UNIDAD"
  ];
  const filasOutput = [headersFinales];

  mapNombres.forEach((nombre, matricula) => {
    const asistencia = mapAsistencia.get(matricula) || 0;
    const actividades = mapActividades.get(matricula) || 0;
    const evaluaciones = mapEvaluaciones.get(matricula) || 0;
    
    const puntajeAsist = (asistencia / 100) * weights.asistencia;
    const puntajeActiv = (actividades / 100) * weights.actividades;
    const puntajeEval = (evaluaciones / 100) * weights.evaluaciones;
    const final = puntajeAsist + puntajeActiv + puntajeEval;
    
    filasOutput.push([
      matricula,
      nombre,
      puntajeAsist,
      puntajeActiv,
      puntajeEval,
      final
    ]);
  });

  if (filasOutput.length > 1) {
    sheetUnidad.getRange(1, 1, filasOutput.length, headersFinales.length).setValues(filasOutput);
    // Formateo
    sheetUnidad.getRange(1, 1, 1, headersFinales.length).setFontWeight("bold");
    sheetUnidad.setFrozenRows(1);
    sheetUnidad.setColumnWidth(2, 250);
    sheetUnidad.getRange(2, 3, filasOutput.length - 1, 4).setNumberFormat("0.00");
  }

  Logger.log(`Reporte final para U${unidad} generado con ${filasOutput.length - 1} alumnos.`);
  SpreadsheetApp.flush();
  
  return { status: "success", message: `Reporte de Calificación Final para la Unidad ${unidad} generado exitosamente.` };
}


/**
 * Calcula y guarda la calificación final ponderada para todo el curso.
 * @param {object} payload Datos { num_unidades, sheets_ids }
 * @return {object} Mensaje de éxito.
 */
function handleCalculateAndSaveFinalCourseGrade(payload) {
  Logger.log(`Iniciando handleCalculateAndSaveFinalCourseGrade...`);
  const { num_unidades, sheets_ids } = payload;
  if (!num_unidades || !sheets_ids || !sheets_ids.calificaciones_spreadsheet_id) {
    throw new Error("Faltan 'num_unidades' o 'sheets_ids.calificaciones_spreadsheet_id'.");
  }
  
  const reporteSheet = SpreadsheetApp.openById(sheets_ids.calificaciones_spreadsheet_id);
  const peso_por_unidad = 100 / num_unidades;
  
  const mapAlumnos = new Map(); // <Matricula, { nombre: "...", puntajes: [U1, U2, ...] }>
  const listaNombresHojas = [];
  const headersDinamicos = [];

  // 1. Leer los datos de cada hoja de unidad
  for (let i = 1; i <= num_unidades; i++) {
    const nombreHoja = `Calificación Final - U${i}`;
    listaNombresHojas.push(nombreHoja);
    headersDinamicos.push(`U${i} (Pond. ${peso_por_unidad.toFixed(1)}pts)`);
    
    try {
      const sheetUnidad = reporteSheet.getSheetByName(nombreHoja);
      if (!sheetUnidad || sheetUnidad.getLastRow() < 2) {
        Logger.log(`Hoja '${nombreHoja}' no encontrada o vacía. Se usará 0 para esta unidad.`);
        continue; // Saltar a la siguiente unidad
      }
      
      const dataUnidad = sheetUnidad.getDataRange().getValues();
      const headersUnidad = dataUnidad[0];
      const matriculaCol = headersUnidad.indexOf("Matrícula");
      const nombreCol = headersUnidad.indexOf("Nombre Alumno");
      const califCol = headersUnidad.indexOf("CALIFICACIÓN FINAL UNIDAD");

      if (matriculaCol === -1 || califCol === -1) {
         Logger.log(`Advertencia: Faltan columnas en '${nombreHoja}'. Saltando...`);
         continue;
      }

      for (let j = 1; j < dataUnidad.length; j++) { // Iterar alumnos
        const matricula = String(dataUnidad[j][matriculaCol]).trim().toUpperCase();
        if (matricula) {
          const califUnidad = parseFloat(dataUnidad[j][califCol]) || 0;
          
          if (!mapAlumnos.has(matricula)) {
            mapAlumnos.set(matricula, {
              nombre: dataUnidad[j][nombreCol] || '',
              puntajes: Array(num_unidades).fill(0) // Crear array de ceros
            });
          }
          mapAlumnos.get(matricula).puntajes[i - 1] = califUnidad; // Asignar puntaje en la posición correcta
        }
      }
    } catch (e) {
      Logger.log(`Error al leer la hoja '${nombreHoja}': ${e.message}. Se usará 0 para esta unidad.`);
    }
  }

  // 2. Calcular y Escribir Reporte Final del Curso
  const nombreHojaFinal = "Calificación Final del CURSO";
  let sheetFinal = reporteSheet.getSheetByName(nombreHojaFinal);
  if (sheetFinal) {
    sheetFinal.clear();
  } else {
    sheetFinal = reporteSheet.insertSheet(nombreHojaFinal, 0); // Ponerla al inicio
  }
  
  const headersFinales = ["Matrícula", "Nombre Alumno", ...headersDinamicos, "CALIFICACIÓN FINAL CURSO"];
  const filasOutput = [headersFinales];

  mapAlumnos.forEach((data, matricula) => {
    let calificacionFinalCurso = 0;
    const puntajesPonderados = [];
    
    data.puntajes.forEach(puntajeUnidad => {
      // (puntajeUnidad / 100) * peso_por_unidad => (85 / 100) * 25 = 21.25
      const puntajePonderado = (puntajeUnidad / 100) * peso_por_unidad;
      puntajesPonderados.push(puntajePonderado);
      calificacionFinalCurso += puntajePonderado;
    });
    
    filasOutput.push([
      matricula,
      data.nombre,
      ...puntajesPonderados,
      calificacionFinalCurso
    ]);
  });
  
  if (filasOutput.length > 1) {
    sheetFinal.getRange(1, 1, filasOutput.length, headersFinales.length).setValues(filasOutput);
    // Formateo
    sheetFinal.getRange(1, 1, 1, headersFinales.length).setFontWeight("bold");
    sheetFinal.setFrozenRows(1);
    sheetFinal.setColumnWidth(2, 250);
    // Formatear todas las columnas de puntajes y la final
    sheetFinal.getRange(2, 3, filasOutput.length - 1, num_unidades + 1).setNumberFormat("0.00");
  }

  Logger.log(`Reporte final del CURSO generado con ${filasOutput.length - 1} alumnos.`);
  SpreadsheetApp.flush();
  
  return { status: "success", message: "Reporte de Calificación Final del Curso generado exitosamente." };
}


/**
 * Calcula y guarda la calificación final ponderada para todo el curso.
 * @param {object} payload Datos { num_unidades, sheets_ids }
 * @return {object} Mensaje de éxito.
 */
function handleCalculateAndSaveFinalCourseGrade(payload) {
  Logger.log(`Iniciando handleCalculateAndSaveFinalCourseGrade...`);
  const { num_unidades, sheets_ids } = payload;
  if (!num_unidades || !sheets_ids || !sheets_ids.calificaciones_spreadsheet_id) {
    throw new Error("Faltan 'num_unidades' o 'sheets_ids.calificaciones_spreadsheet_id'.");
  }
  
  const reporteSheet = SpreadsheetApp.openById(sheets_ids.calificaciones_spreadsheet_id);
  const peso_por_unidad = 100 / num_unidades;
  
  const mapAlumnos = new Map(); // <Matricula, { nombre: "...", puntajes: [U1, U2, ...] }>
  const listaNombresHojas = [];
  const headersDinamicos = [];

  // 1. Leer los datos de cada hoja de unidad
  for (let i = 1; i <= num_unidades; i++) {
    const nombreHoja = `Calificación Final - U${i}`;
    listaNombresHojas.push(nombreHoja);
    headersDinamicos.push(`U${i} (Pond. ${peso_por_unidad.toFixed(1)}pts)`);
    
    try {
      const sheetUnidad = reporteSheet.getSheetByName(nombreHoja);
      if (!sheetUnidad || sheetUnidad.getLastRow() < 2) {
        Logger.log(`Hoja '${nombreHoja}' no encontrada o vacía. Se usará 0 para esta unidad.`);
        continue; // Saltar a la siguiente unidad
      }
      
      const dataUnidad = sheetUnidad.getDataRange().getValues();
      const headersUnidad = dataUnidad[0];
      const matriculaCol = headersUnidad.indexOf("Matrícula");
      const nombreCol = headersUnidad.indexOf("Nombre Alumno");
      const califCol = headersUnidad.indexOf("CALIFICACIÓN FINAL UNIDAD");

      if (matriculaCol === -1 || califCol === -1) {
         Logger.log(`Advertencia: Faltan columnas en '${nombreHoja}'. Saltando...`);
         continue;
      }

      for (let j = 1; j < dataUnidad.length; j++) { // Iterar alumnos
        const matricula = String(dataUnidad[j][matriculaCol]).trim().toUpperCase();
        if (matricula) {
          const califUnidad = parseFloat(dataUnidad[j][califCol]) || 0;
          
          if (!mapAlumnos.has(matricula)) {
            mapAlumnos.set(matricula, {
              nombre: dataUnidad[j][nombreCol] || '',
              puntajes: Array(num_unidades).fill(0) // Crear array de ceros
            });
          }
          mapAlumnos.get(matricula).puntajes[i - 1] = califUnidad; // Asignar puntaje en la posición correcta
        }
      }
    } catch (e) {
      Logger.log(`Error al leer la hoja '${nombreHoja}': ${e.message}. Se usará 0 para esta unidad.`);
    }
  }

  // 2. Calcular y Escribir Reporte Final del Curso
  const nombreHojaFinal = "Calificación Final del CURSO";
  let sheetFinal = reporteSheet.getSheetByName(nombreHojaFinal);
  if (sheetFinal) {
    sheetFinal.clear();
  } else {
    sheetFinal = reporteSheet.insertSheet(nombreHojaFinal, 0); // Ponerla al inicio
  }
  
  const headersFinales = ["Matrícula", "Nombre Alumno", ...headersDinamicos, "CALIFICACIÓN FINAL CURSO"];
  const filasOutput = [headersFinales];

  mapAlumnos.forEach((data, matricula) => {
    let calificacionFinalCurso = 0;
    const puntajesPonderados = [];
    
    data.puntajes.forEach(puntajeUnidad => {
      // (puntajeUnidad / 100) * peso_por_unidad => (85 / 100) * 25 = 21.25
      const puntajePonderado = (puntajeUnidad / 100) * peso_por_unidad;
      puntajesPonderados.push(puntajePonderado);
      calificacionFinalCurso += puntajePonderado;
    });
    
    filasOutput.push([
      matricula,
      data.nombre,
      ...puntajesPonderados,
      calificacionFinalCurso
    ]);
  });
  
  if (filasOutput.length > 1) {
    sheetFinal.getRange(1, 1, filasOutput.length, headersFinales.length).setValues(filasOutput);
    // Formateo
    sheetFinal.getRange(1, 1, 1, headersFinales.length).setFontWeight("bold");
    sheetFinal.setFrozenRows(1);
    sheetFinal.setColumnWidth(2, 250);
    // Formatear todas las columnas de puntajes y la final
    sheetFinal.getRange(2, 3, filasOutput.length - 1, num_unidades + 1).setNumberFormat("0.00");
  }

  Logger.log(`Reporte final del CURSO generado con ${filasOutput.length - 1} alumnos.`);
  SpreadsheetApp.flush();
  
  return { status: "success", message: "Reporte de Calificación Final del Curso generado exitosamente." };
}

/**
 * LEE DATOS: Obtiene las calificaciones finales del curso.
 * Lee la hoja "Calificación Final del CURSO" y devuelve solo la columna de calificaciones.
 *
 * @param {object} payload - El payload con { spreadsheetId }.
 * @returns {object} Un objeto con la clave 'grades' que contiene un array de calificaciones (ej. [95, 88, 72.5])
 */
function handleGetFinalCourseGrades(payload) {
  const { spreadsheetId } = payload;
  if (!spreadsheetId) {
    throw new Error("Se requiere el 'spreadsheetId' de calificaciones.");
  }

  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(FINAL_COURSE_GRADE_SHEET_NAME);
    if (!sheet) {
      // Si la hoja no existe, es probable que no se haya corrido el reporte.
      // Devolvemos un array vacío en lugar de un error.
      Logger.log(`La hoja "${FINAL_COURSE_GRADE_SHEET_NAME}" no existe. Devolviendo vacío.`);
      return { grades: [] }; 
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { grades: [] }; // Hoja vacía
    }

    // Encontrar la última columna (la de "CALIFICACIÓN FINAL CURSO")
    const lastCol = sheet.getLastColumn();
    
    // Obtener solo la columna de calificaciones, empezando de la fila 2
    const gradesRange = sheet.getRange(2, lastCol, lastRow - 1, 1);
    const gradesValues = gradesRange.getValues();

    // Convertir a array de números
    const grades = gradesValues
      .map(row => parseFloat(row[0])) // Convertir a número
      .filter(grade => !isNaN(grade)); // Filtrar cualquier valor no numérico

    Logger.log(`Se obtuvieron ${grades.length} calificaciones del curso.`);
    return { grades: grades };

  } catch (error) {
    Logger.log(`Error en handleGetFinalCourseGrades: ${error.message}`);
    throw new Error(`Error al leer las calificaciones del curso: ${error.message}`);
  }
}

/**
 * LEE DATOS: Obtiene las calificaciones finales de una unidad específica.
 * Lee la hoja "Calificación Final - UX" y devuelve la columna de calificaciones.
 *
 * @param {object} payload - El payload con { spreadsheetId, unidad }.
 * @returns {object} Un objeto con la clave 'grades' que contiene un array de calificaciones (ej. [95, 88, 72.5])
 */
function handleGetFinalUnitGrades(payload) {
  const { spreadsheetId, unidad } = payload;
  if (!spreadsheetId || !unidad) {
    throw new Error("Se requiere 'spreadsheetId' y 'unidad'.");
  }

  const sheetName = `${FINAL_UNIT_GRADE_SHEET_PREFIX}${unidad}`;

  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`La hoja "${sheetName}" no existe. Devolviendo vacío.`);
      return { grades: [] };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { grades: [] }; // Hoja vacía
    }

    // Encontrar la última columna (la de "CALIFICACIÓN FINAL UNIDAD")
    const lastCol = sheet.getLastColumn();

    // Obtener solo la columna de calificaciones, empezando de la fila 2
    const gradesRange = sheet.getRange(2, lastCol, lastRow - 1, 1);
    const gradesValues = gradesRange.getValues();

    // Convertir a array de números
    const grades = gradesValues
      .map(row => parseFloat(row[0])) // Convertir a número
      .filter(grade => !isNaN(grade)); // Filtrar cualquier valor no numérico

    Logger.log(`Se obtuvieron ${grades.length} calificaciones de la unidad ${unidad}.`);
    return { grades: grades };

  } catch (error) {
    Logger.log(`Error en handleGetFinalUnitGrades: ${error.message}`);
    throw new Error(`Error al leer las calificaciones de la unidad ${unidad}: ${error.message}`);
  }
}

/**
 * Actualiza la "Sábana" de calificaciones (Matriz: Alumnos vs Actividades).
 * Si la columna de la actividad no existe, la crea.
 * Si el alumno no existe, lo añade.
 * Escribe la calificación en la intersección.
 */
function handleUpdateGradebook(payload) {
  Logger.log(`Iniciando updateGradebook para: "${payload.nombre_actividad}" (U${payload.unidad})`);
  const { calificaciones_spreadsheet_id, unidad, nombre_actividad, calificaciones } = payload;

  if (!calificaciones_spreadsheet_id || !unidad || !nombre_actividad || !calificaciones) {
    throw new Error("Faltan datos para Gradebook (spreadsheet_id, unidad, nombre_actividad, calificaciones).");
  }

  const spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  // Una hoja por Unidad para mantener orden: "Resumen Calificaciones - Unidad 1"
  const sheetName = `Resumen Calificaciones - Unidad ${unidad}`;
  let sheet = spreadsheet.getSheetByName(sheetName);

  // 1. Crear hoja si no existe
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    sheet.appendRow(["Matrícula", "Nombre Alumno"]); // Encabezados fijos
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(2);
    sheet.getRange(1, 1, 1, 2).setFontWeight("bold");
  }

  // 2. Gestionar Columnas (Buscar actividad o crearla)
  // Leemos solo la primera fila para buscar cabeceras
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 2).getValues()[0];
  
  // Normalizamos nombres para búsqueda (opcional, aquí exacto)
  let colIndex = headers.indexOf(nombre_actividad); // Base 0

  if (colIndex === -1) {
    // Nueva Actividad -> Nueva Columna
    colIndex = headers.length; 
    sheet.getRange(1, colIndex + 1).setValue(nombre_actividad).setFontWeight("bold");
    sheet.setColumnWidth(colIndex + 1, 100); // Ancho razonable para nota
    Logger.log(`Columna creada para "${nombre_actividad}" en índice ${colIndex}`);
  }

  // 3. Mapear Alumnos (Matrícula -> Fila)
  // Leemos columna A (Matrículas) para mapear rápido
  const lastRow = sheet.getLastRow();
  const mapAlumnos = new Map();
  
  if (lastRow > 1) {
    const matriculas = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < matriculas.length; i++) {
      const mat = String(matriculas[i][0]).trim().toUpperCase();
      if (mat) mapAlumnos.set(mat, i + 2); // Fila real (Base 1, +2 por header y array 0)
    }
  }

  // 4. Escribir Calificaciones
  calificaciones.forEach(cal => {
    const matricula = String(cal.matricula).trim().toUpperCase();
    if (!matricula || matricula === "S/M") return;

    let row = mapAlumnos.get(matricula);

    if (!row) {
      // Alumno nuevo -> Append row
      sheet.appendRow([matricula, cal.nombre]);
      row = sheet.getLastRow();
      mapAlumnos.set(matricula, row);
    }

    // Escribir Nota
    // getRange(row, column)
    const nota = cal.calificacion_final !== undefined ? cal.calificacion_final : cal.calificacion;
    sheet.getRange(row, colIndex + 1).setValue(nota);
  });

  SpreadsheetApp.flush();
  return { message: "Gradebook actualizado." };
}