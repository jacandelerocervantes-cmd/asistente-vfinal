/**
 * @OnlyCurrentDoc
 */

// ------------------------------------------------------------------------------------------
// CONFIGURACIÓN PRINCIPAL
// ------------------------------------------------------------------------------------------
const CARPETA_RAIZ_ID = "1j7boqj1CEg9NUItM7MNp31YIuy1hhapT"; // ID de la carpeta raíz de la app
const NOMBRE_SHEET_LISTA_ALUMNOS = "Lista de Alumnos";
const NOMBRE_SHEET_ASISTENCIA = "Reporte de Asistencia";
const NOMBRE_SHEET_MAESTRO_RUBRICAS = "Rúbricas de la Materia";
const NOMBRE_SHEET_PLAGIO = "Reportes de Plagio";

// ------------------------------------------------------------------------------------------
// FUNCIÓN PRINCIPAL (doPost)
// ------------------------------------------------------------------------------------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    Logger.log(`Acción recibida: ${action}`);

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
        return crearRespuestaExitosa({ texto_rubrica: handleGetRubricText(payload) });
      case 'get_rubric_data':
        return crearRespuestaExitosa(handleGetRubricData(payload));
      case 'get_student_work_text':
        return crearRespuestaExitosa({ texto_trabajo: handleGetStudentWorkText(payload) });
      case 'write_justification':
        return crearRespuestaExitosa(handleWriteJustification(payload));
      case 'get_justification_text':
        return crearRespuestaExitosa(handleGetJustificationText(payload));
      case 'create_annotated_file':
        return crearRespuestaExitosa(handleCreateAnnotatedFile(payload));
      default:
        throw new Error(`Acción desconocida: "${action}"`);
    }
  } catch (error) {
    Logger.log(`ERROR: ${error.message}\nStack: ${error.stack}`);
    return crearRespuestaError(error.message);
  }
}

// ------------------------------------------------------------------------------------------
// MANEJADORES DE ACCIONES
// ------------------------------------------------------------------------------------------

function handleCreateMateriasBatch(payload) {
    if (!payload.docente || !payload.docente.email || !payload.materias) {
        throw new Error("Faltan datos esenciales: 'docente' o 'materias'.");
    }
    const { docente, materias } = payload;
    const drive_urls = {};
    const rubricas_spreadsheet_ids = {};
    const plagio_spreadsheet_ids = {};
    const calificaciones_spreadsheet_ids = {};

    const carpetaRaiz = DriveApp.getFolderById(CARPETA_RAIZ_ID);
    const carpetaDocente = getOrCreateFolder(carpetaRaiz, docente.nombre);
    carpetaDocente.addEditor(docente.email);

    for (const materia of materias) {
        if (!materia || !materia.alumnos) {
            Logger.log(`Omitiendo materia con ID ${materia.id} por falta de datos.`);
            continue;
        }
        const nombreCarpetaMateria = `${materia.nombre} - ${materia.semestre}`;
        const carpetaMateria = getOrCreateFolder(carpetaDocente, nombreCarpetaMateria);
        
        // --- CORRECCIÓN: Crear carpetas y sheets para consistencia ---
        const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
        const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
        getOrCreateFolder(carpetaMateria, "Evaluaciones");
        getOrCreateFolder(carpetaMateria, "Material Didáctico");
        
        // Crear los sheets
        crearListaDeAlumnosSheet(carpetaReportes, materia.alumnos);
        const sheetAsistencia = crearAsistenciasSheet(carpetaReportes, materia.alumnos, materia.unidades);
        const sheetRubricas = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_MAESTRO_RUBRICAS);
        const sheetPlagio = getOrCreateSheet(carpetaActividades, NOMBRE_SHEET_PLAGIO);
        
        drive_urls[materia.id] = carpetaMateria.getUrl();
        rubricas_spreadsheet_ids[materia.id] = sheetRubricas.getId();
        plagio_spreadsheet_ids[materia.id] = sheetPlagio.getId();
        calificaciones_spreadsheet_ids[materia.id] = sheetAsistencia.getId(); // Reutilizamos el de asistencia para calificaciones por ahora
    }
    return { drive_urls, rubricas_spreadsheet_ids, plagio_spreadsheet_ids, calificaciones_spreadsheet_ids };
}

