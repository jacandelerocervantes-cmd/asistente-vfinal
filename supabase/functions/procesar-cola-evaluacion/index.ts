// supabase/functions/procesar-cola-evaluacion/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = { /* ... */ };

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: trabajo, error: trabajoError } = await supabaseAdmin.from('cola_de_trabajos').select(`*, calificaciones (*, actividades (*, materias (*)))`).eq('estado', 'pendiente').order('created_at', { ascending: true }).limit(1).single();

    if (trabajoError || !trabajo) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'procesando' }).eq('id', trabajo.id);

    try {
      const calificacion = trabajo.calificaciones;
      const actividad = calificacion.actividades;
      const materia = actividad.materias;
      
      const updateProgress = async (progreso: string) => {
        await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: progreso }).eq('id', calificacion.id);
      };

      await updateProgress("1 de 4: Obteniendo textos...");
      const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
      if (!appsScriptUrl) throw new Error("URL de Apps Script no configurada.");

      // Obtener texto de la rúbrica
      const rubricRes = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'get_rubric_text',
          spreadsheet_id: actividad.rubrica_spreadsheet_id,
          rubrica_sheet_range: actividad.rubrica_sheet_range
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const rubricJson = await rubricRes.json();
      if(rubricJson.status !== 'success') throw new Error(`Apps Script (get_rubric_text) falló: ${rubricJson.message}`);
      const texto_rubrica = rubricJson.texto_rubrica;
      
      // Obtener texto del trabajo
      const workRes = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calificacion.evidencia_drive_file_id }),
        headers: { 'Content-Type': 'application/json' },
      });
      const workJson = await workRes.json();
      if(workJson.status !== 'success') throw new Error(`Apps Script (get_student_work_text) falló: ${workJson.message}`);
      const texto_trabajo = workJson.texto_trabajo;

      await updateProgress("2 de 4: Calificando con IA...");
      const prompt = `
        Eres un asistente experto en evaluación académica. Tu tarea es calificar un trabajo de un estudiante basándote en una rúbrica específica.
        Proporciona una calificación numérica del 0 al 100 y una justificación detallada.

        **Rúbrica de Evaluación:**
        ${texto_rubrica}

        **Trabajo del Estudiante:**
        ${texto_trabajo}

        **Instrucciones de Salida:**
        Tu respuesta DEBE ser únicamente un objeto JSON válido con dos claves: "calificacion_total" (number) y "justificacion_texto" (string).
      `;
      const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
      const geminiResponse = await fetch(geminiUrl, { /* ... */ });
      if (!geminiResponse.ok) { /* ... */ }
      const geminiData = await geminiResponse.json();
      const { calificacion_total, justificacion_texto } = JSON.parse(geminiData.candidates[0].content.parts[0].text);
      
      await updateProgress("3 de 4: Creando copia con anotaciones...");
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

      await updateProgress("4 de 4: Guardando resultados...");
      const justificacionRes = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'write_justification',
          spreadsheet_id: materia.calificaciones_spreadsheet_id, // CORRECCIÓN: Usar el ID correcto de la hoja de calificaciones
          justificacion: justificacion_texto,
          alumno_id: calificacion.alumno_id || calificacion.grupo_id, // Usamos el ID disponible
          actividad_id: actividad.id,
          unidad: actividad.unidad
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const justificacionJson = await justificacionRes.json();
      if(justificacionJson.status !== 'success') throw new Error(`Apps Script (write_justification) falló: ${justificacionJson.message}`);
      const { justificacion_sheet_cell } = justificacionJson;

      await supabaseAdmin.from('calificaciones').update({ calificacion_obtenida: calificacion_total, justificacion_sheet_cell, estado: 'calificado', progreso_evaluacion: 'Completado' }).eq('id', calificacion.id);
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado' }).eq('id', trabajo.id);

    } catch (e) {
      const processError = e instanceof Error ? e.message : "Error desconocido durante el procesamiento.";
      await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error: ${processError}` }).eq('id', trabajo.calificaciones.id);
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: processError, intentos: (trabajo.intentos || 0) + 1 }).eq('id', trabajo.id);
      throw e;
    }

    return new Response(JSON.stringify({ message: `Trabajo ${trabajo.id} procesado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});