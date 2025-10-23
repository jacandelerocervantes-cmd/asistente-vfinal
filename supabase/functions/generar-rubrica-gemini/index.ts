// supabase/functions/generar-rubrica-gemini/index.ts

import { serve } from "std/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RubricRequest {
  descripcion_actividad: string;
  objetivos_aprendizaje?: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { descripcion_actividad, objetivos_aprendizaje: _objetivos_aprendizaje }: RubricRequest = await req.json();
    if (!descripcion_actividad) {
      throw new Error("La 'descripcion_actividad' es requerida.");
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("La API Key de Gemini no está configurada en los secrets.");
    }

    const prompt = `
      Eres un asistente experto en diseño curricular y pedagogía.
      Basado en la siguiente descripción de una actividad académica, 
      genera una rúbrica de evaluación detallada y coherente que sume exactamente 100 puntos.

      **Descripción de la Actividad:**
      "${descripcion_actividad}"

      Tu respuesta DEBE ser únicamente un objeto JSON válido, sin texto introductorio, explicaciones, ni saltos de línea.
      El JSON debe tener una única clave "criterios", que sea un array de objetos.
      Cada objeto en el array debe tener exactamente dos claves: "descripcion" (string) y "puntos" (number).
      La suma de todos los "puntos" debe ser 100.
    `;

    // --- ¡LA CORRECCIÓN DEFINITIVA ESTÁ AQUÍ! ---
    // Usamos el endpoint 'v1beta' con el nombre del modelo que indicaste: 'gemini-2.5-pro'
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Añadimos una configuración para asegurar que la respuesta sea JSON
        generationConfig: {
          response_mime_type: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Error en la API de Gemini: ${errorData.error.message}`);
    }

    const data = await response.json();
    
    // Con response_mime_type, la respuesta ya debería ser un JSON limpio
    const jsonString = data.candidates[0].content.parts[0].text;
    const rubricJson = JSON.parse(jsonString);

    return new Response(JSON.stringify(rubricJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error en la función generar-rubrica-gemini:", errorMessage);
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});