function handleCreateActivityFolder(payload) {
  const { drive_url_materia, nombre_actividad, unidad } = payload;
  if (!drive_url_materia || !nombre_actividad || !unidad) {
    throw new Error("Faltan datos para crear la carpeta de la actividad.");
  }
  
  const carpetaId = extractDriveIdFromUrl(drive_url_materia);
  if (!carpetaId) {
      throw new Error(`No se pudo extraer un ID válido de la URL de Drive: ${drive_url_materia}`);
  }
  
  const carpetaMateria = DriveApp.getFolderById(carpetaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");
  const carpetaUnidad = getOrCreateFolder(carpetaActividades, `Unidad ${unidad}`);
  const carpetaActividad = carpetaUnidad.createFolder(nombre_actividad);
  const carpetaEntregas = carpetaActividad.createFolder("Entregas");
  const carpetaCalificados = carpetaActividad.createFolder("Calificados");
  return { 
    drive_folder_id_actividad: carpetaActividad.getId(), 
    drive_folder_id_entregas: carpetaEntregas.getId(),
    drive_folder_id_calificados: carpetaCalificados.getId()
  };
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
    throw new Error(`No se pudo abrir la hoja de cálculo de rúbricas con ID '${rubricas_spreadsheet_id}'. Verifica el ID y los permisos.`);
  }

  const nombreHoja = nombre_actividad.substring(0, 100);
  const hojaExistente = spreadsheet.getSheetByName(nombreHoja);
  if (hojaExistente) {
    spreadsheet.deleteSheet(hojaExistente);
  }
  
  const nuevaHoja = spreadsheet.insertSheet(nombreHoja);
  const headers = ["Criterio de Evaluación", "Puntos"];
  const filas = criterios.map(c => [c.descripcion, c.puntos]);
  nuevaHoja.appendRow(headers);
  if (filas.length > 0) {
    nuevaHoja.getRange(2, 1, filas.length, headers.length).setValues(filas);
  }
  nuevaHoja.getRange("A1:B1").setFontWeight("bold");
  nuevaHoja.setColumnWidth(1, 400);
  nuevaHoja.setColumnWidth(2, 100);

  const rangoDatos = `'${nombreHoja}'!A1:B${filas.length + 1}`;
  
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

  const carpetaMateriaId = drive_url_materia.split('/').pop();
  const carpetaMateria = DriveApp.getFolderById(carpetaMateriaId);
  const carpetaActividades = getOrCreateFolder(carpetaMateria, "Actividades");

  let spreadsheet;
  const archivos = carpetaActividades.getFilesByName(NOMBRE_SHEET_PLAGIO);
  if (archivos.hasNext()) {
    spreadsheet = SpreadsheetApp.open(archivos.next());
  } else {
    spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_PLAGIO);
    const file = DriveApp.getFileById(spreadsheet.getId());
    carpetaActividades.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  }

  const fechaHoy = new Date().toISOString().slice(0, 10);
  const nombreHoja = `Reporte ${fechaHoy}`;
  let sheet = spreadsheet.getSheetByName(nombreHoja);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(nombreHoja, 0);
    sheet.appendRow(["Trabajo A (File ID)", "Trabajo B (File ID)", "% Similitud", "Fragmentos Similares"]);
    sheet.getRange("A1:D1").setFontWeight("bold");
  }

  reporte_plagio.forEach(item => {
    sheet.appendRow([
      item.trabajo_A_id,
      item.trabajo_B_id,
      item.porcentaje_similitud,
      item.fragmentos_similares.join("\n\n")
    ]);
  });
  
  sheet.setColumnWidth(4, 400);
  return { message: "Reporte de plagio guardado exitosamente." };
}

function handleLogAsistencia(payload) {
  const { drive_url, fecha, unidad, sesion, asistencias } = payload;
  if (!drive_url || !asistencias || !fecha || !unidad || !sesion) { throw new Error("Faltan datos para registrar la asistencia."); }
  const carpetaId = drive_url.split('/').pop();
  const carpetaMateria = DriveApp.getFolderById(carpetaId);
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}".`);
  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const nombreHoja = `Unidad ${unidad}`;
  const hoja = hojaDeCalculo.getSheetByName(nombreHoja);
  if (!hoja) throw new Error(`No se encontró la pestaña "${nombreHoja}".`);
  const hoy = new Date(fecha + 'T12:00:00Z');
  const dia = ('0' + hoy.getDate()).slice(-2);
  const mes = ('0' + (hoy.getMonth() + 1)).slice(-2);
  const textoEncabezado = `${dia}/${mes}-${sesion}`;
  const primeraFila = hoja.getRange(1, 1, 1, hoja.getLastColumn() || 1).getValues()[0];
  let columnaParaHoy = primeraFila.indexOf(textoEncabezado) + 1;
  if (columnaParaHoy === 0) {
    columnaParaHoy = hoja.getLastColumn() + 1;
    hoja.getRange(1, columnaParaHoy).setValue(textoEncabezado);
  }
  const rangoAlumnos = hoja.getRange(2, 1, hoja.getLastRow() > 1 ? hoja.getLastRow() - 1 : 1, 1).getValues();
  const matriculaMap = new Map();
  rangoAlumnos.forEach((fila, index) => { if (fila[0]) { matriculaMap.set(String(fila[0]).trim(), index + 2); } });
  asistencias.forEach(asistencia => {
    const fila = matriculaMap.get(String(asistencia.matricula).trim());
    if (fila) { hoja.getRange(fila, columnaParaHoy).setValue(asistencia.presente ? 1 : 0).setHorizontalAlignment("center"); }
  });
  return `Se registraron ${asistencias.length} asistencias en la columna '${textoEncabezado}'.`;
}

