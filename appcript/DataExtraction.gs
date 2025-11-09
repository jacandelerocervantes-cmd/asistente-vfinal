/**
 * Obtiene los criterios de una rúbrica específica.
 * @param {object} payload Datos {spreadsheet_id, rubrica_sheet_range}.
 * @return {object} Objeto con la clave 'criterios'.
 */
function handleGetRubricData(payload) {
  Logger.log(`Iniciando handleGetRubricData para rango ${payload.rubrica_sheet_range}...`);
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) {
    throw new Error("Faltan datos requeridos: 'spreadsheet_id' o 'rubrica_sheet_range'.");
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  let range;
  try {
     range = spreadsheet.getRange(rubrica_sheet_range);
  } catch(e) {
      throw new Error(`Rango inválido: "${rubrica_sheet_range}". Error: ${e.message}`);
  }

  const values = range.getValues();
  const criterios = values.slice(1)
      .map(row => ({
        descripcion: String(row[0] || '').trim(),
        puntos: Number(row[1]) || 0
      }))
      .filter(c => c.descripcion);

  Logger.log(`Encontrados ${criterios.length} criterios válidos.`);
  return { criterios: criterios };
}

/**
 * Obtiene el texto formateado de una rúbrica.
 * @param {object} payload Datos {spreadsheet_id, rubrica_sheet_range}.
 * @return {object} Objeto con la clave 'texto_rubrica'.
 */
function handleGetRubricText(payload) {
  Logger.log(`Iniciando handleGetRubricText para rango ${payload.rubrica_sheet_range}...`);
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) throw new Error("Faltan 'spreadsheet_id' o 'rubrica_sheet_range'.");

  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  let range;
  try { range = spreadsheet.getRange(rubrica_sheet_range); }
  catch(e) { throw new Error(`Rango inválido: "${rubrica_sheet_range}". Error: ${e.message}`); }

  const values = range.getValues();
  let textoRubrica = "RÚBRICA DE EVALUACIÓN:\n";
  values.slice(1).forEach(row => {
    if(row[0] && (row[1] !== undefined && row[1] !== null && row[1] !== '')) {
      textoRubrica += `- Criterio: "${String(row[0]).trim()}", Puntos Máximos: ${Number(row[1]) || 0}\n`;
    }
  });
  Logger.log("Texto de rúbrica generado.");
  return { texto_rubrica: textoRubrica };
}

/**
 * Extrae el texto de un archivo de Google Drive (Docs, Word, PDF, Texto).
 * @param {object} payload Datos {drive_file_id}.
 * @return {object} Objeto con la clave 'texto_trabajo'.
 */
function handleGetStudentWorkText(payload) {
  const { drive_file_id, fileMimeType } = payload;
  if (!drive_file_id) { throw new Error("Falta 'drive_file_id'."); }
  Logger.log(`Iniciando handleGetStudentWorkText para file ID ${drive_file_id}...`);

  let file;
  let mimeType;
  try {
    const partialFile = Drive.Files.get(drive_file_id, { fields: 'mimeType, title' });
    mimeType = partialFile.mimeType;
    Logger.log(`Extrayendo texto de fileId: ${drive_file_id}. MimeType (Provisto: ${fileMimeType}, Real: ${mimeType})`);
    file = DriveApp.getFileById(drive_file_id);
  } catch (e) {
     throw new Error(`No se pudo acceder al archivo con fileId ${drive_file_id}. ¿Permisos? Error: ${e.message}`);
  }
  
  if (!mimeType) {
      Logger.log(`Advertencia: Archivo ${drive_file_id} (${file.getName()}) no tiene mimeType. Saltando...`);
      return { texto_trabajo: `[Error: El archivo '${file.getName()}' no tiene un tipo de archivo definido y no puede ser procesado.]` };
  }
  Logger.log(`Procesando archivo: "${file.getName()}", Tipo MIME: ${mimeType}`);
  let textContent = '';

  try {
    if (mimeType === MimeType.GOOGLE_DOCS) {
      Logger.log("Leyendo como Google Doc...");
      textContent = DocumentApp.openById(file.getId()).getBody().getText();
    } else if (mimeType === MimeType.PDF) {
       Logger.log("Procesando PDF con OCR...");
       const blob = file.getBlob();
       const resource = { title: `[OCR TEMP] ${file.getName()}` , mimeType: MimeType.GOOGLE_DOCS };
       const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'es' });
       try {
          textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
          Logger.log("OCR completado.");
       } finally {
          try { Drive.Files.remove(ocrFile.id); Logger.log("Archivo OCR temporal eliminado."); }
          catch (removeError) { Logger.log(`Error al eliminar archivo OCR temporal ${ocrFile.id}: ${removeError.message}`); }
       }
    } else if (mimeType === MimeType.MICROSOFT_WORD || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
       Logger.log("Convirtiendo Word a Google Doc para leer texto...");
       const tempDoc = Drive.Files.copy({ title: `[TEMP CONVERT] ${file.getName()}`, mimeType: MimeType.GOOGLE_DOCS }, file.getId());
       try {
          textContent = DocumentApp.openById(tempDoc.id).getBody().getText();
          Logger.log("Conversión y lectura completadas.");
       } finally {
           try { Drive.Files.remove(tempDoc.id); Logger.log("Archivo temporal de conversión eliminado."); }
           catch (removeError) { Logger.log(`Error al eliminar archivo temporal de conversión ${tempDoc.id}: ${removeError.message}`); }
       }
    } else if (mimeType && mimeType.startsWith('text/')) {
        Logger.log("Leyendo como archivo de texto plano...");
        textContent = file.getBlob().getDataAsString('UTF-8');
    } else {
      Logger.log(`Tipo MIME ${mimeType} no soportado directamente. Intentando OCR...`);
      const blob = file.getBlob();
      const resource = { title: `[OCR TEMP fallback] ${file.getName()}` , mimeType: MimeType.GOOGLE_DOCS };
      const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'es' });
       try {
          textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
          Logger.log("OCR (fallback) completado.");
       } finally {
          try { Drive.Files.remove(ocrFile.id); } catch (e) {}
       }
       if (!textContent) {
           throw new Error(`El archivo '${file.getName()}' (tipo ${mimeType}) no es un formato de texto legible ni pudo ser procesado con OCR.`);
       }
    }
    Logger.log(`Texto extraído exitosamente (longitud: ${textContent.length}).`);
    return { texto_trabajo: textContent };
  } catch (e) {
    Logger.log(`ERROR en handleGetStudentWorkText para ID ${drive_file_id}: ${e.message}\nStack: ${e.stack}`);
    throw new Error(`No se pudo leer el contenido del archivo "${file.getName()}". Asegúrate de que sea un formato compatible (Docs, Word, PDF, Texto) y que el script tenga permisos. Error: ${e.message}`);
  }
}

