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
          if (!materia || typeof materia !== 'object' || !materia.id || !materia.nombre || !materia.semestre) {
              Logger.log(`Advertencia: Datos incompletos para una materia, saltando. Datos: ${JSON.stringify(materia)}`);
              continue;
          }
          
          const materiaResult = _crearEstructuraParaMateria_(carpetaDocente, materia);

          results.drive_urls[materia.id] = materiaResult.drive_url;
          results.rubricas_spreadsheet_ids[materia.id] = materiaResult.rubricas_spreadsheet_id;
          results.plagio_spreadsheet_ids[materia.id] = materiaResult.plagio_spreadsheet_id;
          results.calificaciones_spreadsheet_ids[materia.id] = materiaResult.calificaciones_spreadsheet_id;
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
 * Crea la estructura para UNA SOLA materia, incluyendo poblado de listas.
 * @param {object} payload Datos { docente, materia }
 * @return {object} IDs y URLs de los elementos creados.
 */
function handleCreateMateriaStruct(payload) {
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
  const nombreCarpetaMateria = `${materia.nombre} - ${materia.semestre}`;
  const carpetaMateria = getOrCreateFolder(carpetaDocente, nombreCarpetaMateria);

  const carpetaAsistencia = getOrCreateFolder(carpetaMateria, "Asistencia");
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  getOrCreateFolder(carpetaMateria, "Evaluaciones");
  getOrCreateFolder(carpetaMateria, "Material Didáctico");

  const numeroDeUnidades = parseInt(materia.unidades, 10) || 0;
  if (numeroDeUnidades > 0) {
    for (let i = 1; i <= numeroDeUnidades; i++) {
      const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${i}`);
      getOrCreateSheet(carpetaUnidad, `Resumen Calificaciones - Unidad ${i}`);
      getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");
    }
  }

  const alumnosDeMateria = Array.isArray(materia.alumnos) ? materia.alumnos : [];
  Logger.log(`Materia ID ${materia.id} tiene ${alumnosDeMateria.length} alumnos.`);

  // ¡AQUÍ ESTÁ LA DIFERENCIA! Llamamos a las funciones que pueblan las listas
  crearListaDeAlumnosSheet(carpetaAsistencia, alumnosDeMateria);
  const sheetAsistencia = crearAsistenciasSheet(carpetaAsistencia, alumnosDeMateria, numeroDeUnidades);

  const sheetRubricas = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
  const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);

  const results = {
    drive_url: carpetaMateria.getUrl(),
    rubricas_spreadsheet_id: sheetRubricas ? sheetRubricas.getId() : null,
    plagio_spreadsheet_id: sheetPlagio ? sheetPlagio.getId() : null,
    calificaciones_spreadsheet_id: sheetAsistencia ? sheetAsistencia.getId() : null
  };

  const endTime = new Date().getTime();
  Logger.log(`--- Fin handleCreateMateriaStruct en ${(endTime - startTime) / 1000}s ---`);
  SpreadsheetApp.flush();
  return results; // Devolver los IDs de esta materia
}

/**
 * [FUNCIÓN PRIVADA] Crea la estructura de carpetas y archivos para una materia.
 * @param {GoogleAppsScript.Drive.Folder} carpetaDocente La carpeta del docente.
 * @param {object} materia El objeto de la materia.
 * @return {object} IDs y URLs de los elementos creados para esa materia.
 */
function _crearEstructuraParaMateria_(carpetaDocente, materia) {
  const materiaStartTime = new Date().getTime();
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
  Logger.log(`Materia ID ${materia.id} tiene ${alumnosDeMateria.length} alumnos.`);

  crearListaDeAlumnosSheet(carpetaAsistencia, alumnosDeMateria);
  const sheetAsistencia = crearAsistenciasSheet(carpetaAsistencia, alumnosDeMateria, numeroDeUnidades);

  const sheetRubricas = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
  const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);

  const materiaEndTime = new Date().getTime();
  Logger.log(`Materia ID ${materia.id} procesada en ${(materiaEndTime - materiaStartTime) / 1000}s`);

  return {
    drive_url: carpetaMateria.getUrl(),
    rubricas_spreadsheet_id: sheetRubricas ? sheetRubricas.getId() : null,
    plagio_spreadsheet_id: sheetPlagio ? sheetPlagio.getId() : null,
    calificaciones_spreadsheet_id: sheetAsistencia ? sheetAsistencia.getId() : null
  };
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
  };
}

/**
 * Mueve una carpeta o archivo de Drive a la papelera.
 * @param {object} payload Datos { drive_id }.
 * @return {object} Mensaje de éxito.
 */
function handleEliminarRecurso(payload) {
  const { drive_id } = payload;
  if (!drive_id) {
    throw new Error("Se requiere 'drive_id' para eliminar el recurso.");
  }

  try {
    // Intentamos obtenerlo como carpeta primero
    try {
      const folder = DriveApp.getFolderById(drive_id);
      folder.setTrashed(true);
      Logger.log(`Carpeta ${drive_id} enviada a la papelera.`);
      return { message: "Carpeta enviada a la papelera." };
    } catch (e) {
      // Si falla, intentamos como archivo
      const file = DriveApp.getFileById(drive_id);
      file.setTrashed(true);
      Logger.log(`Archivo ${drive_id} enviado a la papelera.`);
      return { message: "Archivo enviado a la papelera." };
    }
  } catch (e) {
    Logger.log(`Error al eliminar recurso ${drive_id}: ${e.message}`);
    // Si no se encuentra, lo reportamos como éxito para que Supabase pueda borrar el registro.
    if (e.message.includes("Not Found") || e.message.includes("no se encontró")) {
      return { message: "Recurso no encontrado en Drive (probablemente ya fue borrado)." };
    }
    throw e; // Lanzar otros errores (ej. permisos)
  }
}

/**
 * Obtiene o crea una carpeta dentro de una carpeta padre.
 * @param {GoogleAppsScript.Drive.Folder} carpetaPadre El objeto Folder padre.
 * @param {string} nombreSubcarpeta El nombre deseado para la subcarpeta.
 * @return {GoogleAppsScript.Drive.Folder} El objeto Folder de la subcarpeta encontrada o creada.
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
 * Mueve un archivo de Google Drive a una carpeta destino, quitándolo de otras carpetas.
 * @param {string} fileId ID del archivo a mover.
 * @param {GoogleAppsScript.Drive.Folder} targetFolder Objeto Folder destino.
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
    }
}