function handleCerrarUnidad(payload) {
  const { drive_url, unidad, alumnos, registros_asistencia } = payload;
  if (!drive_url || !unidad || !alumnos) throw new Error("Faltan datos para cerrar la unidad.");
  const carpetaId = drive_url.split('/').pop();
  const carpetaMateria = DriveApp.getFolderById(carpetaId);
  const carpetaReportes = getOrCreateFolder(carpetaMateria, "Reportes");
  const archivos = carpetaReportes.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (!archivos.hasNext()) throw new Error(`No se encontró el archivo "${NOMBRE_SHEET_ASISTENCIA}".`);
  const hojaDeCalculo = SpreadsheetApp.open(archivos.next());
  const nombreHoja = `Unidad ${unidad}`;
  const hoja = hojaDeCalculo.getSheetByName(nombreHoja);
  if (!hoja) throw new Error(`No se encontró la pestaña "${nombreHoja}".`);
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
  const matriculaMap = new Map();
  rangoMatriculas.forEach((fila, index) => {
      if(fila[0]) matriculaMap.set(String(fila[0]).trim(), index + 2);
  });
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
  protection.setWarningOnly(true);
  return `Resumen para la Unidad ${unidad} generado y la hoja ha sido bloqueada.`;
}

function handleWriteJustification(payload) {
  const { spreadsheet_id, justificacion, alumno_id, actividad_id, unidad } = payload;
  const sheet_name = `Calificaciones_U${unidad}`;
  if (!spreadsheet_id || !justificacion || !actividad_id || !unidad) {
    throw new Error("Faltan parámetros para escribir la justificación (spreadsheet_id, justificacion, actividad_id, unidad).");
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  let sheet = spreadsheet.getSheetByName(sheet_name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheet_name);
    sheet.appendRow(["ID Alumno/Grupo", "ID Actividad", "Justificación"]);
  }
  
  sheet.appendRow([alumno_id, actividad_id, justificacion]); // Se usa alumno_id para ambos casos
  const celda = `C${sheet.getLastRow()}`;
  
  return { justificacion_sheet_cell: `'${sheet_name}'!${celda}` };
}

function handleGetRubricData(payload) {
  const { spreadsheet_id, rubrica_sheet_range } = payload;
  if (!spreadsheet_id || !rubrica_sheet_range) {
    throw new Error("Faltan 'spreadsheet_id' o 'rubrica_sheet_range' para obtener los datos de la rúbrica.");
  }
  
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(rubrica_sheet_range);
  const values = range.getValues();
  
  const criterios = values.slice(1).map(row => {
    return {
      descripcion: row[0],
      puntos: row[1]
    };
  }).filter(c => c.descripcion && c.puntos !== '');

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
  return textoRubrica;
}

function handleGetStudentWorkText(payload) {
  const { drive_file_id } = payload;
  if (!drive_file_id) throw new Error("Falta 'drive_file_id'.");
  try {
    const file = DriveApp.getFileById(drive_file_id);
    return file.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    throw new Error(`No se pudo leer el archivo con ID ${drive_file_id}: ${e.message}`);
  }
}

