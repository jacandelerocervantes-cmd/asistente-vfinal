// supabase/functions/procesar-cola-evaluacion/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Función auxiliar para extraer JSON de forma segura de una cadena de texto
function extractJson(text: string): Record<string, any> | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch (_e) {
        return null;
    }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let trabajoId: number | null = null;
  let calificacionId: number | null = null;

  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    
    const { data: trabajo, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`id, user_id, calificaciones (*, actividades (*, materias (*)))`)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (trabajoError || !trabajo) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    trabajoId = trabajo.id;
    calificacionId = trabajo.calificaciones?.id ?? null;

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'procesando' }).eq('id', trabajo.id);

    const { calificaciones: calificacion } = trabajo;
    if (!calificacion || !calificacion.actividades || !calificacion.actividades.materias) {
      throw new Error(`Datos anidados incompletos para el trabajo ID ${trabajo.id}.`);
    }
    const { actividades: actividad } = calificacion;
    const { materias: materia } = actividad;
    
    const updateProgress = async (progreso: string) => {
      if (calificacionId) {
        await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: progreso }).eq('id', calificacionId);
      }
    };

    await updateProgress("1/4: Obteniendo textos...");
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL")!;

    const rubricRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_rubric_text', spreadsheet_id: actividad.rubrica_spreadsheet_id, rubrica_sheet_range: actividad.rubrica_sheet_range }), headers: { 'Content-Type': 'application/json' } });
    const rubricJson = await rubricRes.json();
    if (rubricJson.status !== 'success') throw new Error(`Apps Script (get_rubric_text) falló: ${rubricJson.message}`);
    
    const workRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calificacion.evidencia_drive_file_id }), headers: { 'Content-Type': 'application/json' } });
    const workJson = await workRes.json();
    if (workJson.status !== 'success') throw new Error(`Apps Script (get_student_work_text) falló: ${workJson.message}`);

    await updateProgress("2/4: Calificando con IA...");
    const prompt = `Evalúa el trabajo basándote en la rúbrica. Tu respuesta DEBE ser únicamente un objeto JSON con las claves "calificacion_total" (number) y "justificacion_texto" (string).\n\nRúbrica:\n${rubricJson.texto_rubrica}\n\nTrabajo:\n${workJson.texto_trabajo}`;
    
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    const geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } }) });
    
    if (!geminiResponse.ok) throw new Error(`Error en la API de Gemini: ${(await geminiResponse.json()).error.message}`);
    
    const geminiData = await geminiResponse.json();
    const geminiText = geminiData.candidates[0].content.parts[0].text;
    
    const parsedJson = extractJson(geminiText);
    if (!parsedJson || typeof parsedJson.calificacion_total !== 'number' || typeof parsedJson.justificacion_texto !== 'string') {
        throw new Error(`La respuesta de la IA no fue un JSON válido o le faltan claves. Respuesta: ${geminiText}`);
    }
    const { calificacion_total, justificacion_texto } = parsedJson;

    await updateProgress("3/4: Generando reportes de calificación...");
    
    let calificacionesParaReporte = [];

    if (calificacion.grupo_id) {
      const { data: miembros, error: errorMiembros } = await supabaseAdmin.from('alumnos_grupos').select('alumnos(matricula, nombre, apellido), grupos(nombre)').eq('grupo_id', calificacion.grupo_id);
      if (errorMiembros) throw errorMiembros;

      calificacionesParaReporte = miembros.map((m: any) => ({
        matricula: m.alumnos.matricula,
        nombre: `${m.alumnos.nombre} ${m.alumnos.apellido}`,
        equipo: m.grupos.nombre,
        calificacion: calificacion_total,
        retroalimentacion: justificacion_texto
      }));
    } else {
      const { data: alumno, error: errorAlumno } = await supabaseAdmin.from('alumnos').select('matricula, nombre, apellido').eq('id', calificacion.alumno_id).single();
      if (errorAlumno) throw errorAlumno;

      calificacionesParaReporte.push({
        matricula: alumno.matricula,
        nombre: `${alumno.nombre} ${alumno.apellido}`,
        equipo: '',
        calificacion: calificacion_total,
        retroalimentacion: justificacion_texto
      });
    }

    const reportePayload = {
      action: 'guardar_calificacion_detallada',
      drive_url_materia: materia.drive_url,
      unidad: actividad.unidad,
      actividad: { nombre: actividad.nombre, id: actividad.id },
      calificaciones: calificacionesParaReporte
    };
    
    const reporteRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify(reportePayload), headers: { 'Content-Type': 'application/json' } });
    if (!reporteRes.ok) throw new Error(`Apps Script (guardar_calificacion_detallada) falló: ${await reporteRes.text()}`);
    
    await updateProgress("4/4: Finalizando...");
    
    await supabaseAdmin.from('calificaciones').update({ calificacion_obtenida: calificacion_total, estado: 'calificado', progreso_evaluacion: 'Completado' }).eq('id', calificacion.id);

    if (calificacion.grupo_id) {
        const { data: miembros, error: errorMiembros } = await supabaseAdmin.from('alumnos_grupos').select('alumno_id').eq('grupo_id', calificacion.grupo_id);
        if (errorMiembros) throw new Error(`No se pudieron obtener los miembros del grupo: ${errorMiembros.message}`);

        const calificacionesAlumnos = miembros.map((miembro: { alumno_id: number }) => ({
            actividad_id: calificacion.actividad_id,
            alumno_id: miembro.alumno_id,
            user_id: trabajo.user_id,
            calificacion_obtenida: calificacion_total,
            estado: 'calificado',
            progreso_evaluacion: 'Completado (Grupal)',
        }));

        if (calificacionesAlumnos.length > 0) {
            const { error: upsertError } = await supabaseAdmin.from('calificaciones').upsert(calificacionesAlumnos, { onConflict: 'actividad_id, alumno_id' });
            if (upsertError) throw new Error(`Error al propagar calificaciones: ${upsertError.message}`);
        }
    }

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado' }).eq('id', trabajo.id);
    
    return new Response(JSON.stringify({ message: `Trabajo ${trabajo.id} procesado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const processError = error instanceof Error ? error.message : "Error desconocido.";
    
    if (calificacionId) {
      await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error: ${processError}` }).eq('id', calificacionId);
    }
    if (trabajoId) {
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: processError }).eq('id', trabajoId);
    }
    
    return new Response(JSON.stringify({ message: processError }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
  }
});