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
      materia_id,
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

    const { data: materia, error: materiaError } = await supabase
      .from('materias')
      .select('rubricas_spreadsheet_id')
      .eq('id', materia_id)
      .single();

    if (materiaError) throw materiaError;

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    let rubricaSheetRange: string | null = null;
    if (materia.rubricas_spreadsheet_id && criterios && criterios.length > 0) {
      const rubricaResponse = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'guardar_rubrica',
          rubricas_spreadsheet_id: materia.rubricas_spreadsheet_id,
          nombre_actividad: nombre_actividad,
          criterios: criterios,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!rubricaResponse.ok) throw new Error("Error al guardar la rúbrica en Google Sheets.");
      const rubricaData = await rubricaResponse.json();
      if(rubricaData.status !== 'success') throw new Error(rubricaData.message);
      rubricaSheetRange = rubricaData.rubrica_sheet_range;
    }

    const { data: actividadActualizada, error: updateError } = await supabase
      .from('actividades')
      .update({
        nombre: nombre_actividad,
        unidad,
        tipo_entrega,
        descripcion: descripcion,
        rubrica_sheet_range: rubricaSheetRange,
        // rubrica_spreadsheet_id no cambia al actualizar, ya pertenece a la materia
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