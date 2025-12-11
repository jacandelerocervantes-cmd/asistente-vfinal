/**
 * @OnlyCurrentDoc
 */

// ============================================================================
// DATA EXTRACTION: MÓDULO DE LECTURA DE ARCHIVOS Y REPORTES
// ============================================================================

/**
 * Obtiene los criterios. Soporta Rangos Nombrados y A1.
 */
function handleGetRubricData(payload) {
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) throw new Error("Faltan datos.");

  const ss = SpreadsheetApp.openById(spreadsheet_id);
  let range;

  // 1. Intentar por Rango Nombrado primero (Nuevo sistema)
  const namedRange = ss.getNamedRange(rubrica_sheet_range);
  if (namedRange) {
    range = namedRange.getRange();
  } else {
    // 2. Intentar como notación A1 antigua (Sistema anterior)
    try {
      // Si tiene '!', asumimos que es 'Hoja!A1:B5'
      if (rubrica_sheet_range.includes('!')) {
         range = ss.getRange(rubrica_sheet_range);
      } else {
         // Si no tiene '!' y no es named range, probablemente es un error o formato antiguo roto
         // Intentamos buscar en la hoja activa por si acaso
         range = ss.getRange(rubrica_sheet_range); 
      }
    } catch(e) {
      Logger.log("No se pudo encontrar el rango: " + e.message);
      return { criterios: [] };
    }
  }

  const values = range.getValues();
  // El formato nuevo tiene 2 filas de encabezado (Título actividad, Títulos tabla)
  // El formato viejo tenía 1.
  // Detectamos buscando donde empieza "Criterio..."
  
  let startIndex = -1;
  for(let i=0; i<values.length; i++) {
    if (String(values[i][0]).includes("Criterio")) {
      startIndex = i + 1; // Los datos empiezan después de esta fila
      break;
    }
  }

  if (startIndex === -1) startIndex = 1; // Fallback al viejo estilo

  const criterios = [];
  for (let i = startIndex; i < values.length; i++) {
    const desc = values[i][0];
    const pts = values[i][1];
    
    // Detenerse si llegamos al "TOTAL" o fila vacía
    if (String(desc).toUpperCase() === "TOTAL" || (!desc && !pts)) break;
    
    criterios.push({ descripcion: desc, puntos: pts });
  }

  return { criterios: criterios };
}

/**
 * Obtiene texto formateado. Soporta Rangos Nombrados.
 */
function handleGetRubricText(payload) {
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  // ... lógica de obtención de range idéntica a handleGetRubricData ...
  const ss = SpreadsheetApp.openById(spreadsheet_id);
  let range;
  const namedRange = ss.getNamedRange(rubrica_sheet_range);
  if (namedRange) {
    range = namedRange.getRange();
  } else {
    try { range = ss.getRange(rubrica_sheet_range); } catch(e) { return { texto_rubrica: "" }; }
  }

  const values = range.getValues();
  let texto = "RÚBRICA:\n";
  
  // Barrido inteligente
  let reading = false;
  for (let i=0; i<values.length; i++) {
    const row = values[i];
    if (String(row[0]).includes("Criterio")) { reading = true; continue; } // Empezar a leer después de cabecera
    if (String(row[0]) === "TOTAL") break; // Parar en total
    
    if (reading && row[0]) {
      texto += `- ${row[0]} (${row[1]} pts)\n`;
    }
  }
  
  return { texto_rubrica: texto };
}

/**
 * Extrae el texto de un archivo de Google Drive.
 * LÓGICA BLINDADA:
 * 1. Detecta Google Docs y lee directo.
 * 2. Detecta Texto plano y lee blob.
 * 3. Para PDFs/Word/Imágenes: Intenta OCR primero. Si falla (error de API), intenta conversión simple.
 * 4. Si todo falla, devuelve flag de revisión manual.
 */
