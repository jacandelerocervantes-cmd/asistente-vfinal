/**
 * @OnlyCurrentDoc
 */

// ==========================================================================================
// CONFIGURACIÓN PRINCIPAL
// ==========================================================================================
const CARPETA_RAIZ_ID = "1j7boqj1CEg9NUItM7MNp31YIuy1hhapT"; // Asegúrate que este ID sea correcto
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

    // Obtener carpeta raíz y carpeta del docente (o crearla)
    const carpetaRaiz = DriveApp.getFolderById(CARPETA_RAIZ_ID);
    const nombreCarpetaDocente = docente.nombre || docente.email; // Usar email si no hay nombre
    const carpetaDocente = getOrCreateFolder(carpetaRaiz, nombreCarpetaDocente);

    // Asegurar permisos de edición para el docente en su carpeta
    try {
      // Verificar si ya tiene permisos antes de intentar añadir para evitar errores
      const editores = carpetaDocente.getEditors().map(u => u.getEmail());
      if (!editores.includes(docente.email)) {
        carpetaDocente.addEditor(docente.email);
        Logger.log(`Permisos añadidos para ${docente.email} en "${carpetaDocente.getName()}"`);
      } else {
        // Logger.log(`Permisos ya existentes para ${docente.email} en "${carpetaDocente.getName()}"`);
      }
    } catch(permError) {
      // Loguear advertencia si falla (ej. si el script no tiene permisos para compartir)
      Logger.log(`Advertencia: No se pudieron añadir/verificar permisos para ${docente.email}: ${permError.message}`);
    }

    // Objeto para almacenar los resultados (URLs e IDs)
    const results = { drive_urls: {}, rubricas_spreadsheet_ids: {}, plagio_spreadsheet_ids: {}, calificaciones_spreadsheet_ids: {} };

    // Iterar sobre cada materia enviada en el payload
    for (const materia of materias) {
        const materiaStartTime = new Date().getTime(); // Medir tiempo por materia
        // Validar datos básicos de la materia actual
        if (!materia || typeof materia !== 'object' || !materia.id || !materia.nombre || !materia.semestre) {
            Logger.log(`Advertencia: Datos incompletos para una materia, saltando. Datos: ${JSON.stringify(materia)}`);
            continue; // Saltar a la siguiente materia si faltan datos esenciales
        }
        Logger.log(`Procesando materia ID ${materia.id}: ${materia.nombre} (${materia.semestre})`);

        // Crear/Obtener carpeta para la materia
        const nombreCarpetaMateria = `${materia.nombre} - ${materia.semestre}`;
        const carpetaMateria = getOrCreateFolder(carpetaDocente, nombreCarpetaMateria);

        // Crear/Obtener carpetas principales dentro de la materia
        const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
        const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
        getOrCreateFolder(carpetaMateria, "Evaluaciones");
        getOrCreateFolder(carpetaMateria, "Material Didáctico");

        // Crear estructura de Unidades DENTRO de la carpeta "Actividades"
        const numeroDeUnidades = parseInt(materia.unidades, 10) || 0; // Asegurar que sea número (0 si no es válido)
        if (numeroDeUnidades > 0) {
          Logger.log(`Creando estructura para ${numeroDeUnidades} unidades...`);
          for (let i = 1; i <= numeroDeUnidades; i++) {
            const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${i}`);
            // Sheet Resumen Calificaciones DENTRO de la carpeta de unidad
            getOrCreateSheet(carpetaUnidad, `Resumen Calificaciones - Unidad ${i}`);
            // Carpeta Reportes Detallados DENTRO de la carpeta de unidad
            getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");
          }
        } else {
            Logger.log("Advertencia: La materia no tiene un número válido de unidades definidas.");
        }

        // Obtener la lista de alumnos (asegurando que sea un array)
        const alumnosDeMateria = Array.isArray(materia.alumnos) ? materia.alumnos : [];
        Logger.log(`Materia ID ${materia.id} tiene ${alumnosDeMateria.length} alumnos recibidos en payload.`);

        // Crear y poblar las hojas de cálculo en la carpeta "Reportes"
        crearListaDeAlumnosSheet(carpetaReportes, alumnosDeMateria); // Llama a la versión optimizada
        const sheetAsistencia = crearAsistenciasSheet(carpetaReportes, alumnosDeMateria, numeroDeUnidades); // Llama a la versión optimizada

        // Crear/Obtener las hojas de cálculo maestras en la carpeta "Actividades"
        const sheetRubricas = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
        const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);

        // Almacenar los resultados (URLs e IDs) para esta materia
        results.drive_urls[materia.id] = carpetaMateria.getUrl();
        results.rubricas_spreadsheet_ids[materia.id] = sheetRubricas ? sheetRubricas.getId() : null; // Guardar ID o null si falló
        results.plagio_spreadsheet_ids[materia.id] = sheetPlagio ? sheetPlagio.getId() : null; // Guardar ID o null si falló
        results.calificaciones_spreadsheet_ids[materia.id] = sheetAsistencia ? sheetAsistencia.getId() : null; // Guardar ID o null si falló

        const materiaEndTime = new Date().getTime();
        Logger.log(`Materia ID ${materia.id} procesada en ${(materiaEndTime - materiaStartTime) / 1000}s`);
        try { SpreadsheetApp.flush(); } catch(e) { Logger.log(`Flush falló (puede ignorarse): ${e.message}`);} // Intentar forzar escritura
    } // Fin del bucle for materias

    const endTime = new Date().getTime();
    Logger.log(`--- Fin handleCreateMateriasBatch en ${(endTime - startTime) / 1000}s ---`);
    return results; // Devolver el objeto con todos los resultados
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
  // Opcional: Crear carpeta "Calificados"
  const carpetaCalificados = getOrCreateFolder(carpetaActividad, "Calificados");

  Logger.log(`Estructura de carpetas creada/verificada para actividad "${nombre_actividad}" en ${nombreCarpetaUnidad}.`);
  return {
    drive_folder_id_actividad: carpetaActividad.getId(),
    drive_folder_id_entregas: carpetaEntregas.getId(),
    drive_folder_id_calificados: carpetaCalificados.getId() // Devolver ID si se crea
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
function handleLogAsistencia(payload) {
  const { drive_url, fecha, unidad, sesion, asistencias } = payload;
  Logger.log("Recibido en handleLogAsistencia: " + JSON.stringify(payload).substring(0, 500) + "..."); // Log inicial truncado

  if (!drive_url || !asistencias || !fecha || !unidad || !sesion) { throw new Error("Faltan datos para registrar la asistencia (drive_url, fecha, unidad, sesion, asistencias)."); }
  if (!Array.isArray(asistencias)) { throw new Error("El campo 'asistencias' debe ser un array."); }

  const carpetaMateriaId = extractDriveIdFromUrl(drive_url);
  if (!carpetaMateriaId) throw new Error(`URL de Drive inválida: ${drive_url}`);
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");

  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}" en la carpeta Reportes.`);

  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const nombreHojaUnidad = `Unidad ${unidad}`;
  const hoja = hojaDeCalculo.getSheetByName(nombreHojaUnidad);
  if (!hoja) throw new Error(`No se encontró la pestaña "${nombreHojaUnidad}" en el archivo ${NOMBRE_SHEET_ASISTENCIA}.`);

  // --- Lógica para encontrar/crear la columna de la sesión ---
  const hoy = new Date(fecha + 'T12:00:00Z'); // Usar T12:00Z para consistencia
  const textoEncabezado = `${('0' + hoy.getDate()).slice(-2)}/${('0' + (hoy.getMonth() + 1)).slice(-2)}-${sesion}`;
  Logger.log("Buscando/Creando encabezado de columna: " + textoEncabezado);

  const ultimaColumna = hoja.getLastColumn();
  let columnaParaHoy = 0; // Base 1

  if (ultimaColumna > 0) { // Solo buscar si la hoja tiene contenido
    const primeraFila = hoja.getRange(1, 1, 1, ultimaColumna).getValues()[0];
    columnaParaHoy = primeraFila.findIndex(header => String(header).trim() === textoEncabezado) + 1; // findIndex es base 0, +1 para base 1
  }

  // Si no se encontró (findIndex devuelve -1 -> columnaParaHoy es 0), crearla
  if (columnaParaHoy === 0) {
    columnaParaHoy = (ultimaColumna || hoja.getFrozenColumns()) + 1; // Añadir después de la última columna o después de las congeladas si está vacía
    hoja.getRange(1, columnaParaHoy).setValue(textoEncabezado).setFontWeight("bold").setHorizontalAlignment("center");
    Logger.log(`Columna "${textoEncabezado}" creada en la posición ${columnaParaHoy}.`);
  } else {
    Logger.log(`Columna "${textoEncabezado}" encontrada en la posición ${columnaParaHoy}.`);
  }

  // --- Lógica para mapear matrículas a filas ---
  const primeraFilaDatos = hoja.getFrozenRows() + 1; // Asume que los datos empiezan después de las filas congeladas (usualmente 2)
  const numFilasDatos = hoja.getLastRow() - primeraFilaDatos + 1;
  let matriculaMap = new Map(); // Mapa: matricula (string mayúsculas) -> numero de fila (base 1)

  if (numFilasDatos > 0) {
    const rangoMatriculas = hoja.getRange(primeraFilaDatos, 1, numFilasDatos, 1).getValues(); // Leer columna A
    rangoMatriculas.forEach((fila, index) => {
      const matriculaEnSheet = String(fila[0]).trim().toUpperCase();
      if (matriculaEnSheet && !matriculaMap.has(matriculaEnSheet)) { // Evitar duplicados si existen en la hoja
        matriculaMap.set(matriculaEnSheet, index + primeraFilaDatos);
      } else if (matriculaEnSheet) {
          Logger.log(`Advertencia: Matrícula duplicada encontrada en hoja: ${matriculaEnSheet} en fila ${index + primeraFilaDatos}`);
      }
    });
    Logger.log(`Mapeadas ${matriculaMap.size} matrículas únicas desde la hoja.`);
  } else {
    Logger.log("Advertencia: No se encontraron filas de datos de alumnos en la hoja (después de las filas congeladas).");
  }


  // --- Escribir las asistencias ---
  let registrosEscritos = 0;
  let matriculasNoEncontradas = [];
  asistencias.forEach(asistencia => {
    if (!asistencia || typeof asistencia.matricula !== 'string') {
        Logger.log(`Registro de asistencia inválido recibido: ${JSON.stringify(asistencia)}`);
        return; // Saltar registro inválido
    }
    const matriculaRecibida = asistencia.matricula.trim().toUpperCase();
    const fila = matriculaMap.get(matriculaRecibida);

    if (fila) {
      const valor = asistencia.presente === true ? 1 : 0; // Asegurar 1 o 0
      try {
        hoja.getRange(fila, columnaParaHoy).setValue(valor).setHorizontalAlignment("center");
        registrosEscritos++;
      } catch (writeError) {
         Logger.log(`Error al escribir en celda (${fila}, ${columnaParaHoy}) para ${matriculaRecibida}: ${writeError.message}`);
      }
    } else {
      matriculasNoEncontradas.push(matriculaRecibida); // Guardar para loguear al final
    }
  });

  if (matriculasNoEncontradas.length > 0) {
      Logger.log(`Advertencia: ${matriculasNoEncontradas.length} matrículas recibidas no fueron encontradas en la hoja "${nombreHojaUnidad}": ${matriculasNoEncontradas.join(', ')}`);
  }
  Logger.log(`Proceso completado. Se intentó escribir ${asistencias.length} registros, se escribieron ${registrosEscritos}.`);
  SpreadsheetApp.flush(); // Forzar escritura
  return `Se ${registrosEscritos === 1 ? 'escribió' : 'escribieron'} ${registrosEscritos} de ${asistencias.length} asistencias en '${textoEncabezado}'. ${matriculasNoEncontradas.length > 0 ? ` (${matriculasNoEncontradas.length} matrículas no encontradas)` : ''}`;
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
  Logger.log(`Iniciando handleGetStudentWorkText para file ID ${payload.drive_file_id}...`);
  const { drive_file_id } = payload;
  if (!drive_file_id) { throw new Error("Falta 'drive_file_id'."); }

  let file;
  try {
    file = DriveApp.getFileById(drive_file_id);
  } catch (e) {
     throw new Error(`No se pudo encontrar o acceder al archivo con ID ${drive_file_id}. Verifica el ID y los permisos. Error: ${e.message}`);
  }

  const fileName = file.getName();
  const mimeType = file.getMimeType();
  Logger.log(`Procesando archivo: "${fileName}", Tipo MIME: ${mimeType}`);
  let textContent = '';

  try {
    if (mimeType === MimeType.GOOGLE_DOCS) {
      Logger.log("Leyendo como Google Doc...");
      textContent = DocumentApp.openById(file.getId()).getBody().getText();
    } else if (mimeType === MimeType.PDF) {
       Logger.log("Procesando PDF con OCR...");
       // Usar API Avanzada de Drive (Drive.Files) para OCR
       const blob = file.getBlob();
       const resource = { title: `[OCR TEMP] ${fileName}` , mimeType: MimeType.GOOGLE_DOCS };
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
       const tempDoc = Drive.Files.copy({ title: `[TEMP CONVERT] ${fileName}`, mimeType: MimeType.GOOGLE_DOCS }, file.getId());
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
      const resource = { title: `[OCR TEMP fallback] ${fileName}` , mimeType: MimeType.GOOGLE_DOCS };
      const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'es' });
       try {
          textContent = DocumentApp.openById(ocrFile.id).getBody().getText();
          Logger.log("OCR (fallback) completado.");
       } finally {
          try { Drive.Files.remove(ocrFile.id); } catch (e) {/*ignore*/}
       }
       if (!textContent) { // Si el OCR fallback tampoco funcionó
           throw new Error(`El archivo '${fileName}' (tipo ${mimeType}) no es un formato de texto legible ni pudo ser procesado con OCR.`);
       }
    }
    Logger.log(`Texto extraído exitosamente (longitud: ${textContent.length}).`);
    return { texto_trabajo: textContent };
  } catch (e) {
    // Loguear el error específico y relanzar uno más genérico
    Logger.log(`ERROR en handleGetStudentWorkText para ID ${drive_file_id}: ${e.message}\nStack: ${e.stack}`);
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

  // Validar formato A1Notation básico (NombreHoja!Celda)
  if (typeof justificacion_sheet_cell !== 'string' || !justificacion_sheet_cell.includes('!')) {
      throw new Error(`Formato de celda inválido: "${justificacion_sheet_cell}". Debe ser 'NombreHoja!A1'.`);
  }

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


// ==========================================================================================
// FUNCIONES AUXILIARES DE DRIVE Y SHEETS (OPTIMIZADAS Y SIN DUPLICADOS)
// ==========================================================================================

/**
 * Obtiene o crea una carpeta dentro de una carpeta padre.
 * @param {Folder} carpetaPadre El objeto Folder padre.
 * @param {string} nombreSubcarpeta El nombre deseado para la subcarpeta.
 * @return {Folder} El objeto Folder de la subcarpeta encontrada o creada.
 */
function getOrCreateFolder(carpetaPadre, nombreSubcarpeta) {
  // Validaciones robustas
  if (!carpetaPadre || typeof carpetaPadre.getFoldersByName !== 'function') {
      Logger.log(`ERROR: carpetaPadre inválida en getOrCreateFolder para "${nombreSubcarpeta || ''}"`);
      throw new Error(`Error interno: Objeto carpetaPadre inválido.`);
  }
  const nombreNormalizado = String(nombreSubcarpeta || '').trim(); // Asegurar string y trim
  if (!nombreNormalizado) {
      Logger.log(`ERROR: Nombre de subcarpeta vacío.`);
      throw new Error(`Error interno: Nombre de subcarpeta no puede estar vacío.`);
  }

  try {
    // Buscar carpeta existente por nombre exacto
    const carpetas = carpetaPadre.getFoldersByName(nombreNormalizado);
    if (carpetas.hasNext()) {
      // Logger.log(`Carpeta encontrada: "${nombreNormalizado}" en "${carpetaPadre.getName()}"`);
      return carpetas.next(); // Devolver la existente
    } else {
      // Si no existe, crearla
      Logger.log(`Creando carpeta: "${nombreNormalizado}" dentro de "${carpetaPadre.getName()}"`);
      return carpetaPadre.createFolder(nombreNormalizado);
    }
  } catch (e) {
      // Capturar y loguear cualquier error durante la búsqueda o creación
      Logger.log(`ERROR en getOrCreateFolder("${carpetaPadre.getName()}", "${nombreNormalizado}"): ${e.message}`);
      throw e; // Relanzar el error para detener la ejecución si es crítico
  }
}

/**
 * Obtiene o crea una hoja de cálculo dentro de una carpeta específica.
 * @param {Folder} folder El objeto Folder donde buscar/crear el archivo.
 * @param {string} sheetName El nombre deseado para la hoja de cálculo.
 * @return {Spreadsheet | null} El objeto Spreadsheet encontrado o creado, o null si falla.
 */
function getOrCreateSheet(folder, sheetName) {
   // Validaciones robustas
  if (!folder || typeof folder.getFilesByName !== 'function') {
      Logger.log(`ERROR: folder inválido en getOrCreateSheet para "${sheetName || ''}"`);
      throw new Error(`Error interno: Objeto folder inválido.`);
  }
   const nameNormalized = String(sheetName || '').trim();
   if (!nameNormalized) {
       Logger.log(`ERROR: Nombre de sheet vacío.`);
       throw new Error(`Error interno: Nombre de sheet no puede estar vacío.`);
   }

  try {
    // Buscar archivo existente por nombre exacto
    const files = folder.getFilesByName(nameNormalized);
    if (files.hasNext()) {
      const file = files.next();
      // Logger.log(`Sheet encontrado: "${nameNormalized}" (ID: ${file.getId()}) en "${folder.getName()}"`);
      return SpreadsheetApp.openById(file.getId()); // Abrir y devolver el existente
    } else {
      // Si no existe, crear uno nuevo
      Logger.log(`Creando sheet: "${nameNormalized}" dentro de "${folder.getName()}"`);
      const spreadsheet = SpreadsheetApp.create(nameNormalized); // Crear con el nombre deseado
      const fileId = spreadsheet.getId();

      // Mover el archivo recién creado a la carpeta destino
      moveFileToFolder(fileId, folder, nameNormalized);

      // Renombrar/Crear la hoja principal dentro del Spreadsheet
      try {
        const sheets = spreadsheet.getSheets();
        if(sheets.length > 0 && sheets[0].getName() === "Sheet1") {
           sheets[0].setName("Datos"); // Renombrar la hoja por defecto "Sheet1"
        } else if (sheets.length === 0) {
           spreadsheet.insertSheet("Datos"); // Crear hoja "Datos" si no hay ninguna
        }
      } catch (renameError) {
          // Loguear si falla el renombrado/creación de hoja, pero continuar
          Logger.log(`Advertencia: no se pudo renombrar/crear hoja principal en "${nameNormalized}": ${renameError.message}`);
      }

      return spreadsheet; // Devolver el Spreadsheet recién creado
    }
  } catch (e) {
      // Capturar y loguear cualquier error
      Logger.log(`ERROR en getOrCreateSheet("${folder.getName()}", "${nameNormalized}"): ${e.message}\nStack: ${e.stack}`);
      // Podrías devolver null o relanzar el error dependiendo de la criticidad
      // return null;
       throw e; // Relanzar para detener la ejecución si falla aquí
  }
}

/**
 * Crea la hoja de cálculo "Lista de Alumnos" y la llena. Optimizado. ÚNICA DEFINICIÓN.
 * @param {Folder} carpetaPadre Carpeta "Reportes".
 * @param {Array<object>} alumnos Array de alumnos [{matricula, nombre, apellido}].
 */
function crearListaDeAlumnosSheet(carpetaPadre, alumnos) {
  const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_LISTA_ALUMNOS);
  if (files.hasNext()) {
    Logger.log(`"${NOMBRE_SHEET_LISTA_ALUMNOS}" ya existe en "${carpetaPadre.getName()}".`);
    // Opcional: Podríamos verificar si la lista de alumnos necesita actualizarse
    return; // Salir si ya existe
  }
  Logger.log(`Creando y poblando "${NOMBRE_SHEET_LISTA_ALUMNOS}" en "${carpetaPadre.getName()}"...`);
  let spreadsheet;
  try {
      spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_LISTA_ALUMNOS);
  } catch (createError) {
       Logger.log(`ERROR al crear Spreadsheet ${NOMBRE_SHEET_LISTA_ALUMNOS}: ${createError.message}`);
       throw createError;
  }
  const sheet = spreadsheet.getSheets()[0].setName("Alumnos");
  const headers = ["Matrícula", "Nombre", "Apellido"];

  // Preparar datos (incluyendo headers)
  const filasParaEscribir = [headers];
  if (Array.isArray(alumnos)) {
      alumnos.forEach((a, index) => {
        if (!a || typeof a !== 'object') {
           Logger.log(`Lista - Alumno ${index} inválido: ${JSON.stringify(a)}`);
           return; // Saltar si el alumno no es un objeto válido
        }
        // Logger.log(`Lista - Alumno ${index}: ${JSON.stringify(a)}`); // Log detallado
        filasParaEscribir.push([ a.matricula || '', a.nombre || '', a.apellido || '' ]);
      });
  } else {
       Logger.log("Lista - 'alumnos' no es un array.");
  }

  // Escribir TODO de una vez (headers + datos)
  if (filasParaEscribir.length > 1) { // Si hay al menos un alumno
    try {
      sheet.getRange(1, 1, filasParaEscribir.length, headers.length).setValues(filasParaEscribir);
      sheet.getRange("A1:C1").setFontWeight("bold");
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 120); sheet.setColumnWidth(2, 200); sheet.setColumnWidth(3, 200);
      Logger.log(`Se escribieron ${filasParaEscribir.length - 1} alumnos en "${NOMBRE_SHEET_LISTA_ALUMNOS}".`);
    } catch (e) {
      Logger.log(`ERROR al escribir en ${NOMBRE_SHEET_LISTA_ALUMNOS}: ${e.message}`);
    }
  } else {
    // Si solo están los headers (no alumnos), escribir solo headers
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange("A1:C1").setFontWeight("bold");
    sheet.setFrozenRows(1);
    Logger.log(`No hay alumnos válidos para escribir en "${NOMBRE_SHEET_LISTA_ALUMNOS}".`);
  }

  // Mover archivo
  moveFileToFolder(spreadsheet.getId(), carpetaPadre, NOMBRE_SHEET_LISTA_ALUMNOS);
}

