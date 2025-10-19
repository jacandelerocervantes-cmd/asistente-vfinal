/**
 * @OnlyCurrentDoc
 */

// ==========================================================================================
// CONFIGURACIÓN PRINCIPAL
// ==========================================================================================
const CARPETA_RAIZ_ID = "1j7boqj1CEg9NUItM7MNp31YIuy1hhapT";
const NOMBRE_SHEET_LISTA_ALUMNOS = "Lista de Alumnos";
const NOMBRE_SHEET_ASISTENCIA = "Reporte de Asistencia";
const NOMBRE_SHEET_MAESTRO_RUBRICAS = "Rúbricas de la Materia";
const NOMBRE_SHEET_PLAGIO = "Reportes de Plagio";


// ==========================================================================================
// MANEJADORES DE PETICIONES WEB (PUNTO DE ENTRADA)
// ==========================================================================================

/**
 * Maneja las peticiones GET (acceso directo a la URL).
 * Previene el error "doGet not found" y confirma que el script está activo.
 */
function doGet(e) {
  Logger.log("Petición GET recibida. Devolviendo mensaje informativo.");
  return ContentService.createTextOutput(
    "El script está activo y responde correctamente a peticiones POST."
  ).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Función principal que dirige todas las peticiones POST desde Supabase.
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    Logger.log(`Acción recibida: "${action}"`);

    switch (action) {
      case 'create_materias_batch':
        return crearRespuestaExitosa(handleCreateMateriasBatch(payload));
      case 'create_activity_folder':
        return crearRespuestaExitosa(handleCreateActivityFolder(payload));
      case 'guardar_rubrica':
        return crearRespuestaExitosa(handleGuardarRubrica(payload));
      case 'get_or_create_rubric_sheet':
        return crearRespuestaExitosa(handleGetOrCreateRubricSheet(payload));
      case 'guardar_reporte_plagio':
        return crearRespuestaExitosa(handleGuardarReportePlagio(payload));
      case 'log_asistencia':
        return crearRespuestaExitosa({ message: handleLogAsistencia(payload) });
      case 'cerrar_unidad':
        return crearRespuestaExitosa({ message: handleCerrarUnidad(payload) });
      case 'get_multiple_file_contents':
        return crearRespuestaExitosa({ contenidos: handleGetMultipleFileContents(payload) });
      case 'get_folder_contents':
        return crearRespuestaExitosa({ archivos: handleGetFolderContents(payload) });
      case 'get_rubric_text':
        return crearRespuestaExitosa({ texto_rubrica: handleGetRubricText(payload) });
      case 'get_rubric_data':
        return crearRespuestaExitosa(handleGetRubricData(payload));
      case 'get_student_work_text':
        return crearRespuestaExitosa(handleGetStudentWorkText(payload));
      case 'write_justification':
        return crearRespuestaExitosa(handleWriteJustification(payload));
      case 'get_justification_text':
        return crearRespuestaExitosa(handleGetJustificationText(payload));
      case 'create_annotated_file':
        return crearRespuestaExitosa(handleCreateAnnotatedFile(payload));
      // --- ¡NUEVA ACCIÓN! ---
      case 'guardar_calificacion_detallada':
        return crearRespuestaExitosa(handleGuardarCalificacionDetallada(payload));
      default:
        throw new Error(`Acción desconocida: "${action}"`);
    }
  } catch (error) {
    Logger.log(`ERROR GRAVE en doPost: ${error.message}\nStack: ${error.stack}`);
    return crearRespuestaError(error.message);
  }
}

// ==========================================================================================
// FUNCIONES AUXILIARES DE RESPUESTA JSON (LAS QUE FALTABAN)
// ==========================================================================================

/**
 * Envuelve los datos de una operación exitosa en una respuesta JSON estandarizada.
 * @param {object} data - El objeto con los datos a devolver.
 * @return {ContentService.TextOutput} La respuesta en formato JSON.
 */
