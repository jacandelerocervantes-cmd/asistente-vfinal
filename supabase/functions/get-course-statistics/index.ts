import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // Manejo de CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validar que el cuerpo de la solicitud sea JSON
    const { spreadsheetId } = await req.json();
    if (!spreadsheetId) {
      throw new Error("Falta el parámetro 'spreadsheetId'.");
    }

    // Crear cliente de Supabase con el token de autorización del usuario
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    // Payload para la función de Apps Script
    const payload = {
      action: "get_final_course_grades",
      spreadsheetId: spreadsheetId,
    };

    // Llamada a Google Apps Script
    const gasResponse = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!gasResponse.ok) {
      const errorText = await gasResponse.text();
      throw new Error(`Error ${gasResponse.status} de Apps Script: ${errorText}`);
    }

    const result = await gasResponse.json();
    if (result.status === "error") {
      throw new Error(`Error devuelto por Apps Script: ${result.message}`);
    }

    // Devolver el resultado exitoso
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(
      JSON.stringify({ message: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
