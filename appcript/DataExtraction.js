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
 * BLINDADO: Detecta correctamente Google Docs para evitar errores de OCR.
 * @param {object} payload Datos {drive_file_id}.
 * @return {object} Objeto con la clave 'texto_trabajo'.
 */
function handleGetStudentWorkText(payload) {
  Logger.log(`Iniciando handleGetStudentWorkText para file ID ${payload.drive_file_id}...`);
  const { drive_file_id } = payload;
  if (!drive_file_id) throw new Error("Falta 'drive_file_id'.");

  // 1. OBTENER TIPO REAL Y NOMBRE
  let mimeType;
  let fileName;
  try {
    const file = Drive.Files.get(drive_file_id, { fields: 'mimeType, title' });
    mimeType = file.mimeType;
    fileName = file.title;
    Logger.log(`Archivo: "${fileName}" | Tipo: ${mimeType}`);
  } catch (e) {
    throw new Error(`No se pudo acceder al archivo con ID ${drive_file_id}. ${e.message}`);
  }

  // 2. LÓGICA DE EXTRACCIÓN SEGURA
  try {
    // CASO A: Google Doc (Nativo) -> LEER DIRECTO
    if (mimeType === 'application/vnd.google-apps.document') {
      Logger.log("Leyendo como Google Doc...");
      const textContent = DocumentApp.openById(drive_file_id).getBody().getText();
      return { texto_trabajo: textContent };
    }

    // CASO B: PDF -> HACER OCR
    if (mimeType === 'application/pdf') {
      Logger.log("Procesando PDF con OCR...");
      const resource = { title: `[OCR TEMP] ${fileName}`, mimeType: "application/vnd.google-apps.document" };
      const blob = DriveApp.getFileById(drive_file_id).getBlob();
      const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: "es" });
      try {
        const textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
        return { texto_trabajo: textContent };
      } finally {
        Drive.Files.remove(ocrFile.id);
      }
    }

    // CASO C: Imagen (Foto de cuaderno, etc.) -> HACER OCR
    if (mimeType.startsWith('image/')) {
      Logger.log("Procesando imagen con OCR...");
      const resource = { title: `[OCR IMG] ${fileName}`, mimeType: "application/vnd.google-apps.document" };
      const blob = DriveApp.getFileById(drive_file_id).getBlob();
      const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: "es" });
      try {
        const textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
        return { texto_trabajo: textContent };
      } finally {
        Drive.Files.remove(ocrFile.id);
      }
    }

    // CASO D: Word -> CONVERTIR Y LEER
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
       Logger.log("Convirtiendo Word a Google Doc para leer texto...");
       const tempDoc = Drive.Files.copy({ title: `[TEMP CONVERT] ${fileName}`, mimeType: 'application/vnd.google-apps.document' }, drive_file_id);
       try {
         const textContent = DocumentApp.openById(tempDoc.id).getBody().getText();
         return { texto_trabajo: textContent };
       } finally {
         Drive.Files.remove(tempDoc.id);
       }
    }

    // CASO E (Fallback): Texto plano o similar
    Logger.log("Leyendo como archivo de texto plano (fallback)...");
    const textContent = DriveApp.getFileById(drive_file_id).getBlob().getDataAsString('UTF-8');
    return { texto_trabajo: textContent };

  } catch (e) {
    Logger.log(`Error leyendo contenido del archivo ID ${drive_file_id}: ${e.message}`);
    throw new Error(`No se pudo leer el contenido del archivo "${fileName}" (tipo ${mimeType}). ${e.message}`);
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

    const allData = sheet.getDataRange().getValues();
    
    const headers = allData[0];
    const matriculaIndex = headers.indexOf("Matrícula");
    
    if (matriculaIndex === -1) {
      throw new Error("No se encontró la columna 'Matrícula' en la hoja de asistencia.");
    }

    const asistencias = [];
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      const matricula = row[matriculaIndex];
      if (!matricula) continue;

      for (let j = matriculaIndex + 1; j < headers.length; j++) {
        const header = headers[j]; 
        // Buscamos columnas con formato de sesión ej. "U1-S1"
        if (typeof header === 'string' && header.includes('-S')) {
             const parts = header.replace('U', '').split('-S');
             if (parts.length === 2) {
                 const unidad = parseInt(parts[0], 10);
                 const sesion = parseInt(parts[1], 10);
                 const fecha = row[j]; 

                 if (fecha && (fecha instanceof Date || String(fecha).trim() !== '')) {
                   asistencias.push({
                     matricula: String(matricula),
                     unidad: unidad,
                     sesion: sesion,
                     fecha: new Date(fecha).toISOString().slice(0, 10)
                   });
                 }
             }
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