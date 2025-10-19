// supabase/functions/get-activity-details/index.ts

import { serve } from "std/http/server.ts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Be more specific in production for better security
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  actividad_id: number;
}

interface Materia {
  id: number;
  rubricas_spreadsheet_id: string;
  // Add other materia fields if needed
}

interface Actividad {
  id: number;
  user_id: string;
  rubrica_sheet_range: string | null;
  materias: Materia | null;
  // Add other actividad fields
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { actividad_id }: RequestBody = await req.json();
    if (!actividad_id) throw new Error("Se requiere el 'actividad_id'.");
    
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization header is required.");

    const supabase: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    const { data: actividad, error: actividadError } = await supabase
      .from('actividades')
      .select('*, materias(*)')
      .eq('id', actividad_id)
      .eq('user_id', user.id)
      .single();

    if (actividadError) throw actividadError;
    if (!actividad) throw new Error("Actividad no encontrada o no tienes permiso para verla.");
    
    let criterios = [];
    if (actividad.rubrica_sheet_range && actividad.materias?.rubricas_spreadsheet_id) {
      // Consider renaming this env var to something more generic like GOOGLE_APPS_SCRIPT_URL
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

      if (!scriptResponse.ok) {
        const errorBody = await scriptResponse.text();
        throw new Error(`Error al llamar a Google Apps Script: ${scriptResponse.status} ${errorBody}`);
      }

      const scriptData = await scriptResponse.json();
      if (scriptData.status !== 'success') throw new Error(scriptData.message || "Error desconocido en Apps Script al obtener la rúbrica.");
      criterios = scriptData.criterios || [];
    }
    return new Response(JSON.stringify({
      ...actividad,
      criterios // Añadimos los criterios al objeto de la actividad
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    console.error(`Error in get-activity-details: ${errorMessage}`);
    return new Response(JSON.stringify({ message: errorMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
});