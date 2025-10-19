// supabase/functions/procesar-cola-evaluacion/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to safely extract JSON from a string
function extractJson(text: string): Record<string, any> | null {
    const match = text?.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch (_e) {
        return null;
    }
}

interface Actividad {
  id: number;
  rubrica_spreadsheet_id: string;
  rubrica_sheet_range: string;
  drive_folder_id_calificados: string;
  unidad: number;
  nombre: string;
  [key: string]: any;
}


interface Materia {
  drive_url: string;
  [key: string]: any;
}









interface Trabajo {
  id: number;
  user_id: string;
  calificaciones: Calificacion | null;
}

interface Calificacion {
  id: number;
  actividades: Actividad | null;
  alumno_id: number;
  [key: string]: any; // Allow other properties
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let trabajoId: number | null = null;

  let calificacionId: number | null = null;

  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    
    // Step 1: Fetch a pending job from the queue
    const { data: trabajo, error: trabajoError } = await supabaseAdmin 
      .from('cola_de_trabajos')
      .select(`id, user_id, calificaciones (*, actividades (*, materias (*)))`)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(1)
      .single<any>();

    if (trabajoError || !trabajo) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Store IDs for robust error handling
    trabajoId = trabajo.id;
    calificacionId = trabajo.calificaciones?.id ?? null;

    

    // Step 2: Mark the job as 'processing' to prevent other workers from picking it up
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'procesando' }).eq('id', trabajo.id);

    const { calificaciones: calificacion } = trabajo;


    if (!calificacion || !calificacion.actividades || !calificacion.actividades.materias) {
      throw new Error(`Datos anidados incompletos para el trabajo ID ${trabajo.id}. Faltan detalles de calificación, actividad o materia.`);

    }

    const { actividades: actividad } = calificacion;
    const { materias: materia } = actividad;

    
    const updateProgress = async (progreso: string) => {
      await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: progreso }).eq('id', calificacion.id);
    };


    // Step 3: Start the evaluation process
    await updateProgress("1/5: Obteniendo textos...");
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL")!;




    // Fetch rubric text
    const rubricRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_rubric_text', spreadsheet_id: actividad.rubrica_spreadsheet_id, rubrica_sheet_range: actividad.rubrica_sheet_range }), headers: { 'Content-Type': 'application/json' } });
    const rubricJson = await rubricRes.json();
    if (rubricJson.status !== 'success') throw new Error(`Apps Script (get_rubric_text) falló: ${rubricJson.message}`);
    
    // Fetch student's work text
    const workRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calificacion.evidencia_drive_file_id }), headers: { 'Content-Type': 'application/json' } });
    const workJson = await workRes.json();
    if (workJson.status !== 'success') throw new Error(`Apps Script (get_student_work_text) falló: ${workJson.message}`);

    // Step 4: Call Gemini for AI-powered grading
    await updateProgress("2/5: Calificando con IA...");    
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
   // Step 5: Save the justification text to Google Sheets
    await updateProgress("3/5: Guardando justificación...");
    const justificacionRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'write_justification', drive_url_materia: materia.drive_url, justificacion: justificacion_texto, alumno_id: calificacion.alumno_id || calificacion.grupo_id, actividad_id: actividad.id, unidad: actividad.unidad }), headers: { 'Content-Type': 'application/json' } });
    const justificacionJson = await justificacionRes.json();
    if(justificacionJson.status !== 'success') throw new Error(`Apps Script (write_justification) falló: ${justificacionJson.message}`);
    const { justificacion_sheet_cell } = justificacionJson;

    // Step 6: Create the annotated file in Google Drive
    await updateProgress("4/5: Creando copia con anotaciones...");
    await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'create_annotated_file', original_file_id: calificacion.evidencia_drive_file_id, calificacion_obtenida: calificacion_total, justificacion: justificacion_texto, carpeta_calificados_id: actividad.drive_folder_id_calificados }), headers: { 'Content-Type': 'application/json' } });

    // Step 7: Finalize and update Supabase records
    await updateProgress("5/5: Finalizando...");
    if (calificacion.grupo_id) {
        // If it's a group assignment, propagate the grade to all members
        const { data: miembros, error: errorMiembros } = await supabaseAdmin.from('alumnos_grupos').select('alumno_id').eq('grupo_id', calificacion.grupo_id);
        if (errorMiembros) throw new Error(`No se pudieron obtener los miembros del grupo: ${errorMiembros.message}`);

        const calificacionesAlumnos = miembros.map((miembro) => ({
            actividad_id: calificacion.actividad_id,
            alumno_id: miembro.alumno_id,
            user_id: trabajo.user_id,
            calificacion_obtenida: calificacion_total,
            justificacion_sheet_cell: justificacion_sheet_cell,
            estado: 'calificado',
            progreso_evaluacion: 'Completado (Grupal)',
            evidencia_drive_file_id: calificacion.evidencia_drive_file_id
        }));

        if (calificacionesAlumnos.length > 0) {
            const { error: upsertError } = await supabaseAdmin.from('calificaciones').upsert(calificacionesAlumnos, { onConflict: 'actividad_id, alumno_id' });
            if (upsertError) throw new Error(`Error al propagar calificaciones: ${upsertError.message}`);
        }
    } else {
        // If it's an individual assignment, update the single record
        await supabaseAdmin.from('calificaciones').update({ calificacion_obtenida: calificacion_total, justificacion_sheet_cell: justificacion_sheet_cell, estado: 'calificado', progreso_evaluacion: 'Completado' }).eq('id', calificacion.id);
    }

    // Mark the job as completed
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado' }).eq('id', trabajo.id);
    
    return new Response(JSON.stringify({ message: `Trabajo ${trabajo.id} procesado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const processError = error instanceof Error ? error.message : "Error desconocido.";    

    // If an error occurs, update the status to 'failed' for both the job and the grade
    if (calificacionId) {
      await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error: ${processError}` }).eq('id', calificacionId);
    }
    if (trabajoId) {
      await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: processError }).eq('id', trabajoId);
    }
    
    return new Response(JSON.stringify({ message: processError }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
  }
});