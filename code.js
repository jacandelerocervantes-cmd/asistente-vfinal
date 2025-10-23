/**
 * @OnlyCurrentDoc
 */

// ==========================================================================================
// CONFIGURACIÓN PRINCIPAL
// ==========================================================================================
const CARPETA_RAIZ_ID = "1j7boqj1CEg9NUItM7MNp31YIuy1hhapT";
const NOMBRE_SHEET_LISTA_ALUMNOS = "Lista de Alumnos";
const NOMBRE_SHEET_ASISTENCIA = "Reporte de Asistencia";
const NOMBRE_SHEET_MAESTRO_RUBRICAS = "Rúbricas de la Materia";
const NOMBRE_SHEET_PLAGIO = "Reportes de Plagio";


// ==========================================================================================
// MANEJADORES DE PETICIONES WEB (PUNTO DE ENTRADA)
// ==========================================================================================

function doGet(e) {
  Logger.log("Petición GET recibida. Devolviendo mensaje informativo.");
  return ContentService.createTextOutput(
    "El script está activo y responde correctamente a peticiones POST."
  ).setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    Logger.log(`Acción recibida: "${action}"`);

    switch (action) {
      case 'create_materias_batch':
        return crearRespuestaExitosa(handleCreateMateriasBatch(payload));
      case 'create_activity_folder':
        return crearRespuestaExitosa(handleCreateActivityFolder(payload));
      case 'guardar_rubrica':
        return crearRespuestaExitosa(handleGuardarRubrica(payload));
      case 'get_or_create_rubric_sheet':
        return crearRespuestaExitosa(handleGetOrCreateRubricSheet(payload));
      case 'guardar_reporte_plagio':
        return crearRespuestaExitosa(handleGuardarReportePlagio(payload));
      case 'log_asistencia':
        return crearRespuestaExitosa({ message: handleLogAsistencia(payload) });
      case 'cerrar_unidad':
        return crearRespuestaExitosa({ message: handleCerrarUnidad(payload) });
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
      case 'guardar_calificacion_detallada':
        return crearRespuestaExitosa(handleGuardarCalificacionDetallada(payload));
      // --- NUEVO CASE ---
      case 'guardar_calificaciones_evaluacion':
        return crearRespuestaExitosa(handleGuardarCalificacionesEvaluacion(payload));
      case 'create_annotated_file': // Aunque obsoleta, se deja por si acaso
        return crearRespuestaExitosa(handleCreateAnnotatedFile(payload));
      default:
        throw new Error(`Acción desconocida: "${action}"`);
    }
  } catch (error) {
    Logger.log(`ERROR GRAVE en doPost: ${error.message}\nStack: ${error.stack}`);
    return crearRespuestaError(error.message);
  }
}

// ==========================================================================================
// FUNCIONES AUXILIARES DE RESPUESTA JSON
// ==========================================================================================

