/**
 * @OnlyCurrentDoc
 */

// ------------------------------------------------------------------------------------------
// CONFIGURACIÓN PRINCIPAL
// ------------------------------------------------------------------------------------------
const CARPETA_RAIZ_ID = "1j7boqj1CEg9NUItM7MNp31YIuy1hhapT";
const NOMBRE_SHEET_MAESTRO_RUBRICAS = "Rúbricas de la Materia";
const NOMBRE_SHEET_PLAGIO = "Reportes de Plagio";
const NOMBRE_SHEET_CALIFICACIONES = "Reporte de Calificaciones";

// ------------------------------------------------------------------------------------------
// FUNCIÓN PRINCIPAL (doPost)
// ------------------------------------------------------------------------------------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    Logger.log(`Acción recibida: ${action}`);

    switch (action) {
      case 'create_materias_batch':
        return crearRespuestaExitosa(handleCreateMateriasBatch(payload));
      case 'create_activity_folder':
        return crearRespuestaExitosa(handleCreateActivityFolder(payload));
      case 'guardar_rubrica':
        return crearRespuestaExitosa(handleGuardarRubrica(payload));
      case 'guardar_reporte_plagio':
        return crearRespuestaExitosa(handleGuardarReportePlagio(payload));
      case 'get_multiple_file_contents':
        return crearRespuestaExitosa({ contenidos: handleGetMultipleFileContents(payload) });
      case 'get_folder_contents':
        return crearRespuestaExitosa({ archivos: handleGetFolderContents(payload) });
      case 'get_rubric_data':
        return crearRespuestaExitosa(handleGetRubricData(payload));
      case 'get_student_work_text':
        return crearRespuestaExitosa({ texto_trabajo: handleGetStudentWorkText(payload) });
      case 'write_justification':
        return crearRespuestaExitosa(handleWriteJustification(payload));
      case 'get_justification_text':
        return crearRespuestaExitosa(handleGetJustificationText(payload));
      case 'create_annotated_file':
        return crearRespuestaExitosa(handleCreateAnnotatedFile(payload));
      default:
        throw new Error(`Acción desconocida: "${action}"`);
    }
  } catch (error) {
    Logger.log(`ERROR: ${error.message}\nStack: ${error.stack}`);
    return crearRespuestaError(error.message);
  }
}

// ------------------------------------------------------------------------------------------
// MANEJADORES DE ACCIONES
// ------------------------------------------------------------------------------------------

function handleCreateMateriasBatch(payload) {
    if (!payload.docente || !payload.materias) throw new Error("Faltan datos de 'docente' o 'materias'.");
    const { docente, materias } = payload;
    const drive_urls = {};
    const rubricas_spreadsheet_ids = {};
    const plagio_spreadsheet_ids = {};
    const calificaciones_spreadsheet_ids = {};

    const carpetaRaiz = DriveApp.getFolderById(CARPETA_RAIZ_ID);
    const carpetaDocente = getOrCreateFolder(carpetaRaiz, docente.nombre);
    if (docente.email) carpetaDocente.addEditor(docente.email);

    for (const materia of materias) {
        const nombreCarpetaMateria = `${materia.nombre} - ${materia.semestre}`;
        const carpetaMateria = getOrCreateFolder(carpetaDocente, nombreCarpetaMateria);
        
        // Crear carpetas principales
        getOrCreateFolder(carpetaMateria, "Reportes");
        const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
        
        // Crear los 3 Sheets maestros dentro de "Actividades"
        const sheetRubricas = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
        const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);
        const sheetCalificaciones = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_CALIFICACIONES);
        
        drive_urls[materia.id] = carpetaMateria.getUrl();
        rubricas_spreadsheet_ids[materia.id] = sheetRubricas.getId();
        plagio_spreadsheet_ids[materia.id] = sheetPlagio.getId();
        calificaciones_spreadsheet_ids[materia.id] = sheetCalificaciones.getId();
    }
    return { drive_urls, rubricas_spreadsheet_ids, plagio_spreadsheet_ids, calificaciones_spreadsheet_ids };
}