/**
 * Crea la hoja de cálculo "Reporte de Asistencia" y la llena. Optimizado. ÚNICA DEFINICIÓN.
 * @param {Folder} carpetaPadre Carpeta "Reportes".
 * @param {Array<object>} alumnos Array de alumnos [{matricula, nombre, apellido}].
 * @param {number} numeroDeUnidades Número de unidades (puede ser 0).
 * @return {Spreadsheet | null} La hoja de cálculo o null si falla.
 */
function crearAsistenciasSheet(carpetaPadre, alumnos, numeroDeUnidades) {
  const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (files.hasNext()) {
    Logger.log(`"${NOMBRE_SHEET_ASISTENCIA}" ya existe en "${carpetaPadre.getName()}".`);
    // Opcional: Podríamos verificar/actualizar hojas o alumnos aquí
    return SpreadsheetApp.open(files.next());
  }
  Logger.log(`Creando y poblando "${NOMBRE_SHEET_ASISTENCIA}" en "${carpetaPadre.getName()}"...`);
  let spreadsheet;
   try {
      spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_ASISTENCIA);
  } catch (createError) {
       Logger.log(`ERROR al crear Spreadsheet ${NOMBRE_SHEET_ASISTENCIA}: ${createError.message}`);
       throw createError;
  }
  const headers = ["Matrícula", "Nombre Completo"];

  // Preparar datos de alumnos
  const filasAlumnos = Array.isArray(alumnos) ? alumnos.map((a, index) => {
     if (!a || typeof a !== 'object') {
           Logger.log(`Asistencia - Alumno ${index} inválido: ${JSON.stringify(a)}`);
           return null; // Marcar para filtrar
        }
    // Logger.log(`Asistencia - Alumno ${index}: ${JSON.stringify(a)}`);
    return [ a.matricula || '', `${a.nombre || ''} ${a.apellido || ''}`.trim() ];
  }).filter(Boolean) : []; // Filtrar nulos si hubo inválidos
  Logger.log(`Asistencia - 'filasAlumnos' válidas generadas: ${filasAlumnos.length} filas.`);

  // --- LÓGICA SIMPLIFICADA PARA HOJAS ---
  // 1. Eliminar la hoja por defecto "Sheet1"
  const sheet1 = spreadsheet.getSheetByName("Sheet1");
  if (sheet1) {
    try {
      spreadsheet.deleteSheet(sheet1);
      Logger.log("Hoja por defecto 'Sheet1' eliminada.");
    } catch (e) {
      Logger.log(`Advertencia: No se pudo eliminar 'Sheet1': ${e.message}`);
    }
  }

  // Crear hojas por unidad
  const numUnidadesReales = Math.max(1, numeroDeUnidades || 0); // Si es 0, creará 1 hoja "Unidad 1"
  for (let i = 1; i <= numUnidadesReales; i++) {
    const nombreHoja = `Unidad ${i}`;
    let hojaUnidad;
    // Intentar obtener/crear la hoja
    try {
        hojaUnidad = spreadsheet.insertSheet(nombreHoja);
        Logger.log(`Hoja "${nombreHoja}" creada.`);
    } catch (sheetError) {
         Logger.log(`ERROR al obtener/crear hoja ${nombreHoja}: ${sheetError.message}`);
         continue; // Saltar a la siguiente unidad si falla
    }

    // Preparar datos para esta hoja (headers + alumnos)
    const datosParaEscribir = [headers];
    if (filasAlumnos.length > 0) {
      datosParaEscribir.push(...filasAlumnos);
    }

    // Escribir todo de una vez
    if (datosParaEscribir.length > 0) {
       try {
            hojaUnidad.getRange(1, 1, datosParaEscribir.length, headers.length).setValues(datosParaEscribir);
            // Aplicar formato
            hojaUnidad.getRange(1, 1, 1, headers.length).setFontWeight("bold");
            hojaUnidad.setFrozenRows(1);
            hojaUnidad.setFrozenColumns(2);
            hojaUnidad.setColumnWidth(2, 250); // Ancho para Nombre Completo
            Logger.log(`Hoja "${nombreHoja}" poblada con encabezados y ${filasAlumnos.length} alumnos.`);
       } catch (e) {
            Logger.log(`ERROR al escribir datos en ${nombreHoja}: ${e.message}`);
       }
    } else {
        Logger.log(`Advertencia: No hay datos (ni siquiera headers?) para escribir en ${nombreHoja}.`);
    }
  } // Fin for unidades

  // Mover archivo
  moveFileToFolder(spreadsheet.getId(), carpetaPadre, NOMBRE_SHEET_ASISTENCIA);
  return spreadsheet; // Devolver el objeto Spreadsheet
}

