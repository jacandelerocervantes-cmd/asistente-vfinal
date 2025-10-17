// supabase/functions/comprobar-plagio-gemini/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define la estructura de los datos que esperamos recibir
interface PlagioRequest {
  drive_file_ids: string[];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { drive_file_ids }: PlagioRequest = await req.json();
    if (!drive_file_ids || drive_file_ids.length < 2) {
      throw new Error("Se requieren al menos dos trabajos para comparar.");
    }

    // 1. Llamar a tu Apps Script para obtener el contenido de los archivos
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL"); // Usamos el secret que ya tienes
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada en los secrets.");
    
    const scriptResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'get_multiple_file_contents',
        drive_file_ids: drive_file_ids,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    
    const scriptResult = await scriptResponse.json();
    if (scriptResult.status !== 'success') {
      throw new Error(`Apps Script devolvió un error: ${scriptResult.message}`);
    }

    // 2. Preparar el prompt para Gemini
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("La API Key de Gemini no está configurada en los secrets.");

    let prompt = `
      Eres un asistente experto en detección de plagio académico.
      Analiza los siguientes trabajos, identificados por 'fileId'.
      Compara cada trabajo con todos los demás.
      Tu tarea es identificar pares de trabajos con un alto porcentaje de similitud textual, ignorando frases comunes o citas correctamente atribuidas.
      
      Devuelve tu análisis únicamente en formato JSON, sin texto adicional.
      El JSON debe tener una clave "reporte_plagio", que sea un array de objetos.
      Cada objeto debe representar un par de trabajos con alta similitud y tener las claves: "trabajo_A_id" (el fileId), "trabajo_B_id" (el fileId), "porcentaje_similitud" (un número del 0 al 100), y "fragmentos_similares" (un array de strings con ejemplos del texto coincidente).
      Si no encuentras plagio entre ningún par, devuelve un array vacío.

      TRABAJOS A ANALIZAR:
    `;

    scriptResult.contenidos.forEach((contenido: { fileId: string; texto: string }) => {
      prompt += `\n\n--- TRABAJO fileId: ${contenido.fileId} ---\n${contenido.texto}\n--- FIN TRABAJO ---`;
    });

    // 3. Llamar a la API de Gemini
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" },
      }),
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      throw new Error(`Error en la API de Gemini: ${errorData.error.message}`);
    }

    const geminiData = await geminiResponse.json();
    const jsonString = geminiData.candidates[0].content.parts[0].text;
    const plagioReport = JSON.parse(jsonString);

    return new Response(JSON.stringify(plagioReport), {
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