function crearRespuestaExitosa(data) {
  return ContentService.createTextOutput(JSON.stringify({ status: "success", ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function crearRespuestaError(message) {
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ==========================================================================================
// NUEVA FUNCIÓN PARA GUARDAR CALIFICACIONES DE EVALUACIONES
// ==========================================================================================

/**
 * Recibe las calificaciones finales de una evaluación y las registra
 * en una hoja específica dentro del archivo maestro de calificaciones de la materia.
 * @param {object} payload Datos de la evaluación y calificaciones.
 * @param {string} payload.calificaciones_spreadsheet_id ID del Spreadsheet maestro de reportes (antes asistencia).
 * @param {string} payload.nombre_evaluacion Nombre de la evaluación.
 * @param {number} payload.unidad Unidad a la que pertenece la evaluación.
 * @param {Array<object>} payload.calificaciones Array de objetos, cada uno con { matricula, nombre, calificacion_final }.
 * @return {object} Mensaje de éxito.
 */
function handleGuardarCalificacionesEvaluacion(payload) {
  const { calificaciones_spreadsheet_id, nombre_evaluacion, unidad, calificaciones } = payload;

  if (!calificaciones_spreadsheet_id || !nombre_evaluacion || !calificaciones || !Array.isArray(calificaciones)) {
    throw new Error("Faltan datos para guardar las calificaciones de la evaluación (spreadsheet_id, nombre_evaluacion, calificaciones).");
  }
  if (calificaciones.length === 0) {
    Logger.log("No se recibieron calificaciones para guardar para la evaluación: " + nombre_evaluacion);
    return { message: "No había calificaciones para registrar." }; // No es un error, pero no hace nada.
  }

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  } catch (e) {
    throw new Error(`No se pudo abrir el Spreadsheet de Reportes con ID '${calificaciones_spreadsheet_id}'. Verifica que el ID sea correcto.`);
  }

  // Usar o crear una hoja específica para el reporte de evaluaciones
  const nombreHojaReporte = "Reporte Evaluaciones";
  let sheet = spreadsheet.getSheetByName(nombreHojaReporte);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(nombreHojaReporte);
    // Configurar encabezados si es la primera vez
    sheet.appendRow(["Matrícula", "Nombre Alumno", "Evaluación", "Unidad", "Calificación Final"]);
    sheet.getRange("A1:E1").setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 250); // Ancho para nombre
    sheet.setColumnWidth(3, 250); // Ancho para nombre evaluación
  }

  // Preparamos los datos para añadir (Matrícula, Nombre, Evaluación, Unidad, Calificación)
  const filasParaAnadir = calificaciones.map(cal => [
    cal.matricula || '',
    cal.nombre || '',
    nombre_evaluacion,
    unidad || '', // Añadir unidad si existe
    cal.calificacion_final !== null && cal.calificacion_final !== undefined ? cal.calificacion_final : '' // Manejar nulos/undefined
  ]);

  // Escribir los datos al final de la hoja
  if (filasParaAnadir.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, filasParaAnadir.length, filasParaAnadir[0].length)
         .setValues(filasParaAnadir);
    Logger.log(`Se añadieron ${filasParaAnadir.length} calificaciones para la evaluación "${nombre_evaluacion}" en la hoja "${nombreHojaReporte}".`);
  }

  return { message: `Se registraron ${filasParaAnadir.length} calificaciones en Google Sheets.` };
}


// ==========================================================================================
// MANEJADORES DE ACCIONES (LÓGICA PRINCIPAL)
// ==========================================================================================

function handleCreateMateriasBatch(payload) {
    if (!payload.docente || !payload.materias) {
        throw new Error("Payload inválido: faltan 'docente' o 'materias'.");
    }
    const { docente, materias } = payload;
    const carpetaRaiz = DriveApp.getFolderById(CARPETA_RAIZ_ID);
    const carpetaDocente = getOrCreateFolder(carpetaRaiz, docente.nombre);
    carpetaDocente.addEditor(docente.email);
    const results = { drive_urls: {}, rubricas_spreadsheet_ids: {}, plagio_spreadsheet_ids: {}, calificaciones_spreadsheet_ids: {} };

    for (const materia of materias) {
        const nombreCarpetaMateria = `${materia.nombre} - ${materia.semestre}`;
        const carpetaMateria = getOrCreateFolder(carpetaDocente, nombreCarpetaMateria);
        
        const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
        const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
        getOrCreateFolder(carpetaMateria, "Evaluaciones");
        getOrCreateFolder(carpetaMateria, "Material Didáctico");
        
        // --- ¡CORRECCIÓN! Se crea el sheet de resumen DENTRO del bucle de unidades ---
        if (materia.unidades && materia.unidades > 0) {
          for (let i = 1; i <= materia.unidades; i++) {
            const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${i}`);
            // Asegura la creación del sheet de resumen aquí
            getOrCreateSheet(carpetaUnidad, `Resumen Calificaciones - Unidad ${i}`);
             // Asegura la creación de la carpeta de reportes detallados
            getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");
          }
        }
        
        const alumnos = Array.isArray(materia.alumnos) ? materia.alumnos : [];

        crearListaDeAlumnosSheet(carpetaReportes, alumnos);
        const sheetAsistencia = crearAsistenciasSheet(carpetaReportes, alumnos, materia.unidades);
        const sheetRubricas = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
        const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);

        results.drive_urls[materia.id] = carpetaMateria.getUrl();
        results.rubricas_spreadsheet_ids[materia.id] = sheetRubricas.getId();
        results.plagio_spreadsheet_ids[materia.id] = sheetPlagio.getId();
        // El ID principal de calificaciones ahora apunta al de asistencia, pero cada unidad tendrá su resumen
        results.calificaciones_spreadsheet_ids[materia.id] = sheetAsistencia.getId();
    }
    return results;
}

function handleCreateActivityFolder(payload) {
  const { drive_url_materia, nombre_actividad, unidad } = payload;
  if (!drive_url_materia || !nombre_actividad) {
    throw new Error("Faltan datos para crear la carpeta de la actividad.");
  }
  
  const carpetaMateria = DriveApp.getFolderById(extractDriveIdFromUrl(drive_url_materia));
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${unidad || 'General'}`);
  
  getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");

  const carpetaActividad = carpetaUnidad.createFolder(nombre_actividad);
  const carpetaEntregas = carpetaActividad.createFolder("Entregas");
  
  return { 
    drive_folder_id_actividad: carpetaActividad.getId(), 
    drive_folder_id_entregas: carpetaEntregas.getId()
  };
}

function handleGuardarCalificacionDetallada(payload) {
  const { drive_url_materia, unidad, actividad, calificaciones } = payload;
  if (!drive_url_materia || !unidad || !actividad || !calificaciones) {
    throw new Error("Faltan datos para guardar las calificaciones.");
  }

  // *** VALIDACIÓN AÑADIDA ***
  if (!Array.isArray(calificaciones) || calificaciones.length === 0) {
      Logger.log("Error en handleGuardarCalificacionDetallada: El array 'calificaciones' recibido está vacío.");
      throw new Error("El array 'calificaciones' recibido por Apps Script estaba vacío."); // Error claro
  }

  const carpetaMateria = DriveApp.getFolderById(extractDriveIdFromUrl(drive_url_materia));
  // --- ¡CORRECCIÓN! Ruta correcta a la carpeta de la unidad ---
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${unidad}`);

  // --- 1. Procesa el Reporte Detallado por Actividad ---
  const carpetaReportesDetallados = getOrCreateFolder(carpetaUnidad, "Reportes por Actividad");
  const reporteDetalladoSheet = getOrCreateSheet(carpetaReportesDetallados, actividad.nombre); // Nombre del sheet = nombre de actividad
  const sheetDetallado = reporteDetalladoSheet.getSheets()[0];
  sheetDetallado.setName("Detalle"); // Renombrar hoja principal si es nueva

  if (sheetDetallado.getLastRow() < 1) {
    // 1. Añade la fila de encabezados
    sheetDetallado.appendRow(["Matricula", "Equipo", "Calificacion", "Retroalimentacion y observaciones"]);
    // 2. Obtén el rango de esa fila (fila 1) y aplica el formato
    sheetDetallado.getRange("A1:D1").setFontWeight("bold");
    sheetDetallado.setFrozenRows(1);
    sheetDetallado.setColumnWidth(4, 400);
  }

  calificaciones.forEach(cal => {
    sheetDetallado.appendRow([cal.matricula, cal.equipo || '', cal.calificacion, cal.retroalimentacion]);
  });

  // --- 2. Actualiza el Resumen de la Unidad ---
  const nombreResumen = `Resumen Calificaciones - Unidad ${unidad}`;
  const resumenUnidadSheet = getOrCreateSheet(carpetaUnidad, nombreResumen);
  const sheetResumen = resumenUnidadSheet.getSheets()[0];
  sheetResumen.setName("Resumen");

  let headers;
  let colIndex = -1; // Inicializar como -1
  let lastHeaderColumn = sheetResumen.getLastColumn();

  // --- LÓGICA DE ENCABEZADOS MEJORADA ---
  if (sheetResumen.getLastRow() < 1) {
    // Hoja completamente vacía, añadir headers básicos y de actividad
    headers = ["Matricula", "Nombre", actividad.nombre];
    sheetResumen.appendRow(headers);
    sheetResumen.getRange(1, 1, 1, 3).setFontWeight("bold"); // Ajusta el rango si añades más headers
    sheetResumen.setFrozenRows(1);
    colIndex = 3; // La columna de la actividad es la 3ra
    lastHeaderColumn = 3;
  } else {
    // Leer headers existentes
    headers = sheetResumen.getRange(1, 1, 1, lastHeaderColumn || 1).getValues()[0];
    colIndex = headers.indexOf(actividad.nombre);

    if (colIndex === -1) { // Si la columna de actividad NO existe
      colIndex = (lastHeaderColumn || 0) + 1; // Nueva columna al final
      sheetResumen.getRange(1, colIndex).setValue(actividad.nombre).setFontWeight("bold");
      lastHeaderColumn = colIndex; // Actualizar última columna de header
    } else {
      colIndex += 1; // Ajuste base 0 a base 1 si ya existía
    }
  }
  // --- FIN LÓGICA DE ENCABEZADOS MEJORADA ---

  let matriculaToRowIndex = new Map();
  const lastDataRow = sheetResumen.getLastRow();
  if (lastDataRow > 1) { // Solo leer si hay datos
      const matriculasEnSheet = sheetResumen.getRange(2, 1, lastDataRow - 1, 1).getValues().flat();
      matriculaToRowIndex = new Map(matriculasEnSheet.map((m, i) => [String(m).trim(), i + 2]));
  }
  // Actualizar/Añadir calificaciones
  calificaciones.forEach(cal => {
    const matriculaStr = String(cal.matricula).trim(); // Asegurar string trim
    let rowIndex = matriculaToRowIndex.get(matriculaStr);
    if (!rowIndex) { // Si el alumno es nuevo en la hoja
      // Crear la fila con datos básicos Y espacio para las calificaciones existentes
      const nuevaFila = [cal.matricula, cal.nombre];
      // Rellenar con vacío para columnas de actividades anteriores
      for (let i = 3; i < colIndex; i++) {
          nuevaFila.push('');
      }
      // Añadir la calificación actual
      nuevaFila[colIndex - 1] = cal.calificacion; // Añadir en la posición correcta (base 0)
      sheetResumen.appendRow(nuevaFila);
      rowIndex = sheetResumen.getLastRow();
      matriculaToRowIndex.set(matriculaStr, rowIndex); // Actualizar el mapa
    } else { // Si el alumno ya existe
      // Escribir solo en la columna correcta
      if (colIndex > sheetResumen.getMaxColumns()) { sheetResumen.insertColumnAfter(sheetResumen.getMaxColumns()); }
      sheetResumen.getRange(rowIndex, colIndex).setValue(cal.calificacion);
    }
  });

  // --- Devolver referencia a la celda (EJEMPLO MEJORADO) ---
  let justificacionCellRef = null;
  // Intenta obtener la fila de la primera matrícula procesada en ESTA ejecución
  const firstMatricula = String(calificaciones[0].matricula).trim();
  const firstRowIndexInSummary = matriculaToRowIndex.get(firstMatricula); // Fila en Resumen
  if (firstRowIndexInSummary) {
      // Asume que la retroalimentación está en la 4ta columna del sheet DETALLADO
      // Manera simple: asumir que la última fila añadida corresponde a la primera matrícula (si solo se procesa uno a la vez)
       const lastDetailRow = sheetDetallado.getLastRow(); // La última fila que se acaba de añadir
       if (lastDetailRow > 1) { // Asegurarse que se añadió algo
            justificacionCellRef = `'Detalle'!D${lastDetailRow}`; // Columna D del sheet 'Detalle'
       }
  }
   Logger.log("Referencia de celda generada: " + justificacionCellRef);

  return { message: "Reportes generados.", justificacion_cell_ref: justificacionCellRef };
}


function handleGuardarRubrica(payload) {
  const { rubricas_spreadsheet_id, nombre_actividad, criterios } = payload;
  if (!rubricas_spreadsheet_id || !nombre_actividad || !criterios || !Array.isArray(criterios)) {
    throw new Error("Faltan datos para guardar la rúbrica.");
  }
  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(rubricas_spreadsheet_id);
  } catch (e) {
    throw new Error(`No se pudo abrir la hoja de cálculo de rúbricas con ID '${rubricas_spreadsheet_id}'.`);
  }
  let sheet = spreadsheet.getSheets()[0];
  if (!sheet) {
    sheet = spreadsheet.insertSheet(NOMBRE_SHEET_MAESTRO_RUBRICAS);
  } else {
    sheet.setName(NOMBRE_SHEET_MAESTRO_RUBRICAS);
  }
  const lastRow = sheet.getLastRow();
  const startRow = lastRow > 0 ? lastRow + 2 : 1;
  sheet.getRange(startRow, 1, 1, 2).merge().setValue(`Rúbrica para: ${nombre_actividad}`).setFontWeight("bold").setBackground("#cfe2f3");
  const headers = ["Criterio de Evaluación", "Puntos"];
  sheet.getRange(startRow + 1, 1, 1, 2).setValues([headers]).setFontWeight("bold");
  const filas = criterios.map(c => [c.descripcion, c.puntos]);
  if (filas.length > 0) {
    sheet.getRange(startRow + 2, 1, filas.length, headers.length).setValues(filas);
  }
  sheet.setColumnWidth(1, 400);
  sheet.setColumnWidth(2, 100);
  const endRow = startRow + 1 + filas.length;
  const rangoDatos = `'${sheet.getName()}'!A${startRow + 1}:B${endRow}`;
  return { 
    rubrica_spreadsheet_id: spreadsheet.getId(),
    rubrica_sheet_range: rangoDatos 
  };
}

// Dentro de code.js - Modificación sugerida

function handleGuardarReportePlagio(payload) {
  const { drive_url_materia, reporte_plagio } = payload;
  if (!drive_url_materia || !reporte_plagio) { /* ... error ... */ } // Validación existente

  const carpetaMateria = DriveApp.getFolderById(extractDriveIdFromUrl(drive_url_materia));
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);
  const fechaHoy = new Date().toISOString().slice(0, 10);
  const nombreHoja = `Reporte ${fechaHoy}`;
  let sheet = sheetPlagio.getSheetByName(nombreHoja);

  if (!sheet) {
    sheet = sheetPlagio.insertSheet(nombreHoja, 0);
    sheet.appendRow(["Trabajo A (File ID)", "Trabajo B (File ID)", "% Similitud", "Fragmentos Similares / Observaciones"]); // Ajustar header
    sheet.getRange("A1:D1").setFontWeight("bold");
    sheet.setColumnWidth(4, 400); // Asegurar ancho
  }

  // *** NUEVA LÓGICA ***
  if (Array.isArray(reporte_plagio) && reporte_plagio.length > 0) {
    // Si hay plagio, añadir las filas como antes
    reporte_plagio.forEach(item => {
      sheet.appendRow([
          item.trabajo_A_id || 'N/A',
          item.trabajo_B_id || 'N/A',
          item.porcentaje_similitud || '0',
          (item.fragmentos_similares || []).join("\n\n") || '-'
      ]);
    });
    Logger.log(`Se añadieron ${reporte_plagio.length} registros de similitud.`);
  } else {
    // Si NO hay plagio (array vacío), añadir una fila indicándolo
    sheet.appendRow(['-', '-', '0%', 'No se encontraron similitudes significativas.']);
    Logger.log("No se encontraron similitudes, se añadió registro informativo.");
  }
  // *** FIN NUEVA LÓGICA ***

  // sheet.setColumnWidth(4, 400); // Mover esta línea después de crear headers si es hoja nueva

  return { message: "Reporte de plagio procesado exitosamente." }; // Mensaje más general
}

/**
 * Registra las asistencias de una sesión específica en la hoja de cálculo.
 * @param {object} payload Datos de la sesión y asistencias.
 * @return {string} Mensaje de resultado.
 */
function handleLogAsistencia(payload) {
  const { drive_url, fecha, unidad, sesion, asistencias } = payload;
  Logger.log("Recibido en handleLogAsistencia: " + JSON.stringify(payload)); // Log inicial

  if (!drive_url || !asistencias || !fecha || !unidad || !sesion) {
    throw new Error("Faltan datos para registrar la asistencia (drive_url, fecha, unidad, sesion, asistencias).");
  }
  if (!Array.isArray(asistencias)) {
    throw new Error("El campo 'asistencias' debe ser un array.");
  }

  const carpetaMateria = DriveApp.getFolderById(extractDriveIdFromUrl(drive_url));
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}".`);

  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const nombreHojaUnidad = `Unidad ${unidad}`;
  const hoja = hojaDeCalculo.getSheetByName(nombreHojaUnidad);
  if (!hoja) {
    throw new Error(`No se encontró la pestaña "${nombreHojaUnidad}". Asegúrate de que exista.`);
  }

  // --- Lógica para encontrar/crear la columna ---
  const hoy = new Date(fecha + 'T12:00:00Z'); // Usar T12:00:00Z para evitar problemas de zona horaria al formatear
  const textoEncabezado = `${('0' + hoy.getDate()).slice(-2)}/${('0' + (hoy.getMonth() + 1)).slice(-2)}-${sesion}`;
  Logger.log("Buscando/Creando encabezado de columna: " + textoEncabezado);

  const ultimaColumna = hoja.getLastColumn();
  let columnaParaHoy = 0; // Inicializar a 0

  if (ultimaColumna > 0) { // Solo buscar si hay columnas
    const primeraFila = hoja.getRange(1, 1, 1, ultimaColumna).getValues()[0];
    // Buscar la columna existente
    for (let i = 0; i < primeraFila.length; i++) {
      if (String(primeraFila[i]).trim() === textoEncabezado) {
        columnaParaHoy = i + 1; // +1 porque los índices de columna son base 1
        break;
      }
    }
  }

  // Si no se encontró, crearla
  if (columnaParaHoy === 0) {
    columnaParaHoy = (ultimaColumna || 0) + 1; // Nueva columna al final
    hoja.getRange(1, columnaParaHoy).setValue(textoEncabezado).setFontWeight("bold"); // Poner en negrita al crear
    Logger.log(`Columna "${textoEncabezado}" creada en la posición ${columnaParaHoy}.`);
  } else {
    Logger.log(`Columna "${textoEncabezado}" encontrada en la posición ${columnaParaHoy}.`);
  }

  // --- Lógica para mapear matrículas a filas ---
  const primeraFilaDatos = 2; // Los datos de alumnos empiezan en la fila 2
  const numFilasDatos = hoja.getLastRow() - primeraFilaDatos + 1;
  let matriculaMap = new Map();

  if (numFilasDatos > 0) {
    // Leer todas las matrículas de la columna A (desde la fila 2)
    const rangoMatriculas = hoja.getRange(primeraFilaDatos, 1, numFilasDatos, 1).getValues();
    rangoMatriculas.forEach((fila, index) => {
      const matriculaEnSheet = String(fila[0]).trim().toUpperCase(); // Normalizar: Trim + Mayúsculas
      if (matriculaEnSheet) { // Evitar mapear celdas vacías
        matriculaMap.set(matriculaEnSheet, index + primeraFilaDatos); // Mapear matrícula -> número de fila (base 1)
      }
    });
    Logger.log(`Mapeadas ${matriculaMap.size} matrículas desde la hoja.`);
  } else {
    Logger.log("Advertencia: No se encontraron datos de alumnos en la hoja (después de la fila 1).");
  }


  // --- Escribir las asistencias ---
  let registrosEscritos = 0;
  asistencias.forEach(asistencia => {
    // Normalizar matrícula recibida
    const matriculaRecibida = String(asistencia.matricula).trim().toUpperCase();
    const fila = matriculaMap.get(matriculaRecibida); // Buscar fila en el mapa

    if (fila) {
      // Si se encontró la fila, escribir 1 (presente) o 0 (ausente)
      const valor = asistencia.presente ? 1 : 0;
      try {
        hoja.getRange(fila, columnaParaHoy).setValue(valor).setHorizontalAlignment("center");
        registrosEscritos++;
        // Logger.log(`Asistencia (${valor}) escrita para ${matriculaRecibida} en fila ${fila}, col ${columnaParaHoy}.`); // Log detallado (opcional)
      } catch (writeError) {
         Logger.log(`Error al escribir en celda (${fila}, ${columnaParaHoy}) para ${matriculaRecibida}: ${writeError.message}`);
      }
    } else {
      // Si la matrícula no se encontró en la hoja
      Logger.log(`Advertencia: Matrícula "${matriculaRecibida}" recibida pero no encontrada en la columna A de la hoja "${nombreHojaUnidad}".`);
    }
  });

  Logger.log(`Proceso completado. Se intentó escribir ${asistencias.length} registros, se escribieron ${registrosEscritos}.`);
  return `Se ${registrosEscritos === 1 ? 'escribió' : 'escribieron'} ${registrosEscritos} de ${asistencias.length} asistencias en la columna '${textoEncabezado}'.`;
}

function handleCerrarUnidad(payload) {
  const { drive_url, unidad, alumnos, registros_asistencia } = payload;
  if (!drive_url || !unidad || !alumnos || !registros_asistencia) { 
    throw new Error("Faltan datos para cerrar la unidad."); 
  }
  const carpetaMateria = DriveApp.getFolderById(extractDriveIdFromUrl(drive_url));
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}".`);
  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const hoja = hojaDeCalculo.getSheetByName(`Unidad ${unidad}`);
  if (!hoja) throw new Error(`No se encontró la pestaña "Unidad ${unidad}".`);
  const totalSesiones = new Set(registros_asistencia.map(r => `${r.fecha}-${r.sesion}`)).size;
  const resumen = new Map();
  alumnos.forEach(alumno => {
    resumen.set(alumno.id, { asistencias: 0, matricula: alumno.matricula });
  });
  registros_asistencia.forEach(registro => {
    if (registro.presente && resumen.has(registro.alumno_id)) {
      resumen.get(registro.alumno_id).asistencias++;
    }
  });
  const ultimaColumna = hoja.getLastColumn();
  const colSumatoria = ultimaColumna + 1;
  const colPromedio = ultimaColumna + 2;
  hoja.getRange(1, colSumatoria).setValue("Total Asistencias").setFontWeight("bold");
  hoja.getRange(1, colPromedio).setValue("% Asistencia").setFontWeight("bold");
  const rangoMatriculas = hoja.getRange(2, 1, hoja.getLastRow() > 1 ? hoja.getLastRow() - 1 : 1, 1).getValues();
  const matriculaMap = new Map(rangoMatriculas.map((fila, index) => [String(fila[0]).trim(), index + 2]));
  for (const [id, datos] of resumen.entries()) {
      const fila = matriculaMap.get(String(datos.matricula).trim());
      if(fila){
          const porcentaje = totalSesiones > 0 ? (datos.asistencias / totalSesiones) : 0;
          hoja.getRange(fila, colSumatoria).setValue(datos.asistencias);
          hoja.getRange(fila, colPromedio).setValue(porcentaje).setNumberFormat("0.0%");
      }
  }
  const protection = hoja.protect().setDescription(`Unidad ${unidad} cerrada`);
  const me = Session.getEffectiveUser();
  protection.addEditor(me);
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) {
    protection.setDomainEdit(false);
  }
  return `Resumen para la Unidad ${unidad} generado y la hoja ha sido protegida.`;
}