function crearRespuestaExitosa(data) {
  return ContentService.createTextOutput(JSON.stringify({ status: "success", ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Envuelve un mensaje de error en una respuesta JSON estandarizada.
 * @param {string} message - El mensaje de error.
 * @return {ContentService.TextOutput} La respuesta en formato JSON.
 */
function crearRespuestaError(message) {
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ==========================================================================================
// MANEJADORES DE ACCIONES (LÓGICA PRINCIPAL)
// ==========================================================================================

function handleCreateMateriasBatch(payload) {
    if (!payload.docente || !payload.materias) {
        throw new Error("Payload inválido: faltan 'docente' o 'materias'.");
    }
    const { docente, materias } = payload;
    const carpetaRaiz = DriveApp.getFolderById(CARPETA_RAIZ_ID);
    const carpetaDocente = getOrCreateFolder(carpetaRaiz, docente.nombre);
    carpetaDocente.addEditor(docente.email);
    const results = { drive_urls: {}, rubricas_spreadsheet_ids: {}, plagio_spreadsheet_ids: {}, calificaciones_spreadsheet_ids: {} };

    for (const materia of materias) {
        const nombreCarpetaMateria = `${materia.nombre} - ${materia.semestre}`;
        const carpetaMateria = getOrCreateFolder(carpetaDocente, nombreCarpetaMateria);
        const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
        const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
        
        const alumnos = Array.isArray(materia.alumnos) ? materia.alumnos : [];

        crearListaDeAlumnosSheet(carpetaReportes, alumnos);
        const sheetAsistencia = crearAsistenciasSheet(carpetaReportes, alumnos, materia.unidades);
        const sheetRubricas = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
        const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);

        results.drive_urls[materia.id] = carpetaMateria.getUrl();
        results.rubricas_spreadsheet_ids[materia.id] = sheetRubricas.getId();
        results.plagio_spreadsheet_ids[materia.id] = sheetPlagio.getId();
        results.calificaciones_spreadsheet_ids[materia.id] = sheetAsistencia.getId();
    }
    return results;
}

function handleCreateActivityFolder(payload) {
  const { drive_url_materia, nombre_actividad, unidad } = payload;  if (!drive_url_materia || !nombre_actividad) {
    throw new Error("Faltan datos para crear la carpeta de la actividad.");
  }
  
  const carpetaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaId) throw new Error(`No se pudo extraer un ID válido de la URL de Drive: ${drive_url_materia}`);
  
  const carpetaMateria = DriveApp.getFolderById(carpetaId);  
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${unidad}`);
  const carpetaActividad = carpetaUnidad.createFolder(nombre_actividad);
  const carpetaEntregas = carpetaActividad.createFolder("Entregas");
  const carpetaCalificados = carpetaActividad.createFolder("Calificados");
  
  return { 
    drive_folder_id_actividad: carpetaActividad.getId(), 
    drive_folder_id_entregas: carpetaEntregas.getId(),
    drive_folder_id_calificados: carpetaCalificados.getId()
  };
}

/**
 * ¡NUEVA FUNCIÓN!
 * 1. Crea/actualiza el sheet de reporte detallado para una actividad.
 * 2. Actualiza el sheet de resumen de la unidad con la nueva calificación.
 */
function handleGuardarCalificacionDetallada(payload) {
  const { drive_url_materia, unidad, actividad, calificaciones } = payload;
  if (!drive_url_materia || !unidad || !actividad || !calificaciones) {
    throw new Error("Faltan datos para guardar las calificaciones.");
  }

  const carpetaMateria = DriveApp.getFolderById(extractDriveIdFromUrl(drive_url_materia));
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${unidad}`);

  // --- 1. Procesa el Reporte Detallado por Actividad ---
  const carpetaReportes = getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");
  const reporteDetalladoSheet = getOrCreateSheet(carpetaReportes, actividad.nombre);
  const sheetDetallado = reporteDetalladoSheet.getSheets()[0];
  
  if (sheetDetallado.getLastRow() < 1) {
    sheetDetallado.appendRow(["Matricula", "Equipo", "Calificacion", "Retroalimentacion y observaciones"]);
    sheetDetallado.setFrozenRows(1);
    sheetDetallado.setColumnWidth(4, 400);
  }
  
  calificaciones.forEach(cal => {
    sheetDetallado.appendRow([cal.matricula, cal.equipo || '', cal.calificacion, cal.retroalimentacion]);
  });

  // --- 2. Actualiza el Resumen de la Unidad ---
  const resumenUnidadSheet = getOrCreateSheet(carpetaUnidad, `Resumen Calificaciones - Unidad ${unidad}`);
  const sheetResumen = resumenUnidadSheet.getSheets()[0];
  
  if (sheetResumen.getLastRow() < 1) {
    sheetResumen.appendRow(["Matricula", "Nombre"]);
    sheetResumen.setFrozenRows(1);
  }

  // Busca o crea la columna para la actividad actual
  const headers = sheetResumen.getRange(1, 1, 1, sheetResumen.getLastColumn()).getValues()[0];
  let colIndex = headers.indexOf(actividad.nombre) + 1;
  if (colIndex === 0) {
    colIndex = sheetResumen.getLastColumn() + 1;
    sheetResumen.getRange(1, colIndex).setValue(actividad.nombre);
  }
  
  // Actualiza la calificación para cada alumno
  const matriculasEnSheet = sheetResumen.getRange(2, 1, sheetResumen.getLastRow(), 1).getValues().flat();
  calificaciones.forEach(cal => {
    let rowIndex = matriculasEnSheet.indexOf(cal.matricula) + 2;
    if (rowIndex === 1) { // Si no encuentra la matrícula, la añade
      sheetResumen.appendRow([cal.matricula, cal.nombre]);
      rowIndex = sheetResumen.getLastRow();
    }
    sheetResumen.getRange(rowIndex, colIndex).setValue(cal.calificacion);
  });

  return { message: "Reportes de calificación generados y actualizados." };
}

function handleGuardarRubrica(payload) {
  const { rubricas_spreadsheet_id, nombre_actividad, criterios } = payload;
  if (!rubricas_spreadsheet_id || !nombre_actividad || !criterios || !Array.isArray(criterios)) {
    throw new Error("Faltan datos para guardar la rúbrica.");
  }

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(rubricas_spreadsheet_id);
  } catch (e) {
    throw new Error(`No se pudo abrir la hoja de cálculo de rúbricas con ID '${rubricas_spreadsheet_id}'.`);
  }

  let sheet = spreadsheet.getSheets()[0];
  if (!sheet) {
    sheet = spreadsheet.insertSheet(NOMBRE_SHEET_MAESTRO_RUBRICAS);
  } else {
    sheet.setName(NOMBRE_SHEET_MAESTRO_RUBRICAS);
  }

  const lastRow = sheet.getLastRow();
  const startRow = lastRow > 0 ? lastRow + 2 : 1;

  sheet.getRange(startRow, 1, 1, 2).merge().setValue(`Rúbrica para: ${nombre_actividad}`).setFontWeight("bold").setBackground("#cfe2f3");
  const headers = ["Criterio de Evaluación", "Puntos"];
  sheet.getRange(startRow + 1, 1, 1, 2).setValues([headers]).setFontWeight("bold");

  const filas = criterios.map(c => [c.descripcion, c.puntos]);
  if (filas.length > 0) {
    sheet.getRange(startRow + 2, 1, filas.length, headers.length).setValues(filas);
  }

  sheet.setColumnWidth(1, 400);
  sheet.setColumnWidth(2, 100);

  const endRow = startRow + 1 + filas.length;
  const rangoDatos = `'${sheet.getName()}'!A${startRow + 1}:B${endRow}`;
  
  return { 
    rubrica_spreadsheet_id: spreadsheet.getId(),
    rubrica_sheet_range: rangoDatos 
  };
}

function handleGuardarReportePlagio(payload) {
  const { drive_url_materia, reporte_plagio } = payload;
  if (!drive_url_materia || !reporte_plagio) {
    throw new Error("Faltan 'drive_url_materia' o 'reporte_plagio'.");
  }

  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);

  const fechaHoy = new Date().toISOString().slice(0, 10);
  const nombreHoja = `Reporte ${fechaHoy}`;
  let sheet = sheetPlagio.getSheetByName(nombreHoja);
  if (!sheet) {
    sheet = sheetPlagio.insertSheet(nombreHoja, 0);
    sheet.appendRow(["Trabajo A (File ID)", "Trabajo B (File ID)", "% Similitud", "Fragmentos Similares"]);
    sheet.getRange("A1:D1").setFontWeight("bold");
  }

  reporte_plagio.forEach(item => {
    sheet.appendRow([item.trabajo_A_id, item.trabajo_B_id, item.porcentaje_similitud, item.fragmentos_similares.join("\n\n")]);
  });
  
  sheet.setColumnWidth(4, 400);
  return { message: "Reporte de plagio guardado exitosamente." };
}

