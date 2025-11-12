// supabase/functions/material-upload-file/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Crear cliente de Supabase y validar usuario
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const authHeader = req.headers.get('Authorization')!;
    const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) {
      return new Response(JSON.stringify({ message: 'No autorizado' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Obtener y validar el payload de la solicitud
    const { targetFolderId, fileName, mimeType, base64Data } = await req.json();
    if (!targetFolderId || !fileName || !mimeType || !base64Data) {
      throw new Error("Faltan datos para subir el archivo (targetFolderId, fileName, mimeType, base64Data).");
    }

    // 3. Obtener la URL del script de Google
    const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_URL');
    if (!googleScriptUrl) {
      throw new Error("La variable de entorno GOOGLE_SCRIPT_URL no está configurada.");
    }

    // 4. Preparar y enviar la solicitud a Google Apps Script
    const payload = {
      action: 'upload_file',
      targetFolderId,
      fileName,
      mimeType,
      base64Data
    };

    const response = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // 5. Manejar la respuesta de Google Apps Script
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Apps Script devolvió error ${response.status}: ${responseText}`);
    }

    const scriptResponse = JSON.parse(responseText);
    if (scriptResponse.status === 'error') {
      throw new Error(`Error de Google Script: ${scriptResponse.message}`);
    }

    // 6. Devolver la respuesta exitosa al cliente
    return new Response(JSON.stringify(scriptResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error("Error en material-upload-file:", error);
    const errorMessage = error instanceof Error ? error.message : "Ocurrió un error desconocido.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});