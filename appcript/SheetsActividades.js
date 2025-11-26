/**
 * Guarda la rúbrica de una actividad en el archivo de Rúbricas Maestras.
 * Crea una pestaña nueva con el nombre de la actividad.
 */
function handleGuardarRubrica(payload) {
  const { rubricas_spreadsheet_id, nombre_actividad, criterios } = payload;
  
  if (!rubricas_spreadsheet_id || !nombre_actividad) throw new Error("Faltan datos para guardar rúbrica.");

  const ss = SpreadsheetApp.openById(rubricas_spreadsheet_id);
  
  // Limpiar nombre de hoja (max 100 chars y caracteres prohibidos)
  const safeName = nombre_actividad.substring(0, 95).replace(/[:\/\\\?\*\[\]]/g, "-");
  
  let sheet = ss.getSheetByName(safeName);
  if (sheet) {
    sheet.clear(); // Si ya existe (ej. edición), limpiamos para reescribir
  } else {
    sheet = ss.insertSheet(safeName);
  }

  // Encabezados
  sheet.appendRow(["Criterio de Evaluación", "Puntos Máximos"]);
  sheet.getRange("A1:B1").setFontWeight("bold").setBackground("#f3f3f3");
  
  // Escribir criterios
  if (criterios && Array.isArray(criterios) && criterios.length > 0) {
    const filas = criterios.map(c => [c.descripcion, c.puntos]);
    sheet.getRange(2, 1, filas.length, 2).setValues(filas);
    
    // Totales
    const totalRow = filas.length + 2;
    sheet.getRange(`A${totalRow}`).setValue("TOTAL").setFontWeight("bold");
    sheet.getRange(`B${totalRow}`).setFormula(`=SUM(B2:B${totalRow-1})`).setFontWeight("bold");
  } else {
    sheet.appendRow(["Sin criterios definidos", 0]);
  }

  // Formato
  sheet.setColumnWidth(1, 400);
  sheet.setColumnWidth(2, 100);

  return {
    rubrica_spreadsheet_id: rubricas_spreadsheet_id,
    rubrica_sheet_range: `${safeName}!A1:B${criterios ? criterios.length + 2 : 2}`
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
 * [FUNCIÓN PRIVADA] Encuentra el índice de una columna por su nombre o la crea si no existe.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet La hoja donde buscar/crear la columna.
 * @param {string} columnName El nombre de la columna a encontrar/crear.
 * @return {number} El índice de la columna (basado en 0).
 */
function _findOrCreateColumn_(sheet, columnName) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) { // Hoja vacía
    return -1; // Se manejará en la lógica principal
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIndex = headers.indexOf(columnName);

  if (colIndex !== -1) {
    return colIndex;
  }
  // Si no existe, la crea y devuelve el nuevo índice
  sheet.getRange(1, lastCol + 1).setValue(columnName).setFontWeight("bold");
  return lastCol; // El nuevo índice es la última columna anterior
}

/**
 * Guarda las calificaciones detalladas de una actividad en su hoja específica y actualiza el resumen de la unidad.
 * @param {object} payload Datos {drive_url_materia, unidad, actividad:{nombre, id}, calificaciones:[{matricula, nombre?, equipo?, calificacion, retroalimentacion}]}.
 * @return {object} Objeto con mensaje y referencia a la celda de justificación.
 */
function handleGuardarCalificacionDetallada(payload) {
    Logger.log(`Iniciando handleGuardarCalificacionDetallada para actividad "${payload?.actividad?.nombre}"...`);

    const { drive_url_materia, unidad, actividad, calificaciones } = payload;

    if (!drive_url_materia || !unidad || !actividad || typeof actividad !== 'object' || !actividad.nombre || !calificaciones) {
        throw new Error("Faltan datos requeridos (drive_url_materia, unidad, actividad {nombre}, calificaciones).");
    }
    if (!Array.isArray(calificaciones) || calificaciones.length === 0) {
        throw new Error("El array 'calificaciones' está vacío o no es un array.");
    }

    // 1. Encontrar/Crear el Spreadsheet "Resumen" para esta Unidad
    const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
    if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url_materia}`);
    const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
    const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
    const nombreCarpetaUnidad = `Unidad ${unidad}`;
    const carpetaUnidad = getOrCreateFolder(carpetaActividades, nombreCarpetaUnidad);

    const nombreResumen = `Resumen Calificaciones - Unidad ${unidad}`;
    const resumenUnidadSS = getOrCreateSheet(carpetaUnidad, nombreResumen); // Este es el Archivo B
    const spreadsheetIdUnidad = resumenUnidadSS.getId(); // <-- ID del Archivo B

    // 2. Crear/Obtener la PESTAÑA para la Actividad (ej. "Actividad 1")
    const nombreSheetDetallado = actividad.nombre.replace(/[/\\?%*:|<>]/g, '_').substring(0, 100);
    let sheetDetallado = resumenUnidadSS.getSheetByName(nombreSheetDetallado);

    if (!sheetDetallado) {
        sheetDetallado = resumenUnidadSS.insertSheet(nombreSheetDetallado);
        Logger.log(`Hoja (pestaña) "${nombreSheetDetallado}" creada en Spreadsheet ID ${spreadsheetIdUnidad}.`);
    }

    // 3. Escribir detalles (justificación) en esa PESTAÑA
    const headersDetallado = ["Matricula", "Nombre Alumno", "Equipo", "Calificacion", "Retroalimentacion y observaciones"];
    if (sheetDetallado.getLastRow() < 1) {
        sheetDetallado.appendRow(headersDetallado);
        sheetDetallado.getRange(1, 1, 1, headersDetallado.length).setFontWeight("bold").setFrozenRows(1);
        sheetDetallado.setColumnWidth(2, 250);
        sheetDetallado.setColumnWidth(5, 400);
    }

    const filasDetallado = calificaciones.map(cal => [
        cal.matricula || '', cal.nombre || '', cal.equipo || '',
        cal.calificacion !== undefined ? cal.calificacion : '',
        cal.retroalimentacion || ''
    ]);

    let primeraFilaNueva = 1;
    if (filasDetallado.length > 0) {
        primeraFilaNueva = sheetDetallado.getLastRow() + 1;
        sheetDetallado.getRange(primeraFilaNueva, 1, filasDetallado.length, headersDetallado.length)
            .setValues(filasDetallado).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    }

    // 4. Actualizar la PESTAÑA "Resumen" (la que tiene solo calificaciones)
    let sheetResumen = resumenUnidadSS.getSheetByName("Resumen");
    if (!sheetResumen) {
        try {
            sheetResumen = resumenUnidadSS.getSheets()[0];
            sheetResumen.setName("Resumen");
        } catch (e) {
            sheetResumen = resumenUnidadSS.insertSheet("Resumen", 0);
        }
    }

    if (sheetResumen) {
        if (sheetResumen.getLastRow() < 1) {
            const initialHeaders = ["Matricula", "Nombre Alumno"];
            sheetResumen.appendRow(initialHeaders);
            sheetResumen.getRange(1, 1, 1, initialHeaders.length).setFontWeight("bold");
            sheetResumen.setFrozenRows(1);
            sheetResumen.setColumnWidth(2, 250);
        }
        const colIndexActividad = _findOrCreateColumn_(sheetResumen, actividad.nombre);
        const dataRange = sheetResumen.getDataRange();
        const sheetData = dataRange.getValues();
        const matriculaToRowIndex = new Map();
        for (let i = 1; i < sheetData.length; i++) {
            const matricula = String(sheetData[i][0]).trim().toUpperCase();
            if (matricula) {
                matriculaToRowIndex.set(matricula, i);
            }
        }
        calificaciones.forEach(cal => {
            const matriculaNorm = String(cal.matricula || '').trim().toUpperCase();
            if (!matriculaNorm) return;
            const rowIndex = matriculaToRowIndex.get(matriculaNorm);
            const calificacionValor = cal.calificacion !== undefined ? cal.calificacion : '';

            if (rowIndex) {
                sheetData[rowIndex][colIndexActividad] = calificacionValor;
            } else {
                const nuevaFila = Array(sheetData[0].length).fill('');
                nuevaFila[0] = cal.matricula;
                nuevaFila[1] = cal.nombre || '';
                nuevaFila[colIndexActividad] = calificacionValor;
                sheetData.push(nuevaFila);
                matriculaToRowIndex.set(matriculaNorm, sheetData.length - 1);
            }
        });
        if (sheetData.length > 0) {
            sheetResumen.getRange(1, 1, sheetData.length, sheetData[0].length).setValues(sheetData);
        }
        Logger.log("Hoja de resumen actualizada.");
    }

    // 5. Crear la referencia de celda (limpia, sin comillas)
    let justificacionCellRef = null;
    const columnaRetro = headersDetallado.indexOf("Retroalimentacion y observaciones") + 1 || 5;
    justificacionCellRef = `${sheetDetallado.getName()}!${sheetDetallado.getRange(primeraFilaNueva, columnaRetro).getA1Notation()}`;
    Logger.log("Referencia de celda generada: " + justificacionCellRef);

    SpreadsheetApp.flush();

    // 6. DEVOLVER EL ID DEL ARCHIVO B
    return {
        message: "Reportes generados/actualizados.",
        justificacion_cell_ref: justificacionCellRef,
        justificacion_spreadsheet_id: spreadsheetIdUnidad // <-- ¡ID DEL ARCHIVO CORRECTO!
    };
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

/**
 * MANEJA LA ENTREGA DE UN ALUMNO.
 * Recibe un archivo en Base64 y lo guarda en la carpeta "Entregas"
 * de la actividad correspondiente.
 * Nombra el archivo usando el formato: "[MATRICULA] - Nombre Apellido - NombreArchivo.ext"
 *
 * @param {object} payload - El objeto con los datos.
 * @param {string} payload.actividad_drive_folder_id - El ID de la carpeta principal de la actividad.
 * @param {object} payload.alumno - Objeto con { id, nombre, apellido, matricula }.
 * @param {string} payload.fileName - El nombre original del archivo.
 * @param {string} payload.mimeType - El tipo MIME del archivo.
 * @param {string} payload.base64Data - El contenido del archivo en Base64 (ej. "data:image/png;base64,iVBORw...")
 * @returns {object} { fileUrl: string, fileId: string } - El enlace para ver el archivo y su ID.
 */
function handleEntregaActividad(payload) {
  const { 
    actividad_drive_folder_id, 
    alumno, 
    fileName, 
    mimeType, 
    base64Data 
  } = payload;

  if (!actividad_drive_folder_id || !alumno || !fileName || !mimeType || !base64Data) {
    throw new Error("Faltan datos para la entrega: se requiere ID de carpeta, datos del alumno, nombre de archivo, tipo y contenido.");
  }

  try {
    const parentFolder = DriveApp.getFolderById(actividad_drive_folder_id);
    
    const entregasFolder = getOrCreateFolder(parentFolder, DRIVE_ENTREGAS_FOLDER_NAME);

    const alumnoNombre = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();
    const alumnoMatricula = alumno.matricula || 'SIN_MATRICULA';
    const newFileName = `[${alumnoMatricula}] - ${alumnoNombre} - ${fileName}`;

    const data = base64Data.split(',')[1];
    if (!data) {
      throw new Error("El formato Base64 es inválido. Debe incluir el prefijo (ej. 'data:image/png;base64,').");
    }
    const decodedData = Utilities.base64Decode(data);
    const blob = Utilities.newBlob(decodedData, mimeType, newFileName);

    const file = entregasFolder.createFile(blob);
    Logger.log(`Archivo entregado: ${newFileName} (ID: ${file.getId()}) en la carpeta ${entregasFolder.getName()}`);

    return {
      fileUrl: file.getUrl(),
      fileId: file.getId()
    };

  } catch (e) {
    Logger.log(`Error en handleEntregaActividad: ${e.message}`);
    throw new Error(`Error al procesar la entrega en Google Drive: ${e.message}`);
  }
}

/**
 * Guarda calificaciones de ACTIVIDADES en una hoja separada "Reporte Actividades".
 * OPTIMIZADO: Usa mapa de búsqueda y escritura puntual para evitar Timeouts.
 */
function handleGuardarCalificacionesActividad(payload) {
  Logger.log(`Iniciando guardado Actividad: "${payload.nombre_evaluacion}"...`);
  const { calificaciones_spreadsheet_id, nombre_evaluacion, unidad, calificaciones } = payload;

  if (!calificaciones_spreadsheet_id || !nombre_evaluacion || !calificaciones) {
    throw new Error("Faltan datos requeridos.");
  }

  const spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  const nombreHoja = "Reporte Actividades";
  let sheet = spreadsheet.getSheetByName(nombreHoja);

  // 1. Crear hoja si no existe
  if (!sheet) {
    sheet = spreadsheet.insertSheet(nombreHoja);
    sheet.appendRow(["Matrícula", "Nombre Alumno", "Nombre Actividad", "Unidad", "Calificación", "Retroalimentación"]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
  }

  // 2. Mapear filas existentes (Matrícula + Actividad -> Fila)
  const data = sheet.getDataRange().getValues();
  const mapFilas = new Map(); // Clave: "MATRICULA|ACTIVIDAD" -> Valor: IndiceFila (Base 0)
  
  // Asumimos columnas fijas por rendimiento: A=0(Mat), C=2(Act)
  for (let i = 1; i < data.length; i++) {
    const key = `${String(data[i][0]).trim().toUpperCase()}|${String(data[i][2]).trim()}`;
    mapFilas.set(key, i + 1); // Guardamos fila base 1 para getRange
  }

  // 3. Escribir datos
  calificaciones.forEach(cal => {
    const key = `${String(cal.matricula).trim().toUpperCase()}|${String(nombre_evaluacion).trim()}`;
    const fila = mapFilas.get(key);
    const nota = cal.calificacion_final !== undefined ? cal.calificacion_final : cal.calificacion;

    if (fila) {
      // ACTUALIZAR (Columna E=5 para Nota, F=6 para Retro)
      sheet.getRange(fila, 5).setValue(nota);
      sheet.getRange(fila, 6).setValue(cal.retroalimentacion || "");
    } else {
      // INSERTAR
      sheet.appendRow([
        cal.matricula,
        cal.nombre,
        nombre_evaluacion,
        unidad,
        nota,
        cal.retroalimentacion || ""
      ]);
    }
  });

  SpreadsheetApp.flush(); // Forzar guardado inmediato
  return { message: "Guardado exitoso." };
}