function handleLogAsistencia(payload) {
  const { drive_url, fecha, unidad, sesion, asistencias } = payload;
  if (!drive_url || !asistencias || !fecha || !unidad || !sesion) { throw new Error("Faltan datos para registrar la asistencia."); }
  
  const carpetaId = extractDriveIdFromUrl(drive_url);
  const carpetaMateria = DriveApp.getFolderById(carpetaId);
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}".`);
  
  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const hoja = hojaDeCalculo.getSheetByName(`Unidad ${unidad}`);
  if (!hoja) throw new Error(`No se encontró la pestaña "Unidad ${unidad}".`);
  
  const hoy = new Date(fecha + 'T12:00:00Z');
  const textoEncabezado = `${('0' + hoy.getDate()).slice(-2)}/${('0' + (hoy.getMonth() + 1)).slice(-2)}-${sesion}`;
  
  const primeraFila = hoja.getRange(1, 1, 1, hoja.getLastColumn() || 1).getValues()[0];
  let columnaParaHoy = primeraFila.indexOf(textoEncabezado) + 1;
  if (columnaParaHoy === 0) {
    columnaParaHoy = hoja.getLastColumn() + 1;
    hoja.getRange(1, columnaParaHoy).setValue(textoEncabezado);
  }
  
  const rangoAlumnos = hoja.getRange(2, 1, hoja.getLastRow() > 1 ? hoja.getLastRow() - 1 : 1, 1).getValues();
  const matriculaMap = new Map();
  rangoAlumnos.forEach((fila, index) => { if (fila[0]) { matriculaMap.set(String(fila[0]).trim(), index + 2); } });
  
  asistencias.forEach(asistencia => {
    const fila = matriculaMap.get(String(asistencia.matricula).trim());
    if (fila) { hoja.getRange(fila, columnaParaHoy).setValue(asistencia.presente ? 1 : 0).setHorizontalAlignment("center"); }
  });
  
  return `Se registraron ${asistencias.length} asistencias en la columna '${textoEncabezado}'.`;
}