function handleCreateActivityFolder(payload) {
  const { drive_url_materia, nombre_actividad, unidad } = payload;
  if (!drive_url_materia || !nombre_actividad || !unidad) {
    throw new Error("Faltan datos para crear la carpeta de la actividad.");
  }
  const carpetaId = drive_url_materia.split('/').pop();
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

function handleGuardarRubrica(payload) {
  const { rubricas_spreadsheet_id, nombre_actividad, criterios } = payload;
  if (!rubricas_spreadsheet_id || !nombre_actividad || !criterios) throw new Error("Faltan datos para guardar la rúbrica.");

  const spreadsheet = SpreadsheetApp.openById(rubricas_spreadsheet_id);

  const nombreHoja = nombre_actividad.substring(0, 100);
  const hojaExistente = spreadsheet.getSheetByName(nombreHoja);
  if (hojaExistente) spreadsheet.deleteSheet(hojaExistente);
  
  const nuevaHoja = spreadsheet.insertSheet(nombreHoja);
  const headers = ["Criterio de Evaluación", "Puntos"];
  const filas = criterios.map(c => [c.descripcion, c.puntos]);

  nuevaHoja.appendRow(headers);
  if (filas.length > 0) {
    nuevaHoja.getRange(2, 1, filas.length, headers.length).setValues(filas);
  }

  nuevaHoja.getRange("A1:B1").setFontWeight("bold");
  nuevaHoja.setColumnWidth(1, 400);
  nuevaHoja.setColumnWidth(2, 100);

  const rangoDatos = `'${nombreHoja}'!A1:B${filas.length + 1}`;
  return { rubrica_sheet_range: rangoDatos };
}

function handleGuardarReportePlagio(payload) {
  const { plagio_spreadsheet_id, reporte_plagio } = payload;
  if (!plagio_spreadsheet_id || !reporte_plagio) throw new Error("Faltan 'plagio_spreadsheet_id' o 'reporte_plagio'.");

  const spreadsheet = SpreadsheetApp.openById(plagio_spreadsheet_id);

  const fechaHoy = new Date().toISOString().slice(0, 10);
  const nombreHoja = `Reporte ${fechaHoy}`;
  let sheet = spreadsheet.getSheetByName(nombreHoja);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(nombreHoja, 0);
    sheet.appendRow(["Trabajo A (File ID)", "Trabajo B (File ID)", "% Similitud", "Fragmentos Similares"]);
    sheet.getRange("A1:D1").setFontWeight("bold");
  }

  reporte_plagio.forEach(item => sheet.appendRow([
      item.trabajo_A_id,
      item.trabajo_B_id,
      item.porcentaje_similitud,
      item.fragmentos_similares.join("\n\n")
    ]));
  
  sheet.autoResizeColumn(3);
  sheet.setColumnWidth(4, 400);
  return { message: "Reporte de plagio guardado exitosamente." };
}

function handleWriteJustification(payload) {
  const { calificaciones_spreadsheet_id, justificacion, alumno_id, actividad_id, unidad } = payload;
  const sheet_name = `Calificaciones_U${unidad}`;
  if (!calificaciones_spreadsheet_id || !justificacion || !actividad_id || !unidad) throw new Error("Faltan parámetros para escribir la justificación.");

  const spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  let sheet = spreadsheet.getSheetByName(sheet_name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheet_name);
    sheet.appendRow(["ID Alumno/Grupo", "ID Actividad", "Justificación"]);
  }
  
  sheet.appendRow([alumno_id, actividad_id, justificacion]);
  const celda = `C${sheet.getLastRow()}`;
  
  return { justificacion_sheet_cell: `'${sheet_name}'!${celda}` };
}

function handleGetRubricData(payload) {
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) {
    throw new Error("Faltan 'spreadsheet_id' o 'rubrica_sheet_range' para obtener los datos de la rúbrica.");
  }
  
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(rubrica_sheet_range);
  const values = range.getValues();
  
  const criterios = values.slice(1).map(row => {
    return {
      descripcion: row[0],
      puntos: row[1]
    };
  }).filter(c => c.descripcion && c.puntos !== '');

  return { criterios: criterios };
}

