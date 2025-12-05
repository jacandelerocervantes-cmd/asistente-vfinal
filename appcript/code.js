/**
 * @OnlyCurrentDoc
 */

// ==========================================================================================
// CONFIGURACIÓN PRINCIPAL
// ==========================================================================================
const CARPETA_RAIZ_ID = "1oGrqi8TJmkqVnVjWDltX__YF1HhDpfJ-"; // Asegúrate que este ID sea correcto
const NOMBRE_SHEET_LISTA_ALUMNOS = "Lista de Alumnos";
const NOMBRE_SHEET_ASISTENCIA = "Reporte de Asistencia";
const NOMBRE_SHEET_MAESTRO_RUBRICAS = "Rúbricas de la Materia";
const NOMBRE_SHEET_PLAGIO = "Reportes de Plagio";


// ==========================================================================================
// MANEJADORES DE PETICIONES WEB (PUNTO DE ENTRADA)
// ==========================================================================================

/**
 * Maneja las solicitudes GET. Devuelve un mensaje informativo.
 * @param {object} e El objeto del evento GET.
 * @return {ContentService.TextOutput} Respuesta de texto.
 */
function doGet(e) {
  Logger.log("Petición GET recibida.");
  return ContentService.createTextOutput("Script activo. Use POST.").setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Maneja las solicitudes POST. Enruta la acción al manejador correspondiente.
 * @param {object} e El objeto del evento POST.
 * @return {ContentService.TextOutput} Respuesta JSON (éxito o error).
 */
function doPost(e) {
  let action = 'desconocida'; // Valor por defecto para logs de error
  try {
    // Parsear el cuerpo de la solicitud como JSON
    const payload = JSON.parse(e.postData.contents);
    action = payload.action || 'sin_accion'; // Obtener la acción solicitada
    Logger.log(`Acción recibida: "${action}"`);

    // Validar payload básico según acción si es necesario
    // (Ej. verificar que ciertos campos existan antes de llamar al manejador)

    // Enrutar al manejador adecuado según la acción
    switch (action) {
      case 'create_materias_batch':
        return crearRespuestaExitosa(handleCreateMateriasBatch(payload));
      // AÑADE ESTA LÍNEA NUEVA:
      case 'create_materia_struct':
        return crearRespuestaExitosa(handleCreateMateriaStruct(payload));
      case 'create_activity_folder':
        return crearRespuestaExitosa(handleCreateActivityFolder(payload));
      case 'guardar_rubrica':
        return crearRespuestaExitosa(handleGuardarRubrica(payload));
      case 'get_or_create_rubric_sheet': // Asegúrate que esta acción aún sea necesaria
        return crearRespuestaExitosa(handleGetOrCreateRubricSheet(payload));
      case 'guardar_reporte_plagio':
        return crearRespuestaExitosa(handleGuardarReportePlagio(payload));
      case 'log_asistencia': // Para registrar asistencias de una sesión finalizada
        return crearRespuestaExitosa({ message: handleLogAsistencia(payload) });
      case 'cerrar_unidad': // Para generar resumen de asistencia y proteger hoja
        return crearRespuestaExitosa({ message: handleCerrarUnidadAsistencia(payload) }); // Renombrada para claridad
      
      // --- INICIO FASE 1: ACCIONES PARA MATERIAL DIDÁCTICO ---
      case 'get_folder_contents': // (Esta función está en DataExtraction.js)
        return crearRespuestaExitosa({ archivos: handleGetFolderContents(payload) });
      case 'create_folder':
        return crearRespuestaExitosa(handleCreateFolder(payload));
      case 'upload_file':
        return crearRespuestaExitosa(handleUploadFile(payload));
      // --- FIN FASE 1 ---
        
      case 'get_multiple_file_contents':
        return crearRespuestaExitosa({ contenidos: handleGetMultipleFileContents(payload) });
      case 'get_rubric_text':
        return crearRespuestaExitosa(handleGetRubricText(payload));
      case 'get_rubric_data':
        return crearRespuestaExitosa(handleGetRubricData(payload));
      case 'get_student_work_text':
        return crearRespuestaExitosa(handleGetStudentWorkText(payload));
      case 'get_justification_text':
        return crearRespuestaExitosa(handleGetJustificationText(payload));
      case 'guardar_calificacion_detallada': // Para calificaciones de actividades
        return crearRespuestaExitosa(handleGuardarCalificacionDetallada(payload));
      case 'guardar_calificacion_actividad':
        return crearRespuestaExitosa(handleGuardarCalificacionesActividad(payload));
      case 'update_gradebook':
        return crearRespuestaExitosa(handleUpdateGradebook(payload));
      case 'eliminar_recurso_drive': // <-- AÑADE ESTE CASO
        return crearRespuestaExitosa(handleEliminarRecurso(payload));
      case 'leer_datos_asistencia': // <-- AÑADE ESTE CASO
        return crearRespuestaExitosa(handleLeerDatosAsistencia(payload));
      
      // --- INICIO FASE 2: CALIFICACIONES DE UNIDAD ---
      case 'get_component_counts_for_unit':
        return crearRespuestaExitosa(handleGetComponentCountsForUnit(payload));
      case 'calculate_and_save_final_grade':
        return crearRespuestaExitosa(handleCalculateAndSaveFinalGrade(payload));
      
      // --- INICIO FASE 9: LECTURA DE REPORTES ---
      case 'get_final_course_grades':
        return crearRespuestaExitosa(handleGetFinalCourseGrades(payload));
      case 'get_final_unit_grades':
        return crearRespuestaExitosa(handleGetFinalUnitGrades(payload));
      // Las funciones obsoletas se han quitado del switch
      default:
        // Si la acción no coincide con ninguna conocida
        throw new Error(`Acción desconocida: "${action}"`);
    }
  } catch (error) {
    // Capturar cualquier error ocurrido durante el procesamiento
    Logger.log(`ERROR GRAVE en doPost (Acción: ${action}): ${error.message}\nPayload recibido (parcial): ${e.postData.contents.substring(0, 500)}\nStack: ${error.stack}`);
    // Devolver una respuesta JSON indicando el error
    return crearRespuestaError(error.message);
  }
}

// ==========================================================================================
// FUNCIONES AUXILIARES DE RESPUESTA JSON
// ==========================================================================================

/**
 * Crea una respuesta JSON estándar para operaciones exitosas.
 * @param {object} data El objeto de datos a incluir en la respuesta.
 * @return {ContentService.TextOutput} Respuesta JSON con status "success".
 */
function crearRespuestaExitosa(data) {
  return ContentService.createTextOutput(JSON.stringify({ status: "success", ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Crea una respuesta JSON estándar para errores.
 * @param {string} message El mensaje de error.
 * @return {ContentService.TextOutput} Respuesta JSON con status "error".
 */
function crearRespuestaError(message) {
  // Simplificar mensajes de error comunes para el usuario final
  let userFriendlyMessage = message;
  if (message.includes("exceeded maximum execution time")) {
    userFriendlyMessage = "La operación tardó demasiado tiempo y fue cancelada. Intenta de nuevo o contacta al administrador.";
  } else if (message.includes("service invoked too many times")) {
     userFriendlyMessage = "Se ha excedido el límite de uso de servicios de Google temporalmente. Por favor, espera unos minutos e intenta de nuevo.";
  } else if (message.includes("Acción desconocida")) {
     userFriendlyMessage = "La acción solicitada no es válida.";
  }
  // Añadir más mapeos de errores técnicos a mensajes amigables si es necesario
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: userFriendlyMessage }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================================================================
// INICIO FASE 1: NUEVAS FUNCIONES PARA MATERIAL DIDÁCTICO
// ==========================================================================================

/**
 * Crea una nueva carpeta (Tema o Subtema) dentro de una carpeta padre.
 * @param {object} payload Datos { parentFolderId, newFolderName }
 * @return {object} { id, name } de la carpeta creada.
 */
function handleCreateFolder(payload) {
  Logger.log("Iniciando handleCreateFolder...");
  const { parentFolderId, newFolderName } = payload;
  if (!parentFolderId || !newFolderName) {
    throw new Error("Faltan 'parentFolderId' o 'newFolderName'.");
  }

  try {
    const parentFolder = DriveApp.getFolderById(parentFolderId);
    const newFolder = parentFolder.createFolder(newFolderName);
    Logger.log(`Carpeta "${newFolderName}" creada con ID ${newFolder.getId()} dentro de ${parentFolderId}.`);
    return { id: newFolder.getId(), name: newFolder.getName() };
  } catch (e) {
    Logger.log(`Error en handleCreateFolder: ${e.message}`);
    throw new Error(`No se pudo crear la carpeta: ${e.message}`);
  }
}

/**
 * Sube un archivo (convertido de Base64) a una carpeta destino.
 * @param {object} payload Datos { targetFolderId, fileName, mimeType, base64Data }
 * @return {object} { id, name } del archivo subido.
 */
function handleUploadFile(payload) {
  Logger.log("Iniciando handleUploadFile...");
  const { targetFolderId, fileName, mimeType, base64Data } = payload;
  if (!targetFolderId || !fileName || !mimeType || !base64Data) {
    throw new Error("Faltan datos para subir el archivo (targetFolderId, fileName, mimeType, base64Data).");
  }

  try {
    const targetFolder = DriveApp.getFolderById(targetFolderId);
    
    // Decodificar el string Base64.
    // El string de DataURL (ej. 'data:application/pdf;base64,JVBER...')
    // debe ser limpiado para obtener solo los datos Base64.
    const splitData = base64Data.split(',');
    let decodedData;
    if (splitData.length > 1) {
      decodedData = Utilities.base64Decode(splitData[1]);
    } else {
      // Asumir que ya venía limpio
      decodedData = Utilities.base64Decode(base64Data);
    }
    
    // Crear el blob y el archivo
    const blob = Utilities.newBlob(decodedData, mimeType, fileName);
    const file = targetFolder.createFile(blob);
    
    Logger.log(`Archivo "${fileName}" (MIME: ${mimeType}) subido con ID ${file.getId()} a la carpeta ${targetFolderId}.`);
    return { id: file.getId(), name: file.getName() };
  } catch (e) {
    Logger.log(`Error en handleUploadFile: ${e.message}`);
    // Error común: Payload demasiado grande (límite de ~50MB para UrlFetch)
    if (e.message.includes("request size") || e.message.includes("Request payload size")) {
        throw new Error("El archivo es demasiado grande para ser subido por este método (Límite ~50MB).");
    }
    throw new Error(`No se pudo subir el archivo: ${e.message}`);
  }
}

// ==========================================================================================
// FIN FASE 1
// ==========================================================================================

/**
 * Crea la estructura para UNA SOLA materia, incluyendo poblado de listas.
 * @param {object} payload Datos { docente, materia }
 * @return {object} IDs y URLs de los elementos creados.
 */
function handleCreateMateriaStruct(payload) {
  // 1. Intentar adquirir un "candado" exclusivo por 30 segundos
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { 
     // Si está ocupado, rechazamos la segunda petición para proteger el archivo
     throw new Error("El sistema ya está sincronizando esta materia. Intenta de nuevo en unos segundos.");
  }

  try {
    Logger.log("--- Iniciando handleCreateMateriaStruct ---");
    const startTime = new Date().getTime();

    // Validar payload de entrada
    if (!payload.docente || !payload.docente.email || !payload.materia) {
      throw new Error("Payload inválido: faltan 'docente' (con email) o 'materia'.");
    }
    const { docente, materia } = payload;
    Logger.log(`Docente: ${docente.email}. Procesando materia ID ${materia.id}: ${materia.nombre}`);

    // Obtener carpeta raíz y carpeta del docente
    const carpetaRaiz = DriveApp.getFolderById(CARPETA_RAIZ_ID);
    const nombreCarpetaDocente = docente.nombre || docente.email;
    const carpetaDocente = getOrCreateFolder(carpetaRaiz, nombreCarpetaDocente);

    // Asegurar permisos (por si acaso)
    try {
      const editores = carpetaDocente.getEditors().map(u => u.getEmail());
      if (!editores.includes(docente.email)) {
        carpetaDocente.addEditor(docente.email);
      }
    } catch (permError) {
      Logger.log(`Advertencia: No se pudieron añadir/verificar permisos para ${docente.email}: ${permError.message}`);
    }

    // --- Procesar esta única materia ---
    const results = _crearEstructuraParaMateria_(carpetaDocente, materia);

    const endTime = new Date().getTime();
    Logger.log(`--- Fin handleCreateMateriaStruct en ${(endTime - startTime) / 1000}s ---`);
    SpreadsheetApp.flush();
    return results; // Devolver los IDs de esta materia
  } finally {
    // 2. Liberar el candado siempre, pase lo que pase
    lock.releaseLock();
  }
}