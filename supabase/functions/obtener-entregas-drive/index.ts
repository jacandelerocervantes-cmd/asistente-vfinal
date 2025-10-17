// supabase/functions/obtener-entregas-drive/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define la estructura de los datos que esperamos recibir
interface EntregasRequest {
  drive_folder_id: string;
}

serve(async (req: Request) => {
  // Manejo de la petición de sondeo (pre-vuelo) OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { drive_folder_id }: EntregasRequest = await req.json();
    if (!drive_folder_id) {
      throw new Error("Se requiere el 'drive_folder_id' de la carpeta de entregas.");
    }
    
    // Autenticación: nos aseguramos de que solo un docente logueado pueda llamar a esta función.
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    // Llamar a tu Apps Script para obtener la lista de archivos
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL"); // Usamos el secret que ya tienes
    if (!appsScriptUrl) {
      throw new Error("La URL de Apps Script no está configurada en los secrets.");
    }
    
    const scriptResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'get_folder_contents', // La acción que creamos en el script
        drive_folder_id: drive_folder_id,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    
    const scriptResult = await scriptResponse.json();
    if (scriptResult.status !== 'success') {
      throw new Error(`Apps Script devolvió un error: ${scriptResult.message}`);
    }

    // Devolvemos la lista de archivos al frontend
    return new Response(JSON.stringify(scriptResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});