// supabase/functions/procesar-cola-evaluacion/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!, 
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: trabajo, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`*, calificaciones (*, actividades (*, materias (*)))`)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (trabajoError || !trabajo) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'procesando' }).eq('id', trabajo.id);

    try {
      const calificacion = trabajo.calificaciones;
      const actividad = calificacion.actividades;
      const materia = actividad.materias;
      
      const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
      if (!appsScriptUrl) throw new Error("URL de Apps Script no configurada.");

      const rubricRes = await fetch(appsScriptUrl, { 
        method: 'POST', 
        body: JSON.stringify({ 
          action: 'get_rubric_text', 
          spreadsheet_id: actividad.rubrica_spreadsheet_id, 
          rubrica_sheet_range: actividad.rubrica_sheet_range 
        }) 
      });
      const rubricJson = await rubricRes.json();
      if(rubricJson.status !== 'success') throw new Error(`Apps Script (get_rubric_text) falló: ${rubricJson.message}`);
      const { texto_rubrica } = rubricJson;
      
      const workRes = await fetch(appsScriptUrl, { 
        method: 'POST', 
        body: JSON.stringify({ 
          action: 'get_student_work_text', 
          drive_file_id: calificacion.evidencia_drive_file_id 
        }) 
      });
      const workJson = await workRes.json();
      if(workJson.status !== 'success') throw new Error(`Apps Script (get_student_work_text) falló: ${workJson.message}`);
      const { texto_trabajo } = workJson;

      const prompt = `Evalúa el siguiente trabajo de un alumno basándote en la rúbrica proporcionada. Asigna un puntaje a cada criterio y redacta una justificación general constructiva. Tu respuesta DEBE ser únicamente un objeto JSON con las claves "calificacion_total" (un número entero de 0 a 100) y "justificacion_texto" (un string con tu análisis).\n\nRÚBRICA:\n${texto_rubrica}\n\nTRABAJO DEL ALUMNO:\n${texto_trabajo}`;
      
      const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
       const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
      
      const geminiResponse = await fetch(geminiUrl, { 
        method: 'POST', 
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }], 
          generationConfig: { response_mime_type: "application/json" } 
        }) 
      });
      
      if (!geminiResponse.ok) {
        const errorData = await geminiResponse.text();
        throw new Error(`Error en la respuesta de Gemini: ${errorData}`);
      }
      const geminiData = await geminiResponse.json();
      const { calificacion_total, justificacion_texto } = JSON.parse(geminiData.candidates[0].content.parts[0].text);
      
      // --- ¡LÓGICA AÑADIDA! ---
      // 1. Crear el archivo duplicado con comentarios
      await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_annotated_file',
          original_file_id: calificacion.evidencia_drive_file_id,
          calificacion_obtenida: calificacion_total,
          justificacion: justificacion_texto,
          carpeta_calificados_id: actividad.drive_folder_id_calificados
        })
      });

      // 2. Guardar la justificación en la hoja de la unidad correcta
      const justificacionRes = await fetch(appsScriptUrl, { 
        method: 'POST', 
        body: JSON.stringify({ 
          action: 'write_justification', 
          spreadsheet_id: materia.spreadsheet_id, // Se usa el ID del spreadsheet de la materia
          justificacion: justificacion_texto, 
          alumno_id: calificacion.alumno_id || calificacion.grupo_id, // Identificador único
          actividad_id: actividad.id,
          unidad: actividad.unidad // <-- Se pasa la unidad
        }) 
      });
      const justificacionJson = await justificacionRes.json();
      if(justificacionJson.status !== 'success') throw new Error(`Apps Script (write_justification) falló: ${justificacionJson.message}`);
      const { justificacion_sheet_cell } = justificacionJson;

      // 3. Actualizar la calificación en Supabase
      await supabaseAdmin.from('calificaciones').update({ calificacion_obtenida: calificacion_total, justificacion_sheet_cell, estado: 'calificado' }).eq('id', calificacion.id);
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado' }).eq('id', trabajo.id);

    } catch (e) {
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: e.message, intentos: (trabajo.intentos || 0) + 1 }).eq('id', trabajo.id);
      throw e;
    }

    return new Response(JSON.stringify({ message: `Trabajo ${trabajo.id} procesado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});