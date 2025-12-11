/**
 * @OnlyCurrentDoc
 */

// ============================================================================
// MÓDULO SHEETS ACTIVIDADES
// Maneja Rúbricas, Reportes de Plagio y Calificaciones (Kardex y Detalles)
// ============================================================================

/**
 * Guarda la rúbrica apilada en una hoja maestra "Rúbricas".
 */
function handleGuardarRubrica(payload) {
  const { rubricas_spreadsheet_id, nombre_actividad, criterios } = payload;
  if (!rubricas_spreadsheet_id || !nombre_actividad) throw new Error("Faltan datos para guardar rúbrica.");

  const ss = SpreadsheetApp.openById(rubricas_spreadsheet_id);
  const SHEET_NAME = "Rúbricas";
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME, 0);
    const defaultSheet = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
    if (defaultSheet) try { ss.deleteSheet(defaultSheet); } catch(e) {}
  }

  const cleanName = nombre_actividad.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 50);
  const uniqueSuffix = Math.floor(Math.random() * 10000);
  const finalNamedRangeName = `R_${cleanName}_${uniqueSuffix}`;
  
  const startRow = sheet.getLastRow() + 1;
  const headerActividad = [[`ACTIVIDAD: ${nombre_actividad.toUpperCase()}`, ""]];
  const headerTabla = [["Criterio de Evaluación", "Puntos Máximos"]];
  
  let filasCriterios = [];
  if (criterios && criterios.length > 0) {
    filasCriterios = criterios.map(c => [c.descripcion, c.puntos]);
  } else {
    filasCriterios = [["Sin criterios definidos", 0]];
  }
  
  const totalPuntos = filasCriterios.reduce((sum, row) => sum + (Number(row[1])||0), 0);
  const filaTotal = [["TOTAL", totalPuntos]];
  const filaEspacio = [["", ""]];

  const bloqueCompleto = [
    ...headerActividad,
    ...headerTabla,
    ...filasCriterios,
    ...filaTotal,
    ...filaEspacio
  ];

  const range = sheet.getRange(startRow, 1, bloqueCompleto.length, 2);
  range.setValues(bloqueCompleto);

  sheet.getRange(startRow, 1, 1, 2).merge().setFontWeight("bold").setBackground("#e0f2f1").setFontSize(11).setBorder(true, true, true, true, true, true);
  sheet.getRange(startRow + 1, 1, 1, 2).setFontWeight("bold").setBackground("#f5f5f5").setBorder(true, true, true, true, true, true);
  sheet.getRange(startRow + 2, 1, filasCriterios.length, 2).setBorder(true, true, true, true, true, true).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sheet.getRange(startRow + 2 + filasCriterios.length, 1, 1, 2).setFontWeight("bold").setBackground("#fff9c4").setBorder(true, true, true, true, true, true);
  
  sheet.setColumnWidth(1, 450);
  sheet.setColumnWidth(2, 120);

  ss.setNamedRange(finalNamedRangeName, range);

  return {
    rubrica_spreadsheet_id: rubricas_spreadsheet_id,
    rubrica_sheet_range: finalNamedRangeName
  };
}

/**
 * Elimina la rúbrica usando el Rango Nombrado.
 */
function handleEliminarRubrica(payload) {
  const { rubricas_spreadsheet_id, rubrica_sheet_range } = payload;
  if (!rubricas_spreadsheet_id || !rubrica_sheet_range) return { message: "Faltan datos." };

  try {
    const ss = SpreadsheetApp.openById(rubricas_spreadsheet_id);
    const namedRange = ss.getNamedRange(rubrica_sheet_range);
    
    if (namedRange) {
      const range = namedRange.getRange();
      range.getSheet().deleteRows(range.getRow(), range.getNumRows());
      namedRange.remove();
      return { message: "Rúbrica eliminada." };
    } else {
      return { message: "Rúbrica no encontrada." };
    }
  } catch (e) {
    return { message: "Error no fatal al borrar rúbrica en Sheets." }; 
  }
}

/**
 * Guarda el reporte de plagio.
 */
