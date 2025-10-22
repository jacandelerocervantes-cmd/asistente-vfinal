// supabase/functions/procesar-cola-obtener-textos/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Interfaces (puedes moverlas a un archivo _shared si las usas en varias funciones)
interface Materia {
    id: number;
    rubricas_spreadsheet_id: string; // Cambiado desde rubrica_spreadsheet_id
}
interface Actividad {
    id: number;
    rubrica_sheet_range: string;
    materias: Materia | null;
}
interface Calificacion {
    id: number;
    evidencia_drive_file_id: string;
    actividades: Actividad | null;
}
interface TrabajoCola {
    id: number;
    calificacion_id: number; // Asumiendo que ahora guardas solo el ID aquí
    // Carga la calificación relacionada con sus detalles anidados
    calificaciones: Calificacion | null; // Cambiado a objeto único si la relación es uno a uno
}


serve(async (_req: Request) => {
  // Asegurarse de que sea una solicitud GET o POST (ej. desde cron)
  if (_req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let trabajoId: number | null = null;
  let calificacionId: number | null = null;

  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Buscar UN trabajo pendiente
    const { data: trabajoData, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`id, calificacion_id, calificaciones (*, actividades (*, materias (*)))`)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(); // Usar maybeSingle para manejar el caso de 0 filas sin error

    if (trabajoError) throw new Error(`Error al buscar trabajo pendiente: ${trabajoError.message}`);
    if (!trabajoData) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes para obtener textos." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const trabajo = trabajoData as unknown as TrabajoCola;
    trabajoId = trabajo.id;

    // --- Validación robusta de datos relacionados ---
    const calificacion = trabajo.calificaciones;
    if (!calificacion || typeof calificacion !== 'object') {
      throw new Error(`El trabajo ID ${trabajo.id} no tiene una calificación asociada válida.`);
    }
    calificacionId = calificacion.id;

    const actividad = calificacion.actividades;
    if (!actividad || typeof actividad !== 'object') {
      throw new Error(`La calificación ID ${calificacion.id} no tiene una actividad asociada válida.`);
    }

    const materia = actividad.materias;
    // ¡Ajuste importante! Usar rubricas_spreadsheet_id que viene de la tabla materias
    if (!materia || typeof materia !== 'object' || !materia.rubricas_spreadsheet_id || !actividad.rubrica_sheet_range || !calificacion.evidencia_drive_file_id) {
        throw new Error(`Faltan datos críticos (materia, IDs de sheets/drive, o rango) para la Actividad ID ${actividad.id}.`);
    }
    // --- Fin de la validación ---


    // 2. Marcar como 'obteniendo_textos' en ambas tablas
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'obteniendo_textos' }).eq('id', trabajo.id);
    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '1/4: Obteniendo textos...' }).eq('id', calificacionId);

    // 3. Llamar a Google Apps Script
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    // Obtener texto de la rúbrica
    const rubricRes = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'get_rubric_text',
        // Usar el ID de la hoja maestra de rúbricas de la materia
        spreadsheet_id: materia.rubricas_spreadsheet_id,
        rubrica_sheet_range: actividad.rubrica_sheet_range
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    if (!rubricRes.ok) throw new Error(`Error de red al obtener rúbrica: ${rubricRes.statusText} - ${await rubricRes.text()}`);
    const rubricJson = await rubricRes.json();
    if (rubricJson.status !== 'success') throw new Error(`Apps Script (get_rubric_text) falló: ${rubricJson.message}`);
    const textoRubrica = rubricJson.texto_rubrica; // Asumiendo que Apps Script devuelve { status: 'success', texto_rubrica: '...' }

    // Obtener texto del trabajo
    const workRes = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'get_student_work_text',
        drive_file_id: calificacion.evidencia_drive_file_id
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    if (!workRes.ok) throw new Error(`Error de red al obtener trabajo: ${workRes.statusText} - ${await workRes.text()}`);
    const workJson = await workRes.json();
    if (workJson.status !== 'success') throw new Error(`Apps Script (get_student_work_text) falló: ${workJson.message}`);
    const textoTrabajo = workJson.texto_trabajo; // Asumiendo que Apps Script devuelve { status: 'success', texto_trabajo: '...' }

    // 4. Guardar textos en 'calificaciones'
    const { error: updateTextsError } = await supabaseAdmin
      .from('calificaciones')
      .update({ texto_rubrica: textoRubrica, texto_trabajo: textoTrabajo })
      .eq('id', calificacionId);
    if (updateTextsError) throw new Error(`Error al guardar textos en calificación ${calificacionId}: ${updateTextsError.message}`);

    // 5. Marcar como 'listo_para_ia'
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'listo_para_ia' }).eq('id', trabajo.id);
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: 'Textos obtenidos, listo para IA' }).eq('id', calificacionId); // Actualizar progreso

    console.log(`Textos obtenidos y guardados para trabajo ID ${trabajoId}, calificación ID ${calificacionId}.`);
    return new Response(JSON.stringify({ message: `Textos obtenidos para trabajo ${trabajoId}.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    console.error(`Error procesando textos para trabajo ID ${trabajoId} (Calificación ID: ${calificacionId}): ${errorMessage}`);
    // Marcar como fallido si tenemos los IDs
    if (trabajoId) {
        const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      try {
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido_textos', ultimo_error: errorMessage }).eq('id', trabajoId);
        if (calificacionId) {
          await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error obteniendo textos: ${errorMessage.substring(0, 100)}...` }).eq('id', calificacionId);
        }
      } catch (dbError) {
        console.error(`Error adicional al marcar como fallido (obtener textos): ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }
    return new Response(JSON.stringify({ message: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});