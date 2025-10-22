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
      Logger.log("Error: El array 'calificaciones' recibido está vacío. No se puede procesar.");
      // Devolver un error claro a la función de Supabase
      throw new Error("El array 'calificaciones' recibido por Apps Script estaba vacío.");
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
    sheetDetallado.appendRow(["Matricula", "Equipo", "Calificacion", "Retroalimentacion y observaciones"]);
    sheetDetallado.setFrozenRows(1);
    sheetDetallado.setColumnWidth(4, 400);
  }
  
  calificaciones.forEach(cal => {
    sheetDetallado.appendRow([cal.matricula, cal.equipo || '', cal.calificacion, cal.retroalimentacion]);
  });

  // --- 2. Actualiza el Resumen de la Unidad ---
  const nombreResumen = `Resumen Calificaciones - Unidad ${unidad}`;
  const resumenUnidadSheet = getOrCreateSheet(carpetaUnidad, nombreResumen); // Se crea/obtiene en la carpeta de Unidad
  const sheetResumen = resumenUnidadSheet.getSheets()[0];
  sheetResumen.setName("Resumen"); // Renombrar hoja principal si es nueva
  
  if (sheetResumen.getLastRow() < 1) {
    sheetResumen.appendRow(["Matricula", "Nombre"]);
    sheetResumen.setFrozenRows(1);
  }

  // Asegura que exista la columna para la actividad
  const headers = sheetResumen.getRange(1, 1, 1, sheetResumen.getLastColumn() || 1).getValues()[0];
  let colIndex = headers.indexOf(actividad.nombre);
  if (colIndex === -1) { // Si no existe la columna
    colIndex = sheetResumen.getLastColumn() + 1;
    sheetResumen.getRange(1, colIndex).setValue(actividad.nombre).setFontWeight("bold");
  } else {
    colIndex += 1; // Ajuste porque indexOf es base 0 y las columnas son base 1
  }
  
  // Mapea matrículas existentes a sus filas
  const matriculasEnSheet = sheetResumen.getRange(2, 1, sheetResumen.getLastRow() > 0 ? sheetResumen.getLastRow() - 1 : 1, 1).getValues().flat();
  const matriculaToRowIndex = new Map(matriculasEnSheet.map((m, i) => [String(m).trim(), i + 2])); // Asegurar string trim

  calificaciones.forEach(cal => {
    const matriculaStr = String(cal.matricula).trim(); // Asegurar string trim
    let rowIndex = matriculaToRowIndex.get(matriculaStr);
    if (!rowIndex) { // Si el alumno no está en el resumen, añadirlo
      sheetResumen.appendRow([cal.matricula, cal.nombre]);
      rowIndex = sheetResumen.getLastRow();
      matriculaToRowIndex.set(matriculaStr, rowIndex); // Actualizar el mapa
    }
    // Asegurarse de que la celda exista antes de escribir
    if (rowIndex > 0 && colIndex > 0) {
       // Asegurarse que la columna exista antes de escribir
       if(colIndex > sheetResumen.getMaxColumns()) {
         sheetResumen.insertColumnAfter(sheetResumen.getMaxColumns());
       }
       sheetResumen.getRange(rowIndex, colIndex).setValue(cal.calificacion);
    } else {
        Logger.log(`Error: Índice inválido para ${cal.matricula}. Fila: ${rowIndex}, Col: ${colIndex}`);
    }
  });

  // --- Devolver referencia a la celda (EJEMPLO SIMPLIFICADO) ---
  // Esto asume que la primera calificación es representativa o que quieres esa celda.
  // Podrías necesitar una lógica más compleja si quieres referencias para todos.
  let justificacionCellRef = null;
  if (calificaciones.length > 0) {
      const firstMatricula = String(calificaciones[0].matricula).trim();
      const firstRowIndex = matriculaToRowIndex.get(firstMatricula);
      // Asumiendo que la justificación va en la columna 4 del sheet detallado
      if (firstRowIndex) { // Podría no estar si solo se añadió en esta ejecución
          // Corrección: La referencia debe ser a la hoja DETALLADA, no al resumen
          const firstDetailRow = sheetDetallado.getLastRow(); // Obtener la última fila añadida en detallado
           justificacionCellRef = `'Detalle'!D${firstDetailRow}`; // Columna D (4ta) de la última fila
      }
  }
  Logger.log("Referencia de celda generada (ejemplo): " + justificacionCellRef);

  return { message: "Reportes de calificación generados y actualizados.", justificacion_cell_ref: justificacionCellRef }; // Devolver la referencia
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

