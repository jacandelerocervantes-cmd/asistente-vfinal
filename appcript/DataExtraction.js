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
  const { drive_file_id, fileMimeType: _fileMimeType } = payload; // No usamos fileMimeType de la BD, confiamos en el real
  if (!drive_file_id) { throw new Error("Falta 'drive_file_id'."); }
  Logger.log(`Iniciando handleGetStudentWorkText para file ID ${drive_file_id}...`);

  let file;
  let mimeType;
  let fileName;
  try {
    // Obtenemos el mimeType real y el nombre usando la API Avanzada (Drive API V2)
    const partialFile = Drive.Files.get(drive_file_id, { fields: 'mimeType, title' });
    mimeType = partialFile.mimeType;
    fileName = partialFile.title;
    Logger.log(`Extrayendo texto de fileId: ${drive_file_id}. Nombre: "${fileName}". MimeType Real: ${mimeType}`);
    file = DriveApp.getFileById(drive_file_id);
  } catch (e) {
     throw new Error(`No se pudo acceder al archivo con fileId ${drive_file_id}. ¿Permisos? Error: ${e.message}`);
  }
  
  if (!mimeType) {
      Logger.log(`Advertencia: Archivo ${drive_file_id} (${fileName}) no tiene mimeType. Saltando...`);
      return { texto_trabajo: `[Error: El archivo '${fileName}' no tiene un tipo de archivo definido y no puede ser procesado.]` };
  }
  
  let textContent = '';

  try {
    // --- INICIO DE LA CORRECCIÓN ---
    // PRIORIDAD 1: ¿Es un Google Doc? (Sin importar el nombre)
    if (mimeType === MimeType.GOOGLE_DOCS) {
      Logger.log("Leyendo como Google Doc (MimeType detectado)...");
      textContent = DocumentApp.openById(file.getId()).getBody().getText();
    } 
    // PRIORIDAD 2: ¿Es un PDF?
    else if (mimeType === MimeType.PDF) {
       Logger.log("Procesando PDF con OCR...");
       const blob = file.getBlob();
       const resource = { title: `[OCR TEMP] ${fileName}` , mimeType: MimeType.GOOGLE_DOCS };
       const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'es' });
       try {
          textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
          Logger.log("OCR completado.");
       } finally {
          try { Drive.Files.remove(ocrFile.id); Logger.log("Archivo OCR temporal eliminado."); }
          catch (removeError) { Logger.log(`Error al eliminar archivo OCR temporal ${ocrFile.id}: ${removeError.message}`); }
       }
    } 
    // PRIORIDAD 3: ¿Es un Word?
    else if (mimeType === MimeType.MICROSOFT_WORD || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
       Logger.log("Convirtiendo Word a Google Doc para leer texto...");
       const tempDoc = Drive.Files.copy({ title: `[TEMP CONVERT] ${fileName}`, mimeType: MimeType.GOOGLE_DOCS }, file.getId());
       try {
          textContent = DocumentApp.openById(tempDoc.id).getBody().getText();
          Logger.log("Conversión y lectura completadas.");
       } finally {
           try { Drive.Files.remove(tempDoc.id); Logger.log("Archivo temporal de conversión eliminado."); }
           catch (removeError) { Logger.log(`Error al eliminar archivo temporal de conversión ${tempDoc.id}: ${removeError.message}`); }
       }
    } 
    // PRIORIDAD 4: ¿Es texto plano?
    else if (mimeType && mimeType.startsWith('text/')) {
        Logger.log("Leyendo como archivo de texto plano...");
        textContent = file.getBlob().getDataAsString('UTF-8');
    } 
    // ÚLTIMO RECURSO: Intentar OCR en cualquier otra cosa (ej. imágenes)
    else {
      Logger.log(`Tipo MIME ${mimeType} no soportado directamente. Intentando OCR como último recurso...`);
      // --- INICIO BLOQUE MANEJO REVISIÓN MANUAL ---
      // Si es un tipo de archivo que definitivamente no es texto (imagen, video, zip)
      if (mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType === 'application/zip') {
          Logger.log(`Archivo ${fileName} (${mimeType}) requiere revisión manual.`);
          // Devolvemos una estructura especial para que la Edge Function la interprete
          return { texto_trabajo: null, requiere_revision_manual: true };
      }
      // --- FIN BLOQUE ---
      
      const blob = file.getBlob();
      const resource = { title: `[OCR TEMP fallback] ${fileName}` , mimeType: MimeType.GOOGLE_DOCS };
      const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'es' });
       try {
          textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
          Logger.log("OCR (fallback) completado.");
       } finally {
          try { Drive.Files.remove(ocrFile.id); } catch (e) {}
       }
       if (!textContent) {
           throw new Error(`El archivo '${fileName}' (tipo ${mimeType}) no es un formato de texto legible ni pudo ser procesado con OCR.`);
       }
    }
    // --- FIN DE LA CORRECCIÓN ---

    Logger.log(`Texto extraído exitosamente (longitud: ${textContent.length}).`);
    return { texto_trabajo: textContent };
  } catch (e) {
    Logger.log(`ERROR en handleGetStudentWorkText para ID ${drive_file_id}: ${e.message}\nStack: ${e.stack}`);
    // Propagamos el error para que la Edge Function lo capture
    throw new Error(`No se pudo leer el contenido del archivo "${fileName}". Asegúrate de que sea un formato compatible (Docs, Word, PDF, Texto) y que el script tenga permisos. Error: ${e.message}`);
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

  let cleanRange = justificacion_sheet_cell;

  // Si la referencia viene con comillas (ej. "'Detalle'!E5"), las quitamos.
  if (cleanRange && cleanRange.startsWith("'") && cleanRange.includes("'!")) {
    cleanRange = cleanRange.replace(/'/g, ""); // Quita todas las comillas
    Logger.log(`Referencia de celda con comillas detectada. Limpiando a: ${cleanRange}`);
  }

  let range;
  try {
    // Usamos la variable limpia para obtener el rango
    range = spreadsheet.getRange(cleanRange); 
  } catch (e) {
     throw new Error(`Referencia de celda inválida: "${cleanRange}" (Original: "${justificacion_sheet_cell}"). Error: ${e.message}`);
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
      // Manejar el caso de revisión manual
      if (resultado.requiere_revision_manual) {
           return { fileId: fileId, texto: null, error: "Archivo requiere revisión manual (ej. imagen)." };
      }
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
 * Lista las carpetas y archivos dentro de una carpeta de Google Drive.
 * @param {object} payload Datos {drive_folder_id}.
 * @return {object} Objeto con claves 'folders' y 'files' (arrays de {id, name, webViewLink, iconLink}).
 */
function handleGetFolderContents(payload) {
  Logger.log(`Iniciando handleGetFolderContents para folder ID ${payload.drive_folder_id}...`);
  const { drive_folder_id } = payload;
  if (!drive_folder_id) {
    throw new Error("Se requiere el 'drive_folder_id' para listar el contenido.");
  }

  let carpeta;
  try {
    carpeta = DriveApp.getFolderById(drive_folder_id);
  } catch (e) {
    throw new Error(`No se pudo encontrar o acceder a la carpeta con ID '${drive_folder_id}'. Verifica el ID y los permisos. Error: ${e.message}`);
  }

  const listaFolders = [];
  const folders = carpeta.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    listaFolders.push({
      id: folder.getId(),
      name: folder.getName(),
      type: 'folder'
    });
  }

  const listaFiles = [];
  const files = carpeta.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    let fileDetails = {};
    try {
      fileDetails = Drive.Files.get(file.getId(), { fields: 'webViewLink, iconLink, mimeType' });
    } catch (e) {
      Logger.log(`No se pudo obtener metadatos extra para ${file.getName()}: ${e.message}`);
    }

    listaFiles.push({
      id: file.getId(),
      name: file.getName(),
      type: 'file',
      mimeType: fileDetails.mimeType || file.getMimeType(),
      webViewLink: fileDetails.webViewLink || file.getUrl(), // webViewLink es mejor para abrir
      iconLink: fileDetails.iconLink || null // Link al ícono del tipo de archivo
    });
  }

  Logger.log(`Encontrados ${listaFolders.length} carpetas y ${listaFiles.length} archivos en "${carpeta.getName()}".`);
  return { folders: listaFolders, files: listaFiles };
}

/**
 * Lee todos los datos de asistencia de la hoja de cálculo de una materia.
 * (Función duplicada de SheetsAsistencia.js, revisar si se puede unificar)
 * @param {object} payload Datos { calificaciones_spreadsheet_id }.
 * @return {object} Objeto con la clave 'asistencias' (array de objetos).
 */
function handleLeerDatosAsistencia(payload) {
  Logger.log("Iniciando handleLeerDatosAsistencia...");
  const { calificaciones_spreadsheet_id } = payload;
  if (!calificaciones_spreadsheet_id) {
    throw new Error("Se requiere el 'calificaciones_spreadsheet_id'.");
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
    const sheet = spreadsheet.getSheetByName(NOMBRE_SHEET_ASISTENCIA);
    if (!sheet) {
      throw new Error(`No se encontró la hoja "${NOMBRE_SHEET_ASISTENCIA}".`);
    }

    // Leer todos los datos de la hoja de una sola vez para eficiencia
    const allData = sheet.getDataRange().getValues();
    
    // La primera fila contiene los encabezados (Matrícula, Alumno, U1-S1, U1-S2, etc.)
    const headers = allData[0];
    const matriculaIndex = headers.indexOf("Matrícula");
    
    if (matriculaIndex === -1) {
      throw new Error("No se encontró la columna 'Matrícula' en la hoja de asistencia.");
    }

    const asistencias = [];
    // Iterar sobre las filas de datos (a partir de la segunda fila)
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      const matricula = row[matriculaIndex];
      if (!matricula) continue; // Omitir filas sin matrícula

      // Iterar sobre las columnas de asistencia (a partir de la columna después de "Alumno")
      for (let j = matriculaIndex + 1; j < headers.length; j++) {
        const header = headers[j]; // Ej: "U1-S1"
        const [unidad, sesion] = header.replace('U', '').split('-S');
        const fecha = row[j]; // La celda contiene la fecha de la asistencia

        if (fecha && (fecha instanceof Date || String(fecha).trim() !== '')) {
          asistencias.push({
            matricula: String(matricula),
            unidad: parseInt(unidad, 10),
            sesion: parseInt(sesion, 10),
            fecha: new Date(fecha).toISOString().slice(0, 10) // Formatear a YYYY-MM-DD
          });
        }
      }
    }

    Logger.log(`Procesadas ${asistencias.length} registros de asistencia.`);
    return { asistencias };

  } catch (e) {
    Logger.log(`Error en handleLeerDatosAsistencia: ${e.message}`);
    throw new Error(`No se pudieron leer los datos de asistencia. ${e.message}`);
  }
}