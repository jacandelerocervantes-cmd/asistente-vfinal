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
      case 'create_materia_struct':
        return crearRespuestaExitosa(handleCreateMateriaStruct(payload));
      case 'eliminar_recurso_drive': // <-- AÑADE ESTE CASO
        return crearRespuestaExitosa(handleEliminarRecurso(payload));
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
// MANEJADORES DE ACCIONES PRINCIPALES
// ==========================================================================================

/**
 * Crea la estructura de carpetas y archivos iniciales para un lote de materias.
 * @param {object} payload Datos del docente y las materias (incluyendo alumnos anidados).
 * @return {object} IDs y URLs de los elementos creados.
 */
function handleCreateMateriasBatch(payload) {
  Logger.log("--- Iniciando handleCreateMateriasBatch ---");
  const startTime = new Date().getTime(); // Medir tiempo de ejecución

  // Validar payload de entrada
  if (!payload.docente || !payload.docente.email || !payload.materias || !Array.isArray(payload.materias)) {
      throw new Error("Payload inválido: faltan 'docente' (con email) o 'materias' (debe ser array).");
  }
  const { docente, materias } = payload;
  Logger.log(`Docente: ${docente.email}. Materias a procesar: ${materias.length}`);

  // --- IMPLEMENTACIÓN DE BLOQUEO ---
  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(15000); // Esperar hasta 15 segundos
  if (!lockAcquired) {
    Logger.log("No se pudo obtener el bloqueo. Otra instancia de sincronización podría estar en ejecución. Devolviendo respuesta controlada.");
    // En lugar de lanzar un error, devolvemos un objeto que indica que el proceso está ocupado.
    // La función `doPost` lo envolverá en una respuesta exitosa.
    return { status_process: "locked", message: "El proceso de sincronización ya está en ejecución. Inténtalo de nuevo en un momento." };
  }
  Logger.log("Bloqueo adquirido. Procediendo con la sincronización.");

  try {
      // Obtener carpeta raíz y carpeta del docente (o crearla)
      const carpetaRaiz = DriveApp.getFolderById(CARPETA_RAIZ_ID);
      const nombreCarpetaDocente = docente.nombre || docente.email; // Usar email si no hay nombre
      const carpetaDocente = getOrCreateFolder(carpetaRaiz, nombreCarpetaDocente);

      // Asegurar permisos de edición para el docente en su carpeta
      try {
        const editores = carpetaDocente.getEditors().map(u => u.getEmail());
        if (!editores.includes(docente.email)) {
          carpetaDocente.addEditor(docente.email);
          Logger.log(`Permisos añadidos para ${docente.email} en "${carpetaDocente.getName()}"`);
        }
      } catch(permError) {
        Logger.log(`Advertencia: No se pudieron añadir/verificar permisos para ${docente.email}: ${permError.message}`);
      }

      const results = { drive_urls: {}, rubricas_spreadsheet_ids: {}, plagio_spreadsheet_ids: {}, calificaciones_spreadsheet_ids: {} };

      for (const materia of materias) {
          const materiaStartTime = new Date().getTime();
          if (!materia || typeof materia !== 'object' || !materia.id || !materia.nombre || !materia.semestre) {
              Logger.log(`Advertencia: Datos incompletos para una materia, saltando. Datos: ${JSON.stringify(materia)}`);
              continue;
          }
          Logger.log(`Procesando materia ID ${materia.id}: ${materia.nombre} (${materia.semestre})`);

          const nombreCarpetaMateria = `${materia.nombre} - ${materia.semestre}`;
          const carpetaMateria = getOrCreateFolder(carpetaDocente, nombreCarpetaMateria);

          const carpetaAsistencia = getOrCreateFolder(carpetaMateria, "Asistencia");
          const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
          getOrCreateFolder(carpetaMateria, "Evaluaciones");
          getOrCreateFolder(carpetaMateria, "Material Didáctico");

          const numeroDeUnidades = parseInt(materia.unidades, 10) || 0;
          if (numeroDeUnidades > 0) {
            Logger.log(`Creando estructura para ${numeroDeUnidades} unidades...`);
            for (let i = 1; i <= numeroDeUnidades; i++) {
              const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${i}`);
              getOrCreateSheet(carpetaUnidad, `Resumen Calificaciones - Unidad ${i}`);
              getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");
            }
          } else {
              Logger.log("Advertencia: La materia no tiene un número válido de unidades definidas.");
          }

          const alumnosDeMateria = Array.isArray(materia.alumnos) ? materia.alumnos : [];
          Logger.log(`Materia ID ${materia.id} tiene ${alumnosDeMateria.length} alumnos recibidos en payload.`);

          crearListaDeAlumnosSheet(carpetaAsistencia, alumnosDeMateria);
          const sheetAsistencia = crearAsistenciasSheet(carpetaAsistencia, alumnosDeMateria, numeroDeUnidades);

          const sheetRubricas = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
          const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);

          results.drive_urls[materia.id] = carpetaMateria.getUrl();
          results.rubricas_spreadsheet_ids[materia.id] = sheetRubricas ? sheetRubricas.getId() : null;
          results.plagio_spreadsheet_ids[materia.id] = sheetPlagio ? sheetPlagio.getId() : null;
          results.calificaciones_spreadsheet_ids[materia.id] = sheetAsistencia ? sheetAsistencia.getId() : null;

          const materiaEndTime = new Date().getTime();
          Logger.log(`Materia ID ${materia.id} procesada en ${(materiaEndTime - materiaStartTime) / 1000}s`);
      }

      const endTime = new Date().getTime();
      Logger.log(`--- Fin handleCreateMateriasBatch en ${(endTime - startTime) / 1000}s ---`);
      // CORRECCIÓN: Llamar a flush() una sola vez al final del bucle para mejorar el rendimiento.
      try { SpreadsheetApp.flush(); } catch(e) { Logger.log(`Flush final falló (puede ignorarse): ${e.message}`);}
      return results;
  } finally {
      // --- LIBERAR EL BLOQUEO ---
      lock.releaseLock();
      Logger.log("Bloqueo liberado.");
  }
}

/**
 * Crea las carpetas necesarias para una actividad específica dentro de su unidad.
 * @param {object} payload Datos de la actividad (drive_url_materia, nombre_actividad, unidad).
 * @return {object} IDs de las carpetas creadas.
 */
function handleCreateActivityFolder(payload) {
  Logger.log("Iniciando handleCreateActivityFolder...");
  const { drive_url_materia, nombre_actividad, unidad } = payload;
  if (!drive_url_materia || !nombre_actividad) {
    throw new Error("Faltan datos requeridos: drive_url_materia, nombre_actividad.");
  }

  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url_materia}`);

  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  // Usar 'General' si la unidad no es válida o no se proporciona
  const nombreCarpetaUnidad = (unidad && !isNaN(parseInt(unidad, 10)) && parseInt(unidad, 10) > 0) ? `Unidad ${unidad}` : 'General';
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, nombreCarpetaUnidad);

  // Asegurar que exista la carpeta de reportes detallados en la unidad
  getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");

  // Crear carpeta para esta actividad específica
  const carpetaActividad = getOrCreateFolder(carpetaUnidad, nombre_actividad); // Usar getOrCreate por si ya existe
  // Crear carpeta "Entregas" dentro de la actividad
  const carpetaEntregas = getOrCreateFolder(carpetaActividad, "Entregas");

  Logger.log(`Estructura de carpetas creada/verificada para actividad "${nombre_actividad}" en ${nombreCarpetaUnidad}.`);
  return {
    drive_folder_id_actividad: carpetaActividad.getId(),
    drive_folder_id_entregas: carpetaEntregas.getId(),
    // drive_folder_id_calificados: carpetaCalificados.getId() // Eliminado
  };
}

/**
 * Guarda o actualiza una rúbrica en la hoja maestra de rúbricas.
 * @param {object} payload Datos (rubricas_spreadsheet_id, nombre_actividad, criterios).
 * @return {object} ID del spreadsheet y rango donde se guardó la rúbrica.
 */
function handleGuardarRubrica(payload) {
  Logger.log("Iniciando handleGuardarRubrica...");
  const { rubricas_spreadsheet_id, nombre_actividad, criterios } = payload;
  if (!rubricas_spreadsheet_id || !nombre_actividad || !criterios || !Array.isArray(criterios)) {
    throw new Error("Faltan datos requeridos: rubricas_spreadsheet_id, nombre_actividad, criterios (array).");
  }

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(rubricas_spreadsheet_id);
  } catch (e) {
    throw new Error(`No se pudo abrir la hoja de cálculo de rúbricas con ID '${rubricas_spreadsheet_id}'. Verifica permisos o ID.`);
  }

  // Obtener o crear la hoja principal
  let sheet = spreadsheet.getSheetByName(NOMBRE_SHEET_MAESTRO_RUBRICAS);
  if (!sheet) {
      if (spreadsheet.getSheets().length > 0) {
          sheet = spreadsheet.getSheets()[0].setName(NOMBRE_SHEET_MAESTRO_RUBRICAS);
      } else {
          sheet = spreadsheet.insertSheet(NOMBRE_SHEET_MAESTRO_RUBRICAS);
      }
      Logger.log(`Hoja "${NOMBRE_SHEET_MAESTRO_RUBRICAS}" creada/renombrada.`);
  }

  // Encontrar la última fila usada para añadir la nueva rúbrica debajo
  const lastRow = sheet.getLastRow();
  const startRow = lastRow > 0 ? lastRow + 2 : 1; // Deja una fila en blanco si ya hay contenido

  // Escribir el título de la rúbrica (celda combinada)
  sheet.getRange(startRow, 1, 1, 2).merge().setValue(`Rúbrica para: ${nombre_actividad}`).setFontWeight("bold").setBackground("#cfe2f3").setHorizontalAlignment("center");

  // Escribir encabezados de la tabla de criterios
  const headers = ["Criterio de Evaluación", "Puntos"];
  sheet.getRange(startRow + 1, 1, 1, 2).setValues([headers]).setFontWeight("bold");

  // Preparar y escribir los datos de los criterios
  const filasCriterios = criterios.map(c => [c.descripcion || '', c.puntos !== undefined ? c.puntos : '']); // Asegurar valores
  if (filasCriterios.length > 0) {
    sheet.getRange(startRow + 2, 1, filasCriterios.length, headers.length).setValues(filasCriterios);
  }

  // Ajustar formato de columnas
  sheet.setColumnWidth(1, 400); // Ancho para descripción
  sheet.setColumnWidth(2, 100); // Ancho para puntos

  // Calcular el rango A1Notation donde se guardó la rúbrica (incluyendo headers)
  const endRow = startRow + 1 + filasCriterios.length;
  const rangoDatos = `'${sheet.getName()}'!A${startRow + 1}:B${endRow}`; // Ejemplo: 'Rúbricas de la Materia'!A5:B8
  Logger.log(`Rúbrica para "${nombre_actividad}" guardada en rango: ${rangoDatos}`);

  SpreadsheetApp.flush(); // Forzar escritura
  return {
    rubrica_spreadsheet_id: spreadsheet.getId(), // Devolver el ID del sheet maestro
    rubrica_sheet_range: rangoDatos // Devolver el rango específico de esta rúbrica
  };
}

/**
 * Guarda el reporte de plagio en la hoja correspondiente.
 * @param {object} payload Datos (drive_url_materia, reporte_plagio).
 * @return {object} Mensaje de éxito.
 */
function handleGuardarReportePlagio(payload) {
  Logger.log("Iniciando handleGuardarReportePlagio...");
  const { drive_url_materia, reporte_plagio } = payload; // reporte_plagio es el array [{trabajo_A_id, trabajo_B_id, ...}]

  if (!drive_url_materia || reporte_plagio === undefined || reporte_plagio === null) {
      throw new Error("Faltan datos requeridos: drive_url_materia, reporte_plagio.");
  }
  if (!Array.isArray(reporte_plagio)) {
       throw new Error("'reporte_plagio' debe ser un array.");
  }

  // Obtener/Crear la hoja de cálculo de plagio
  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url_materia}`);
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const sheetPlagioSS = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO); // Spreadsheet

  // Crear/Obtener una hoja dentro del Spreadsheet con la fecha de hoy
  const fechaHoy = new Date().toISOString().slice(0, 10);
  const nombreHojaReporte = `Reporte ${fechaHoy}`;
  let sheet = sheetPlagioSS.getSheetByName(nombreHojaReporte);

  // Si la hoja no existe, crearla y añadir encabezados
  if (!sheet) {
    sheet = sheetPlagioSS.insertSheet(nombreHojaReporte, 0); // Insertar al principio
    const headers = ["Trabajo A (File ID)", "Trabajo B (File ID)", "% Similitud", "Fragmentos Similares / Observaciones"];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150); // ID A
    sheet.setColumnWidth(2, 150); // ID B
    sheet.setColumnWidth(3, 100); // %
    sheet.setColumnWidth(4, 500); // Fragmentos
    Logger.log(`Hoja "${nombreHojaReporte}" creada.`);
  }

  // Preparar filas para añadir
  const filasParaAnadir = [];
  if (reporte_plagio.length > 0) {
    reporte_plagio.forEach(item => {
      // Unir fragmentos con doble salto de línea
      const fragmentosTexto = Array.isArray(item.fragmentos_similares) ? item.fragmentos_similares.join("\n\n") : '-';
      filasParaAnadir.push([
          item.trabajo_A_id || 'N/A',
          item.trabajo_B_id || 'N/A',
          item.porcentaje_similitud !== undefined ? item.porcentaje_similitud : '0', // Asegurar valor
          fragmentosTexto
      ]);
    });
    Logger.log(`Preparadas ${filasParaAnadir.length} filas de similitud.`);
  } else {
    // Si el array está vacío, añadir fila informativa
    filasParaAnadir.push(['-', '-', '0%', 'No se encontraron similitudes significativas en esta comparación.']);
    Logger.log("Reporte vacío, se añadirá fila informativa.");
  }

  // Escribir las filas en la hoja
  if (filasParaAnadir.length > 0) {
      try {
        sheet.getRange(sheet.getLastRow() + 1, 1, filasParaAnadir.length, filasParaAnadir[0].length)
             .setValues(filasParaAnadir)
             .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); // Ajustar texto en celdas largas
         Logger.log(`Se añadieron ${filasParaAnadir.length} filas al reporte de plagio.`);
      } catch(e) {
         Logger.log(`ERROR al escribir en ${nombreHojaReporte}: ${e.message}`);
         throw new Error(`Error al escribir reporte de plagio: ${e.message}`);
      }
  }

  SpreadsheetApp.flush();
  return { message: "Reporte de plagio procesado y guardado exitosamente." };
}

/**
 * Registra las asistencias de una sesión específica en la hoja de cálculo.
 * @param {object} payload Datos de la sesión y asistencias. {drive_url, fecha, unidad, sesion, asistencias:[{matricula, presente}]}
 * @return {string} Mensaje de resultado.
 */
function handleLogAsistencia(payload) { // Renombrada para mantener consistencia
  const { drive_url, fecha, unidad, sesion, asistencias } = payload;
  Logger.log("Recibido en handleLogAsistencia: " + JSON.stringify(payload).substring(0, 500) + "...");

  if (!drive_url || !asistencias || !fecha || !unidad || !sesion) { throw new Error("Faltan datos para registrar la asistencia (drive_url, fecha, unidad, sesion, asistencias)."); }
  if (!Array.isArray(asistencias)) { throw new Error("El campo 'asistencias' debe ser un array."); }

  try {
    const carpetaMateriaId = extractDriveIdFromUrl(drive_url);
    if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url}`);
    const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
    const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");

    const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
    if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}" en la carpeta Reportes.`);

    const reporteSheet = SpreadsheetApp.open(archivos.next());
    const nombreHojaUnidad = `Unidad ${unidad}`;
    const unitSheet = reporteSheet.getSheetByName(nombreHojaUnidad);
    
    if (!unitSheet) {
      throw new Error(`No se encontró la hoja de la unidad "${nombreHojaUnidad}" para registrar la asistencia.`);
    }
    
    // Constantes para la hoja
    const HEADER_ROW = 1;
    const DATA_START_ROW = 2; // Fila donde inician los datos de los alumnos (después del encabezado)
    const FIXED_COLS = 2; // Matrícula, Nombre Completo
    
    let lastCol = unitSheet.getLastColumn();
    let sessionCol = -1;
    
    // Aseguramos que lastCol sea al menos el número de columnas fijas si hay datos.
    if (unitSheet.getLastRow() > 0 && lastCol < FIXED_COLS) {
        lastCol = FIXED_COLS;
    }

    // 1. Buscar si la columna de sesión ya existe
    const hoy = new Date(fecha + 'T12:00:00Z');
    const textoEncabezado = `${('0' + hoy.getDate()).slice(-2)}/${('0' + (hoy.getMonth() + 1)).slice(-2)}-${sesion}`;

    if (lastCol > FIXED_COLS) {
      const headerValues = unitSheet.getRange(HEADER_ROW, FIXED_COLS + 1, 1, lastCol - FIXED_COLS).getValues()[0];
      const colIndex = headerValues.findIndex(h => String(h).trim() === textoEncabezado);
      if (colIndex !== -1) {
        sessionCol = colIndex + FIXED_COLS + 1;
      }
    }

    // 2. Si no existe la columna de sesión, crear una nueva
    if (sessionCol === -1) {
      sessionCol = lastCol + 1;
      unitSheet.getRange(HEADER_ROW, sessionCol).setValue(textoEncabezado).setFontWeight('bold').setHorizontalAlignment("center");
    }
    
    // 3. Escribir los valores de asistencia (1 o 0)
    const maxRows = unitSheet.getLastRow();
    if (maxRows < DATA_START_ROW) {
        throw new Error('No se encontraron alumnos en la hoja de la unidad.');
    }

    const matriculasInSheetRange = unitSheet.getRange(DATA_START_ROW, 1, maxRows - DATA_START_ROW + 1, 1);
    const matriculasInSheet = matriculasInSheetRange.getValues().flat();
    
    let registrosEscritos = 0;
    asistencias.forEach(data => {
      const rowIndex = matriculasInSheet.findIndex(m => String(m).trim().toUpperCase() === String(data.matricula).trim().toUpperCase());
      
      if (rowIndex !== -1) {
        const sheetRow = rowIndex + DATA_START_ROW;
        const value = data.presente ? 1 : 0;
        unitSheet.getRange(sheetRow, sessionCol).setValue(value).setHorizontalAlignment("center");
        registrosEscritos++;
      }
    });

    SpreadsheetApp.flush(); 

    return `Asistencia registrada en la columna ${sessionCol} de la hoja ${nombreHojaUnidad}. Se procesaron ${registrosEscritos} registros.`;

  } catch (e) {
    Logger.log(e);
    throw new Error('Error al procesar el registro de asistencia: ' + e.message);
  }
}

