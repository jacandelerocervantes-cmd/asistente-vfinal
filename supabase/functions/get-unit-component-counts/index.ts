// supabase/functions/get-unit-component-counts/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { materia_id, unidad, sheets_ids } = await req.json();
    if (!materia_id || !unidad || !sheets_ids || !sheets_ids.calificaciones_spreadsheet_id || !sheets_ids.actividades_drive_url) {
      throw new Error("Faltan parámetros: materia_id, unidad o sheets_ids (con calificaciones_spreadsheet_id y actividades_drive_url).");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    const payload = {
      action: 'get_component_counts_for_unit',
      unidad: unidad,
      sheets_ids: sheets_ids
    };

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });

    const responseText = await response.text();
    if (!response.ok) throw new Error(`Error ${response.status} de Apps Script: ${responseText}`);
    
    const scriptResult = JSON.parse(responseText);
    if (scriptResult.status !== 'success') {
      throw new Error(`Apps Script reportó un error: ${scriptResult.message}`);
    }

    // Devuelve el objeto { counts: { actividades: X, evaluaciones: Y } }
    return new Response(JSON.stringify(scriptResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    });
  }
});