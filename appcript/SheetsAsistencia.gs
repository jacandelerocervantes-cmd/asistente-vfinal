/**
 * Registra las asistencias de una sesión específica en la hoja de cálculo.
 * @param {object} payload Datos de la sesión y asistencias. {drive_url, fecha, unidad, sesion, asistencias:[{matricula, presente}]}
 * @return {string} Mensaje de resultado.
 */
function handleLogAsistencia(payload) {
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
    
    const HEADER_ROW = 1;
    const DATA_START_ROW = 2;
    const FIXED_COLS = 2;
    
    let lastCol = unitSheet.getLastColumn();
    let sessionCol = -1;
    
    if (unitSheet.getLastRow() > 0 && lastCol < FIXED_COLS) {
        lastCol = FIXED_COLS;
    }

    const hoy = new Date(fecha + 'T12:00:00Z');
    const textoEncabezado = `${('0' + hoy.getDate()).slice(-2)}/${('0' + (hoy.getMonth() + 1)).slice(-2)}-${sesion}`;

    if (lastCol > FIXED_COLS) {
      const headerValues = unitSheet.getRange(HEADER_ROW, FIXED_COLS + 1, 1, lastCol - FIXED_COLS).getValues()[0];
      const colIndex = headerValues.findIndex(h => String(h).trim() === textoEncabezado);
      if (colIndex !== -1) {
        sessionCol = colIndex + FIXED_COLS + 1;
      }
    }

    if (sessionCol === -1) {
      sessionCol = lastCol + 1;
      unitSheet.getRange(HEADER_ROW, sessionCol).setValue(textoEncabezado).setFontWeight('bold').setHorizontalAlignment("center");
    }
    
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
 * Calcula el resumen de asistencia para una unidad y protege la hoja correspondiente.
 * @param {object} payload Datos {drive_url, unidad, alumnos, registros_asistencia}
 * @return {string} Mensaje de resultado.
 */
function handleCerrarUnidadAsistencia(payload) {
  Logger.log(`Iniciando handleCerrarUnidadAsistencia para unidad ${payload.unidad}...`);
  const { drive_url, unidad, alumnos, registros_asistencia } = payload;
  if (!drive_url || !unidad || !alumnos || !Array.isArray(alumnos) || !registros_asistencia || !Array.isArray(registros_asistencia)) {
    throw new Error("Faltan datos para cerrar la unidad (drive_url, unidad, alumnos, registros_asistencia).");
  }

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

  const sesionesUnicas = new Set(registros_asistencia.map(r => `${r.fecha}-${r.sesion}`));
  const totalSesiones = sesionesUnicas.size;
  Logger.log(`Total sesiones únicas para unidad ${unidad}: ${totalSesiones}`);
  if (totalSesiones === 0) {
      Logger.log("No hay registros de asistencia para calcular resumen. Saliendo.");
      return `No se generó resumen para Unidad ${unidad} porque no hay registros de asistencia.`;
  }

  const resumen = new Map();
  alumnos.forEach(alumno => {
    if (alumno && alumno.id && alumno.matricula) {
       resumen.set(alumno.id, { asistencias: 0, matricula: alumno.matricula });
    } else {
        Logger.log(`Alumno inválido en payload: ${JSON.stringify(alumno)}`);
    }
  });
  registros_asistencia.forEach(registro => {
    if (registro && registro.presente === true && resumen.has(registro.alumno_id)) {
      resumen.get(registro.alumno_id).asistencias++;
    }
  });
  Logger.log(`Resumen de asistencias calculado para ${resumen.size} alumnos.`);

  const ultimaColumnaContenido = hoja.getLastColumn();
  const colSumatoria = ultimaColumnaContenido + 1;
  const colPromedio = ultimaColumnaContenido + 2;
  if (hoja.getRange(1, colSumatoria).getValue() !== "Total Asistencias") {
    hoja.getRange(1, colSumatoria).setValue("Total Asistencias").setFontWeight("bold");
  }
  if (hoja.getRange(1, colPromedio).getValue() !== "% Asistencia") {
     hoja.getRange(1, colPromedio).setValue("% Asistencia").setFontWeight("bold");
  }

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

  let resumenesEscritos = 0;
  for (const [id, datos] of resumen.entries()) {
      const matriculaNormalizada = String(datos.matricula).trim().toUpperCase();
      const fila = matriculaMap.get(matriculaNormalizada);
      if(fila){
          const porcentaje = totalSesiones > 0 ? (datos.asistencias / totalSesiones) : 0;
          try {
            hoja.getRange(fila, colSumatoria, 1, 2).setValues([[datos.asistencias, porcentaje]]);
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

  try {
    const protection = hoja.protect().setDescription(`Unidad ${unidad} cerrada - Asistencia`);
    const me = Session.getEffectiveUser();
    protection.addEditor(me);
    const editors = protection.getEditors();
    editors.forEach(editor => {
      if (editor.getEmail() !== me.getEmail()) {
         try { protection.removeEditor(editor); } catch(e) {}
      }
    });
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
    Logger.log(`Hoja "${nombreHojaUnidad}" protegida.`);
  } catch (protectError) {
      Logger.log(`Error al proteger la hoja "${nombreHojaUnidad}": ${protectError.message}`);
  }

  SpreadsheetApp.flush();
  return `Resumen para la Unidad ${unidad} generado (${resumenesEscritos} alumnos) y la hoja ha sido protegida.`;
}

/**
 * Crea la hoja de cálculo "Lista de Alumnos" y la llena.
 * @param {GoogleAppsScript.Drive.Folder} carpetaPadre Carpeta "Reportes".
 * @param {Array<object>} alumnos Array de alumnos [{matricula, nombre, apellido}].
 */
function crearListaDeAlumnosSheet(carpetaPadre, alumnos) {
  const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_LISTA_ALUMNOS);
  if (files.hasNext()) {
    Logger.log(`"${NOMBRE_SHEET_LISTA_ALUMNOS}" ya existe en "${carpetaPadre.getName()}".`);
    return;
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

  const filasParaEscribir = [headers];
  if (Array.isArray(alumnos)) {
      alumnos.forEach((a, index) => {
        if (!a || typeof a !== 'object') {
           Logger.log(`Lista - Alumno ${index} inválido: ${JSON.stringify(a)}`);
           return;
        }
        filasParaEscribir.push([ a.matricula || '', a.nombre || '', a.apellido || '' ]);
      });
  } else {
       Logger.log("Lista - 'alumnos' no es un array.");
  }

  if (filasParaEscribir.length > 1) {
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
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange("A1:C1").setFontWeight("bold");
    sheet.setFrozenRows(1);
    Logger.log(`No hay alumnos válidos para escribir en "${NOMBRE_SHEET_LISTA_ALUMNOS}".`);
  }

  moveFileToFolder(spreadsheet.getId(), carpetaPadre, NOMBRE_SHEET_LISTA_ALUMNOS);
}

/**
 * Crea la hoja de cálculo "Reporte de Asistencia" y la llena.
 * @param {GoogleAppsScript.Drive.Folder} carpetaPadre Carpeta "Reportes".
 * @param {Array<object>} alumnos Array de alumnos [{matricula, nombre, apellido}].
 * @param {number} numeroDeUnidades Número de unidades.
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet | null} La hoja de cálculo o null si falla.
 */
function crearAsistenciasSheet(carpetaPadre, alumnos, numeroDeUnidades) {
  const files = carpetaPadre.getFilesByName(NOMBRE_SHEET_ASISTENCIA);
  if (files.hasNext()) {
    Logger.log(`"${NOMBRE_SHEET_ASISTENCIA}" ya existe en "${carpetaPadre.getName()}".`);
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

  const filasAlumnos = Array.isArray(alumnos) ? alumnos.map((a, index) => {
     if (!a || typeof a !== 'object') {
           Logger.log(`Asistencia - Alumno ${index} inválido: ${JSON.stringify(a)}`);
           return null;
        }
    return [ a.matricula || '', `${a.nombre || ''} ${a.apellido || ''}`.trim() ];
  }).filter(Boolean) : [];
  Logger.log(`Asistencia - 'filasAlumnos' válidas generadas: ${filasAlumnos.length} filas.`);

  const defaultSheet = spreadsheet.getSheets()[0];
  const defaultSheetName = defaultSheet ? defaultSheet.getName() : null;

  const numUnidadesReales = Math.max(1, numeroDeUnidades || 0);
  for (let i = 1; i <= numUnidadesReales; i++) {
    const nombreHoja = `Unidad ${i}`;
    let hojaUnidad;
    try {
        hojaUnidad = spreadsheet.insertSheet(nombreHoja);
        Logger.log(`Hoja "${nombreHoja}" creada.`);
    } catch (sheetError) {
         Logger.log(`ERROR al obtener/crear hoja ${nombreHoja}: ${sheetError.message}`);
         continue;
    }

    const datosParaEscribir = [headers];
    if (filasAlumnos.length > 0) {
      datosParaEscribir.push(...filasAlumnos);
    }

    if (datosParaEscribir.length > 0) {
       try {
            hojaUnidad.getRange(1, 1, datosParaEscribir.length, headers.length).setValues(datosParaEscribir);
            hojaUnidad.getRange(1, 1, 1, headers.length).setFontWeight("bold");
            hojaUnidad.setFrozenRows(1);
            hojaUnidad.setFrozenColumns(2);
            hojaUnidad.setColumnWidth(2, 250);
            Logger.log(`Hoja "${nombreHoja}" (re)poblada con encabezados y ${filasAlumnos.length} alumnos.`);
       } catch (e) {
            Logger.log(`ERROR al escribir datos en ${nombreHoja}: ${e.message}`);
       }
    } else {
        Logger.log(`Advertencia: No hay datos para escribir en ${nombreHoja}.`);
    }
  }

  if (defaultSheet && (defaultSheetName === "Sheet1" || defaultSheetName === "Hoja 1")) {
     try {
        spreadsheet.deleteSheet(defaultSheet);
        Logger.log(`Hoja por defecto residual '${defaultSheetName}' eliminada exitosamente.`);
     } catch (e) {
         Logger.log(`Advertencia: Falló la eliminación final de la hoja por defecto residual '${defaultSheetName}': ${e.message}`);
     }
  }

  const firstUnitSheet = spreadsheet.getSheetByName("Unidad 1");
  if (firstUnitSheet) {
    spreadsheet.setActiveSheet(firstUnitSheet);
    spreadsheet.moveActiveSheet(1);
  }

  moveFileToFolder(spreadsheet.getId(), carpetaPadre, NOMBRE_SHEET_ASISTENCIA);
  return spreadsheet;
}

/**
 * Lee todas las hojas de asistencia de un Spreadsheet y las devuelve como JSON.
 * @param {object} payload Datos { calificaciones_spreadsheet_id }.
 * @return {object} { asistencias: [...] }
 */
function handleLeerDatosAsistencia(payload) {
  const { calificaciones_spreadsheet_id } = payload;
  if (!calificaciones_spreadsheet_id) {
    throw new Error("Se requiere 'calificaciones_spreadsheet_id'.");
  }

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(calificaciones_spreadsheet_id);
  } catch (e) {
    throw new Error(`No se pudo abrir el Sheet de Asistencia con ID ${calificaciones_spreadsheet_id}.`);
  }
  
  const todasLasAsistencias = [];
  const hojasUnidad = spreadsheet.getSheets().filter(s => s.getName().startsWith("Unidad "));
  
  Logger.log(`Encontradas ${hojasUnidad.length} hojas de unidad para leer.`);

  for (const sheet of hojasUnidad) {
    const nombreHoja = sheet.getName();
    const matchUnidad = nombreHoja.match(/Unidad (\d+)/);
    if (!matchUnidad) continue;
    
    const unidadNum = parseInt(matchUnidad[1], 10);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    // Asumir que los datos empiezan en fila 2 y matrículas en col A
    if (lastRow < 2 || lastCol < 3) {
      Logger.log(`Hoja ${nombreHoja} está vacía o no tiene datos de asistencia. Saltando.`);
      continue;
    }
    
    const dataRange = sheet.getDataRange();
    const allValues = dataRange.getValues();
    
    const headers = allValues[0]; // Fila 1
    const matriculas = allValues.slice(1).map(row => row[0]); // Columna A (desde fila 2)
    
    // Iterar por columnas (a partir de la C, índice 2)
    for (let c_idx = 2; c_idx < lastCol; c_idx++) {
      const header = String(headers[c_idx] || "");
      const matchFecha = header.match(/(\d{2})\/(\d{2})-(\d+)/); // Formato "DD/MM-S"
      
      if (matchFecha) {
        const [_, dia, mes, sesionNum] = matchFecha.map(Number);
        const anio = new Date().getFullYear(); // Asumir año actual (podría fallar en Enero/Diciembre)
        // Formato ISO: YYYY-MM-DD
        const fechaISO = `${anio}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
        
        // Iterar por filas (alumnos)
        for (let r_idx = 0; r_idx < matriculas.length; r_idx++) {
          const matricula = String(matriculas[r_idx]);
          if (!matricula) continue; // Saltar fila sin matrícula
          
          const valorAsistencia = allValues[r_idx + 1][c_idx];
          const presente = (valorAsistencia === 1 || valorAsistencia === '1' || String(valorAsistencia).toLowerCase() === 'true');
          
          todasLasAsistencias.push({
            matricula: matricula,
            fecha: fechaISO,
            unidad: unidadNum,
            sesion: sesionNum,
            presente: presente
          });
        }
      }
    }
  }
  
  Logger.log(`Se leyeron un total de ${todasLasAsistencias.length} registros de asistencia desde Sheets.`);
  return { asistencias: todasLasAsistencias };
}