function handleGetStudentWorkText(payload) {
  const { drive_file_id } = payload;
  if (!drive_file_id) throw new Error("Falta 'drive_file_id'.");
  try {
    const file = DriveApp.getFileById(drive_file_id);
    const blob = file.getBlob();
    // Intenta detectar si es un Google Doc y exportarlo, si no, lo lee como texto.
    if (blob.getContentType() === MimeType.GOOGLE_DOCS) {
      return DocumentApp.openById(drive_file_id).getBody().getText();
    }
    return blob.getDataAsString('UTF-8');
  } catch (e) {
    throw new Error(`No se pudo leer el archivo con ID ${drive_file_id}: ${e.message}`);
  }
}

function handleGetJustificationText(payload) {
  const { spreadsheet_id, justificacion_sheet_cell } = payload;
  if (!spreadsheet_id || !justificacion_sheet_cell) {
    throw new Error("Faltan 'spreadsheet_id' o 'justificacion_sheet_cell'.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(justificacion_sheet_cell);
  const justificacion = range.getValue();
  return { justificacion_texto: justificacion };
}

function handleCreateAnnotatedFile(payload) {
  const { original_file_id, calificacion_obtenida, justificacion, carpeta_calificados_id } = payload;
  if (!original_file_id || calificacion_obtenida === undefined || !justificacion || !carpeta_calificados_id) {
    throw new Error("Faltan parámetros para crear el archivo anotado.");
  }

  const originalFile = DriveApp.getFileById(original_file_id);
  const carpetaCalificados = DriveApp.getFolderById(carpeta_calificados_id);

  const nuevoNombre = `[CALIFICADO] ${originalFile.getName()}`;
  const doc = DocumentApp.create(nuevoNombre);
  const body = doc.getBody();

  body.appendParagraph(`Reporte de Calificación`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(`Calificación Obtenida: ${calificacion_obtenida} / 100`).setBold(true);
  body.appendParagraph(`\n--- Retroalimentación / Justificación ---\n`).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(justificacion);
  
  doc.saveAndClose();
  const docFile = DriveApp.getFileById(doc.getId());
  
  docFile.moveTo(carpetaCalificados);
  
  return { annotated_file_id: docFile.getId(), annotated_file_url: docFile.getUrl() };
}

function handleGetMultipleFileContents(payload) {
  const { drive_file_ids } = payload;
  if (!drive_file_ids || !Array.isArray(drive_file_ids)) {
    throw new Error("Se requiere un array de 'drive_file_ids'.");
  }
  const contenidos = drive_file_ids.map(fileId => {
    try {
      const file = DriveApp.getFileById(fileId);
      const blob = file.getBlob();
      let texto = '';
      if (blob.getContentType() === MimeType.GOOGLE_DOCS) {
        texto = DocumentApp.openById(fileId).getBody().getText();
      } else {
        texto = blob.getDataAsString('UTF-8');
      }
      return { fileId: fileId, texto: texto };
    } catch (e) {
      Logger.log(`No se pudo leer el archivo con ID ${fileId}: ${e.message}`);
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
  const carpeta = DriveApp.getFolderById(drive_folder_id);
  const archivos = carpeta.getFiles();
  const listaArchivos = [];
  while (archivos.hasNext()) {
    const archivo = archivos.next();
    listaArchivos.push({
      id: archivo.getId(),
      nombre: archivo.getName()
    });
  }
  return listaArchivos;
}

// ------------------------------------------------------------------------------------------
// FUNCIONES AUXILIARES
// ------------------------------------------------------------------------------------------

function getOrCreateSheet(folder, sheetName) {
  const files = folder.getFilesByName(sheetName);
  if (files.hasNext()) {
    const fileId = files.next().getId();
    return SpreadsheetApp.openById(fileId);
  } else {
    const spreadsheet = SpreadsheetApp.create(sheetName);
    const file = DriveApp.getFileById(spreadsheet.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    const defaultSheet = spreadsheet.getSheetByName('Sheet1');
    if (defaultSheet) spreadsheet.deleteSheet(defaultSheet);
    return spreadsheet;
  }
}

function getOrCreateFolder(carpetaPadre, nombreSubcarpeta) {
  const carpetas = carpetaPadre.getFoldersByName(nombreSubcarpeta);
  if (carpetas.hasNext()) { return carpetas.next(); } 
  else { return carpetaPadre.createFolder(nombreSubcarpeta); }
}

function crearRespuestaExitosa(data) {
  return ContentService.createTextOutput(JSON.stringify({ status: "success", ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function crearRespuestaError(message) {
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
