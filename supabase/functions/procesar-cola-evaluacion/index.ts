// supabase/functions/procesar-cola-evaluacion/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Interfaces (Asegúrate que coincidan con tu estructura) ---
interface Materia {
    id: number;
    rubricas_spreadsheet_id: string | null; // Hacer nullables si pueden ser null
}
interface Actividad {
    id: number;
    rubrica_sheet_range: string | null; // Hacer nullables si pueden ser null
    materias: Materia | null;
}
interface Calificacion {
    id: number;
    evidencia_drive_file_id: string | null; // Hacer nullables si pueden ser null
    actividades: Actividad | null;
}
interface TrabajoCola {
    id: number;
    calificacion_id: number;
    calificaciones: Calificacion | null;
}
// --- Fin Interfaces ---

serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let trabajoId: number | null = null;
  let calificacionId: number | null = null;
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!); // Mover cliente aquí para usar en catch

  try {
    // 1. Buscar UN trabajo pendiente
    const { data: trabajoData, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`id, calificacion_id, calificaciones (*, actividades (*, materias (*)))`)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (trabajoError) throw new Error(`Error al buscar trabajo pendiente: ${trabajoError.message}`);
    if (!trabajoData) {
      console.log("No hay trabajos pendientes para obtener textos."); // Log informativo
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes para obtener textos." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const trabajo = trabajoData as unknown as TrabajoCola;
    trabajoId = trabajo.id;
    console.log(`Procesando trabajo ID: ${trabajoId}`); // Log

    // --- Validación robusta ---
    const calificacion = trabajo.calificaciones;
    if (!calificacion || typeof calificacion !== 'object') {
      throw new Error(`Trabajo ID ${trabajo.id} no tiene calificación asociada válida.`);
    }
    calificacionId = calificacion.id;
    console.log(`Calificación ID: ${calificacionId}`); // Log

    const actividad = calificacion.actividades;
    if (!actividad || typeof actividad !== 'object') {
      throw new Error(`Calificación ID ${calificacion.id} no tiene actividad asociada válida.`);
    }
    console.log(`Actividad ID: ${actividad.id}`); // Log

    const materia = actividad.materias;
    // Validar existencia de IDs/rangos necesarios
    if (!materia || typeof materia !== 'object' || !materia.rubricas_spreadsheet_id || !actividad.rubrica_sheet_range || !calificacion.evidencia_drive_file_id) {
        // Log detallado del problema
        console.error("Datos faltantes:", {
            materia_existe: !!materia,
            rubricas_spreadsheet_id: materia?.rubricas_spreadsheet_id,
            rubrica_sheet_range: actividad?.rubrica_sheet_range,
            evidencia_drive_file_id: calificacion?.evidencia_drive_file_id
        });
        throw new Error(`Faltan datos críticos (materia, IDs de sheets/drive, o rango) para la Actividad ID ${actividad.id}.`);
    }
    // --- Fin Validación ---

    // 2. Marcar como 'obteniendo_textos'
    console.log(`Marcando trabajo ${trabajoId} como 'obteniendo_textos'`); // Log
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'obteniendo_textos' }).eq('id', trabajo.id);
    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '1/4: Obteniendo textos...' }).eq('id', calificacionId);

    // 3. Llamar a Google Apps Script
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");
    console.log("Llamando a Apps Script para obtener textos..."); // Log

    // Obtener texto de la rúbrica
    console.log(`Obteniendo rúbrica: SheetID=${materia.rubricas_spreadsheet_id}, Range=${actividad.rubrica_sheet_range}`); // Log
    const rubricRes = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'get_rubric_text',
        spreadsheet_id: materia.rubricas_spreadsheet_id,
        rubrica_sheet_range: actividad.rubrica_sheet_range
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`Respuesta Rúbrica: ${rubricRes.status}`); // Log
    if (!rubricRes.ok) throw new Error(`Error de red al obtener rúbrica: ${rubricRes.statusText} - ${await rubricRes.text()}`);
    const rubricJson = await rubricRes.json();
    if (rubricJson.status !== 'success') throw new Error(`Apps Script (get_rubric_text) falló: ${rubricJson.message}`);
    const textoRubrica = rubricJson.texto_rubrica;
    console.log("Texto de rúbrica obtenido."); // Log

    // Obtener texto del trabajo
    console.log(`Obteniendo trabajo: FileID=${calificacion.evidencia_drive_file_id}`); // Log
    const workRes = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'get_student_work_text',
        drive_file_id: calificacion.evidencia_drive_file_id
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`Respuesta Trabajo: ${workRes.status}`); // Log
    if (!workRes.ok) throw new Error(`Error de red al obtener trabajo: ${workRes.statusText} - ${await workRes.text()}`);
    const workJson = await workRes.json();
    if (workJson.status !== 'success') throw new Error(`Apps Script (get_student_work_text) falló: ${workJson.message}`);
    const textoTrabajo = workJson.texto_trabajo;
    console.log("Texto de trabajo obtenido."); // Log

    // 4. Guardar textos en 'calificaciones' - ¡AQUÍ ESTÁ LA LÍNEA DEL ERROR!
    console.log(`Guardando textos en calificación ID: ${calificacionId}`); // Log
    const { error: updateTextsError } = await supabaseAdmin
      .from('calificaciones')
      .update({ texto_rubrica: textoRubrica, texto_trabajo: textoTrabajo }) // Intenta escribir en las columnas
      .eq('id', calificacionId);

    // Si hubo error al guardar, lanzarlo para que lo capture el catch
    if (updateTextsError) {
        console.error("Error al actualizar textos:", updateTextsError); // Log detallado del error de DB
        // El mensaje de error específico que viste ("Could not find...") viene de aquí
        throw new Error(`Error al guardar textos en calificación ${calificacionId}: ${updateTextsError.message}`);
    }
    console.log("Textos guardados en Supabase."); // Log

    // 5. Marcar como 'listo_para_ia'
    console.log(`Marcando trabajo ${trabajoId} como 'listo_para_ia'`); // Log
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'listo_para_ia' }).eq('id', trabajo.id);
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: 'Textos obtenidos, listo para IA' }).eq('id', calificacionId);

    // --- ¡CORRECCIÓN CLAVE! ---
    // Invocar la siguiente función en la cadena para que el proceso no se detenga.
    await supabaseAdmin.functions.invoke('procesar-cola-llamar-ia');

    console.log(`Textos obtenidos y guardados para trabajo ID ${trabajoId}, calificación ID ${calificacionId}.`);
    return new Response(JSON.stringify({ message: `Textos obtenidos para trabajo ${trabajoId}.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    console.error(`Error procesando textos para trabajo ID ${trabajoId} (Calificación ID: ${calificacionId}): ${errorMessage}`); // Log del error final
    // Marcar como fallido
    if (trabajoId) {
      try {
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido_textos', ultimo_error: errorMessage }).eq('id', trabajoId);
        if (calificacionId) {
          await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error obteniendo textos: ${errorMessage.substring(0, 100)}...` }).eq('id', calificacionId);
        }
        console.log(`Trabajo ${trabajoId} marcado como 'fallido_textos'`); // Log
      } catch (dbError) {
        console.error(`Error adicional al marcar como fallido (obtener textos): ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }
    // Devolver el error 500
    return new Response(JSON.stringify({ message: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
  });