function handleGetRubricData(payload) {
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) {
    throw new Error("Faltan 'spreadsheet_id' o 'rubrica_sheet_range'.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(rubrica_sheet_range);
  const values = range.getValues();
  const criterios = values.slice(1).map(row => ({
    descripcion: row[0],
    puntos: row[1]
  })).filter(c => c.descripcion && c.puntos !== '');
  return { criterios: criterios };
}

function handleGetRubricText(payload) {
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) throw new Error("Faltan 'spreadsheet_id' o 'rubrica_sheet_range'.");
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(rubrica_sheet_range);
  const values = range.getValues();
  let textoRubrica = "RÚBRICA DE EVALUACIÓN:\n";
  values.forEach(row => {
    if(row[0] && row[1]) {
      textoRubrica += `- Criterio: "${row[0]}", Puntos Máximos: ${row[1]}\n`;
    }
  });
  return { texto_rubrica: textoRubrica };
}

function handleGetStudentWorkText(payload) {
  const { drive_file_id } = payload;
  if (!drive_file_id) {
    throw new Error("Falta 'drive_file_id'.");
  }
  try {
    const file = DriveApp.getFileById(drive_file_id);
    const mimeType = file.getMimeType();
    let textContent = '';
    if (mimeType === MimeType.GOOGLE_DOCS) {
      textContent = DocumentApp.openById(file.getId()).getBody().getText();
    } else if (
      mimeType === MimeType.MICROSOFT_WORD ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === MimeType.PDF
    ) {
      const tempDoc = Drive.Files.copy({ title: `[TEMP] ${file.getName()}` }, file.getId(), { ocr: true, ocrLanguage: 'es' });
      try {
        textContent = DocumentApp.openById(tempDoc.id).getBody().getText();
      } finally {
        Drive.Files.remove(tempDoc.id);
      }
    } else if (mimeType.startsWith('text/')) {
        textContent = file.getBlob().getDataAsString('UTF-8');
    } else {
      throw new Error(`El archivo '${file.getName()}' no es un formato de texto legible.`);
    }
    return { texto_trabajo: textContent };
  } catch (e) {
    throw new Error(`No se pudo leer el contenido del archivo con ID ${drive_file_id}: ${e.message}`);
  }
}