/**
 * Obtiene el texto de justificación desde una celda específica en Google Sheets.
 * @param {object} payload Datos {spreadsheet_id, justificacion_sheet_cell}.
 * @return {object} Objeto con la clave 'justificacion_texto'.
 */
function handleGetJustificationText(payload) {
  Logger.log(`Iniciando handleGetJustificationText para celda ${payload.justificacion_sheet_cell}...`);
  const { spreadsheet_id, justificacion_sheet_cell } = payload;
  if (!spreadsheet_id || !justificacion_sheet_cell) {
    throw new Error("Faltan datos requeridos: 'spreadsheet_id' o 'justificacion_sheet_cell'.");
  }

  let spreadsheet;
  try {
     spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  } catch(e) {
     throw new Error(`No se pudo abrir Spreadsheet con ID ${spreadsheet_id}: ${e.message}`);
  }

  let range;
  try {
    range = spreadsheet.getRange(justificacion_sheet_cell);
  } catch (e) {
     throw new Error(`Referencia de celda inválida: "${justificacion_sheet_cell}" en Spreadsheet ID ${spreadsheet_id}. Error: ${e.message}`);
  }

  const value = range.getValue();
  const textoJustificacion = (value !== null && value !== undefined) ? String(value) : "";

  Logger.log(`Texto de justificación obtenido: "${textoJustificacion.substring(0,100)}..."`);
  return { justificacion_texto: textoJustificacion };
}

/**
 * Obtiene el contenido de texto de múltiples archivos de Drive.
 * @param {object} payload Datos {drive_file_ids: string[]}.
 * @return {object} Objeto con la clave 'contenidos' (array de {fileId, texto, error?}).
 */
function handleGetMultipleFileContents(payload) {
  Logger.log("Iniciando handleGetMultipleFileContents...");
  const { drive_file_ids } = payload;
  if (!drive_file_ids || !Array.isArray(drive_file_ids)) {
    throw new Error("Se requiere un array de 'drive_file_ids'.");
  }
  Logger.log(`Recibidos ${drive_file_ids.length} IDs de archivo.`);

  const contenidos = drive_file_ids.map(fileId => {
    try {
      const resultado = handleGetStudentWorkText({ drive_file_id: fileId });
      return { fileId: fileId, texto: resultado.texto_trabajo };
    } catch (e) {
      Logger.log(`Error al leer archivo ${fileId} en handleGetMultipleFileContents: ${e.message}`);
      return { fileId: fileId, texto: null, error: `No se pudo leer el archivo: ${e.message}` };
    }
  });

  const exitosos = contenidos.filter(c => c.texto !== null).length;
  Logger.log(`Lectura completada. Exitosos: ${exitosos}, Fallidos: ${drive_file_ids.length - exitosos}`);
  return contenidos;
}

/**
 * Lista los archivos dentro de una carpeta de Google Drive.
 * @param {object} payload Datos {drive_folder_id}.
 * @return {object} Objeto con la clave 'archivos' (array de {id, nombre}).
 */
function handleGetFolderContents(payload) {
  Logger.log(`Iniciando handleGetFolderContents para folder ID ${payload.drive_folder_id}...`);
  const { drive_folder_id } = payload;
  if (!drive_folder_id) {
    throw new Error("Se requiere el 'drive_folder_id' para listar los archivos.");
  }

  let carpeta;
  try {
    carpeta = DriveApp.getFolderById(drive_folder_id);
  } catch (e) {
    throw new Error(`No se pudo encontrar o acceder a la carpeta con ID '${drive_folder_id}'. Verifica el ID y los permisos. Error: ${e.message}`);
  }

  const archivos = carpeta.getFiles();
  const listaArchivos = [];
  let count = 0;
  while (archivos.hasNext()) {
    const archivo = archivos.next();
    listaArchivos.push({ id: archivo.getId(), nombre: archivo.getName() });
    count++;
  }
  Logger.log(`Encontrados ${count} archivos en la carpeta "${carpeta.getName()}".`);
  return listaArchivos;
}