/**
 * Mueve un archivo de Google Drive a una carpeta destino, quitándolo de otras carpetas.
 * @param {string} fileId ID del archivo a mover.
 * @param {Folder} targetFolder Objeto Folder destino.
 * @param {string} fileNameForLog Nombre del archivo para usar en los logs.
 */
function moveFileToFolder(fileId, targetFolder, fileNameForLog) {
   try {
      const file = DriveApp.getFileById(fileId);
      const parents = file.getParents();
      let needsMove = true;
      let currentParentFound = false;

      // Iterar sobre todos los padres actuales
      while (parents.hasNext()) {
          const parent = parents.next();
          if (parent.getId() === targetFolder.getId()) {
              needsMove = false; // Ya está en la carpeta destino
          }
          currentParentFound = true; // Marcamos que encontramos al menos un padre
      }

      // Si no estaba en la carpeta destino O si no tenía ningún padre (estaba en la raíz)
      if (needsMove) {
          // Quitar de todas las carpetas padre actuales (si las tenía)
           if (currentParentFound) {
               const currentParentsIterator = file.getParents(); // Obtener de nuevo el iterador
               while (currentParentsIterator.hasNext()) {
                  DriveApp.getFolderById(currentParentsIterator.next().getId()).removeFile(file);
               }
           } else {
               // Si no tenía padres, estaba en la raíz
               DriveApp.getRootFolder().removeFile(file);
           }
          // Añadir a la carpeta destino
          targetFolder.addFile(file);
          Logger.log(`Archivo "${fileNameForLog}" movido a "${targetFolder.getName()}".`);
      } else {
           Logger.log(`Archivo "${fileNameForLog}" ya estaba en "${targetFolder.getName()}".`);
      }
    } catch(moveError) {
      // Loguear el error pero no detener el script necesariamente
      Logger.log(`ERROR al mover archivo "${fileNameForLog}" (ID: ${fileId}) a "${targetFolder.getName()}": ${moveError.message}\nStack: ${moveError.stack}`);
      // Considerar relanzar si es crítico: throw moveError;
    }
}


