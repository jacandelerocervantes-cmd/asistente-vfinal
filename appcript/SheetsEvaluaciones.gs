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

  const filasParaAnadir = calificaciones.map(cal => [
    cal.matricula || '',
    cal.nombre || '',
    nombre_evaluacion,
    unidad || '',
    cal.calificacion_final !== null && cal.calificacion_final !== undefined ? cal.calificacion_final : ''
  ]);

  if (filasParaAnadir.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, filasParaAnadir.length, headers.length)
           .setValues(filasParaAnadir);
      Logger.log(`Se añadieron ${filasParaAnadir.length} calificaciones para "${nombre_evaluacion}" en "${nombreHojaReporte}".`);
  }

  SpreadsheetApp.flush();
  return { message: `Se registraron ${filasParaAnadir.length} calificaciones en Google Sheets.` };
}