function handleGetJustificationText(payload) {
  const { spreadsheet_id, justificacion_sheet_cell } = payload;
  if (!spreadsheet_id || !justificacion_sheet_cell) {
    throw new Error("Faltan 'spreadsheet_id' o 'justificacion_sheet_cell'.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  // Validar el formato de la celda antes de usarlo
  if (typeof justificacion_sheet_cell !== 'string' || !justificacion_sheet_cell.includes('!')) {
      throw new Error(`Formato de celda inválido: ${justificacion_sheet_cell}`);
  }
  const range = spreadsheet.getRange(justificacion_sheet_cell);
  return { justificacion_texto: range.getValue() };
}


function handleGetMultipleFileContents(payload) {
  const { drive_file_ids } = payload;
  if (!drive_file_ids || !Array.isArray(drive_file_ids)) {
    throw new Error("Se requiere un array de 'drive_file_ids'.");
  }
  const contenidos = drive_file_ids.map(fileId => {
    try {
      const file = DriveApp.getFileById(fileId);
      const texto = file.getBlob().getDataAsString('UTF-8');
      return { fileId: fileId, texto: texto };
    } catch (e) {
      return { fileId: fileId, texto: null, error: `No se pudo leer el archivo.` };
    }
  });
  return contenidos;
}

function handleGetFolderContents(payload) {
  const { drive_folder_id } = payload;
  if (!drive_folder_id) {
    throw new Error("Se requiere el 'drive_folder_id' para listar los archivos.");
  }
  try {
    const carpeta = DriveApp.getFolderById(drive_folder_id);
    const archivos = carpeta.getFiles();
    const listaArchivos = [];
    while (archivos.hasNext()) {
      const archivo = archivos.next();
      listaArchivos.push({ id: archivo.getId(), nombre: archivo.getName() });
    }
    return listaArchivos;
  } catch (e) {
    throw new Error(`No se pudo acceder a la carpeta de Drive con ID '${drive_folder_id}'.`);
  }
}

// ==========================================================================================
// FUNCIONES AUXILIARES DE DRIVE Y SHEETS
// ==========================================================================================

function getOrCreateFolder(carpetaPadre, nombreSubcarpeta) {
  const nombreNormalizado = nombreSubcarpeta.trim();
  const carpetas = carpetaPadre.getFoldersByName(nombreNormalizado);

  if (carpetas.hasNext()) {
    // Logger.log(`Carpeta encontrada: "${nombreNormalizado}"`); // Opcional: Descomentar para depurar
    return carpetas.next();
  } else {
    // Podrías añadir búsqueda insensible a mayúsculas/minúsculas si sospechas problemas
    // var folders = carpetaPadre.getFolders();
    // while (folders.hasNext()) {
    //   var folder = folders.next();
    //   if (folder.getName().toLowerCase() === nombreNormalizado.toLowerCase()) {
    //     return folder;
    //   }
    // }
    Logger.log(`Creando carpeta: "${nombreNormalizado}" dentro de ${carpetaPadre.getName()}`);
    return carpetaPadre.createFolder(nombreNormalizado);
  }
}

function getOrCreateSheet(folder, sheetName) {
  const files = folder.getFilesByName(sheetName);
  if (files.hasNext()) {
    return SpreadsheetApp.openById(files.next().getId());
  } else {
    const spreadsheet = SpreadsheetApp.create(sheetName);
    const file = DriveApp.getFileById(spreadsheet.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    spreadsheet.getSheets()[0].setName("Hoja Principal"); // Renombrar la hoja por defecto
    return spreadsheet;
  }
}

/**
 * Crea la hoja de cálculo "Reporte de Asistencia" y la llena. Optimizado.
 * @param {Folder} carpetaPadre Carpeta "Reportes".
 * @param {Array<object>} alumnos Array de alumnos.
 * @param {number} numeroDeUnidades Número de unidades.
 * @return {Spreadsheet | null} La hoja de cálculo o null si falla.
 */
function crearAsistenciasSheet(carpetaPadre, alumnos, numeroDeUnidades) {
  const archivosExistentes = carpetaPadre.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (archivosExistentes.hasNext()) {
    Logger.log(`"${NOMBRE_SHEET_ASISTENCIA}" ya existe.`);
    // Podríamos añadir lógica para verificar/añadir hojas de unidad o alumnos faltantes
    return SpreadsheetApp.open(archivosExistentes.next());
  }
  Logger.log(`Creando y poblando "${NOMBRE_SHEET_ASISTENCIA}"...`);
  const spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_ASISTENCIA);
  const headers = ["Matrícula", "Nombre Completo"];

  // Preparar datos de alumnos
  const filasAlumnos = Array.isArray(alumnos) ? alumnos.map((a, index) => {
    // Logger.log(`Asistencia - Alumno ${index}: ${JSON.stringify(a)}`); // Log detallado (descomentar si es necesario)
    return [ a.matricula || '', `${a.nombre || ''} ${a.apellido || ''}`.trim() ];
  }) : [];
  Logger.log(`Asistencia - 'filasAlumnos' generadas: ${filasAlumnos.length} filas.`);

  // Crear hojas por unidad
  const numUnidadesReales = Math.max(1, numeroDeUnidades || 1); // Asegurar al menos 1 hoja
  for (let i = 1; i <= numeroDeUnidades; i++) {
    const nombreHoja = `Unidad ${i}`;
    let hojaUnidad = (i === 1 && spreadsheet.getSheets().length > 0) ? spreadsheet.getSheets()[0].setName(nombreHoja) : spreadsheet.insertSheet(nombreHoja);

    // Preparar datos para esta hoja (headers + alumnos)
    const datosHoja = [headers];
    if (filasAlumnos.length > 0) {
      datosHoja.push(...filasAlumnos);
    }

    // Escribir todo de una vez
    if (datosHoja.length > 0) {
       try {
            hojaUnidad.getRange(1, 1, datosHoja.length, headers.length).setValues(datosHoja);
            // Aplicar formato
            hojaUnidad.getRange(1, 1, 1, headers.length).setFontWeight("bold");
            hojaUnidad.setFrozenRows(1);
            hojaUnidad.setFrozenColumns(2);
            hojaUnidad.setColumnWidth(2, 250);
            Logger.log(`Hoja "${nombreHoja}" creada y poblada con ${filasAlumnos.length} alumnos.`);
       } catch (e) {
            Logger.log(`ERROR al escribir en ${nombreHoja}: ${e.message}`);
       }
    } else {
        Logger.log(`No hay datos (ni headers?) para escribir en ${nombreHoja}.`);
    }
  }

  // Eliminar hoja inicial "Sheet1" si existe y creamos hojas de unidad
  const sheet1 = spreadsheet.getSheetByName("Sheet1");
  if (numUnidadesReales > 0 && sheet1 && spreadsheet.getSheets().length > numUnidadesReales) {
    spreadsheet.deleteSheet(sheet1);
  }

  // Mover archivo
  const file = DriveApp.getFileById(spreadsheet.getId());
   try {
    if (file.getParents().next().getId() !== carpetaPadre.getId()) {
      DriveApp.getRootFolder().removeFile(file);
      carpetaPadre.addFile(file);
    }
    Logger.log(`Archivo "${NOMBRE_SHEET_ASISTENCIA}" creado y movido.`);
    return spreadsheet; // Devolver el objeto Spreadsheet
  } catch(moveError) {
      Logger.log(`Error al mover ${NOMBRE_SHEET_ASISTENCIA}: ${moveError.message}`);
      return null; // Indicar fallo
  }
}

/**
 * Crea la hoja de cálculo "Lista de Alumnos" y la llena. Optimizado.
 * @param {Folder} carpetaPadre Carpeta "Reportes".
 * @param {Array<object>} alumnos Array de alumnos.
 */
function crearListaDeAlumnosSheet(carpetaPadre, alumnos) {
  const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_LISTA_ALUMNOS);
  if (files.hasNext()) {
    Logger.log(`"${NOMBRE_SHEET_LISTA_ALUMNOS}" ya existe.`);
    // Opcional: Podríamos actualizar aquí si fuera necesario
    return; // Salir si ya existe
  }
  Logger.log(`Creando y poblando "${NOMBRE_SHEET_LISTA_ALUMNOS}"...`);
  const spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_LISTA_ALUMNOS);
  const sheet = spreadsheet.getSheets()[0].setName("Alumnos");
  const headers = ["Matrícula", "Nombre", "Apellido"];

  // Preparar datos (incluyendo headers)
  const filasParaEscribir = [headers];
  if (Array.isArray(alumnos)) {
      alumnos.forEach((a, index) => {
        // Logger.log(`Lista - Alumno ${index}: ${JSON.stringify(a)}`); // Log detallado (descomentar si es necesario)
        filasParaEscribir.push([ a.matricula || '', a.nombre || '', a.apellido || '' ]);
      });
  } else {
       Logger.log("Lista - 'alumnos' no es un array o está vacío.");
  }

  // Escribir TODO de una vez (headers + datos)
  if (filasParaEscribir.length > 1) { // Si hay al menos un alumno
    try {
      // Ajustar rango dinámicamente
      sheet.getRange(1, 1, filasParaEscribir.length, headers.length).setValues(filasParaEscribir);
      // Aplicar formato DESPUÉS de escribir
      sheet.getRange("A1:C1").setFontWeight("bold");
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 120); // Ancho matrícula
      sheet.setColumnWidth(2, 200); // Ancho nombre
      sheet.setColumnWidth(3, 200); // Ancho apellido
      Logger.log(`Se escribieron ${filasParaEscribir.length - 1} alumnos en "${NOMBRE_SHEET_LISTA_ALUMNOS}".`);
    } catch (e) {
      Logger.log(`ERROR al escribir en ${NOMBRE_SHEET_LISTA_ALUMNOS}: ${e.message}`);
    }
  } else {
    // Si solo están los headers (no alumnos), escribir solo headers
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange("A1:C1").setFontWeight("bold");
    sheet.setFrozenRows(1);
    Logger.log(`No hay alumnos para escribir en "${NOMBRE_SHEET_LISTA_ALUMNOS}", solo encabezados.`);
  }

  // Mover archivo
  const file = DriveApp.getFileById(spreadsheet.getId());
  // Usar try-catch para mover, por si falla
  try {
    if (file.getParents().next().getId() !== carpetaPadre.getId()) {
      DriveApp.getRootFolder().removeFile(file); // Quitar de raíz si está ahí
      carpetaPadre.addFile(file); // Añadir a la carpeta destino
    }
  } catch(moveError) {
      Logger.log(`Error al mover ${NOMBRE_SHEET_LISTA_ALUMNOS}: ${moveError.message}`);
  }
}

