/**
 * Guarda o actualiza una rúbrica en la hoja maestra de rúbricas.
 * @param {object} payload Datos (rubricas_spreadsheet_id, nombre_actividad, criterios).
 * @return {object} ID del spreadsheet y rango donde se guardó la rúbrica.
 */
function handleGuardarRubrica(payload) {
  Logger.log("Iniciando handleGuardarRubrica...");
  const { rubricas_spreadsheet_id, nombre_actividad, criterios } = payload;
  if (!rubricas_spreadsheet_id || !nombre_actividad || !criterios || !Array.isArray(criterios)) {
    throw new Error("Faltan datos requeridos: rubricas_spreadsheet_id, nombre_actividad, criterios (array).");
  }

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(rubricas_spreadsheet_id);
  } catch (e) {
    throw new Error(`No se pudo abrir la hoja de cálculo de rúbricas con ID '${rubricas_spreadsheet_id}'. Verifica permisos o ID.`);
  }

  let sheet = spreadsheet.getSheetByName(NOMBRE_SHEET_MAESTRO_RUBRICAS);
  if (!sheet) {
      if (spreadsheet.getSheets().length > 0) {
          sheet = spreadsheet.getSheets()[0].setName(NOMBRE_SHEET_MAESTRO_RUBRICAS);
      } else {
          sheet = spreadsheet.insertSheet(NOMBRE_SHEET_MAESTRO_RUBRICAS);
      }
      Logger.log(`Hoja "${NOMBRE_SHEET_MAESTRO_RUBRICAS}" creada/renombrada.`);
  }

  const lastRow = sheet.getLastRow();
  const startRow = lastRow > 0 ? lastRow + 2 : 1;

  sheet.getRange(startRow, 1, 1, 2).merge().setValue(`Rúbrica para: ${nombre_actividad}`).setFontWeight("bold").setBackground("#cfe2f3").setHorizontalAlignment("center");

  const headers = ["Criterio de Evaluación", "Puntos"];
  sheet.getRange(startRow + 1, 1, 1, 2).setValues([headers]).setFontWeight("bold");

  const filasCriterios = criterios.map(c => [c.descripcion || '', c.puntos !== undefined ? c.puntos : '']);
  if (filasCriterios.length > 0) {
    sheet.getRange(startRow + 2, 1, filasCriterios.length, headers.length).setValues(filasCriterios);
  }

  sheet.setColumnWidth(1, 400);
  sheet.setColumnWidth(2, 100);

  const endRow = startRow + 1 + filasCriterios.length;
  const rangoDatos = `'${sheet.getName()}'!A${startRow + 1}:B${endRow}`;
  Logger.log(`Rúbrica para "${nombre_actividad}" guardada en rango: ${rangoDatos}`);

  SpreadsheetApp.flush();
  return {
    rubrica_spreadsheet_id: spreadsheet.getId(),
    rubrica_sheet_range: rangoDatos
  };
}

/**
 * Guarda el reporte de plagio en la hoja correspondiente.
 * @param {object} payload Datos (drive_url_materia, reporte_plagio).
 * @return {object} Mensaje de éxito.
 */