function handleGuardarReportePlagio(payload) {
  const { drive_url_materia, reporte_plagio } = payload;
  if (!drive_url_materia || !reporte_plagio) throw new Error("Faltan datos.");

  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  const carpetaActividades = getOrCreateFolder(DriveApp.getFolderById(carpetaMateriaId), "Actividades");
  const sheetPlagioSS = getOrCreateSheet(carpetaActividades, "Reportes de Plagio");

  const fechaHoy = new Date().toISOString().slice(0, 10);
  const nombreHojaReporte = `Reporte ${fechaHoy}`;
  let sheet = sheetPlagioSS.getSheetByName(nombreHojaReporte);

  if (!sheet) {
    sheet = sheetPlagioSS.insertSheet(nombreHojaReporte, 0);
    sheet.appendRow(["Trabajo A", "Trabajo B", "% Similitud", "Observaciones"]);
    sheet.getRange(1, 1, 1, 4).setFontWeight("bold");
  }

  const filas = [];
  if (reporte_plagio.length > 0) {
    reporte_plagio.forEach(item => {
      filas.push([
          item.trabajo_A_id,
          item.trabajo_B_id,
          item.porcentaje_similitud,
          Array.isArray(item.fragmentos_similares) ? item.fragmentos_similares.join("\n") : '-'
      ]);
    });
  } else {
    filas.push(['-', '-', '0%', 'Sin similitudes.']);
  }

  if (filas.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, filas.length, 4).setValues(filas);
  }
  return { message: "Reporte de plagio guardado." };
}

/**
 * [CORREGIDO] Actualiza DOS archivos separados buscando la ruta correcta.
 */
