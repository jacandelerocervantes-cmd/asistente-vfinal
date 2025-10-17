// supabase/functions/get-justification-text/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  spreadsheet_id: string;
  justificacion_sheet_cell: string;
}

serve(async (req: Request) => {
  // Manejo de la solicitud OPTIONS (pre-vuelo) para CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { spreadsheet_id, justificacion_sheet_cell }: RequestBody = await req.json();
    if (!spreadsheet_id || !justificacion_sheet_cell) {
      throw new Error("Se requieren 'spreadsheet_id' y 'justificacion_sheet_cell'.");
    }

    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    const scriptResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'get_justification_text',
        spreadsheet_id: spreadsheet_id,
        justificacion_sheet_cell: justificacion_sheet_cell,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!scriptResponse.ok) throw new Error("Error al llamar a Google Apps Script.");
    
    const scriptData = await scriptResponse.json();
    if (scriptData.status !== 'success') {
      throw new Error(scriptData.message);
    }

    return new Response(JSON.stringify(scriptData), { 
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