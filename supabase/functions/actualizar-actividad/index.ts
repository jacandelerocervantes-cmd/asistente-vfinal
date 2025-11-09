// supabase/functions/actualizar-actividad/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Criterio {
  descripcion: string;
  puntos: number;
}

interface ActividadUpdateRequest {
  actividad_id: number;
  materia_id: number;
  nombre_actividad: string;
  unidad: number | null;
  tipo_entrega: string;
  criterios: Criterio[];
  descripcion: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
      actividad_id,
      materia_id: _materia_id, // Recibido del cliente pero no usado directamente en la lógica.
      nombre_actividad, 
      unidad, 
      tipo_entrega,
      criterios,
      descripcion
    }: ActividadUpdateRequest = await req.json();

    if (!actividad_id) {
        throw new Error("Se requiere el ID de la actividad para actualizarla.");
    }

    const authHeader = req.headers.get("Authorization")!;
    
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    // 1. Obtener datos de la materia Y el rango de la rúbrica ANTIGUA
    const { data: actividadPrevia, error: fetchError } = await supabase
      .from('actividades')
      .select(`
        rubrica_sheet_range,
        materias (
          rubricas_spreadsheet_id
        )
      `)
      .eq('id', actividad_id)
      .eq('user_id', user.id)
      .single();

    if (fetchError) throw new Error(`Error al buscar actividad: ${fetchError.message}`);
    if (!actividadPrevia) throw new Error("Actividad no encontrada o no pertenece al usuario.");

    // @ts-ignore: La inferencia de tipos de Supabase no maneja bien la selección anidada de 'materias'.
    const rubricas_spreadsheet_id = actividadPrevia.materias?.rubricas_spreadsheet_id;
    const rubrica_sheet_range_existente = actividadPrevia.rubrica_sheet_range;

    if (!rubricas_spreadsheet_id) {
        throw new Error("Error crítico: La materia de esta actividad no tiene un ID de hoja de rúbricas.");
    }

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    let nuevoRubricaSheetRange: string | null = rubrica_sheet_range_existente;

    // 2. Si hay criterios Y un rango existente, llamar a ACTUALIZAR
    if (criterios && criterios.length > 0 && rubrica_sheet_range_existente) {
        console.log(`Actualizando rúbrica existente en rango: ${rubrica_sheet_range_existente}`);
        const rubricaResponse = await fetch(appsScriptUrl, {
          method: 'POST',
          body: JSON.stringify({
            action: 'actualizar_rubrica', // <-- ACCIÓN NUEVA
            rubricas_spreadsheet_id: rubricas_spreadsheet_id,
            rubrica_sheet_range: rubrica_sheet_range_existente, // <-- RANGO ANTIGUO
            nombre_actividad: nombre_actividad, // Para actualizar título
            criterios: criterios,
          }),
          headers: { 'Content-Type': 'application/json' },
        });
        if (!rubricaResponse.ok) throw new Error(`Error al actualizar la rúbrica en Google Sheets: ${await rubricaResponse.text()}`);
        const rubricaData = await rubricaResponse.json();
        if(rubricaData.status !== 'success') throw new Error(rubricaData.message);
        nuevoRubricaSheetRange = rubricaData.rubrica_sheet_range; // Guardar el nuevo rango (puede haber cambiado)

    } else if (criterios && criterios.length > 0 && !rubrica_sheet_range_existente) {
        // 3. Si hay criterios PERO NO hay rango (ej. se añade rúbrica a act. antigua), llamar a CREAR
        console.log("Creando nueva rúbrica (no existía rango)...");
        // (Necesitamos el drive_url de la materia para esto...)
        // Nota: Para simplificar, asumimos que si edita, ya tenía rúbrica.
        // Si quieres soportar AÑADIR rúbrica en la edición, necesitarías
        // también el 'drive_url_materia' como en 'crear-actividad'.
        // Por ahora, nos enfocamos solo en la ACTUALIZACIÓN.
         const rubricaResponse = await fetch(appsScriptUrl, {
            method: 'POST',
            body: JSON.stringify({
              action: 'guardar_rubrica', // <-- ACCIÓN ANTIGUA (CREAR)
              rubricas_spreadsheet_id: rubricas_spreadsheet_id,
              nombre_actividad: nombre_actividad,
              criterios: criterios,
            }),
            headers: { 'Content-Type': 'application/json' },
          });
          if (!rubricaResponse.ok) throw new Error("Error al guardar la rúbrica (nueva) en Google Sheets.");
          const rubricaData = await rubricaResponse.json();
          if(rubricaData.status !== 'success') throw new Error(rubricaData.message);
          nuevoRubricaSheetRange = rubricaData.rubrica_sheet_range;

    } else if (!criterios || criterios.length === 0) {
        // 4. Si se borraron todos los criterios, limpiar el rango (opcional)
         console.log("No se enviaron criterios.");
         // Aquí podrías llamar a 'actualizar_rubrica' con criterios vacíos
         // o simplemente poner el rango en null en la BD.
         nuevoRubricaSheetRange = null; // O dejar el existente si prefieres no borrarlo
    }


    // 5. Actualizar la actividad en Supabase con los nuevos datos
    const { data: actividadActualizada, error: updateError } = await supabase
      .from('actividades')
      .update({
        nombre: nombre_actividad,
        unidad,
        tipo_entrega,
        descripcion: descripcion,
        rubrica_sheet_range: nuevoRubricaSheetRange, // <-- GUARDAR EL RANGO NUEVO
        // 'rubrica_spreadsheet_id' no cambia, ya que es el maestro de la materia
      })
      .eq('id', actividad_id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ 
        message: "Actividad actualizada exitosamente.",
        actividad: actividadActualizada
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
});