/**
 * Calcula el resumen de asistencia para una unidad y protege la hoja correspondiente. RENOMBRADA.
 * @param {object} payload Datos {drive_url, unidad, alumnos, registros_asistencia}
 * @return {string} Mensaje de resultado.
 */
function handleCerrarUnidadAsistencia(payload) {
  Logger.log(`Iniciando handleCerrarUnidadAsistencia para unidad ${payload.unidad}...`);
  const { drive_url, unidad, alumnos, registros_asistencia } = payload;
  if (!drive_url || !unidad || !alumnos || !Array.isArray(alumnos) || !registros_asistencia || !Array.isArray(registros_asistencia)) {
    throw new Error("Faltan datos para cerrar la unidad (drive_url, unidad, alumnos, registros_asistencia).");
  }

  // Obtener la hoja de cálculo y la hoja de la unidad
  const carpetaMateriaId = extractDriveIdFromUrl(drive_url);
  if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url}`);
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}".`);

  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const nombreHojaUnidad = `Unidad ${unidad}`;
  const hoja = hojaDeCalculo.getSheetByName(nombreHojaUnidad);
  if (!hoja) throw new Error(`No se encontró la pestaña "${nombreHojaUnidad}".`);

  // Calcular total de sesiones únicas para esta unidad a partir de los registros recibidos
  const sesionesUnicas = new Set(registros_asistencia.map(r => `${r.fecha}-${r.sesion}`));
  const totalSesiones = sesionesUnicas.size;
  Logger.log(`Total sesiones únicas para unidad ${unidad}: ${totalSesiones}`);
  if (totalSesiones === 0) {
      Logger.log("No hay registros de asistencia para calcular resumen. Saliendo.");
      // Proteger hoja aunque no haya resumen? Opcional. Por ahora solo salimos.
      return `No se generó resumen para Unidad ${unidad} porque no hay registros de asistencia.`;
  }

  // Calcular asistencias por alumno
  const resumen = new Map(); // Mapa: alumno_id -> { asistencias: number, matricula: string }
  alumnos.forEach(alumno => {
    if (alumno && alumno.id && alumno.matricula) { // Validar alumno
       resumen.set(alumno.id, { asistencias: 0, matricula: alumno.matricula });
    } else {
        Logger.log(`Alumno inválido en payload: ${JSON.stringify(alumno)}`);
    }
  });
  registros_asistencia.forEach(registro => {
    // Contar solo si el registro es 'presente' y el alumno existe en el mapa
    if (registro && registro.presente === true && resumen.has(registro.alumno_id)) {
      resumen.get(registro.alumno_id).asistencias++;
    }
  });
  Logger.log(`Resumen de asistencias calculado para ${resumen.size} alumnos.`);

  // Encontrar/Crear columnas de resumen en la hoja
  const ultimaColumnaContenido = hoja.getLastColumn();
  const colSumatoria = ultimaColumnaContenido + 1;
  const colPromedio = ultimaColumnaContenido + 2;
  // Escribir encabezados si no existen ya (más robusto que solo añadir)
  if (hoja.getRange(1, colSumatoria).getValue() !== "Total Asistencias") {
    hoja.getRange(1, colSumatoria).setValue("Total Asistencias").setFontWeight("bold");
  }
  if (hoja.getRange(1, colPromedio).getValue() !== "% Asistencia") {
     hoja.getRange(1, colPromedio).setValue("% Asistencia").setFontWeight("bold");
  }


  // Mapear matrículas de la hoja a filas (similar a handleLogAsistencia)
  const primeraFilaDatos = hoja.getFrozenRows() + 1;
  const numFilasDatos = hoja.getLastRow() - primeraFilaDatos + 1;
  let matriculaMap = new Map();
  if (numFilasDatos > 0) {
    const rangoMatriculas = hoja.getRange(primeraFilaDatos, 1, numFilasDatos, 1).getValues();
    rangoMatriculas.forEach((fila, index) => {
      const matriculaEnSheet = String(fila[0]).trim().toUpperCase();
      if (matriculaEnSheet && !matriculaMap.has(matriculaEnSheet)) {
        matriculaMap.set(matriculaEnSheet, index + primeraFilaDatos);
      }
    });
  }
  Logger.log(`Mapeadas ${matriculaMap.size} matrículas de la hoja para escribir resumen.`);

  // Escribir los resultados del resumen
  let resumenesEscritos = 0;
  for (const [id, datos] of resumen.entries()) {
      const matriculaNormalizada = String(datos.matricula).trim().toUpperCase();
      const fila = matriculaMap.get(matriculaNormalizada);
      if(fila){
          const porcentaje = totalSesiones > 0 ? (datos.asistencias / totalSesiones) : 0;
          try {
            // Escribir ambos valores en una sola llamada para eficiencia
            hoja.getRange(fila, colSumatoria, 1, 2).setValues([[datos.asistencias, porcentaje]]);
            // Aplicar formato de porcentaje a la segunda celda escrita
            hoja.getRange(fila, colPromedio).setNumberFormat("0.0%");
            resumenesEscritos++;
          } catch (writeError) {
              Logger.log(`Error al escribir resumen para ${matriculaNormalizada}: ${writeError.message}`);
          }
      } else {
          Logger.log(`Advertencia: Alumno ID ${id} (Matrícula ${datos.matricula}) del resumen no encontrado en la hoja.`);
      }
  }
  Logger.log(`Escritos ${resumenesEscritos} resúmenes de asistencia.`);

  // Proteger la hoja
  try {
    const protection = hoja.protect().setDescription(`Unidad ${unidad} cerrada - Asistencia`);
    const me = Session.getEffectiveUser();
    protection.addEditor(me); // Asegurar que el dueño del script pueda editar
    // Quitar otros editores si es necesario (cuidado si colaboran)
    const editors = protection.getEditors();
    editors.forEach(editor => {
      if (editor.getEmail() !== me.getEmail()) {
         try { protection.removeEditor(editor); } catch(e) {/* Ignorar si no se puede quitar */}
      }
    });
    // Quitar permiso de edición a nivel dominio si está activo
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
    Logger.log(`Hoja "${nombreHojaUnidad}" protegida.`);
  } catch (protectError) {
      Logger.log(`Error al proteger la hoja "${nombreHojaUnidad}": ${protectError.message}`);
      // No lanzar error, pero sí loguearlo
  }

  SpreadsheetApp.flush(); // Forzar escritura final
  return `Resumen para la Unidad ${unidad} generado (${resumenesEscritos} alumnos) y la hoja ha sido protegida.`;
}


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
  // Validar el rango antes de usarlo
  let range;
  try {
     range = spreadsheet.getRange(rubrica_sheet_range);
  } catch(e) {
      throw new Error(`Rango inválido: "${rubrica_sheet_range}". Error: ${e.message}`);
  }

  const values = range.getValues(); // Obtener [['Criterio 1', 10], ['Criterio 2', 20], ...]
  // Asume que la primera fila son headers, las siguientes son datos
  const criterios = values.slice(1) // Omitir fila de encabezado
      .map(row => ({
        // Asegurar que sean strings y números válidos
        descripcion: String(row[0] || '').trim(),
        puntos: Number(row[1]) || 0 // Usar 0 si no es un número válido
      }))
      .filter(c => c.descripcion); // Filtrar filas sin descripción

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
  // Empezar desde la segunda fila (índice 1) asumiendo que la primera son headers
  values.slice(1).forEach(row => {
    // Validar que ambas celdas tengan contenido
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
  const { drive_file_id, fileMimeType } = payload; // fileMimeType is the one from Supabase
  if (!drive_file_id) { throw new Error("Falta 'drive_file_id'."); }
  Logger.log(`Iniciando handleGetStudentWorkText para file ID ${drive_file_id}...`);

  let file;
  let mimeType;
  try {
    // --- CORRECCIÓN: Obtener SIEMPRE el mimeType real de Google Drive ---
    // El mimeType pasado desde Supabase (basado en la extensión .pdf) puede ser incorrecto
    // si el alumno subió un Google Doc con la extensión .pdf
    // si el alumno subió un Google Doc con la extensión .pdf. Se especifica `fields` para evitar el error "Invalid field selection name".
    const partialFile = Drive.Files.get(drive_file_id, { fields: 'mimeType, title' }); // Pedir name para logs
    mimeType = partialFile.mimeType;
    // --- FIN DE LA CORRECCIÓN ---
    Logger.log(`Extrayendo texto de fileId: ${drive_file_id}. MimeType (Provisto: ${fileMimeType}, Real: ${mimeType})`);
    file = DriveApp.getFileById(drive_file_id);
  } catch (e) {
     throw new Error(`No se pudo acceder al archivo con fileId ${drive_file_id}. ¿Permisos? Error: ${e.message}`);
  }
  
  // --- CORRECCIÓN: Añadir un "null check" para el mimeType ---
  if (!mimeType) {
      Logger.log(`Advertencia: Archivo ${drive_file_id} (${file.getName()}) no tiene mimeType. Saltando...`);
      // Devolver un texto de error controlado en lugar de fallar toda la operación.
      // Esto evita que toda la operación se detenga.
      return { texto_trabajo: `[Error: El archivo '${file.getName()}' no tiene un tipo de archivo definido y no puede ser procesado.]` };
  }
  // --- FIN DE LA CORRECCIÓN ---
  Logger.log(`Procesando archivo: "${file.getName()}", Tipo MIME: ${mimeType}`);
  let textContent = '';

  try {
    if (mimeType === MimeType.GOOGLE_DOCS) {
      Logger.log("Leyendo como Google Doc...");
      textContent = DocumentApp.openById(file.getId()).getBody().getText();
    } else if (mimeType === MimeType.PDF) {
       Logger.log("Procesando PDF con OCR...");
       // Usar API Avanzada de Drive (Drive.Files) para OCR
       const blob = file.getBlob();
       const resource = { title: `[OCR TEMP] ${file.getName()}` , mimeType: MimeType.GOOGLE_DOCS };
       const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'es' });
       try {
          textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
          Logger.log("OCR completado.");
       } finally {
          // Asegurar borrado del archivo temporal incluso si falla la lectura
          try { Drive.Files.remove(ocrFile.id); Logger.log("Archivo OCR temporal eliminado."); }
          catch (removeError) { Logger.log(`Error al eliminar archivo OCR temporal ${ocrFile.id}: ${removeError.message}`); }
       }
    } else if (mimeType === MimeType.MICROSOFT_WORD || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
       Logger.log("Convirtiendo Word a Google Doc para leer texto...");
       // Crear copia temporal como Google Doc
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
        textContent = file.getBlob().getDataAsString('UTF-8'); // Asumir UTF-8
    } else {
      // Intentar OCR como último recurso para otros tipos (imágenes?)
      Logger.log(`Tipo MIME ${mimeType} no soportado directamente. Intentando OCR...`);
      const blob = file.getBlob();
      const resource = { title: `[OCR TEMP fallback] ${file.getName()}` , mimeType: MimeType.GOOGLE_DOCS };
      const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'es' });
       try {
          textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
          Logger.log("OCR (fallback) completado.");
       } finally {
          try { Drive.Files.remove(ocrFile.id); } catch (e) {/*ignore*/}
       }
       if (!textContent) { // Si el OCR fallback tampoco funcionó
           throw new Error(`El archivo '${file.getName()}' (tipo ${mimeType}) no es un formato de texto legible ni pudo ser procesado con OCR.`);
       }
    }
    Logger.log(`Texto extraído exitosamente (longitud: ${textContent.length}).`);
    return { texto_trabajo: textContent };
  } catch (e) {
    // Loguear el error específico y relanzar uno más genérico
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

  // Validar formato A1Notation básico (NombreHoja!Celda)
  // SE ELIMINA LA VALIDACIÓN ESTRICTA QUE PROVOCABA EL ERROR 400
  let spreadsheet;
  try {
     spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  } catch(e) {
     throw new Error(`No se pudo abrir Spreadsheet con ID ${spreadsheet_id}: ${e.message}`);
  }

  let range;
  try {
    range = spreadsheet.getRange(justificacion_sheet_cell); // Obtener rango
  } catch (e) {
     throw new Error(`Referencia de celda inválida: "${justificacion_sheet_cell}" en Spreadsheet ID ${spreadsheet_id}. Error: ${e.message}`);
  }

  const value = range.getValue(); // Obtener el valor
  const textoJustificacion = (value !== null && value !== undefined) ? String(value) : ""; // Convertir a string o vacío

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
    // Reutilizar handleGetStudentWorkText para cada archivo
    try {
      const resultado = handleGetStudentWorkText({ drive_file_id: fileId });
      return { fileId: fileId, texto: resultado.texto_trabajo };
    } catch (e) {
      Logger.log(`Error al leer archivo ${fileId} en handleGetMultipleFileContents: ${e.message}`);
      // Devolver objeto indicando el error para ese archivo
      return { fileId: fileId, texto: null, error: `No se pudo leer el archivo: ${e.message}` };
    }
  });

  const exitosos = contenidos.filter(c => c.texto !== null).length;
  Logger.log(`Lectura completada. Exitosos: ${exitosos}, Fallidos: ${drive_file_ids.length - exitosos}`);
  return contenidos; // Devolver array con resultados individuales
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
    // Opcional: Limitar el número de archivos si esperas carpetas muy grandes
    // if (count >= 500) { Logger.log("Límite de 500 archivos alcanzado."); break; }
  }
  Logger.log(`Encontrados ${count} archivos en la carpeta "${carpeta.getName()}".`);
  return listaArchivos;
}


