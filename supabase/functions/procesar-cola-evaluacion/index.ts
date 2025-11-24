import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

// Helper para esperar (Throttle)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Helper para fetch con reintentos
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) { // Too Many Requests
        console.log(`Rate limit 429. Esperando ${2 * (i + 1)}s...`);
        await wait(2000 * (i + 1));
        continue;
      }
      return res; // Retornamos la respuesta original (sin leer el body aún)
    } catch (err) {
      if (i === retries - 1) throw err;
      await wait(1000);
    }
  }
  throw new Error("Fetch falló tras reintentos");
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Variables para manejo de error global
  let job_id_ref = null;
  let calif_id_ref = null;
  
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // 1. OBTENER TRABAJO (Bloqueo para que sea uno a uno)
    const { data: jobData, error: jobError } = await supabaseAdmin.rpc('obtener_siguiente_trabajo_evaluacion');
    if (jobError || !jobData || jobData.length === 0) {
      return new Response(JSON.stringify({ message: "Sin trabajos" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const jobId = jobData[0].job_id;
    job_id_ref = jobId;
    console.log(`>>> PROCESANDO JOB ${jobId} <<<`);

    // 2. LEER DATOS COMPLETOS
    const { data: item } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`*, calificaciones ( *, actividades ( *, materias (*) ), alumnos (*), grupos (*) )`)
      .eq('id', jobId).single();

    if (!item) throw new Error("Datos de trabajo no encontrados");
    const calif = item.calificaciones;
    calif_id_ref = calif.id;
    const act = calif.actividades;

    // 3. OBTENER TEXTO (Apps Script)
    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '1/4: Leyendo...' }).eq('id', calif.id);
    
    // PAUSA TÁCTICA: Darle respiro a la API antes de empezar
    await wait(1000); 

    const resText = await fetchWithRetry(Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calif.evidencia_drive_file_id })
    });

    // LEER UNA SOLA VEZ
    const rawText = await resText.text();
    let jsonText;
    try { jsonText = JSON.parse(rawText); } catch { throw new Error("Error leyendo respuesta de texto de Google."); }

    // Manejo de "Revisión Manual" sin error fatal
    if (jsonText.requiere_revision_manual) {
       await supabaseAdmin.from('calificaciones').update({ estado: 'requiere_revision_manual', progreso_evaluacion: 'Formato no soportado' }).eq('id', calif.id);
       await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', ultimo_error: 'Manual requerido' }).eq('id', jobId);
       return new Response(JSON.stringify({ ok: true, manual: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!jsonText.texto_trabajo) throw new Error("Archivo vacío o sin texto.");

    // 4. OBTENER RÚBRICA
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '2/4: Rúbrica...' }).eq('id', calif.id);
    const resRubrica = await fetchWithRetry(Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_rubric_text', spreadsheet_id: act.rubrica_spreadsheet_id, rubrica_sheet_range: act.rubrica_sheet_range })
    });
    const jsonRubrica = await resRubrica.json(); // Aquí es seguro usar .json() directo si confiamos en que GAS siempre devuelve JSON

    // 5. GEMINI (EVALUACIÓN)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '3/4: IA Analizando...' }).eq('id', calif.id);
    
    // PAUSA IMPORTANTE: Throttle para Gemini (2 segundos entre lecturas grandes)
    await wait(2000);

    const prompt = `
      Eres un profesor experto. Evalúa esto con la rúbrica proporcionada.
      RÚBRICA: ${jsonRubrica.texto_rubrica}
      ALUMNO: "${jsonText.texto_trabajo.substring(0, 15000)}"
      Salida JSON exacta: { "calificacion_total": number, "justificacion_texto": "string" }
    `;

    const resGemini = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const geminiData = await resGemini.json();
    const aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) throw new Error("Gemini saturado (respuesta vacía).");

    let evalJson;
    try { evalJson = JSON.parse(aiText.replace(/```json|```/g, '').trim()); } 
    catch { throw new Error("Error parseando JSON de Gemini."); }

    // 6. GUARDAR EN SHEETS (Corrección Body Consumed y Script Nuevo)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '4/4: Guardando...' }).eq('id', calif.id);

    const payloadSave = {
        action: 'guardar_calificacion_actividad', // <--- LLAMAMOS A LA FUNCIÓN NUEVA
        calificaciones_spreadsheet_id: act.materias.calificaciones_spreadsheet_id,
        nombre_evaluacion: act.nombre,
        unidad: act.unidad,
        calificaciones: [{
            matricula: calif.alumnos?.matricula || "S/M",
            nombre: calif.alumnos ? `${calif.alumnos.nombre}` : "",
            calificacion_final: evalJson.calificacion_total,
            retroalimentacion: evalJson.justificacion_texto
        }]
    };

    const resSave = await fetchWithRetry(Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadSave)
    });

    // --- FIX DEFINITIVO BODY CONSUMED ---
    const rawSave = await resSave.text(); // Leemos UNA vez
    let jsonSave;
    try { jsonSave = JSON.parse(rawSave); } catch { throw new Error(`Error GAS: ${rawSave}`); }
    if (jsonSave.status === 'error') throw new Error(`Error GAS Lógico: ${jsonSave.message}`);

    // 7. ACTUALIZAR DB Y FINALIZAR
    // Actualizar grupo si aplica
    let ids = [calif.id];
    if (calif.grupo_id && ['grupal', 'mixta'].includes(act.tipo_entrega)) {
        const { data: groupMembers } = await supabaseAdmin.from('calificaciones').select('id')
            .eq('actividad_id', act.id).eq('grupo_id', calif.grupo_id);
        if (groupMembers) ids = groupMembers.map(x => x.id);
    }

    await supabaseAdmin.from('calificaciones').update({
        calificacion_obtenida: evalJson.calificacion_total,
        estado: 'calificado',
        progreso_evaluacion: 'Completado',
        justificacion_sheet_cell: 'Ver Reporte'
    }).in('id', ids);

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', updated_at: new Date() }).eq('id', jobId);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido en el proceso";
    console.error("Error en proceso:", errorMessage, error);
    // Marcar como fallido visualmente
    if (calif_id_ref) await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: 'Error: Ver detalle' }).eq('id', calif_id_ref);
    if (job_id_ref) await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: errorMessage }).eq('id', job_id_ref);
    
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});