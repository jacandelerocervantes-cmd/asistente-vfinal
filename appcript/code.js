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
      case 'actualizar_rubrica':
        return crearRespuestaExitosa(handleActualizarRubrica(payload));
      case 'get_or_create_rubric_sheet': // Asegúrate que esta acción aún sea necesaria
        return crearRespuestaExitosa(handleGetOrCreateRubricSheet(payload));
      case 'guardar_reporte_plagio':
        return crearRespuestaExitosa(handleGuardarReportePlagio(payload));
      case 'log_asistencia': // Para registrar asistencias de una sesión finalizada
        return crearRespuestaExitosa({ message: handleLogAsistencia(payload) });
      case 'cerrar_unidad': // Para generar resumen de asistencia y proteger hoja
        return crearRespuestaExitosa({ message: handleCerrarUnidadAsistencia(payload) }); // Renombrada para claridad
      case 'get_multiple_file_contents':
        return crearRespuestaExitosa({ contenidos: handleGetMultipleFileContents(payload) });
      case 'get_folder_contents':
        return crearRespuestaExitosa({ archivos: handleGetFolderContents(payload) });
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
      case 'guardar_calificaciones_evaluacion': // Para calificaciones de evaluaciones
        return crearRespuestaExitosa(handleGuardarCalificacionesEvaluacion(payload));
      case 'eliminar_recurso_drive': // <-- AÑADE ESTE CASO
        return crearRespuestaExitosa(handleEliminarRecurso(payload));
      case 'leer_datos_asistencia': // <-- AÑADE ESTE CASO
        return crearRespuestaExitosa(handleLeerDatosAsistencia(payload));
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