/**
 * Guarda las calificaciones detalladas de una actividad en su hoja específica y actualiza el resumen de la unidad.
 * @param {object} payload Datos {drive_url_materia, unidad, actividad:{nombre, id}, calificaciones:[{matricula, nombre?, equipo?, calificacion, retroalimentacion}]}.
 * @return {object} Objeto con mensaje y referencia a la celda de justificación.
 */
function handleGuardarCalificacionDetallada(payload) {
  Logger.log(`Iniciando handleGuardarCalificacionDetallada para actividad "${payload?.actividad?.nombre}"...`);
  const { drive_url_materia, unidad, actividad, calificaciones } = payload;
  // Validaciones robustas
  if (!drive_url_materia || !unidad || !actividad || typeof actividad !== 'object' || !actividad.nombre || !calificaciones) { throw new Error("Faltan datos requeridos (drive_url_materia, unidad, actividad {nombre}, calificaciones)."); }
  if (!Array.isArray(calificaciones) || calificaciones.length === 0) { throw new Error("El array 'calificaciones' está vacío o no es un array."); }

  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url_materia}`);
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const nombreCarpetaUnidad = `Unidad ${unidad}`;
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, nombreCarpetaUnidad);

  // --- 1. Reporte Detallado por Actividad ---
  const carpetaReportesDetallados = getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");
  // Usar nombre sanitizado para el archivo/hoja
  const nombreSheetDetallado = actividad.nombre.replace(/[/\\?%*:|"<>]/g, '_'); // Reemplazar caracteres inválidos
  const reporteDetalladoSS = getOrCreateSheet(carpetaReportesDetallados, nombreSheetDetallado);
  const sheetDetallado = reporteDetalladoSS.getSheets()[0]; // Asumir primera hoja
  // Renombrar si es necesario (evita error si ya tiene nombre correcto)
  if (sheetDetallado.getName() !== "Detalle") {
      try { sheetDetallado.setName("Detalle"); } catch(e) { Logger.log(`Advertencia: No se pudo renombrar hoja a "Detalle": ${e.message}`); }
  }


  const headersDetallado = ["Matricula", "Nombre Alumno", "Equipo", "Calificacion", "Retroalimentacion y observaciones"];
  // Escribir headers si la hoja está vacía
  if (sheetDetallado.getLastRow() < 1) {
    sheetDetallado.appendRow(headersDetallado);
    sheetDetallado.getRange(1, 1, 1, headersDetallado.length).setFontWeight("bold");
    sheetDetallado.setFrozenRows(1);
    sheetDetallado.setColumnWidth(2, 250); // Nombre
    sheetDetallado.setColumnWidth(5, 400); // Retro
  }

  // Preparar y escribir datos detallados
  const filasDetallado = calificaciones.map(cal => [
      cal.matricula || '',
      cal.nombre || '', // Incluir nombre si se envía
      cal.equipo || '',
      cal.calificacion !== undefined ? cal.calificacion : '',
      cal.retroalimentacion || ''
  ]);
  if (filasDetallado.length > 0) {
      try {
        sheetDetallado.getRange(sheetDetallado.getLastRow() + 1, 1, filasDetallado.length, headersDetallado.length)
             .setValues(filasDetallado)
             .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); // Ajustar texto retro
      } catch(e) { Logger.log(`ERROR escribiendo en sheet detallado: ${e.message}`); }
  }
  const ultimaFilaDetalle = sheetDetallado.getLastRow(); // Guardar para referencia de celda

  // --- 2. Actualizar Resumen de la Unidad ---
  const nombreResumen = `Resumen Calificaciones - Unidad ${unidad}`;
  const resumenUnidadSS = getOrCreateSheet(carpetaUnidad, nombreResumen);
  const sheetResumen = resumenUnidadSS.getSheets()[0];
  if (sheetResumen.getName() !== "Resumen") {
     try { sheetResumen.setName("Resumen"); } catch(e) { Logger.log(`Advertencia: No se pudo renombrar hoja a "Resumen": ${e.message}`);}
  }

  let headersResumen;
  let colIndexActividad = -1; // Base 0
  let lastHeaderColResumen = sheetResumen.getLastColumn();

  // Leer o crear encabezados del resumen
  if (sheetResumen.getLastRow() < 1) {
    headersResumen = ["Matricula", "Nombre Alumno", actividad.nombre]; // Incluir nombre de alumno
    sheetResumen.appendRow(headersResumen);
    sheetResumen.getRange(1, 1, 1, headersResumen.length).setFontWeight("bold");
    sheetResumen.setFrozenRows(1);
    sheetResumen.setColumnWidth(2, 250); // Ancho nombre
    colIndexActividad = 2; // Índice base 0 de la columna de actividad
    lastHeaderColResumen = headersResumen.length;
  } else {
    headersResumen = sheetResumen.getRange(1, 1, 1, lastHeaderColResumen || 1).getValues()[0];
    colIndexActividad = headersResumen.indexOf(actividad.nombre);
    if (colIndexActividad === -1) { // Si no existe la columna para esta actividad
      colIndexActividad = (lastHeaderColResumen || 0); // Índice base 0 de la nueva columna
      lastHeaderColResumen = colIndexActividad + 1; // Actualizar última columna (base 1)
      sheetResumen.getRange(1, lastHeaderColResumen).setValue(actividad.nombre).setFontWeight("bold");
    }
  }

  // Mapear matrículas existentes en el resumen a sus filas
  let matriculaToRowIndexResumen = new Map();
  const firstDataRowResumen = sheetResumen.getFrozenRows() + 1;
  const numDataRowsResumen = sheetResumen.getLastRow() - firstDataRowResumen + 1;
  if (numDataRowsResumen > 0) {
      const matriculasEnResumen = sheetResumen.getRange(firstDataRowResumen, 1, numDataRowsResumen, 1).getValues();
      matriculasEnResumen.forEach((row, index) => {
          const matricula = String(row[0]).trim().toUpperCase();
          if (matricula && !matriculaToRowIndexResumen.has(matricula)) {
              matriculaToRowIndexResumen.set(matricula, index + firstDataRowResumen);
          }
      });
  }
  Logger.log(`Mapeadas ${matriculaToRowIndexResumen.size} matrículas del Resumen.`);

  // Actualizar/Añadir calificaciones en el resumen
  const colNumActividad = colIndexActividad + 1; // Columna base 1 para getRange
  const updatesResumen = {}; // { rowIndex: { colIndex: value } } para batch update
  const nuevasFilasResumen = []; // Para alumnos no encontrados

  calificaciones.forEach(cal => {
    const matriculaNorm = String(cal.matricula || '').trim().toUpperCase();
    if (!matriculaNorm) return; // Saltar si no hay matrícula

    const rowIndex = matriculaToRowIndexResumen.get(matriculaNorm);
    const calificacionValor = cal.calificacion !== undefined ? cal.calificacion : '';

    if (rowIndex) { // Si el alumno ya existe en el resumen
      // Preparar actualización para batch
      if (!updatesResumen[rowIndex]) updatesResumen[rowIndex] = {};
      updatesResumen[rowIndex][colNumActividad] = calificacionValor;
    } else { // Si el alumno es nuevo en el resumen
      const nuevaFila = Array(lastHeaderColResumen).fill(''); // Crear fila con tamaño correcto
      nuevaFila[0] = cal.matricula; // Columna A
      nuevaFila[1] = cal.nombre || ''; // Columna B
      nuevaFila[colIndexActividad] = calificacionValor; // Columna de la actividad
      nuevasFilasResumen.push(nuevaFila);
      // Añadir al mapa para futuras referencias en este bucle
      matriculaToRowIndexResumen.set(matriculaNorm, sheetResumen.getLastRow() + nuevasFilasResumen.length);
    }
  });

  // Escribir nuevas filas (si las hay)
  if (nuevasFilasResumen.length > 0) {
      try {
        sheetResumen.getRange(sheetResumen.getLastRow() + 1, 1, nuevasFilasResumen.length, lastHeaderColResumen)
                    .setValues(nuevasFilasResumen);
        Logger.log(`Añadidas ${nuevasFilasResumen.length} nuevas filas al Resumen.`);
      } catch(e) { Logger.log(`ERROR añadiendo nuevas filas al Resumen: ${e.message}`);}
  }

  // Escribir actualizaciones usando batch (getRangeList/setValues) para eficiencia
  const rangesToUpdate = [];
  const valuesToUpdate = [];
  for (const rowIdx in updatesResumen) {
      for (const colIdx in updatesResumen[rowIdx]) {
          rangesToUpdate.push(sheetResumen.getRange(parseInt(rowIdx, 10), parseInt(colIdx, 10)));
          valuesToUpdate.push(updatesResumen[rowIdx][colIdx]);
      }
  }
  if (rangesToUpdate.length > 0) {
      try {
          // Nota: setValues en RangeList no existe directamente, hay que iterar o usar Range.setValue
          Logger.log(`Actualizando ${rangesToUpdate.length} celdas existentes en Resumen...`);
          rangesToUpdate.forEach((range, i) => range.setValue(valuesToUpdate[i]));
          // Alternativa menos eficiente si son muchas celdas separadas:
          // sheetResumen.getRangeList(rangesToUpdate.map(r => r.getA1Notation())).getRanges().forEach((r, i) => r.setValue(valuesToUpdate[i]));
          Logger.log(`Actualizaciones en Resumen completadas.`);
      } catch(e) { Logger.log(`ERROR actualizando celdas en Resumen: ${e.message}`);}
  }

  // --- Devolver referencia a la celda de justificación (del sheet detallado) ---
  let justificacionCellRef = null;
  // Usar la última fila escrita en el sheet detallado, columna E (5) - o D (4) si no hay equipo? AJUSTAR COLUMNA
  if (ultimaFilaDetalle > 1) { // Si se escribió al menos una fila de datos
      const columnaRetro = headersDetallado.indexOf("Retroalimentacion y observaciones") + 1 || 4; // Columna D o E
      justificacionCellRef = `'${sheetDetallado.getName()}'!${sheetDetallado.getRange(ultimaFilaDetalle, columnaRetro).getA1Notation()}`; // Ej: 'Detalle'!E15
  }
   Logger.log("Referencia de celda de justificación generada: " + justificacionCellRef);

  SpreadsheetApp.flush(); // Forzar escritura final
  return { message: "Reportes generados/actualizados.", justificacion_cell_ref: justificacionCellRef };
}


/**
 * Guarda las calificaciones finales de una evaluación en una hoja general de reportes.
 * @param {object} payload Datos {calificaciones_spreadsheet_id, nombre_evaluacion, unidad?, calificaciones:[{matricula, nombre?, calificacion_final}]}
 * @return {object} Mensaje de éxito.
 */
function handleGuardarCalificacionesEvaluacion(payload) {
  Logger.log(`Iniciando handleGuardarCalificacionesEvaluacion para "${payload.nombre_evaluacion}"...`);
  const { calificaciones_spreadsheet_id, nombre_evaluacion, unidad, calificaciones } = payload;

  if (!calificaciones_spreadsheet_id || !nombre_evaluacion || !calificaciones || !Array.isArray(calificaciones)) { throw new Error("Faltan datos (spreadsheet_id, nombre_evaluacion, calificaciones array)."); }
  if (calificaciones.length === 0) { Logger.log("No hay calificaciones para guardar."); return { message: "No había calificaciones para registrar." }; }

  let spreadsheet;
  try { spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id); }
  catch (e) { throw new Error(`No se pudo abrir Spreadsheet ID '${calificaciones_spreadsheet_id}'.`); }

  const nombreHojaReporte = "Reporte Evaluaciones";
  let sheet = spreadsheet.getSheetByName(nombreHojaReporte);
  const headers = ["Matrícula", "Nombre Alumno", "Evaluación", "Unidad", "Calificación Final"];

  if (!sheet) {
    sheet = spreadsheet.insertSheet(nombreHojaReporte);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 250); sheet.setColumnWidth(3, 250); // Anchos
    Logger.log(`Hoja "${nombreHojaReporte}" creada.`);
  }

  // Preparar filas para añadir
  const filasParaAnadir = calificaciones.map(cal => [
    cal.matricula || '',
    cal.nombre || '', // Incluir nombre si se envía
    nombre_evaluacion,
    unidad || '',
    cal.calificacion_final !== null && cal.calificacion_final !== undefined ? cal.calificacion_final : ''
  ]);

  // Escribir datos
  if (filasParaAnadir.length > 0) {
      try {
        sheet.getRange(sheet.getLastRow() + 1, 1, filasParaAnadir.length, headers.length)
             .setValues(filasParaAnadir);
        Logger.log(`Se añadieron ${filasParaAnadir.length} calificaciones para "${nombre_evaluacion}" en "${nombreHojaReporte}".`);
      } catch(e) {
          Logger.log(`ERROR escribiendo calificaciones de evaluación: ${e.message}`);
          throw new Error(`Error al escribir calificaciones: ${e.message}`);
      }
  }

  SpreadsheetApp.flush();
  return { message: `Se registraron ${filasParaAnadir.length} calificaciones en Google Sheets.` };
}