function handleGuardarReportePlagio(payload) {
  const { drive_url_materia, reporte_plagio } = payload;
  if (!drive_url_materia || !reporte_plagio) {
    throw new Error("Faltan 'drive_url_materia' o 'reporte_plagio'.");
  }
  const carpetaMateria = DriveApp.getFolderById(extractDriveIdFromUrl(drive_url_materia));
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO); // Usa getOrCreateSheet
  const fechaHoy = new Date().toISOString().slice(0, 10);
  const nombreHoja = `Reporte ${fechaHoy}`;
  let sheet = sheetPlagio.getSheetByName(nombreHoja);
  if (!sheet) {
    sheet = sheetPlagio.insertSheet(nombreHoja, 0);
    sheet.appendRow(["Trabajo A (File ID)", "Trabajo B (File ID)", "% Similitud", "Fragmentos Similares"]);
    sheet.getRange("A1:D1").setFontWeight("bold");
  }
  reporte_plagio.forEach(item => {
    sheet.appendRow([item.trabajo_A_id, item.trabajo_B_id, item.porcentaje_similitud, item.fragmentos_similares.join("\n\n")]);
  });
  sheet.setColumnWidth(4, 400);
  return { message: "Reporte de plagio guardado exitosamente." };
}

function handleLogAsistencia(payload) {
  const { drive_url, fecha, unidad, sesion, asistencias } = payload;
  if (!drive_url || !asistencias || !fecha || !unidad || !sesion) { throw new Error("Faltan datos para registrar la asistencia."); }
  const carpetaMateria = DriveApp.getFolderById(extractDriveIdFromUrl(drive_url));
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}".`);
  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const hoja = hojaDeCalculo.getSheetByName(`Unidad ${unidad}`);
  if (!hoja) throw new Error(`No se encontró la pestaña "Unidad ${unidad}".`);
  const hoy = new Date(fecha + 'T12:00:00Z');
  const textoEncabezado = `${('0' + hoy.getDate()).slice(-2)}/${('0' + (hoy.getMonth() + 1)).slice(-2)}-${sesion}`;
  const primeraFila = hoja.getRange(1, 1, 1, hoja.getLastColumn() || 1).getValues()[0];
  let columnaParaHoy = primeraFila.indexOf(textoEncabezado) + 1;
  if (columnaParaHoy === 0) {
    columnaParaHoy = hoja.getLastColumn() + 1;
    hoja.getRange(1, columnaParaHoy).setValue(textoEncabezado);
  }
  const rangoAlumnos = hoja.getRange(2, 1, hoja.getLastRow() > 1 ? hoja.getLastRow() - 1 : 1, 1).getValues();
  const matriculaMap = new Map(rangoAlumnos.map((fila, index) => [String(fila[0]).trim(), index + 2]));
  asistencias.forEach(asistencia => {
    const fila = matriculaMap.get(String(asistencia.matricula).trim());
    if (fila) { hoja.getRange(fila, columnaParaHoy).setValue(asistencia.presente ? 1 : 0).setHorizontalAlignment("center"); }
  });
  return `Se registraron ${asistencias.length} asistencias en la columna '${textoEncabezado}'.`;
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
  const nombreNormalizado = nombreSubcarpeta.trim(); // Quitar espacios extra
  const carpetas = carpetaPadre.getFoldersByName(nombreNormalizado); // Buscar por nombre normalizado

  if (carpetas.hasNext()) {
    Logger.log(`Carpeta encontrada: "${nombreNormalizado}"`);
    return carpetas.next();
  } else {
    // Podrías añadir una búsqueda insensible a mayúsculas/minúsculas aquí si es necesario
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

function crearAsistenciasSheet(carpetaPadre, alumnos, numeroDeUnidades) {
  const archivosExistentes = carpetaPadre.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (archivosExistentes.hasNext()) {
    return SpreadsheetApp.open(archivosExistentes.next());
  }
  const spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_ASISTENCIA);
  const headers = ["Matrícula", "Nombre Completo"];
  const filasAlumnos = Array.isArray(alumnos) ? alumnos.map(a => [a.matricula, `${a.nombre} ${a.apellido}`.trim()]) : [];
  for (let i = 1; i <= numeroDeUnidades; i++) {
    let hojaUnidad = (i === 1) ? spreadsheet.getSheets()[0].setName(`Unidad ${i}`) : spreadsheet.insertSheet(`Unidad ${i}`);
    hojaUnidad.appendRow(headers);
    if (filasAlumnos.length > 0) {
      hojaUnidad.getRange(2, 1, filasAlumnos.length, headers.length).setValues(filasAlumnos);
    }
    hojaUnidad.setFrozenRows(1);
    hojaUnidad.setFrozenColumns(2);
  }
  const file = DriveApp.getFileById(spreadsheet.getId());
  carpetaPadre.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return spreadsheet;
}

function crearListaDeAlumnosSheet(carpetaPadre, alumnos) {
  if (carpetaPadre.getFilesByName(NOMBRE_SHEET_LISTA_ALUMNOS).hasNext()) { return; }
  const spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_LISTA_ALUMNOS);
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName("Alumnos");
  const headers = ["Matrícula", "Nombre", "Apellido"];
  const filas = Array.isArray(alumnos) ? alumnos.map(a => [a.matricula, a.nombre, a.apellido]) : [];
  sheet.appendRow(headers);
  if (filas.length > 0) {
    sheet.getRange(2, 1, filas.length, headers.length).setValues(filas);
  }
  sheet.setFrozenRows(1);
  const file = DriveApp.getFileById(spreadsheet.getId());
  carpetaPadre.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
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