function handleGuardarCalificacionesActividad(payload) {
  Logger.log(`Iniciando guardado separado para: "${payload.nombre_actividad}"`);
  // Nota: calificaciones_spreadsheet_id ya no es el destino del Kardex, sino una referencia.
  // Usaremos drive_url_materia para encontrar el archivo correcto.
  const { drive_url_materia, unidad, nombre_actividad, calificaciones } = payload;

  if (!drive_url_materia || !unidad || !calificaciones) {
    throw new Error("Faltan datos (drive_url_materia, unidad, calificaciones).");
  }

  // 1. Navegar a la carpeta de la Unidad
  const materiaId = extractDriveIdFromUrl(drive_url_materia);
  const carpetaMateria = DriveApp.getFolderById(materiaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${unidad}`);

  // =================================================================================
  // DESTINO 1: GRADEBOOK OFICIAL (Resumen Calificaciones - Unidad X)
  // =================================================================================
  const nombreArchivoResumen = `Resumen Calificaciones - Unidad ${unidad}`;
  // Buscamos el archivo. getOrCreateSheet usa "nombre" para crear o buscar.
  const resumenSS = getOrCreateSheet(carpetaUnidad, nombreArchivoResumen);
  
  let sheetKardex = resumenSS.getSheetByName("Resumen");
  if (!sheetKardex) {
    // Si se creó nuevo, puede que la hoja se llame "Datos" o "Hoja 1". Buscamos/Renombramos.
    if (resumenSS.getNumSheets() > 0) {
        sheetKardex = resumenSS.getSheets()[0];
        sheetKardex.setName("Resumen");
    } else {
        sheetKardex = resumenSS.insertSheet("Resumen");
    }
    // Inicializar cabeceras si está vacío
    if (sheetKardex.getLastRow() === 0) {
        sheetKardex.appendRow(["Matrícula", "Nombre Alumno"]);
        sheetKardex.setFrozenRows(1);
        sheetKardex.setFrozenColumns(2);
        sheetKardex.getRange("A1:B1").setFontWeight("bold");
    }
  }

  // Mapear Columnas y Filas del Kardex
  // Aseguramos que existan encabezados
  const lastCol = sheetKardex.getLastColumn();
  const headersKardex = lastCol > 0 ? sheetKardex.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim()) : [];
  
  let colIndex = headersKardex.indexOf(String(nombre_actividad).trim());
  if (colIndex === -1) {
    colIndex = headersKardex.length; // Nueva columna al final
    // Si la hoja estaba vacía (headersKardex.length es 0), esto pone en col 1 (A), lo cual sobreescribe Matrícula.
    // Corrección: Si headersKardex es < 2, aseguramos estructura base.
    if (colIndex < 2) {
         sheetKardex.getRange(1, 1, 1, 2).setValues([["Matrícula", "Nombre Alumno"]]).setFontWeight("bold");
         colIndex = 2; // La actividad empieza en col 3 (índice 2)
    }
    sheetKardex.getRange(1, colIndex + 1).setValue(nombre_actividad).setFontWeight("bold");
  }

  // Mapear alumnos existentes
  const dataKardex = sheetKardex.getDataRange().getValues();
  const mapRowsKardex = new Map();
  for (let i = 1; i < dataKardex.length; i++) {
    const mat = String(dataKardex[i][0]).trim().toUpperCase();
    if (mat) mapRowsKardex.set(mat, i + 1);
  }

  // Escribir NOTAS en el Kardex
  calificaciones.forEach(cal => {
    const mat = String(cal.matricula).trim().toUpperCase();
    if (!mat || mat === "S/M") return;

    let row = mapRowsKardex.get(mat);
    if (!row) {
      sheetKardex.appendRow([mat, cal.nombre]);
      row = sheetKardex.getLastRow();
      mapRowsKardex.set(mat, row);
    }
    // Escribir calificación
    sheetKardex.getRange(row, colIndex + 1).setValue(cal.calificacion_final);
  });
  Logger.log("Kardex de Unidad actualizado.");


  // =================================================================================
  // DESTINO 2: REPORTE DE DETALLES (Carpeta "Reportes por Actividad")
  // =================================================================================
  
  // CORRECCIÓN: Usar el nombre de carpeta correcto "Reportes por Actividad"
  const carpetaReportes = getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");

  const nombreArchivoReporte = `Reporte - ${nombre_actividad}`;
  // Usamos getOrCreateSheet aquí también para consistencia
  // NOTA: getOrCreateSheet busca un archivo dentro de un folder.
  const ssReporte = getOrCreateSheet(carpetaReportes, nombreArchivoReporte);

  let sheetDetalle = ssReporte.getSheetByName("Detalle");
  if (!sheetDetalle) {
    if (ssReporte.getNumSheets() > 0) {
        sheetDetalle = ssReporte.getSheets()[0];
        sheetDetalle.setName("Detalle");
    } else {
        sheetDetalle = ssReporte.insertSheet("Detalle");
    }
    
    if (sheetDetalle.getLastRow() === 0) {
      sheetDetalle.appendRow(["Matrícula", "Nombre", "Calificación", "Retroalimentación IA"]);
      sheetDetalle.setFrozenRows(1);
      sheetDetalle.getRange("A1:D1").setFontWeight("bold").setBackground("#e3f2fd");
      sheetDetalle.setColumnWidth(4, 500); // Ancho para la justificación
    }
  }

  const dataDetalle = sheetDetalle.getDataRange().getValues();
  const mapRowsDetalle = new Map();
  for (let i = 1; i < dataDetalle.length; i++) {
    mapRowsDetalle.set(String(dataDetalle[i][0]).trim().toUpperCase(), i + 1);
  }

  // Escribir detalles
  calificaciones.forEach(cal => {
    const mat = String(cal.matricula).trim().toUpperCase();
    if (!mat || mat === "S/M") return;

    let row = mapRowsDetalle.get(mat);
    if (row) {
      // Actualizar existente
      sheetDetalle.getRange(row, 3).setValue(cal.calificacion_final);
      sheetDetalle.getRange(row, 4).setValue(cal.retroalimentacion);
    } else {
      // Nuevo registro
      sheetDetalle.appendRow([mat, cal.nombre, cal.calificacion_final, cal.retroalimentacion]);
    }
  });

  SpreadsheetApp.flush();
  
  // Devolvemos el ID del archivo de reporte detallado para referencia futura si se necesita
  return { 
      message: "Proceso completo: Resumen de Unidad y Reporte Detallado actualizados.",
      reporte_spreadsheet_id: ssReporte.getId()
  };
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
 * [HELPER] Encuentra el índice de una columna por nombre o crea una nueva.
 */
function _findOrCreateColumn_(sheet, columnName) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return -1;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIndex = headers.indexOf(columnName);
  if (colIndex !== -1) return colIndex;
  
  sheet.getRange(1, lastCol + 1).setValue(columnName).setFontWeight("bold");
  return lastCol;
}