function handleGetJustificationText(payload) {
  const { spreadsheet_id, justificacion_sheet_cell } = payload;
  if (!spreadsheet_id || !justificacion_sheet_cell) {
    throw new Error("Faltan 'spreadsheet_id' o 'justificacion_sheet_cell'.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheet_id);
  const range = spreadsheet.getRange(justificacion_sheet_cell);
  const justificacion = range.getValue();
  return { justificacion_texto: justificacion };
}

function handleCreateAnnotatedFile(payload) {
  const { original_file_id, calificacion_obtenida, justificacion, carpeta_calificados_id } = payload;
  if (!original_file_id || calificacion_obtenida === undefined || !justificacion || !carpeta_calificados_id) {
    throw new Error("Faltan parámetros para crear el archivo anotado.");
  }

  const originalFile = DriveApp.getFileById(original_file_id);
  const carpetaCalificados = DriveApp.getFolderById(carpeta_calificados_id);

  const nuevoNombre = `[CALIFICADO] ${originalFile.getName()}`;
  const doc = DocumentApp.create(nuevoNombre);
  const body = doc.getBody();

  body.appendParagraph(`Reporte de Calificación`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(`Calificación Obtenida: ${calificacion_obtenida} / 100`).setBold(true);
  body.appendParagraph(`\n--- Retroalimentación / Justificación ---\n`).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(justificacion);
  
  doc.saveAndClose();
  const docFile = DriveApp.getFileById(doc.getId());
  
  docFile.moveTo(carpetaCalificados);
  
  return { annotated_file_id: docFile.getId(), annotated_file_url: docFile.getUrl() };
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
      Logger.log(`No se pudo leer el archivo con ID ${fileId}: ${e.message}`);
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
  const carpeta = DriveApp.getFolderById(drive_folder_id);
  const archivos = carpeta.getFiles();
  const listaArchivos = [];
  while (archivos.hasNext()) {
    const archivo = archivos.next();
    listaArchivos.push({
      id: archivo.getId(),
      nombre: archivo.getName()
    });
  }
  return listaArchivos;
}

// ------------------------------------------------------------------------------------------
// FUNCIONES AUXILIARES
// ------------------------------------------------------------------------------------------

function crearAsistenciasSheet(carpetaPadre, alumnos, numeroDeUnidades) {
  const archivosExistentes = carpetaPadre.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (archivosExistentes.hasNext()) {
    return SpreadsheetApp.open(archivosExistentes.next());
  }
  
  const spreadsheet = SpreadsheetApp.create(NOMBRE_SHEET_ASISTENCIA);
  const hojaOriginal = spreadsheet.getSheets()[0];
  const headers = ["Matrícula", "Nombre Completo"];
  const filasAlumnos = alumnos.map(a => [a.matricula, `${a.nombre} ${a.apellido}`.trim()]);

  for (let i = 1; i <= numeroDeUnidades; i++) {
    let hojaUnidad;
    const nombreHoja = `Unidad ${i}`;
    if (i === 1) {
      hojaUnidad = hojaOriginal;
      hojaUnidad.setName(nombreHoja);
    } else {
      hojaUnidad = spreadsheet.insertSheet(nombreHoja);
    }
    hojaUnidad.appendRow(headers);
    if (filasAlumnos.length > 0) {
      hojaUnidad.getRange(2, 1, filasAlumnos.length, headers.length).setValues(filasAlumnos);
    }
    hojaUnidad.getRange("A1:B1").setFontWeight("bold");
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
  const filas = alumnos.map(a => [a.matricula, a.nombre, a.apellido]);
  sheet.appendRow(headers);
  if (filas.length > 0) { sheet.getRange(2, 1, filas.length, headers.length).setValues(filas); }
  sheet.setFrozenRows(1);
  const file = DriveApp.getFileById(spreadsheet.getId());
  carpetaPadre.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
}

function getOrCreateFolder(carpetaPadre, nombreSubcarpeta) {
  const carpetas = carpetaPadre.getFoldersByName(nombreSubcarpeta);
  if (carpetas.hasNext()) { return carpetas.next(); } 
  else { return carpetaPadre.createFolder(nombreSubcarpeta); }
}

function extractDriveIdFromUrl(driveUrl) {
  // Expresión regular para encontrar el ID largo de Drive en varios formatos de URL
  const match = driveUrl.match(/[-\w]{25,}/);
  if (match) {
    return match[0];
  }
  return null; // Devuelve null si no se encuentra un ID válido
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

function getOrCreateSheet(folder, sheetName) {
  const files = folder.getFilesByName(sheetName);
  if (files.hasNext()) {
    const fileId = files.next().getId();
    return SpreadsheetApp.openById(fileId);
  } else {
    const spreadsheet = SpreadsheetApp.create(sheetName);
    const file = DriveApp.getFileById(spreadsheet.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    const defaultSheet = spreadsheet.getSheetByName('Sheet1');
    if (defaultSheet) spreadsheet.deleteSheet(defaultSheet);
    return spreadsheet;
  }
}

function crearRespuestaExitosa(data) {
  return ContentService.createTextOutput(JSON.stringify({ status: "success", ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function crearRespuestaError(message) {
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
