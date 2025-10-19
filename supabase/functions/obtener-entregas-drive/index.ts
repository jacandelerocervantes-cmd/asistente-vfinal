// supabase/functions/obtener-entregas-drive/index.ts (Versión de Diagnóstico)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  console.log("Iniciando 'obtener-entregas-drive' en MODO DIAGNÓSTICO...");
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { drive_folder_id } = body;
    if (!drive_folder_id) {
      throw new Error("Petición incorrecta: se requiere el 'drive_folder_id'.");
    }
    
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");
    
    console.log(`Llamando a Google Script: ${appsScriptUrl}`);
    const scriptResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'get_folder_contents', drive_folder_id }),
      headers: { 'Content-Type': 'application/json' },
    });

    console.log(`Respuesta de Google recibida con estado: ${scriptResponse.status}`);
    const responseText = await scriptResponse.text(); // Obtenemos la respuesta como texto

    // --- ¡ESTA ES LA PARTE IMPORTANTE! ---
    // Intentamos interpretar el JSON, y si falla, el error incluirá el HTML exacto.
    try {
        const scriptResult = JSON.parse(responseText);
        if (scriptResult.status !== 'success') {
          throw new Error(`Apps Script reportó un error: ${scriptResult.message}`);
        }
        return new Response(JSON.stringify(scriptResult), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    } catch (e) {
        throw new Error(`Fallo al interpretar la respuesta de Google como JSON. La respuesta cruda fue: ${responseText}`);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    console.error("ERROR GRAVE en 'obtener-entregas-drive':", errorMessage);
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});