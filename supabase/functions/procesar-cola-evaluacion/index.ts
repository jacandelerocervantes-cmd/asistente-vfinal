import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

// Helper para pausas (evita saturar APIs)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch Robusto (Tipado corregido para options)
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) { // Too Many Requests
        console.log(`⚠️ Rate Limit (429). Esperando ${3 * (i + 1)}s...`);
        await wait(3000 * (i + 1));
        continue;
      }
      if (res.status >= 500) {
        throw new Error(`Server Error ${res.status}`);
      }
      return res; 
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`Reintentando fetch... (${i + 1}/${retries})`);
      await wait(1500);
    }
  }
  throw new Error("Fallo de conexión tras varios intentos.");
};

// Interfaz para el objeto de alumno a guardar
interface AlumnoGuardar {
  matricula: string;
  nombre: string;
  calificacion_final: number;
  retroalimentacion: string;
}

// Interfaz para el objeto complejo de calificaciones que viene de la BD
interface CalificacionConDetalles {
  id: number;
  evidencia_drive_file_id: string;
  grupo_id: number | null;
  actividades: {
    id: number;
    nombre: string;
    unidad: number;
    rubrica_sheet_range: string;
    rubrica_spreadsheet_id: string;
    tipo_entrega: 'individual' | 'grupal' | 'mixta';
    materias: {
      calificaciones_spreadsheet_id: string;
    };
  };
  alumnos: {
    matricula: string;
    nombre: string;
    apellido: string;
  } | null;
  // No necesitamos grupos aquí, pero podría añadirse
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let jobIdRef = null;
  let califIdRef = null;

  try {
    // 1. OBTENER TRABAJO (Lock)
    const { data: jobData, error: rpcError } = await supabaseAdmin.rpc('obtener_siguiente_trabajo_evaluacion');
    if (rpcError) throw new Error(`RPC Error: ${rpcError.message}`);
    if (!jobData || jobData.length === 0) {
      return new Response(JSON.stringify({ message: "Sin trabajos pendientes" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const jobId = jobData[0].job_id;
    jobIdRef = jobId;
    console.log(`>>> PROCESANDO JOB: ${jobId} <<<`);

    // 2. LEER DATOS DE LA BASE DE DATOS
    const { data: item, error: dbError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`*, calificaciones (id, actividad_id, alumno_id, grupo_id, evidencia_drive_file_id, actividades (id, nombre, unidad, rubrica_sheet_range, rubrica_spreadsheet_id, tipo_entrega, materias (calificaciones_spreadsheet_id)), alumnos (matricula, nombre, apellido), grupos (nombre))`)
      .eq('id', jobId).single();

    if (dbError || !item) throw new Error("No se encontró el registro en la cola/calificaciones.");

    const calif = item.calificaciones as CalificacionConDetalles;
    
    califIdRef = calif.id;
    const act = calif.actividades;

    // Actualizar estado visual
    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '1/4: Extrayendo texto...' }).eq('id', calif.id);

    // 3. OBTENER TEXTO (Google Apps Script)
    await wait(1000); // Pausa inicial
    const scriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!;

    const resText = await fetchWithRetry(scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calif.evidencia_drive_file_id })
    });

    const rawTextBody = await resText.text(); // LEER UNA VEZ
    let jsonText;
    try { jsonText = JSON.parse(rawTextBody); } catch { throw new Error(`Error parseando texto alumno: ${rawTextBody.substring(0,100)}`); }

    if (jsonText.requiere_revision_manual) {
       await supabaseAdmin.from('calificaciones').update({ estado: 'requiere_revision_manual', progreso_evaluacion: 'Formato complejo (Imagen/Manuscrito)' }).eq('id', calif.id);
       await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', ultimo_error: 'Manual requerido' }).eq('id', jobId);
       return new Response(JSON.stringify({ ok: true, manual: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const textoAlumno = jsonText.texto_trabajo || "";
    if (textoAlumno.length < 10) throw new Error("Archivo vacío o sin texto legible.");

    // 4. OBTENER RÚBRICA
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '2/4: Leyendo rúbrica...' }).eq('id', calif.id);
    const resRubrica = await fetchWithRetry(scriptUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_rubric_text', spreadsheet_id: act.rubrica_spreadsheet_id, rubrica_sheet_range: act.rubrica_sheet_range })
    });
    const jsonRubrica = await resRubrica.json();

    // 5. EVALUACIÓN CON IA (MEJORADA)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '3/4: IA Analizando...' }).eq('id', calif.id);
    await wait(2000); // Throttle para Gemini

    const prompt = `
      Actúa como un profesor universitario experto y estricto.
      
      TAREA: Evaluar el siguiente trabajo del alumno basándote ÚNICAMENTE en la rúbrica provista.
      
      RÚBRICA DE EVALUACIÓN:
      ${jsonRubrica.texto_rubrica}

      TRABAJO DEL ALUMNO:
      "${textoAlumno.substring(0, 18000)}"

      INSTRUCCIONES:
      1. Analiza críticamente si cumple cada punto de la rúbrica.
      2. Sé justo pero riguroso. Si falta algo, penalízalo.
      3. Genera una retroalimentación constructiva en 2da persona ("Tú...").
      
      SALIDA (JSON ÚNICAMENTE):
      {
        "calificacion_total": (Número entero 0-100),
        "justificacion_texto": "Breve resumen de fortalezas y debilidades específicas encontradas."
      }
    `;

    const resGemini = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const geminiData = await resGemini.json();
    const aiContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiContent) throw new Error("Gemini devolvió respuesta vacía.");

