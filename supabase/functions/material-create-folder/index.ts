// supabase/functions/material-create-folder/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  try {
    const { parentFolderId, newFolderName } = await req.json();
    if (!parentFolderId || !newFolderName) {
      throw new Error("Se requieren 'parentFolderId' y 'newFolderName'.");
    }
    
    // Autenticación
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    // Llamar a Google Apps Script
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("URL de Apps Script no configurada.");

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'create_folder', 
        parentFolderId: parentFolderId,
        newFolderName: newFolderName
      }),
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