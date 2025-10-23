// supabase/functions/sugerir-calificacion-gemini/index.ts
import { serve } from "std/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Ajusta en producción
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestPayload {
    texto_pregunta: string;
    respuesta_alumno: string;
    puntos_maximos: number;
    // Opcional: Podrías pasar criterios de la rúbrica si los tienes
    // criterios_rubrica?: string;
}

interface SugerenciaResponse {
    puntos_sugeridos: number;
    comentario_sugerido: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Autenticación (importante para funciones que usan API keys)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Se requiere cabecera de autorización.");
    // (Supabase invoke verifica el token por defecto)

    const { texto_pregunta, respuesta_alumno, puntos_maximos }: RequestPayload = await req.json();
    if (!texto_pregunta || !respuesta_alumno || typeof puntos_maximos !== 'number' || puntos_maximos <= 0) {
      throw new Error("Faltan parámetros requeridos o son inválidos: 'texto_pregunta', 'respuesta_alumno', 'puntos_maximos'.");
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("API Key de Gemini (GEMINI_API_KEY) no configurada.");
    }

    // --- Prompt para Gemini ---
    const prompt = `
      Eres un asistente de profesor evaluando una respuesta a una pregunta abierta.
      Pregunta: "${texto_pregunta}"
      Puntos máximos posibles para esta pregunta: ${puntos_maximos}.
      Respuesta del Alumno: "${respuesta_alumno}"

      Evalúa la respuesta del alumno basándote únicamente en la pregunta formulada. Considera la claridad, precisión, completitud y relevancia de la respuesta en relación a lo que se pide en la pregunta.

      Tu tarea es proporcionar una calificación numérica y un breve comentario justificativo.

      Formato de Salida Obligatorio:
      Tu respuesta DEBE ser únicamente un objeto JSON válido, sin texto adicional antes o después.
      El JSON debe tener EXACTAMENTE las siguientes dos claves:
      - "puntos_sugeridos": (number) Un número entero o decimal (máximo 1 decimal si es necesario) entre 0 y ${puntos_maximos}, representando la calificación sugerida.
      - "comentario_sugerido": (string) Una breve explicación (1-2 frases) de por qué sugieres esa calificación, destacando puntos fuertes o áreas de mejora de la respuesta del alumno.

      Ejemplo de salida esperada:
      {
        "puntos_sugeridos": ${Math.round(puntos_maximos * 0.8)},
        "comentario_sugerido": "La respuesta es mayormente correcta y bien explicada, pero le falta mencionar un detalle clave."
      }

      Asegúrate de que los puntos sugeridos no excedan ${puntos_maximos}. Sé objetivo y justo en tu evaluación.
    `;

    // --- Llamada a Gemini ---
    console.log("Llamando a Gemini para sugerir calificación...");
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json",
          // Ajusta la temperatura si quieres respuestas más creativas o deterministas
          // temperature: 0.7
        },
      }),
    });

    console.log(`Respuesta Gemini Status: ${response.status}`);
    if (!response.ok) {
        const errorBodyText = await response.text();
        console.error("Error crudo de Gemini API:", errorBodyText);
        let errMsg = `Error ${response.status} de la API de Gemini.`; try { errMsg = JSON.parse(errorBodyText)?.error?.message || errMsg; } catch (_) { /* ignore */ }
        throw new Error(errMsg);
    }

    const data = await response.json();
    const rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJsonText) {
        console.error("Respuesta Gemini inesperada (sin texto):", JSON.stringify(data));
        throw new Error(`Respuesta inesperada o vacía de Gemini.`);
    }
    console.log("JSON crudo recibido de Gemini:", rawJsonText);

    let sugerencia: SugerenciaResponse;
    try {
        sugerencia = JSON.parse(rawJsonText) as SugerenciaResponse;
    } catch (_parseError) {
        throw new Error(`La respuesta de Gemini no es un JSON válido. Respuesta cruda: ${rawJsonText}`);
    }

    // --- Validar la respuesta parseada ---
    if (typeof sugerencia.puntos_sugeridos !== 'number' || typeof sugerencia.comentario_sugerido !== 'string') {
        throw new Error(`El JSON de Gemini no tiene la estructura esperada. Recibido: ${JSON.stringify(sugerencia)}`);
    }
    // Asegurarse que los puntos están en el rango correcto
    sugerencia.puntos_sugeridos = Math.max(0, Math.min(puntos_maximos, sugerencia.puntos_sugeridos));
    // Redondear a 1 decimal si es necesario
    sugerencia.puntos_sugeridos = Math.round(sugerencia.puntos_sugeridos * 10) / 10;


    console.log("Sugerencia generada:", sugerencia);
    return new Response(JSON.stringify(sugerencia), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en sugerir-calificacion-gemini:", error);
    const message = error instanceof Error ? error.message : "Error desconocido.";
    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