function handleCerrarUnidad(payload) {
  const { drive_url, unidad, alumnos, registros_asistencia } = payload;
  if (!drive_url || !unidad || !alumnos || !registros_asistencia) { 
    throw new Error("Faltan datos para cerrar la unidad."); 
  }

  const carpetaId = extractDriveIdFromUrl(drive_url);
  const carpetaMateria = DriveApp.getFolderById(carpetaId);
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}".`);
  
  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const hoja = hojaDeCalculo.getSheetByName(`Unidad ${unidad}`);
  if (!hoja) throw new Error(`No se encontró la pestaña "Unidad ${unidad}".`);

  const totalSesiones = new Set(registros_asistencia.map(r => `${r.fecha}-${r.sesion}`)).size;
  const resumen = new Map();
  alumnos.forEach(alumno => {
    resumen.set(alumno.id, { asistencias: 0, matricula: alumno.matricula });
  });
  
  registros_asistencia.forEach(registro => {
    if (registro.presente && resumen.has(registro.alumno_id)) {
      resumen.get(registro.alumno_id).asistencias++;
    }
  });
  
  const ultimaColumna = hoja.getLastColumn();
  const colSumatoria = ultimaColumna + 1;
  const colPromedio = ultimaColumna + 2;
  
  hoja.getRange(1, colSumatoria).setValue("Total Asistencias").setFontWeight("bold");
  hoja.getRange(1, colPromedio).setValue("% Asistencia").setFontWeight("bold");
  
  const rangoMatriculas = hoja.getRange(2, 1, hoja.getLastRow() > 1 ? hoja.getLastRow() - 1 : 1, 1).getValues();
  const matriculaMap = new Map(rangoMatriculas.map((fila, index) => [String(fila[0]).trim(), index + 2]));

  for (const [id, datos] of resumen.entries()) {
      const fila = matriculaMap.get(String(datos.matricula).trim());
      if(fila){
          const porcentaje = totalSesiones > 0 ? (datos.asistencias / totalSesiones) : 0;
          hoja.getRange(fila, colSumatoria).setValue(datos.asistencias);
          hoja.getRange(fila, colPromedio).setValue(porcentaje).setNumberFormat("0.0%");
      }
  }

  const protection = hoja.protect().setDescription(`Unidad ${unidad} cerrada`);
  const me = Session.getEffectiveUser();
  protection.addEditor(me);
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) {
    protection.setDomainEdit(false);
  }
  
  return `Resumen para la Unidad ${unidad} generado y la hoja ha sido protegida.`;
}

