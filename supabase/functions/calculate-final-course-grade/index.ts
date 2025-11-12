// supabase/functions/calculate-final-course-grade/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { materia_id, num_unidades, sheets_ids } = await req.json();
    if (!materia_id || !num_unidades || !sheets_ids || !sheets_ids.calificaciones_spreadsheet_id) {
      throw new Error("Faltan parámetros: materia_id, num_unidades o sheets_ids (con calificaciones_spreadsheet_id).");
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
      action: 'calculate_and_save_final_course_grade',
      num_unidades: num_unidades,
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