    let evalJson;
    try {
        evalJson = JSON.parse(aiContent.replace(/```json|```/g, '').trim());
    } catch {
        throw new Error(`Error parseando JSON de IA: ${aiContent}`);
    }

    // 6. GUARDAR EN SHEETS (Dual: Kardex + Reporte Individual)
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '4/4: Guardando resultados...' }).eq('id', calif.id);

    // Corrección del Error de Tipado: Definimos explícitamente el tipo del array
    let alumnosAGuardar: AlumnoGuardar[] = [];
    let idsBDUpdate = [calif.id];

    if (calif.grupo_id && ['grupal', 'mixta'].includes(act.tipo_entrega)) {
        const { data: miembros } = await supabaseAdmin
            .from('alumnos_grupos')
            .select('alumnos(matricula, nombre, apellido)')
            .eq('grupo_id', calif.grupo_id);
        
        const { data: compas } = await supabaseAdmin.from('calificaciones').select('id').eq('actividad_id', act.id).eq('grupo_id', calif.grupo_id);
        if (compas) idsBDUpdate = compas.map(c => c.id);

        if (miembros && miembros.length > 0) {
            // Usamos el tipo inferido por Supabase para el mapeo
            alumnosAGuardar = miembros.map((m) => {
                // FIX: La relación 'alumnos' viene como un array, accedemos al primer elemento.
                const alumnoData = m.alumnos[0];
                return {
                    matricula: alumnoData?.matricula || "S/M",
                    nombre: `${alumnoData?.nombre} ${alumnoData?.apellido}`,
                    calificacion_final: evalJson.calificacion_total,
                    retroalimentacion: evalJson.justificacion_texto
                };
            });
        }
    } else {
        // Individual
        const al = calif.alumnos;
        alumnosAGuardar.push({
            matricula: al?.matricula || "S/M",
            nombre: `${al?.nombre} ${al?.apellido}`,
            calificacion_final: evalJson.calificacion_total,
            retroalimentacion: evalJson.justificacion_texto
        });
    }

    const payloadSave = {
        action: 'guardar_calificacion_actividad', 
        calificaciones_spreadsheet_id: act.materias.calificaciones_spreadsheet_id,
        unidad: act.unidad,
        nombre_actividad: act.nombre,
        calificaciones: alumnosAGuardar
    };

    const resSave = await fetchWithRetry(scriptUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadSave)
    });

    const rawSaveBody = await resSave.text();
    try {
        const jsonSave = JSON.parse(rawSaveBody);
        if (jsonSave.status === 'error') throw new Error(jsonSave.message);
    } catch (e) { 
        // Corrección error catch 'unknown'
        const errorMsg = e instanceof Error ? e.message : String(e);
        throw new Error(`Error guardando en Sheets: ${errorMsg || rawSaveBody}`); 
    }

    // 7. FINALIZAR
    await supabaseAdmin.from('calificaciones').update({
        calificacion_obtenida: evalJson.calificacion_total,
        estado: 'calificado',
        progreso_evaluacion: 'Completado',
        justificacion_sheet_cell: 'Ver Reporte'
    }).in('id', idsBDUpdate);

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', updated_at: new Date() }).eq('id', jobId);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    // Corrección error catch 'unknown' en bloque principal
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error fatal en Edge Function:", msg);
    
    if (califIdRef) await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error: ${msg.substring(0,30)}...` }).eq('id', califIdRef);
    if (jobIdRef) await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: msg }).eq('id', jobIdRef);

    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});