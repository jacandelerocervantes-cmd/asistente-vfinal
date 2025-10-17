// supabase/functions/procesar-cola-evaluacion/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { /* ... (igual que antes) ... */ };

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization')!;
    if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`) throw new Error('Llamada no autorizada.');

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Buscar un trabajo pendiente
    const { data: trabajo, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`*, calificaciones(*, actividades(*, materias(*)))`)
      .eq('estado', 'pendiente')
      .limit(1)
      .single();

    if (trabajoError || !trabajo) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Marcar como "procesando"
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'procesando' }).eq('id', trabajo.id);

    try {
      const calificacion = trabajo.calificaciones;
      const actividad = calificacion.actividades;
      const materia = actividad.materias;
      
      // 3. Orquestar llamadas a Apps Script
      const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL")!;
      
      // a. Obtener texto de la rúbrica
      const rubricRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_rubric_text', spreadsheet_id: materia.spreadsheet_id, rubrica_sheet_range: actividad.rubrica_sheet_range }) });
      const { texto_rubrica } = (await rubricRes.json()).data;
      
      // b. Obtener texto del trabajo
      const workRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calificacion.evidencia_drive_file_id }) });
      const { texto_trabajo } = (await workRes.json()).data;

      // 4. Llamar a Gemini
      const prompt = `Evalúa el siguiente trabajo de un alumno basándote en la rúbrica proporcionada. Asigna un puntaje a cada criterio y redacta una justificación general constructiva. Devuelve un JSON con "calificacion_total" (un número) y "justificacion_texto".\n\nRÚBRICA:\n${texto_rubrica}\n\nTRABAJO DEL ALUMNO:\n${texto_trabajo}`;
      
      const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
      const geminiResponse = await fetch(geminiUrl, { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } }) });
      const geminiData = await geminiResponse.json();
      const { calificacion_total, justificacion_texto } = JSON.parse(geminiData.candidates[0].content.parts[0].text);
      
      // 5. Guardar la justificación en Sheets
      const justificacionRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'write_justification', spreadsheet_id: materia.spreadsheet_id, sheet_name: `Calificaciones_U${actividad.unidad}`, justificacion: justificacion_texto, alumno_id: calificacion.alumno_id, actividad_id: actividad.id }) });
      const { justificacion_sheet_cell } = (await justificacionRes.json()).data;

      // 6. Guardar la calificación en Supabase
      await supabaseAdmin
        .from('calificaciones')
        .update({ calificacion_obtenida: calificacion_total, justificacion_sheet_cell })
        .eq('id', calificacion.id);

      // 7. Marcar el trabajo como "completado"
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado' }).eq('id', trabajo.id);

    } catch (e) {
      // Si algo falla, marcar el trabajo como "fallido"
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: e.message, intentos: trabajo.intentos + 1 }).eq('id', trabajo.id);
    }

    return new Response(JSON.stringify({ message: `Trabajo ${trabajo.id} procesado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});