function handleGetStudentWorkText(payload) {
  Logger.log(`Iniciando handleGetStudentWorkText para file ID ${payload.drive_file_id}...`);
  const { drive_file_id } = payload;
  if (!drive_file_id) throw new Error("Falta 'drive_file_id'.");

  let file;
  try {
    file = DriveApp.getFileById(drive_file_id);
  } catch (e) {
    throw new Error(`Archivo no encontrado o sin permisos (ID: ${drive_file_id}).`);
  }

  const mimeType = file.getMimeType();
  const fileName = file.getName();
  Logger.log(`Procesando: "${fileName}" | Tipo: ${mimeType}`);

  try {
    // CASO A: Google Doc (Nativo) -> LEER DIRECTO (¡Sin OCR!)
    if (mimeType === MimeType.GOOGLE_DOCS) {
      Logger.log("Detectado Google Doc nativo. Leyendo cuerpo directamente...");
      const doc = DocumentApp.openById(drive_file_id);
      return { texto_trabajo: doc.getBody().getText() };
    }

    // CASO B: Texto Plano (txt, html, etc)
    if (mimeType === MimeType.PLAIN_TEXT || mimeType === MimeType.HTML) {
      Logger.log("Detectado texto plano. Leyendo blob...");
      return { texto_trabajo: file.getBlob().getDataAsString() };
    }

    // CASO C: Word (docx), PDF o Imágenes -> Requieren conversión/OCR
    if (mimeType === MimeType.MICROSOFT_WORD || mimeType === MimeType.PDF || mimeType.startsWith('image/')) {
      
      // Estrategia 1: Intentar OCR (Mejor para escaneos y PDFs complejos)
      try {
        Logger.log("Intentando lectura con OCR...");
        const resource = { title: `[TEMP_OCR] ${fileName}`, mimeType: MimeType.GOOGLE_DOCS };
        // 'ocr: true' es lo ideal, pero a veces falla con ciertos PDFs
        const tempFile = Drive.Files.insert(resource, file.getBlob(), { ocr: true, ocrLanguage: "es" });
        
        const text = DocumentApp.openById(tempFile.id).getBody().getText();
        try { Drive.Files.remove(tempFile.id); } catch(e) { Logger.log("Limpieza OCR falló: " + e.message); }
        return { texto_trabajo: text };
        
      } catch (ocrError) {
        Logger.log(`OCR falló (${ocrError.message}). Intentando conversión simple...`);

        // Estrategia 2: Conversión Simple (Mejor para PDFs de texto nativo o Word que falló en OCR)
        // Solo intentamos esto si el archivo NO es una imagen pura (las imágenes requieren OCR sí o sí)
        if (!mimeType.startsWith('image/')) {
          try {
            const resource = { title: `[TEMP_CONVERT] ${fileName}`, mimeType: MimeType.GOOGLE_DOCS };
            // 'convert: true' es más tolerante que OCR
            const tempFile = Drive.Files.insert(resource, file.getBlob(), { convert: true });
            
            const text = DocumentApp.openById(tempFile.id).getBody().getText();
            try { Drive.Files.remove(tempFile.id); } catch(e) { Logger.log("Limpieza Convert falló: " + e.message); }
            return { texto_trabajo: text };

          } catch (convertError) {
             Logger.log(`Conversión simple también falló: ${convertError.message}`);
          }
        }
      }
    }

    // CASO D: Fallback final (Tipo no soportado o fallaron conversiones)
    Logger.log("No se pudo extraer texto automáticamente. Solicitando revisión manual.");
    return { 
      texto_trabajo: "El sistema no pudo extraer texto legible automáticamente de este archivo.", 
      requiere_revision_manual: true 
    };

  } catch (e) {
    // Error catastrófico (ej. cuota excedida, error interno de Drive)
    Logger.log(`Error crítico en extracción: ${e.message}`);
    throw new Error(`Error procesando archivo: ${e.message}`);
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
           return { fileId: fileId, texto: null, error: "Archivo requiere revisión manual (ej. imagen o formato no soportado)." };
      }
      return { fileId: fileId, texto: resultado.texto_trabajo };
    } catch (e) {
      Logger.log(`Error al leer archivo ${fileId} en handleGetMultipleFileContents: ${e.message}`);
      return { fileId: fileId, texto: null, error: `No se pudo leer el archivo: ${e.message}` };
    }
  });

  const exitosos = contenidos.filter(c => c.texto !== null).length;
  Logger.log(`Lectura completada. Exitosos: ${exitosos}, Fallidos: ${drive_file_ids.length - exitosos}`);
  return { contenidos: contenidos };
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
    const sheet = spreadsheet.getSheetByName("Reporte de Asistencia"); // Nombre hardcoded según constantes
    if (!sheet) {
      throw new Error(`No se encontró la hoja "Reporte de Asistencia".`);
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
        // Buscamos columnas con formato de sesión ej. "DD/MM-S#"
        // La lógica anterior usaba "U1-S1", ajusta si tu formato es diferente
        if (typeof header === 'string' && header.includes('-')) {
             // Lógica flexible para detectar Unidad/Sesión o Fecha/Sesión
             // Si el header es DD/MM-S1
             const parts = header.split('-');
             if (parts.length === 2) {
                 const sesionPart = parts[1]; // "S1" o "1"
                 let sesion = parseInt(sesionPart.replace('S',''), 10);
                 if (isNaN(sesion)) sesion = 1; // Default
                 
                 // Para la unidad, asumimos que viene en el payload o la hoja tiene nombre de unidad
                 // O simplemente devolvemos la fecha y sesión
                 
                 const val = row[j]; 
                 // Asumiendo que 1=Presente, 0=Ausente
                 if (val === 1 || val === 0 || val === true || val === false) {
                   asistencias.push({
                     matricula: String(matricula),
                     // Si no podemos deducir la unidad del header, la dejamos pendiente o 
                     // el llamador debe filtrar. Aquí devolvemos crudo.
                     header_original: header, 
                     presente: (val == 1 || val === true)
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