/**
 * Extrae el ID de un archivo o carpeta de una URL de Google Drive.
 * @param {string} driveUrl La URL de Google Drive.
 * @return {string | null} El ID extraído o null si no se encuentra.
 */
function extractDriveIdFromUrl(driveUrl) {
  if (!driveUrl || typeof driveUrl !== 'string') return null;
  // Expresión regular mejorada para capturar IDs de carpetas, archivos, y URLs de edición/vista
  const match = driveUrl.match(/(?:folders\/|d\/|id=|\/open\?id=)([-\w]{25,})/);
  // Devuelve el grupo capturado (el ID) o null
  const id = match ? match[1] : null;
  // Logger.log(`extractDriveIdFromUrl: URL='${driveUrl}', Extracted ID='${id}'`); // Log detallado
  return id;
}

/**
 * Obtiene o crea la hoja de cálculo maestra para rúbricas.
 * @param {object} payload Datos {drive_url_materia}.
 * @return {object} Objeto con 'rubricas_spreadsheet_id'.
 */
function handleGetOrCreateRubricSheet(payload) {
   Logger.log("Iniciando handleGetOrCreateRubricSheet...");
   const { drive_url_materia } = payload;
   if (!drive_url_materia) { throw new Error("Falta 'drive_url_materia'."); }
   const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
   if (!carpetaMateriaId) { throw new Error(`URL de Drive inválida: ${drive_url_materia}`); }
   let carpetaMateria;
   try { carpetaMateria = DriveApp.getFolderById(carpetaMateriaId); }
   catch(e) { throw new Error(`No se pudo acceder a la carpeta de materia con ID ${carpetaMateriaId}: ${e.message}`); }

   const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
   const sheet = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
   if (!sheet) throw new Error("No se pudo crear/obtener la hoja maestra de rúbricas."); // Lanzar error si falla
   Logger.log(`Hoja maestra de rúbricas obtenida/creada: ${sheet.getId()}`);
   return { rubricas_spreadsheet_id: sheet.getId() };
}

// ==========================================================================================
// FUNCIONES OBSOLETAS (MANTENIDAS PERO VACÍAS O CON LOG DE ADVERTENCIA)
// ==========================================================================================

/** @deprecated */
function handleCreateAnnotatedFile(payload) {
  Logger.log("ADVERTENCIA: La función 'handleCreateAnnotatedFile' está obsoleta y no realiza ninguna acción.");
  return { message: "Función obsoleta."};
}

/** @deprecated */
function handleWriteJustification(payload) {
  Logger.log("ADVERTENCIA: La función 'handleWriteJustification' está obsoleta y no realiza ninguna acción.");
  return { message: "Función obsoleta."};
}