function handleGuardarReportePlagio(payload) {
  Logger.log("Iniciando handleGuardarReportePlagio...");
  const { drive_url_materia, reporte_plagio } = payload;

  if (!drive_url_materia || reporte_plagio === undefined || reporte_plagio === null) {
      throw new Error("Faltan datos requeridos: drive_url_materia, reporte_plagio.");
  }
  if (!Array.isArray(reporte_plagio)) {
       throw new Error("'reporte_plagio' debe ser un array.");
  }

  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url_materia}`);
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const sheetPlagioSS = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);

  const fechaHoy = new Date().toISOString().slice(0, 10);
  const nombreHojaReporte = `Reporte ${fechaHoy}`;
  let sheet = sheetPlagioSS.getSheetByName(nombreHojaReporte);

  if (!sheet) {
    sheet = sheetPlagioSS.insertSheet(nombreHojaReporte, 0);
    const headers = ["Trabajo A (File ID)", "Trabajo B (File ID)", "% Similitud", "Fragmentos Similares / Observaciones"];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 100);
    sheet.setColumnWidth(4, 500);
    Logger.log(`Hoja "${nombreHojaReporte}" creada.`);
  }

  const filasParaAnadir = [];
  if (reporte_plagio.length > 0) {
    reporte_plagio.forEach(item => {
      const fragmentosTexto = Array.isArray(item.fragmentos_similares) ? item.fragmentos_similares.join("\n\n") : '-';
      filasParaAnadir.push([
          item.trabajo_A_id || 'N/A',
          item.trabajo_B_id || 'N/A',
          item.porcentaje_similitud !== undefined ? item.porcentaje_similitud : '0',
          fragmentosTexto
      ]);
    });
    Logger.log(`Preparadas ${filasParaAnadir.length} filas de similitud.`);
  } else {
    filasParaAnadir.push(['-', '-', '0%', 'No se encontraron similitudes significativas en esta comparación.']);
    Logger.log("Reporte vacío, se añadirá fila informativa.");
  }

  if (filasParaAnadir.length > 0) {
      try {
        sheet.getRange(sheet.getLastRow() + 1, 1, filasParaAnadir.length, filasParaAnadir[0].length)
             .setValues(filasParaAnadir)
             .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
         Logger.log(`Se añadieron ${filasParaAnadir.length} filas al reporte de plagio.`);
      } catch(e) {
         Logger.log(`ERROR al escribir en ${nombreHojaReporte}: ${e.message}`);
         throw new Error(`Error al escribir reporte de plagio: ${e.message}`);
      }
  }

  SpreadsheetApp.flush();
  return { message: "Reporte de plagio procesado y guardado exitosamente." };
}

/**
 * Guarda las calificaciones detalladas de una actividad en su hoja específica y actualiza el resumen de la unidad.
 * @param {object} payload Datos {drive_url_materia, unidad, actividad:{nombre, id}, calificaciones:[{matricula, nombre?, equipo?, calificacion, retroalimentacion}]}.
 * @return {object} Objeto con mensaje y referencia a la celda de justificación.
 */
function handleGuardarCalificacionDetallada(payload) {
  Logger.log(`Iniciando handleGuardarCalificacionDetallada para actividad "${payload?.actividad?.nombre}"...`);
  const { drive_url_materia, unidad, actividad, calificaciones } = payload;
  if (!drive_url_materia || !unidad || !actividad || typeof actividad !== 'object' || !actividad.nombre || !calificaciones) { throw new Error("Faltan datos requeridos (drive_url_materia, unidad, actividad {nombre}, calificaciones)."); }
  if (!Array.isArray(calificaciones) || calificaciones.length === 0) { throw new Error("El array 'calificaciones' está vacío o no es un array."); }

  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url_materia}`);
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const nombreCarpetaUnidad = `Unidad ${unidad}`;
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, nombreCarpetaUnidad);

  const carpetaReportesDetallados = getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");
  const nombreSheetDetallado = actividad.nombre.replace(/[/\\?%*:|"<>]/g, '_');
  const reporteDetalladoSS = getOrCreateSheet(carpetaReportesDetallados, nombreSheetDetallado);
  const sheetDetallado = reporteDetalladoSS.getSheets()[0];
  if (sheetDetallado.getName() !== "Detalle") {
      try { sheetDetallado.setName("Detalle"); } catch(e) { Logger.log(`Advertencia: No se pudo renombrar hoja a "Detalle": ${e.message}`); }
  }

  const headersDetallado = ["Matricula", "Nombre Alumno", "Equipo", "Calificacion", "Retroalimentacion y observaciones"];
  if (sheetDetallado.getLastRow() < 1) {
    sheetDetallado.appendRow(headersDetallado);
    sheetDetallado.getRange(1, 1, 1, headersDetallado.length).setFontWeight("bold");
    sheetDetallado.setFrozenRows(1);
    sheetDetallado.setColumnWidth(2, 250);
    sheetDetallado.setColumnWidth(5, 400);
  }

  const filasDetallado = calificaciones.map(cal => [
      cal.matricula || '',
      cal.nombre || '',
      cal.equipo || '',
      cal.calificacion !== undefined ? cal.calificacion : '',
      cal.retroalimentacion || ''
  ]);
  if (filasDetallado.length > 0) {
      try {
        sheetDetallado.getRange(sheetDetallado.getLastRow() + 1, 1, filasDetallado.length, headersDetallado.length)
             .setValues(filasDetallado)
             .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
      } catch(e) { Logger.log(`ERROR escribiendo en sheet detallado: ${e.message}`); }
  }
  const ultimaFilaDetalle = sheetDetallado.getLastRow();

  const nombreResumen = `Resumen Calificaciones - Unidad ${unidad}`;
  const resumenUnidadSS = getOrCreateSheet(carpetaUnidad, nombreResumen);
  const sheetResumen = resumenUnidadSS.getSheets()[0];
  if (sheetResumen.getName() !== "Resumen") {
     try { sheetResumen.setName("Resumen"); } catch(e) { Logger.log(`Advertencia: No se pudo renombrar hoja a "Resumen": ${e.message}`);}
  }

  let headersResumen;
  let colIndexActividad = -1;
  let lastHeaderColResumen = sheetResumen.getLastColumn();

  if (sheetResumen.getLastRow() < 1) {
    headersResumen = ["Matricula", "Nombre Alumno", actividad.nombre];
    sheetResumen.appendRow(headersResumen);
    sheetResumen.getRange(1, 1, 1, headersResumen.length).setFontWeight("bold");
    sheetResumen.setFrozenRows(1);
    sheetResumen.setColumnWidth(2, 250);
    colIndexActividad = 2;
    lastHeaderColResumen = headersResumen.length;
  } else {
    headersResumen = sheetResumen.getRange(1, 1, 1, lastHeaderColResumen || 1).getValues()[0];
    colIndexActividad = headersResumen.indexOf(actividad.nombre);
    if (colIndexActividad === -1) {
      colIndexActividad = (lastHeaderColResumen || 0);
      lastHeaderColResumen = colIndexActividad + 1;
      sheetResumen.getRange(1, lastHeaderColResumen).setValue(actividad.nombre).setFontWeight("bold");
    }
  }

  let matriculaToRowIndexResumen = new Map();
  const firstDataRowResumen = sheetResumen.getFrozenRows() + 1;
  const numDataRowsResumen = sheetResumen.getLastRow() - firstDataRowResumen + 1;
  if (numDataRowsResumen > 0) {
      const matriculasEnResumen = sheetResumen.getRange(firstDataRowResumen, 1, numDataRowsResumen, 1).getValues();
      matriculasEnResumen.forEach((row, index) => {
          const matricula = String(row[0]).trim().toUpperCase();
          if (matricula && !matriculaToRowIndexResumen.has(matricula)) {
              matriculaToRowIndexResumen.set(matricula, index + firstDataRowResumen);
          }
      });
  }
  Logger.log(`Mapeadas ${matriculaToRowIndexResumen.size} matrículas del Resumen.`);

  const colNumActividad = colIndexActividad + 1;
  const updatesResumen = {};
  const nuevasFilasResumen = [];

  calificaciones.forEach(cal => {
    const matriculaNorm = String(cal.matricula || '').trim().toUpperCase();
    if (!matriculaNorm) return;

    const rowIndex = matriculaToRowIndexResumen.get(matriculaNorm);
    const calificacionValor = cal.calificacion !== undefined ? cal.calificacion : '';

    if (rowIndex) {
      if (!updatesResumen[rowIndex]) updatesResumen[rowIndex] = {};
      updatesResumen[rowIndex][colNumActividad] = calificacionValor;
    } else {
      const nuevaFila = Array(lastHeaderColResumen).fill('');
      nuevaFila[0] = cal.matricula;
      nuevaFila[1] = cal.nombre || '';
      nuevaFila[colIndexActividad] = calificacionValor;
      nuevasFilasResumen.push(nuevaFila);
      matriculaToRowIndexResumen.set(matriculaNorm, sheetResumen.getLastRow() + nuevasFilasResumen.length);
    }
  });

  if (nuevasFilasResumen.length > 0) {
      try {
        sheetResumen.getRange(sheetResumen.getLastRow() + 1, 1, nuevasFilasResumen.length, lastHeaderColResumen)
                    .setValues(nuevasFilasResumen);
        Logger.log(`Añadidas ${nuevasFilasResumen.length} nuevas filas al Resumen.`);
      } catch(e) { Logger.log(`ERROR añadiendo nuevas filas al Resumen: ${e.message}`);}
  }

  const rangesToUpdate = [];
  const valuesToUpdate = [];
  for (const rowIdx in updatesResumen) {
      for (const colIdx in updatesResumen[rowIdx]) {
          rangesToUpdate.push(sheetResumen.getRange(parseInt(rowIdx, 10), parseInt(colIdx, 10)));
          valuesToUpdate.push(updatesResumen[rowIdx][colIdx]);
      }
  }
  if (rangesToUpdate.length > 0) {
      try {
          Logger.log(`Actualizando ${rangesToUpdate.length} celdas existentes en Resumen...`);
          rangesToUpdate.forEach((range, i) => range.setValue(valuesToUpdate[i]));
          Logger.log(`Actualizaciones en Resumen completadas.`);
      } catch(e) { Logger.log(`ERROR actualizando celdas en Resumen: ${e.message}`);}
  }

  let justificacionCellRef = null;
  if (ultimaFilaDetalle > 1) {
      const columnaRetro = headersDetallado.indexOf("Retroalimentacion y observaciones") + 1 || 4;
      justificacionCellRef = `'${sheetDetallado.getName()}'!${sheetDetallado.getRange(ultimaFilaDetalle, columnaRetro).getA1Notation()}`;
  }
   Logger.log("Referencia de celda de justificación generada: " + justificacionCellRef);

  SpreadsheetApp.flush();
  return { message: "Reportes generados/actualizados.", justificacion_cell_ref: justificacionCellRef };
}

/**
 * Obtiene o crea una hoja de cálculo dentro de una carpeta específica.
 * @param {GoogleAppsScript.Drive.Folder} folder El objeto Folder donde buscar/crear el archivo.
 * @param {string} sheetName El nombre deseado para la hoja de cálculo.
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet | null} El objeto Spreadsheet encontrado o creado, o null si falla.
 */
function getOrCreateSheet(folder, sheetName) {
   if (!folder || typeof folder.getFilesByName !== 'function') {
      Logger.log(`ERROR: folder inválido en getOrCreateSheet para "${sheetName || ''}"`);
      throw new Error(`Error interno: Objeto folder inválido.`);
  }
   const nameNormalized = String(sheetName || '').trim();
   if (!nameNormalized) {
       Logger.log(`ERROR: Nombre de sheet vacío.`);
       throw new Error(`Error interno: Nombre de sheet no puede estar vacío.`);
   }

  try {
    const files = folder.getFilesByName(nameNormalized);
    if (files.hasNext()) {
      const file = files.next();
      return SpreadsheetApp.openById(file.getId());
    } else {
      Logger.log(`Creando sheet: "${nameNormalized}" dentro de "${folder.getName()}"`);
      const spreadsheet = SpreadsheetApp.create(nameNormalized);
      const fileId = spreadsheet.getId();

      moveFileToFolder(fileId, folder, nameNormalized);

      try {
        const sheets = spreadsheet.getSheets();
        if(sheets.length > 0 && sheets[0].getName() === "Sheet1") {
           sheets[0].setName("Datos");
        } else if (sheets.length === 0) {
           spreadsheet.insertSheet("Datos");
        }
      } catch (renameError) {
          Logger.log(`Advertencia: no se pudo renombrar/crear hoja principal en "${nameNormalized}": ${renameError.message}`);
      }

      return spreadsheet;
    }
  } catch (e) {
      Logger.log(`ERROR en getOrCreateSheet("${folder.getName()}", "${nameNormalized}"): ${e.message}\nStack: ${e.stack}`);
       throw e;
  }
}