function handleWriteJustification(payload) {
  const { drive_url_materia, justificacion, alumno_id, actividad_id, unidad } = payload;
  if (!drive_url_materia || !justificacion || !actividad_id || !unidad) {
    throw new Error("Faltan parámetros para escribir la justificación.");
  }

  const sheetName = `Calificaciones - Unidad ${unidad}`;

  // Navega a la carpeta correcta: Materia -> Actividades -> Unidad X
  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaMateriaId) throw new Error("URL de la materia no es válida.");

  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${unidad}`);

  // Obtiene o crea la hoja de cálculo específica para esta unidad
  const spreadsheet = getOrCreateSheet(carpetaUnidad, sheetName);
  let sheet = spreadsheet.getSheets()[0];
  sheet.setName("Calificaciones");

  // Añade encabezados si la hoja está vacía
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(["ID Alumno/Grupo", "ID Actividad", "Retroalimentación"]);
    sheet.setFrozenRows(1);
  }
  
  sheet.appendRow([alumno_id, actividad_id, justificacion]);
  const celda = `C${sheet.getLastRow()}`;
  
  return {
    spreadsheet_id: spreadsheet.getId(),
    justificacion_sheet_cell: `'${sheet.getName()}'!${celda}`
  };
}

function handleGetRubricData(payload) {
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) {
    throw new Error("Faltan 'spreadsheet_id' o 'rubrica_sheet_range' para obtener los datos de la rúbrica.");
  }
  
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(rubrica_sheet_range);
  const values = range.getValues();
  
  const criterios = values.slice(1).map(row => ({
    descripcion: row[0],
    puntos: row[1]
  })).filter(c => c.descripcion && c.puntos !== '');

  return { criterios: criterios };
}

function handleGetRubricText(payload) {
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) throw new Error("Faltan 'spreadsheet_id' o 'rubrica_sheet_range'.");
  
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(rubrica_sheet_range);
  const values = range.getValues();
  
  let textoRubrica = "RÚBRICA DE EVALUACIÓN:\n";
  values.forEach(row => {
    if(row[0] && row[1]) {
      textoRubrica += `- Criterio: "${row[0]}", Puntos Máximos: ${row[1]}\n`;
    }
  });
  return textoRubrica;
}

function handleGetStudentWorkText(payload) {
  const { drive_file_id } = payload;
  if (!drive_file_id) {
    throw new Error("Falta 'drive_file_id'.");
  }

  try {
    const file = DriveApp.getFileById(drive_file_id);
    const mimeType = file.getMimeType();
    let textContent = '';
    
    if (mimeType === MimeType.GOOGLE_DOCS) {
      textContent = DocumentApp.openById(file.getId()).getBody().getText();
    } else if (
      mimeType === MimeType.MICROSOFT_WORD ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === MimeType.PDF
    ) {
      const tempDoc = Drive.Files.copy({ title: `[TEMP] ${file.getName()}` }, file.getId(), { ocr: true, ocrLanguage: 'es' });
      try {
        textContent = DocumentApp.openById(tempDoc.id).getBody().getText();
      } finally {
        Drive.Files.remove(tempDoc.id);
      }
    } else if (mimeType.startsWith('text/')) {
        textContent = file.getBlob().getDataAsString('UTF-8');
    } else {
      throw new Error(`El archivo '${file.getName()}' no es un formato de texto legible.`);
    }
    
    return { texto_trabajo: textContent };
    
  } catch (e) {
    throw new Error(`No se pudo leer el contenido del archivo con ID ${drive_file_id}: ${e.message}`);
  }
}

function handleGetJustificationText(payload) {
  const { spreadsheet_id, justificacion_sheet_cell } = payload;
  if (!spreadsheet_id || !justificacion_sheet_cell) {
    throw new Error("Faltan 'spreadsheet_id' o 'justificacion_sheet_cell'.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(justificacion_sheet_cell);
  return { justificacion_texto: range.getValue() };
}

function handleCreateAnnotatedFile(payload) {
  const { original_file_id, calificacion_obtenida, justificacion, carpeta_calificados_id } = payload;
  if (!original_file_id || calificacion_obtenida === undefined || !justificacion || !carpeta_calificados_id) {
    throw new Error("Faltan parámetros para crear el archivo anotado.");
  }
  try {
    const originalFile = DriveApp.getFileById(original_file_id);
    const carpetaCalificados = DriveApp.getFolderById(carpeta_calificados_id);
    const nuevoNombre = `[CALIFICADO] ${originalFile.getName()}`;

    const doc = DocumentApp.create(nuevoNombre);
    const body = doc.getBody();
    
    body.appendParagraph(`Reporte de Calificación para: ${originalFile.getName()}`).setHeading(DocumentApp.ParagraphHeading.TITLE);
    body.appendParagraph();
    
    const tableData = [['Calificación Obtenida', `${calificacion_obtenida} / 100`], ['Fecha de Evaluación', new Date().toLocaleDateString('es-MX')]];
    body.appendTable(tableData);
    body.appendParagraph();

    body.appendParagraph('Retroalimentación Detallada').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(justificacion);
    
    doc.saveAndClose();
    
    const docFile = DriveApp.getFileById(doc.getId());
    docFile.moveTo(carpetaCalificados);
    
    return { annotated_file_id: docFile.getId(), annotated_file_url: docFile.getUrl() };

  } catch (e) {
    throw new Error(`No se pudo crear el archivo con anotaciones: ${e.message}`);
  }
}

function handleGetMultipleFileContents(payload) {
  const { drive_file_ids } = payload;
  if (!drive_file_ids || !Array.isArray(drive_file_ids)) {
    throw new Error("Se requiere un array de 'drive_file_ids'.");
  }
  const contenidos = drive_file_ids.map(fileId => {
    try {
      const file = DriveApp.getFileById(fileId);
      const texto = file.getBlob().getDataAsString('UTF-8');
      return { fileId: fileId, texto: texto };
    } catch (e) {
      return { fileId: fileId, texto: null, error: `No se pudo leer el archivo.` };
    }
  });
  return contenidos;
}

function handleGetFolderContents(payload) {
  const { drive_folder_id } = payload;
  if (!drive_folder_id) {
    throw new Error("Se requiere el 'drive_folder_id' para listar los archivos.");
  }
  try {
    const carpeta = DriveApp.getFolderById(drive_folder_id);
    const archivos = carpeta.getFiles();
    const listaArchivos = [];
    while (archivos.hasNext()) {
      const archivo = archivos.next();
      listaArchivos.push({ id: archivo.getId(), nombre: archivo.getName() });
    }
    return listaArchivos;
  } catch (e) {
    throw new Error(`No se pudo acceder a la carpeta de Drive con ID '${drive_folder_id}'.`);
  }
}

// ==========================================================================================
// FUNCIONES AUXILIARES DE DRIVE Y SHEETS
// ==========================================================================================

function getOrCreateFolder(carpetaPadre, nombreSubcarpeta) {
  const carpetas = carpetaPadre.getFoldersByName(nombreSubcarpeta);
  return carpetas.hasNext() ? carpetas.next() : carpetaPadre.createFolder(nombreSubcarpeta);
}

function getOrCreateSheet(folder, sheetName) {
  const files = folder.getFilesByName(sheetName);
  if (files.hasNext()) {
    return SpreadsheetApp.openById(files.next().getId());
  } else {
    const spreadsheet = SpreadsheetApp.create(sheetName);
    const file = DriveApp.getFileById(spreadsheet.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    spreadsheet.getSheets()[0].setName("Hoja Principal");
    return spreadsheet;
  }
}

function crearAsistenciasSheet(carpetaPadre, alumnos, numeroDeUnidades) {
  const archivosExistentes = carpetaPadre.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (archivosExistentes.hasNext()) {
    return SpreadsheetApp.open(archivosExistentes.next());
  }
  
  const spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_ASISTENCIA);
  const headers = ["Matrícula", "Nombre Completo"];
  const filasAlumnos = alumnos.map(a => [a.matricula, `${a.nombre} ${a.apellido}`.trim()]);

  for (let i = 1; i <= numeroDeUnidades; i++) {
    let hojaUnidad = (i === 1) ? spreadsheet.getSheets()[0].setName(`Unidad ${i}`) : spreadsheet.insertSheet(`Unidad ${i}`);
    hojaUnidad.appendRow(headers);
    if (filasAlumnos.length > 0) {
      hojaUnidad.getRange(2, 1, filasAlumnos.length, headers.length).setValues(filasAlumnos);
    }
    hojaUnidad.setFrozenRows(1);
    hojaUnidad.setFrozenColumns(2);
  }

  const file = DriveApp.getFileById(spreadsheet.getId());
  carpetaPadre.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return spreadsheet;
}

function crearListaDeAlumnosSheet(carpetaPadre, alumnos) {
  if (carpetaPadre.getFilesByName(NOMBRE_SHEET_LISTA_ALUMNOS).hasNext()) { return; }
  const spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_LISTA_ALUMNOS);
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName("Alumnos");
  const headers = ["Matrícula", "Nombre", "Apellido"];
  const filas = alumnos.map(a => [a.matricula, a.nombre, a.apellido]);
  sheet.appendRow(headers);
  if (filas.length > 0) { sheet.getRange(2, 1, filas.length, headers.length).setValues(filas); }
  sheet.setFrozenRows(1);
  const file = DriveApp.getFileById(spreadsheet.getId());
  carpetaPadre.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
}

function extractDriveIdFromUrl(driveUrl) {
  const match = driveUrl.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

function handleGetOrCreateRubricSheet(payload) {
  const { drive_url_materia } = payload;
  if (!drive_url_materia) {
    throw new Error("Falta 'drive_url_materia' para obtener/crear la hoja de rúbricas.");
  }
  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaMateriaId) {
    throw new Error(`No se pudo extraer un ID de Drive válido de la URL: ${drive_url_materia}`);
  }

  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const sheet = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
  return { rubricas_spreadsheet_id: sheet.getId() };
}