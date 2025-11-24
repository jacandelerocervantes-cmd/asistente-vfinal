import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

// Helper para pausas
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch robusto que lee el cuerpo UNA sola vez
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      // Si falla por Rate Limit (429) o Server Error (5xx), reintentamos
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Server error ${res.status}`);
      }
      return res;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log(`Intento ${i + 1} fallido (${errorMessage}). Reintentando en ${i + 2}s...`);
      if (i === retries - 1) throw err;
      await wait(2000 * (i + 1)); // Espera exponencial (2s, 4s, 6s)
    }
  }
  throw new Error("Fallo fetch tras reintentos");
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let job_id_global = null;
  let calificacion_id_global = null;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. OBTENER TRABAJO (Bloqueo concurrente)
    const { data: jobData, error: jobError } = await supabaseAdmin.rpc('obtener_siguiente_trabajo_evaluacion');
    if (jobError) throw new Error(`Error RPC: ${jobError.message}`);
    if (!jobData || jobData.length === 0) {
      return new Response(JSON.stringify({ message: "Sin trabajos pendientes." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const jobId = jobData[0].job_id;
    job_id_global = jobId;
    console.log(`>>> INICIO PROCESAMIENTO TRABAJO ID: ${jobId} <<<`);

    // 2. LEER DATOS
    const { data: colaItem, error: colaError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`*, calificaciones (id, actividad_id, alumno_id, grupo_id, evidencia_drive_file_id, actividades (id, nombre, unidad, rubrica_sheet_range, rubrica_spreadsheet_id, drive_folder_entregas_id, tipo_entrega, materia_id, materias (nombre, calificaciones_spreadsheet_id, drive_url)), alumnos (id, nombre, apellido, matricula), grupos (id, nombre))`)
      .eq('id', jobId).single();

    if (colaError || !colaItem) throw new Error("No se encontró el trabajo en la BD.");
    const calif = colaItem.calificaciones;
    calificacion_id_global = calif.id;
    const act = calif.actividades;
    const mat = act.materias;

    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '1/4: Leyendo archivo...' }).eq('id', calif.id);

    // 3. OBTENER TEXTO (Apps Script)
    const scriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!;
    
    // --- FIX: Pausa artificial para no saturar a Gemini si hay muchos procesos ---
    await wait(2000); 

    const resTexto = await fetchWithRetry(scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calif.evidencia_drive_file_id })
    });

    // LECTURA SEGURA DEL BODY
    const rawTexto = await resTexto.text();
    let jsonTexto;
    try { jsonTexto = JSON.parse(rawTexto); } catch { throw new Error(`Google devolvió respuesta inválida al leer texto.`); }

    if (jsonTexto.requiere_revision_manual) {
        console.warn("Archivo requiere revisión manual.");
        await supabaseAdmin.from('calificaciones').update({ estado: 'requiere_revision_manual', progreso_evaluacion: 'Formato no legible por IA' }).eq('id', calif.id);
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', ultimo_error: 'Manual req.' }).eq('id', jobId);
        return new Response(JSON.stringify({ message: "Marcado manual" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!resTexto.ok || !jsonTexto.texto_trabajo) throw new Error(`Error leyendo archivo: ${jsonTexto.error || 'Sin texto'}`);
    const textoAlumno = jsonTexto.texto_trabajo;

    // 4. OBTENER RÚBRICA
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '2/4: Analizando rúbrica...' }).eq('id', calif.id);
    const resRubrica = await fetchWithRetry(scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_rubric_text', spreadsheet_id: act.rubrica_spreadsheet_id, rubrica_sheet_range: act.rubrica_sheet_range })
    });
    const jsonRubrica = await resRubrica.json();
    if (!jsonRubrica.texto_rubrica) throw new Error("Error leyendo rúbrica.");

    // 5. GEMINI
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '3/4: Evaluando con IA...' }).eq('id', calif.id);
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;

    const prompt = `
      Eres un profesor evaluando. Usa esta RÚBRICA:\n${jsonRubrica.texto_rubrica}\n
      Para evaluar este ALUMNO:\n"${textoAlumno.substring(0, 12000)}"\n
      Responde SOLO un JSON: {"calificacion_total": number, "justificacion_texto": "string breve"}.
    `;

    const resGemini = await fetchWithRetry(geminiUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const geminiData = await resGemini.json();
    const rawAI = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawAI) throw new Error("Gemini devolvió respuesta vacía (Posible sobrecarga).");

    let evaluacion;
    try {
        evaluacion = JSON.parse(rawAI.replace(/```json|```/g, '').trim());
    } catch { throw new Error("Gemini no devolvió JSON válido."); }

    // 6. GUARDAR EN SHEETS (Aquí estaba el error Body Consumed)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '4/4: Guardando...' }).eq('id', calif.id);
    
    const payloadSave = {
      action: 'guardar_calificacion_actividad',
      calificaciones_spreadsheet_id: mat.calificaciones_spreadsheet_id,
      nombre_evaluacion: act.nombre,
      unidad: act.unidad,
      calificaciones: [{
          matricula: calif.alumnos?.matricula || "S/M",
          nombre: calif.alumnos ? `${calif.alumnos.nombre} ${calif.alumnos.apellido}` : "",
          calificacion_final: evaluacion.calificacion_total,
          retroalimentacion: evaluacion.justificacion_texto // Pasamos también la justificación
      }]
    };

    const resSave = await fetchWithRetry(scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadSave)
    });

    // --- FIX BODY CONSUMED ---
    const rawSaveBody = await resSave.text(); // Leemos UNA VEZ
    let jsonSave;
    try { jsonSave = JSON.parse(rawSaveBody); } catch { 
        // Si falla el JSON, usamos el texto crudo para el error
        throw new Error(`Apps Script error (No JSON): ${rawSaveBody}`); 
    }

    if (!resSave.ok || jsonSave.status === 'error') {
        throw new Error(`Apps Script error lógico: ${jsonSave.message || rawSaveBody}`);
    }

    // 7. ACTUALIZAR DB LOCAL
    let idsUpdate = [calif.id];
    // Si es equipo, buscamos compañeros
    if (calif.grupo_id && ['grupal', 'mixta'].includes(act.tipo_entrega)) {
        const { data: comps } = await supabaseAdmin.from('calificaciones').select('id')
            .eq('actividad_id', act.id).eq('grupo_id', calif.grupo_id);
        if (comps) idsUpdate = comps.map(c => c.id);
    }

    await supabaseAdmin.from('calificaciones').update({
        calificacion_obtenida: evaluacion.calificacion_total,
        estado: 'calificado',
        progreso_evaluacion: 'Completado',
        justificacion_sheet_cell: 'Ver reporte'
    }).in('id', idsUpdate);

    // Completar Job
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', updated_at: new Date() }).eq('id', jobId);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido en el procesamiento.";
    console.error("ERROR FATAL:", errorMessage);
    // Revertir estado para reintentar o mostrar error
    if (calificacion_id_global) {
        await supabaseAdmin.from('calificaciones').update({ 
            estado: 'fallido', // Lo dejamos en fallido para que el usuario lo vea y decida reintentar
            progreso_evaluacion: `Error: ${errorMessage.substring(0, 40)}` 
        }).eq('id', calificacion_id_global);
    }
    if (job_id_global) {
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: errorMessage }).eq('id', job_id_global);
    }
    return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});