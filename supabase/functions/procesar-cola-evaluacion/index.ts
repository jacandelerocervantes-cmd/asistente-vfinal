import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch blindado con reintentos
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) { // Si Gemini dice "Calma, vas muy rápido"
        console.log(`Rate Limit (429). Esperando ${3 * (i + 1)}s...`);
        await wait(3000 * (i + 1));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await wait(1000);
    }
  }
  throw new Error("Error de conexión tras varios intentos.");
};

interface AlumnoParaGuardar {
  matricula: string;
  nombre: string;
  calificacion_final: number;
  retroalimentacion: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // 1. TOMAR TRABAJO (Bloqueo)
    const { data: jobData } = await supabaseAdmin.rpc('obtener_siguiente_trabajo_evaluacion');
    if (!jobData || jobData.length === 0) {
      return new Response(JSON.stringify({ message: "Cola vacía" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const jobId = jobData[0].job_id;
    console.log(`>>> PROCESANDO TRABAJO ${jobId} <<<`);

    // 2. LEER DATOS
    const { data: item } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`*, calificaciones (id, actividad_id, alumno_id, grupo_id, evidencia_drive_file_id, actividades (id, nombre, unidad, rubrica_sheet_range, rubrica_spreadsheet_id, tipo_entrega, materias (calificaciones_spreadsheet_id)), alumnos (matricula, nombre, apellido), grupos (nombre))`)
      .eq('id', jobId).single();

    const calif = item.calificaciones;
    const act = calif.actividades;

    // 3. OBTENER TEXTO (Apps Script)
    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '1/4: Leyendo documento...' }).eq('id', calif.id);
    
    await wait(1000); // Pausa de cortesía

    const resText = await fetchWithRetry(Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calif.evidencia_drive_file_id })
    });

    const rawText = await resText.text(); // LEER UNA VEZ
    const jsonText = JSON.parse(rawText);

    if (jsonText.requiere_revision_manual) {
       await supabaseAdmin.from('calificaciones').update({ estado: 'requiere_revision_manual', progreso_evaluacion: 'Formato no soportado por IA' }).eq('id', calif.id);
       await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', ultimo_error: 'Manual' }).eq('id', jobId);
       return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 4. RÚBRICA
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '2/4: Analizando rúbrica...' }).eq('id', calif.id);
    const resRubrica = await fetchWithRetry(Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_rubric_text', spreadsheet_id: act.rubrica_spreadsheet_id, rubrica_sheet_range: act.rubrica_sheet_range })
    });
    const jsonRubrica = await resRubrica.json();

    // 5. IA GEMINI (Con espera para evitar 429)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '3/4: IA Evaluando...' }).eq('id', calif.id);
    await wait(2500); // THROTTLE: Espera 2.5s antes de llamar a Gemini

    const prompt = `
      RÚBRICA: ${jsonRubrica.texto_rubrica}
      ALUMNO: "${jsonText.texto_trabajo.substring(0, 15000)}"
      Evalúa y responde SOLO JSON: { "calificacion_total": number, "justificacion_texto": "string" }
    `;

    const resGemini = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const geminiData = await resGemini.json();
    const aiResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiResponse) throw new Error("Gemini saturado (respuesta vacía).");
    const evalJson = JSON.parse(aiResponse.replace(/```json|```/g, '').trim());

    // 6. GUARDAR EN SHEETS (Expandir Grupos + Solución Body Consumed)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '4/4: Guardando reporte...' }).eq('id', calif.id);

    const alumnosAGuardar: AlumnoParaGuardar[] = [];
    let idsAActualizar = [calif.id];

    // Lógica de expansión: Si es grupal, buscamos a los compañeros
    if (calif.grupo_id && ['grupal', 'mixta'].includes(act.tipo_entrega)) {
        const { data: miembros } = await supabaseAdmin
            .from('alumnos_grupos')
            .select('alumnos(matricula, nombre, apellido)')
            .eq('grupo_id', calif.grupo_id);
        
        // También buscamos los IDs de calificaciones de los compañeros para actualizarlos en BD
        const { data: comps } = await supabaseAdmin.from('calificaciones').select('id')
            .eq('actividad_id', act.id).eq('grupo_id', calif.grupo_id);
        if (comps) idsAActualizar = comps.map(x => x.id);

        if (miembros) {
            miembros.forEach(m => {
              const alumno = Array.isArray(m.alumnos) ? m.alumnos[0] : m.alumnos;
              if (alumno) {
                alumnosAGuardar.push({
                matricula: alumno.matricula,
                nombre: `${alumno.nombre} ${alumno.apellido}`,
                calificacion_final: evalJson.calificacion_total,
                retroalimentacion: evalJson.justificacion_texto
                });
              }
            });
        }
    } else {
        // Individual
        alumnosAGuardar.push({
            matricula: calif.alumnos?.matricula || "S/M",
            nombre: `${calif.alumnos?.nombre} ${calif.alumnos?.apellido}`,
            calificacion_final: evalJson.calificacion_total,
            retroalimentacion: evalJson.justificacion_texto
        });
    }

    const payloadSave = {
        action: 'guardar_calificacion_actividad', // Usa la nueva función dual
        calificaciones_spreadsheet_id: act.materias.calificaciones_spreadsheet_id,
        unidad: act.unidad,
        nombre_actividad: act.nombre,
        calificaciones: alumnosAGuardar
    };

    const resSave = await fetchWithRetry(Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadSave)
    });

    const rawSave = await resSave.text(); // FIX: Lectura única
    try {
        const jsonSave = JSON.parse(rawSave);
        if (jsonSave.status === 'error') throw new Error(jsonSave.message);
    } catch (e) { 
        throw new Error(`Error guardando Sheet: ${e instanceof Error ? e.message : String(e)}`); 
    }

    // 7. FINALIZAR
    await supabaseAdmin.from('calificaciones').update({
        calificacion_obtenida: evalJson.calificacion_total,
        estado: 'calificado',
        progreso_evaluacion: 'Completado'
    }).in('id', idsAActualizar);

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', updated_at: new Date() }).eq('id', jobId);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido en el proceso.";
    console.error(message, error);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});