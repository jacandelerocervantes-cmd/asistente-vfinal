// supabase/functions/procesar-cola-evaluacion/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

// Encabezados CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Interfaces para seguridad de tipos ---
interface Materia {
    id: number;
    drive_url: string | null;
    rubricas_spreadsheet_id: string | null; // ID maestro de rúbricas
    calificaciones_spreadsheet_id: string | null; // ID de hoja de calificaciones (puede ser útil)
}
interface Actividad {
    id: number;
    nombre: string;
    unidad: number;
    rubrica_spreadsheet_id: string | null; // Podría ser el mismo que el maestro
    rubrica_sheet_range: string | null;    // Rango específico
    materias: Materia | null;
}
interface Alumno { id: number; matricula: string; nombre: string; apellido: string; }
interface Grupo { id: number; nombre: string; }
interface Calificacion {
    id: number;
    actividad_id: number;
    alumno_id?: number | null;
    grupo_id?: number | null;
    user_id: string; // Dueño de la calificación
    evidencia_drive_file_id: string | null;
    actividades: Actividad | null; // Relación anidada
    // Campos a actualizar
    estado?: string;
    progreso_evaluacion?: string | null;
    calificacion_obtenida?: number | null;
    justificacion_sheet_cell?: string | null;
}
interface TrabajoCola {
    id: number;
    user_id: string; // Dueño del trabajo en cola
    calificaciones: Calificacion | null; // Relación directa a la calificación a procesar
}
interface MiembroGrupo {
    alumno: { id: number; matricula: string; nombre: string; apellido: string; } | null;
    grupo: { id: number; nombre: string; } | null;
}



// --- Función auxiliar para extraer JSON (Respaldo) ---
function extractJson(text: string): Record<string, unknown> | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) { console.warn("extractJson: No encontró patrón {.*}"); return null; }
    const potentialJson = match[0].replace(/```json\n?/, '').replace(/\n?```$/, '').trim();
    try {
        const parsed = JSON.parse(potentialJson);
        console.log("extractJson: Parseo exitoso.");
        return parsed;
    } catch (e) {
        if (e instanceof Error) {
            console.error("extractJson: Fallo al parsear JSON:", e.message);
        } else {
            console.error("extractJson: Fallo al parsear JSON:", String(e));
        }
        console.error("extractJson: JSON problemático:", potentialJson);
        return null;
    }
}

