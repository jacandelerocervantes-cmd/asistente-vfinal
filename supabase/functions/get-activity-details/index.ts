// supabase/functions/get-activity-details/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  actividad_id: number;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { actividad_id }: RequestBody = await req.json();
    if (!actividad_id) throw new Error("Se requiere el 'actividad_id'.");
    
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    // 1. Obtener los detalles de la actividad y la materia asociada
    const { data: actividad, error: actividadError } = await supabase
      .from('actividades')
      .select('*, materias(*)')
      .eq('id', actividad_id)
      .eq('user_id', user.id)
      .single();

    if (actividadError) throw actividadError;
    if (!actividad) throw new Error("Actividad no encontrada o no tienes permiso para verla.");

    // 2. Si hay una rúbrica, llamar a Apps Script para obtener sus datos
    let criterios = [];
    if (actividad.rubrica_sheet_range && actividad.materias?.rubricas_spreadsheet_id) {
      const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
      if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

      const scriptResponse = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'get_rubric_data',
          spreadsheet_id: actividad.materias.rubricas_spreadsheet_id,
          rubrica_sheet_range: actividad.rubrica_sheet_range,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!scriptResponse.ok) throw new Error("Error al obtener los datos de la rúbrica desde Google Sheets.");
      const scriptData = await scriptResponse.json();
      if (scriptData.status === 'success') {
        criterios = scriptData.criterios;
      }
    }

    // 3. Devolver toda la información combinada
    return new Response(JSON.stringify({
      ...actividad,
      criterios // Añadimos los criterios al objeto de la actividad
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