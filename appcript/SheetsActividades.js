/**
 * Guarda la calificación de una actividad cumpliendo DOS objetivos:
 * 1. Generar/Actualizar una hoja específica para esa actividad ("Reporte - Nombre Actividad").
 * 2. Actualizar la columna correspondiente en el Kardex de la Unidad ("Resumen - Unidad X").
 */
function handleGuardarCalificacionesActividad(payload) {
  Logger.log(`Procesando actividad: "${payload.nombre_actividad}" (U${payload.unidad})`);
  const { calificaciones_spreadsheet_id, unidad, nombre_actividad, calificaciones } = payload;

  if (!calificaciones_spreadsheet_id || !unidad || !nombre_actividad || !calificaciones) {
    throw new Error("Faltan datos requeridos.");
  }

  const spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);

  // --- PARTE A: REPORTE INDIVIDUAL DE LA ACTIVIDAD ---
  // Crea una pestaña exclusiva para esta tarea (ej: "Rep. Ensayo Revolución")
  const nombreHojaIndividual = `Rep. ${nombre_actividad}`.substring(0, 30); // Max 30 chars
  let sheetInd = spreadsheet.getSheetByName(nombreHojaIndividual);
  
  if (!sheetInd) {
    sheetInd = spreadsheet.insertSheet(nombreHojaIndividual);
    sheetInd.appendRow(["Matrícula", "Nombre Alumno", "Calificación", "Retroalimentación IA"]);
    sheetInd.setFrozenRows(1);
    sheetInd.getRange(1, 1, 1, 4).setFontWeight("bold");
    sheetInd.setColumnWidth(2, 200); // Nombre
    sheetInd.setColumnWidth(4, 400); // Retro
  }

  // Mapeamos para no duplicar filas en el reporte individual
  const dataInd = sheetInd.getDataRange().getValues();
  const mapInd = new Map();
  for (let i = 1; i < dataInd.length; i++) {
    mapInd.set(String(dataInd[i][0]).trim().toUpperCase(), i + 1);
  }

  // --- PARTE B: KARDEX DE LA UNIDAD (RESUMEN) ---
  const nombreHojaKardex = `Resumen - Unidad ${unidad}`;
  let sheetKardex = spreadsheet.getSheetByName(nombreHojaKardex);

  if (!sheetKardex) {
    sheetKardex = spreadsheet.insertSheet(nombreHojaKardex);
    sheetKardex.appendRow(["Matrícula", "Nombre Alumno"]);
    sheetKardex.setFrozenRows(1);
    sheetKardex.setFrozenColumns(2);
    sheetKardex.getRange(1, 1, 1, 2).setFontWeight("bold");
  }

  // Gestionar Columnas del Kardex (Buscar actividad o crearla)
  const headersKardex = sheetKardex.getRange(1, 1, 1, sheetKardex.getLastColumn() || 2).getValues()[0];
  let colIndexKardex = headersKardex.indexOf(nombre_actividad);

  if (colIndexKardex === -1) {
    colIndexKardex = headersKardex.length;
    sheetKardex.getRange(1, colIndexKardex + 1).setValue(nombre_actividad).setFontWeight("bold");
  }

  // Mapear Filas del Kardex
  const dataKardex = sheetKardex.getDataRange().getValues();
  const mapKardex = new Map();
  for (let i = 1; i < dataKardex.length; i++) {
    mapKardex.set(String(dataKardex[i][0]).trim().toUpperCase(), i + 1);
  }

  // --- EJECUCIÓN DE GUARDADO ---
  calificaciones.forEach(cal => {
    const matricula = String(cal.matricula || "S/M").trim().toUpperCase();
    const nota = cal.calificacion_final !== undefined ? cal.calificacion_final : cal.calificacion;
    const retro = cal.retroalimentacion || "";

    // 1. Guardar en Reporte Individual
    let rowInd = mapInd.get(matricula);
    if (rowInd) {
      sheetInd.getRange(rowInd, 3).setValue(nota);
      sheetInd.getRange(rowInd, 4).setValue(retro);
    } else {
      sheetInd.appendRow([matricula, cal.nombre, nota, retro]);
    }

    // 2. Guardar en Kardex
    let rowKardex = mapKardex.get(matricula);
    if (!rowKardex) {
      sheetKardex.appendRow([matricula, cal.nombre]);
      rowKardex = sheetKardex.getLastRow();
      mapKardex.set(matricula, rowKardex);
    }
    // Escribir solo la nota en la intersección
    sheetKardex.getRange(rowKardex, colIndexKardex + 1).setValue(nota);
  });

  SpreadsheetApp.flush();
  return { message: "Reportes actualizados correctamente." };
}