// --- Servidor de la función ---
serve(async (req: Request) => {
  console.log(`--- INICIO EJECUCIÓN (SINGLE): procesar-cola-evaluacion | ${new Date().toISOString()} ---`);
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  let trabajoId: number | null = null;
  let calificacionId: number | null = null;
  // Crear cliente Admin al inicio para usarlo también en el catch
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // 1. Obtener UN trabajo pendiente
    const { data: trabajoData, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`
    id,
    user_id,
    calificaciones (
      id,
      actividad_id,
      alumno_id,
      grupo_id,
      user_id,
      evidencia_drive_file_id,
      actividades (
        id,
        nombre,
        unidad,
        rubrica_spreadsheet_id,
        rubrica_sheet_range,
        materias (
          id,
          drive_url,
          rubricas_spreadsheet_id,
          calificaciones_spreadsheet_id
        )
      )
    )
  `)
  // --- FIN SECCIÓN CORREGIDA ---
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (trabajoError) { console.error("Error en BD al buscar trabajo:", trabajoError); throw new Error(`Error BD buscando trabajo: ${trabajoError.message}`); }
    if (!trabajoData) {
      console.log("Paso 1: No hay trabajos pendientes.");
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- Validación robusta de datos ---
    const trabajo = trabajoData as unknown as TrabajoCola;
    trabajoId = trabajo.id;
    console.log(`Paso 1: Encontrado Trabajo ID: ${trabajoId}`);

    const calificacion = trabajo.calificaciones;
    // Validar que la relación con calificaciones exista
    if (!calificacion || typeof calificacion !== 'object') {
      console.error(`Error de Validación: Trabajo ID ${trabajoId} no tiene objeto 'calificaciones' válido. Datos:`, trabajoData);
      // Marcar como fallido inmediatamente si la relación falla
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: 'La calificación asociada no existe o la relación falló.' }).eq('id', trabajo.id);
      throw new Error(`Trabajo ID ${trabajo.id} no tiene una calificación asociada válida.`);
    }
    calificacionId = calificacion.id;
    console.log(`Paso 1: Calificación ID asociada: ${calificacionId}`);

    // Validar campos críticos de calificación y relaciones anidadas
    if (!calificacion.evidencia_drive_file_id) { throw new Error(`Calificación ID ${calificacion.id} falta 'evidencia_drive_file_id'.`); }
    const actividad = calificacion.actividades;
    if (!actividad || typeof actividad !== 'object') { throw new Error(`Calificación ID ${calificacion.id} falta 'actividades' asociada.`); }
    if (!actividad.rubrica_sheet_range) { throw new Error(`Actividad ID ${actividad.id} falta 'rubrica_sheet_range'.`); }
    const materia = actividad.materias;
    // Necesitamos el ID maestro de rúbricas de la materia Y la URL de Drive
    if (!materia || typeof materia !== 'object' || !materia.rubricas_spreadsheet_id || !materia.drive_url) { throw new Error(`Actividad ID ${actividad.id} falta 'materias' asociada o falta 'rubricas_spreadsheet_id'/'drive_url'.`); }
    // Usar el ID maestro de la materia para obtener el texto de la rúbrica
    const spreadsheetIdParaRubrica = materia.rubricas_spreadsheet_id;
    console.log("Paso 1: Validación de datos OK.");
    // --- Fin Validación ---

    // 2. Marcar como 'procesando'
    console.log(`Paso 2: Marcando trabajo ${trabajoId} y calificación ${calificacionId} como 'procesando'`);
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'procesando' }).eq('id', trabajo.id);
    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '1/4: Obteniendo textos...' }).eq('id', calificacionId);

    // 3. Obtener textos desde Google Apps Script
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("URL de Apps Script no configurada.");
    console.log("Paso 3: Llamando a Apps Script para obtener textos...");

    // Obtener texto de la rúbrica
    const rubricPayload = { action: 'get_rubric_text', spreadsheet_id: spreadsheetIdParaRubrica, rubrica_sheet_range: actividad.rubrica_sheet_range };
    console.log("Payload Rúbrica:", rubricPayload);
    const rubricRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify(rubricPayload), headers: { 'Content-Type': 'application/json' } });
    if (!rubricRes.ok) throw new Error(`Error red rúbrica (${rubricRes.status}): ${await rubricRes.text()}`);
    const rubricJson = await rubricRes.json();
    if (rubricJson.status !== 'success') throw new Error(`Apps Script (get_rubric_text) falló: ${rubricJson.message}`);
    const textoRubrica = rubricJson.texto_rubrica;
    console.log("Texto rúbrica OK.");

    // Obtener texto del trabajo
    const workPayload = { action: 'get_student_work_text', drive_file_id: calificacion.evidencia_drive_file_id };
    console.log("Payload Trabajo:", workPayload);
    const workRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify(workPayload), headers: { 'Content-Type': 'application/json' } });
    if (!workRes.ok) throw new Error(`Error red trabajo (${workRes.status}): ${await workRes.text()}`);
    const workJson = await workRes.json();
    if (workJson.status !== 'success') throw new Error(`Apps Script (get_student_work_text) falló: ${workJson.message}`);
    const textoTrabajo = workJson.texto_trabajo;
    console.log("Texto trabajo OK.");

    // 4. Calificar con IA (Gemini)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '2/4: Calificando con IA...' }).eq('id', calificacionId);
    console.log("Paso 4: Llamando a Gemini API...");
    const prompt = `Evalúa el trabajo basándote en la rúbrica. Tu respuesta DEBE ser únicamente un objeto JSON válido con las claves "calificacion_total" (number) y "justificacion_texto" (string).\n\nRúbrica:\n${textoRubrica}\n\nTrabajo:\n${textoTrabajo}`;
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada.");
    console.log(`Usando GEMINI_API_KEY que empieza con: ${GEMINI_API_KEY.substring(0, 5)}...`);

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    const geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } }) });
    console.log(`Respuesta Gemini Status: ${geminiResponse.status}`);

    if (!geminiResponse.ok) {
        const errorBodyText = await geminiResponse.text();
        console.error("Error crudo de Gemini API:", errorBodyText);
        let errMsg = `Error ${geminiResponse.status}`; try { errMsg = JSON.parse(errorBodyText)?.error?.message || errMsg; } catch (_) { /* ignore */ }
        throw new Error(`Error en API Gemini: ${errMsg}`);
    }
    const geminiData = await geminiResponse.json();
    console.log("Respuesta Gemini OK.");

    const rawGeminiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawGeminiText) { console.error("Respuesta Gemini inesperada:", JSON.stringify(geminiData)); throw new Error(`Respuesta inesperada/vacía de Gemini.`); }
    console.log("Texto crudo Gemini:", rawGeminiText);

    // Parseo y validación del JSON
    let parsedJson = extractJson(rawGeminiText); // Respaldo
    if (!parsedJson) { 
        try { 
            parsedJson = JSON.parse(rawGeminiText); 
        } catch (e) { 
            throw new Error(`Respuesta IA no pudo ser parseada como JSON. Crudo: ${rawGeminiText}. Error: ${e instanceof Error ? e.message : String(e)}`); 
        }}
    if (parsedJson === null || typeof parsedJson.calificacion_total !== 'number' || typeof parsedJson.justificacion_texto !== 'string') { console.error("JSON parseado inválido:", parsedJson); throw new Error(`JSON de IA inválido o faltan claves. Recibido: ${JSON.stringify(parsedJson)}`); }
    const { calificacion_total, justificacion_texto } = parsedJson;
    console.log(`Calificación IA: ${calificacion_total}. JSON Validado.`);

    // 5. Guardar resultados en Google Sheets
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '3/4: Generando reportes...' }).eq('id', calificacionId);
    console.log("Paso 5: Preparando datos para Google Sheets...");

    let calificacionesParaReporte: { matricula: string; nombre: string; equipo: string; calificacion: number; retroalimentacion: string; }[] = [];

    // Obtener detalles alumnos/grupos
    if (calificacion.grupo_id) {
      console.log(`Obteniendo miembros grupo ID: ${calificacion.grupo_id}`);
      const { data: miembros, error: errorMiembros } = await supabaseAdmin.from('alumnos_grupos').select(`alumno:alumnos!inner(id, matricula, nombre, apellido), grupo:grupos!inner(id, nombre)`).eq('grupo_id', calificacion.grupo_id);
      console.log("Raw data 'miembros':", JSON.stringify(miembros)); // LOG CRUDO
      if (errorMiembros) { console.error("Error consultando miembros:", errorMiembros); throw errorMiembros; }
      if (!Array.isArray(miembros)) throw new Error("Consulta miembros no devolvió array.");

      calificacionesParaReporte = (miembros as unknown as MiembroGrupo[]).map((m) => {
         const alumno = m.alumno; const grupo = m.grupo;
         if (!alumno || !grupo || !alumno.matricula) { console.warn(`Datos incompletos miembro grupo ${calificacion.grupo_id}. Alumno: ${JSON.stringify(alumno)}, Grupo: ${JSON.stringify(grupo)}`); return null; }
         return { matricula: alumno.matricula, nombre: `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim(), equipo: grupo.nombre, calificacion: calificacion_total, retroalimentacion: justificacion_texto };
      }).filter((item): item is NonNullable<typeof item> => item !== null);

    } else if (calificacion.alumno_id) {
      console.log(`Obteniendo alumno ID: ${calificacion.alumno_id}`);
      const { data: alumno, error: errorAlumno } = await supabaseAdmin.from('alumnos').select('matricula, nombre, apellido').eq('id', calificacion.alumno_id).single();
      if (errorAlumno) throw errorAlumno;
      if (!alumno) throw new Error(`No se encontró alumno ID ${calificacion.alumno_id}`);
      calificacionesParaReporte.push({ matricula: alumno.matricula, nombre: `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim(), equipo: '', calificacion: calificacion_total, retroalimentacion: justificacion_texto });
    } else { throw new Error(`Calificación ${calificacionId} sin alumno_id ni grupo_id.`); }

    console.log("'calificacionesParaReporte' preparado:", JSON.stringify(calificacionesParaReporte));

    // *** VALIDACIÓN CRÍTICA ANTES DE LLAMAR A APPS SCRIPT ***
    if (calificacionesParaReporte.length === 0) {
        console.error("Error Crítico: 'calificacionesParaReporte' está vacío ANTES de llamar a Apps Script.");
        throw new Error("No se pudieron generar los datos de calificación para el reporte (array vacío). Revisar consulta de miembros de grupo o alumno.");
    }

    // Llamar a Apps Script
    const reportePayload = { action: 'guardar_calificacion_detallada', drive_url_materia: materia.drive_url, unidad: actividad.unidad, actividad: { nombre: actividad.nombre, id: actividad.id }, calificaciones: calificacionesParaReporte };
    console.log("Payload para guardar_calificacion_detallada:", reportePayload);
    const reporteRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify(reportePayload), headers: { 'Content-Type': 'application/json' } });
    if (!reporteRes.ok) throw new Error(`Apps Script (guardar...) falló (${reporteRes.status}): ${await reporteRes.text()}`);
    const reporteJson = await reporteRes.json();
    // Capturar el error específico de Apps Script si lo reporta
    if (reporteJson.status !== 'success') throw new Error(`Apps Script (guardar...) reportó error: ${reporteJson.message}`);
    console.log("Resultados guardados en Google Sheets OK.");
    // Guardar referencia a la celda devuelta por Apps Script
    const justificacionSheetCell = reporteJson.justificacion_cell_ref || null;
    console.log("Referencia celda justificación:", justificacionSheetCell);

    // 6. Actualizar Supabase (final)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '4/4: Finalizando...' }).eq('id', calificacionId);
    console.log("Paso 6: Actualizando estado final en Supabase...");

    // Actualizar calificación principal
    const { error: updateCalifError } = await supabaseAdmin.from('calificaciones').update({ calificacion_obtenida: calificacion_total, justificacion_sheet_cell: justificacionSheetCell, estado: 'calificado', progreso_evaluacion: 'Completado' }).eq('id', calificacionId);
    if (updateCalifError) throw new Error(`Error al actualizar calificación ${calificacionId}: ${updateCalifError.message}`);

    // Propagación para grupos
    if (calificacion.grupo_id && calificacionesParaReporte.length > 0) {
        console.log(`Propagando calificación a miembros grupo ${calificacion.grupo_id}...`);
        const { data: miembrosProp, error: errorMiembrosProp } = await supabaseAdmin.from('alumnos_grupos').select('alumno_id').eq('grupo_id', calificacion.grupo_id);
        if (errorMiembrosProp) throw new Error(`Error obteniendo miembros (propagación): ${errorMiembrosProp.message}`);
        if (!Array.isArray(miembrosProp)) throw new Error("Consulta miembros (propagación) no devolvió array.");

        const calificacionesAlumnos = miembrosProp.map((miembro: { alumno_id: number }) => ({
            actividad_id: calificacion.actividad_id,
            alumno_id: miembro.alumno_id,
            user_id: trabajo.user_id, // Usar el user_id del trabajo original
            calificacion_obtenida: calificacion_total,
            estado: 'calificado',
            progreso_evaluacion: 'Completado (Grupal)',
            grupo_id: calificacion.grupo_id, // Mantener referencia al grupo
            justificacion_sheet_cell: justificacionSheetCell, // Propagar referencia
            evidencia_drive_file_id: calificacion.evidencia_drive_file_id // Propagar evidencia
        }));
        if (calificacionesAlumnos.length > 0) {
            console.log(`Upsert para ${calificacionesAlumnos.length} miembros...`);
            const { error: upsertError } = await supabaseAdmin.from('calificaciones').upsert(calificacionesAlumnos, { onConflict: 'actividad_id, alumno_id' }); // Conflict en actividad y alumno
            if (upsertError) throw new Error(`Error al propagar (upsert): ${upsertError.message}`);
        }
    }

    // 7. Marcar trabajo como completado
    console.log(`Paso 7: Marcando trabajo ${trabajoId} como 'completado'.`);
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', ultimo_error: null, intentos: 0 }).eq('id', trabajo.id);

    console.log(`--- FIN EJECUCIÓN (Éxito SINGLE): procesar-cola-evaluacion | Trabajo ID ${trabajoId} ---`);
    return new Response(JSON.stringify({ message: `Trabajo ${trabajoId} procesado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) { // <-- Bloque catch robusto
    console.error("!!!!!!!!!! ERROR CAPTURADO EN BLOQUE CATCH (SINGLE procesar-cola) !!!!!!!!!!");
    console.error("RAW ERROR caught:", error);
    let errorMessage = "Error desconocido durante procesamiento.";
    if (error instanceof Error) { errorMessage = error.message || error.toString(); }
    else if (typeof error === 'string') { errorMessage = error; }
    else { try { errorMessage = JSON.stringify(error); } catch (_) { errorMessage = "Error no serializable."; }}
    console.error(`Error procesado para trabajo ID ${trabajoId} (Calif ID: ${calificacionId}): ${errorMessage}`);

    // Intentar marcar como fallido en BD
    if (trabajoId) {
      try {
        console.log(`[Catch Bloque SINGLE] Intentando actualizar trabajo ${trabajoId} a 'fallido'. Error: "${errorMessage.substring(0, 500)}..."`);
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: errorMessage }).eq('id', trabajoId);
        if (calificacionId) {
          await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error: ${errorMessage.substring(0, 100)}...` }).eq('id', calificacionId);
        }
        console.log(`[Catch Bloque SINGLE] Trabajo ${trabajoId} marcado como 'fallido'.`);
      } catch (dbError) {
        if (dbError instanceof Error) {
            console.error(`[Catch Bloque SINGLE] Error ADICIONAL al marcar como fallido: ${dbError.message}`);
        } else {
            console.error(`[Catch Bloque SINGLE] Error ADICIONAL al marcar como fallido: ${String(dbError)}`);
        }
      }
    } else { console.warn("[Catch Bloque SINGLE] trabajoId nulo, no se pudo actualizar estado."); }

    console.log(`--- FIN EJECUCIÓN (Error SINGLE): procesar-cola-evaluacion | Trabajo ID ${trabajoId} ---`);
    // Devolver el error 500
    return new Response(JSON.stringify({ message: errorMessage }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});