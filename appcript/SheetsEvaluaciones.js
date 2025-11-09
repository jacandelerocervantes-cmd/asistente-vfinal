/**
 * Guarda las calificaciones finales de una evaluación en una hoja general de reportes.
 * @param {object} payload Datos {calificaciones_spreadsheet_id, nombre_evaluacion, unidad?, calificaciones:[{matricula, nombre?, calificacion_final}]}
 * @return {object} Mensaje de éxito.
 */
function handleGuardarCalificacionesEvaluacion(payload) {
  Logger.log(`Iniciando handleGuardarCalificacionesEvaluacion para "${payload.nombre_evaluacion}"...`);
  const { calificaciones_spreadsheet_id, nombre_evaluacion, unidad, calificaciones } = payload;

  if (!calificaciones_spreadsheet_id || !nombre_evaluacion || !calificaciones || !Array.isArray(calificaciones)) { throw new Error("Faltan datos (spreadsheet_id, nombre_evaluacion, calificaciones array)."); }
  if (calificaciones.length === 0) { Logger.log("No hay calificaciones para guardar."); return { message: "No había calificaciones para registrar." }; }

  let spreadsheet;
  try { spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id); }
  catch (e) { throw new Error(`No se pudo abrir Spreadsheet ID '${calificaciones_spreadsheet_id}'.`); }

  const nombreHojaReporte = "Reporte Evaluaciones";
  let sheet = spreadsheet.getSheetByName(nombreHojaReporte);
  const headers = ["Matrícula", "Nombre Alumno", "Evaluación", "Unidad", "Calificación Final"];

  if (!sheet) {
    sheet = spreadsheet.insertSheet(nombreHojaReporte);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 250); sheet.setColumnWidth(3, 250); // Anchos
    Logger.log(`Hoja "${nombreHojaReporte}" creada.`);
  }

  // --- REFACTORIZACIÓN: Lógica de Actualizar o Insertar ---

  // 1. Leer todos los datos y mapear registros existentes
  const sheetData = sheet.getDataRange().getValues();
  const matriculaColIndex = headers.indexOf("Matrícula");
  const evaluacionColIndex = headers.indexOf("Evaluación");
  const calificacionColIndex = headers.indexOf("Calificación Final");

  const existingRecords = new Map();
  // Empezar en 1 para saltar la fila de encabezados
  for (let i = 1; i < sheetData.length; i++) {
    const row = sheetData[i];
    const matricula = String(row[matriculaColIndex]).trim().toUpperCase();
    const evaluacion = String(row[evaluacionColIndex]).trim();
    if (matricula && evaluacion) {
      const key = `${matricula}-${evaluacion}`;
      existingRecords.set(key, i); // Guardar el índice de la fila
    }
  }
  Logger.log(`Mapeados ${existingRecords.size} registros existentes en la hoja.`);

  // 2. Procesar calificaciones del payload para actualizar o añadir
  let actualizados = 0;
  let anadidos = 0;
  calificaciones.forEach(cal => {
    const matriculaNorm = String(cal.matricula || '').trim().toUpperCase();
    if (!matriculaNorm) return;

    const key = `${matriculaNorm}-${nombre_evaluacion}`;
    const rowIndex = existingRecords.get(key);

    if (rowIndex) {
      // Actualizar registro existente en memoria
      sheetData[rowIndex][calificacionColIndex] = cal.calificacion_final;
      actualizados++;
    } else {
      // Añadir nueva fila al array en memoria
      const nuevaFila = [cal.matricula || '', cal.nombre || '', nombre_evaluacion, unidad || '', cal.calificacion_final];
      sheetData.push(nuevaFila);
      anadidos++;
    }
  });

  // 3. Escribir todos los datos de vuelta a la hoja
  sheet.getRange(1, 1, sheetData.length, sheetData[0].length).setValues(sheetData);
  Logger.log(`Proceso completado. Calificaciones actualizadas: ${actualizados}, añadidas: ${anadidos}.`);

  SpreadsheetApp.flush();
  return { message: `Se registraron ${anadidos + actualizados} calificaciones en Google Sheets.` };
}