function extractDriveIdFromUrl(driveUrl) {
  const match = driveUrl ? driveUrl.match(/[-\w]{25,}/) : null;
  return match ? match[0] : null;
}

function handleGetOrCreateRubricSheet(payload) {
  const { drive_url_materia } = payload;
  if (!drive_url_materia) {
    throw new Error("Falta 'drive_url_materia' para obtener/crear la hoja de rúbricas.");
  }
  const carpetaMateriaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaMateriaId) {
    throw new Error(`No se pudo extraer un ID de Drive válido de la URL: ${drive_url_materia}`);
  }
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const sheet = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
  return { rubricas_spreadsheet_id: sheet.getId() };
}

// --- FUNCIONES OBSOLETAS ---
// Se marcan como obsoletas pero no se eliminan para evitar errores si alguna parte antigua del código las llama.
function handleCreateAnnotatedFile(payload) {
  Logger.log("ADVERTENCIA: La función 'handleCreateAnnotatedFile' está obsoleta y no debería ser llamada en el nuevo flujo.");
  return { message: "Función obsoleta."};
}

function handleWriteJustification(payload) {
  Logger.log("ADVERTENCIA: La función 'handleWriteJustification' está obsoleta y ha sido reemplazada por 'handleGuardarCalificacionDetallada'.");
  return { message: "Función obsoleta."};
}