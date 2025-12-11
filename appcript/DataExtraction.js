/**
 * @OnlyCurrentDoc
 */

// ============================================================================
// DATA EXTRACTION: MÓDULO DE LECTURA DE ARCHIVOS Y REPORTES
// ============================================================================

/**
 * Obtiene los criterios de una rúbrica específica.
 * Soporta tanto Rangos Nombrados (Nuevo) como notación A1 (Viejo).
 * @param {object} payload Datos {spreadsheet_id, rubrica_sheet_range}.
 * @return {object} Objeto con la clave 'criterios'.
 */
function handleGetRubricData(payload) {
  Logger.log(`Iniciando handleGetRubricData...`);
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  
  if (!spreadsheet_id || !rubrica_sheet_range) {
    throw new Error("Faltan datos requeridos: 'spreadsheet_id' o 'rubrica_sheet_range'.");
  }

  // 1. Abrir el LIBRO (Spreadsheet), no una hoja específica.
  const ss = SpreadsheetApp.openById(spreadsheet_id);
  let range;

  // 2. Intentar obtener el rango por NOMBRE (Sistema Nuevo)
  // getNamedRange existe solo en objetos Spreadsheet (ss)
  const namedRange = ss.getNamedRange(rubrica_sheet_range);
  
  if (namedRange) {
    range = namedRange.getRange();
    Logger.log(`Rango nombrado '${rubrica_sheet_range}' encontrado.`);
  } else {
    // 3. Fallback: Intentar como dirección A1 (Sistema Viejo)
    Logger.log(`Rango nombrado no encontrado. Intentando como notación A1: ${rubrica_sheet_range}`);
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
      Logger.log("No se pudo encontrar el rango ni por nombre ni por dirección A1.");
      return { criterios: [] };
    }
  }

  const values = range.getValues();
  const criterios = [];
  
  // Barrido inteligente para encontrar donde empiezan los datos
  let reading = false;
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const col0 = String(row[0]);
    const col1 = row[1];

    // Detenerse si llegamos al total
    if (col0.toUpperCase() === "TOTAL") break;

    // Si ya estamos leyendo y hay datos, añadir criterio
    if (reading && col0 && (col1 !== "" && col1 !== null)) {
       criterios.push({ 
         descripcion: col0.trim(), 
         puntos: Number(col1) || 0 
       });
    }

    // Activar lectura cuando encontramos la cabecera
    if (col0.includes("Criterio")) {
      reading = true;
    }
  }

  Logger.log(`Encontrados ${criterios.length} criterios.`);
  return { criterios: criterios };
}

/**
 * Obtiene el texto formateado de una rúbrica.
 * Soporta Rangos Nombrados.
 * @param {object} payload Datos {spreadsheet_id, rubrica_sheet_range}.
 * @return {object} Objeto con la clave 'texto_rubrica'.
 */
function handleGetRubricText(payload) {
  Logger.log(`Iniciando handleGetRubricText...`);
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) throw new Error("Faltan datos.");

  const ss = SpreadsheetApp.openById(spreadsheet_id);
  let range;
  
  const namedRange = ss.getNamedRange(rubrica_sheet_range);
  if (namedRange) {
    range = namedRange.getRange();
  } else {
    try { range = ss.getRange(rubrica_sheet_range); } 
    catch(e) { return { texto_rubrica: "" }; }
  }

  const values = range.getValues();
  let texto = "RÚBRICA:\n";
  let reading = false;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const col0 = String(row[0]);
    
    if (col0.toUpperCase() === "TOTAL") break;
    
    if (reading && col0) {
      texto += `- ${row[0]} (${row[1]} pts)\n`;
    }
    
    if (col0.includes("Criterio")) reading = true;
  }
  
  return { texto_rubrica: texto };
}

/**
 * Extrae el texto de un archivo de Google Drive.
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

  // Si la referencia viene con comillas (ej. "'Detalle'!E5"), las quitamos.
  const cleanRange = justificacion_sheet_cell.replace(/'/g, "");

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
      // Usar la API Avanzada de Drive para obtener más detalles eficientemente
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
 */
function handleLeerDatosAsistencia(payload) {
  Logger.log("Iniciando handleLeerDatosAsistencia...");
  const { calificaciones_spreadsheet_id } = payload;
  if (!calificaciones_spreadsheet_id) {
    throw new Error("Se requiere el 'calificaciones_spreadsheet_id'.");
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
    const sheets = spreadsheet.getSheets();
    const asistencias = [];
    const year = new Date().getFullYear(); // Asumimos año actual para reconstruir fechas

    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      // Procesar solo hojas que parezcan de Unidades
      if (sheetName.toLowerCase().startsWith("unidad ")) {
        const unidad = parseInt(sheetName.replace(/unidad /i, ""), 10);
        if (isNaN(unidad)) return;

        const data = sheet.getDataRange().getValues();
        if (data.length < 2) return; // Hoja vacía o solo cabeceras

        const headers = data[0];
        const matriculaIndex = headers.findIndex(h => String(h).toLowerCase() === 'matrícula');
        if (matriculaIndex === -1) return;

        // Buscar columnas de sesión (formato DD/MM-S# o DD/MM-#)
        headers.forEach((h, colIndex) => {
          if (typeof h === 'string' && h.includes('/') && h.includes('-')) {
            const [fechaPart, sesionPart] = h.split('-');
            const [day, month] = fechaPart.split('/');
            const sesion = parseInt(sesionPart.replace(/\D/g,''), 10); // Limpiar 'S'

            if (!isNaN(sesion) && day && month) {
              const fechaISO = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

              // Leer las filas para esta columna de sesión
              for (let r = 1; r < data.length; r++) {
                const matricula = String(data[r][matriculaIndex]).trim().toUpperCase();
                if (!matricula) continue;

                const val = data[r][colIndex];
                // Solo procesar celdas con 1 o 0 (o booleano)
                if (val === 1 || val === 0 || val === true || val === false) {
                  asistencias.push({
                    matricula,
                    fecha: fechaISO,
                    unidad,
                    sesion,
                    presente: (val == 1 || val === true)
                  });
                }
              }
            }
          }
        });
      }
    });

    Logger.log(`Leídos ${asistencias.length} registros de asistencia de todas las unidades.`);
    return { asistencias };

  } catch (e) {
    Logger.log(`Error en handleLeerDatosAsistencia: ${e.message}`);
    throw new Error(`No se pudieron leer los datos de asistencia. ${e.message}`);
  }
}