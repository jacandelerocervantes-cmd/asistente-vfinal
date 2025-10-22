// supabase/functions/procesar-cola-llamar-ia/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Interfaz simplificada para esta función
interface CalificacionConTextos {
    id: number;
    texto_rubrica: string | null;
    texto_trabajo: string | null;
}
interface TrabajoColaParaIA {
    id: number;
    calificacion_id: number;
    calificaciones: CalificacionConTextos | null; // Objeto único
}

// Función auxiliar para extraer JSON (por si acaso Gemini no respeta el mime_type)
function extractJson(text: string): Record<string, unknown> | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        // Intenta eliminar comentarios residuales o texto antes/después del JSON
        const potentialJson = match[0].replace(/```json\n?/, '').replace(/\n?```$/, '').trim();
        return JSON.parse(potentialJson);
    } catch (_e) {
        console.error("Fallo al parsear JSON extraído:", _e);
        return null;
    }
}


serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let trabajoId: number | null = null;
  let calificacionId: number | null = null;

  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Buscar UN trabajo listo para IA
    const { data: trabajoData, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`id, calificacion_id, calificaciones (id, texto_rubrica, texto_trabajo)`) // Solo necesitamos los textos
      .eq('estado', 'listo_para_ia')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (trabajoError) throw new Error(`Error al buscar trabajo listo para IA: ${trabajoError.message}`);
    if (!trabajoData) {
      return new Response(JSON.stringify({ message: "No hay trabajos listos para procesar con IA." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const trabajo = trabajoData as unknown as TrabajoColaParaIA;
    trabajoId = trabajo.id;

    // --- Validación ---
    const calificacion = trabajo.calificaciones;
    if (!calificacion || typeof calificacion !== 'object' || !calificacion.texto_rubrica || !calificacion.texto_trabajo) {
        // Marcar como fallido si faltan los textos
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido_ia', ultimo_error: 'Faltan textos de rúbrica o trabajo en la calificación asociada.' }).eq('id', trabajo.id);
        throw new Error(`Trabajo ID ${trabajo.id} (Calificación ID: ${calificacion?.id}) no tiene los textos necesarios.`);
    }
    calificacionId = calificacion.id;
    // --- Fin Validación ---

    // 2. Marcar como 'llamando_ia'
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'llamando_ia' }).eq('id', trabajo.id);
    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '2/4: Calificando con IA...' }).eq('id', calificacionId);

    // 3. Preparar y llamar a Gemini
    const prompt = `Evalúa el trabajo basándote en la rúbrica. Tu respuesta DEBE ser únicamente un objeto JSON válido con las claves "calificacion_total" (number) y "justificacion_texto" (string).\n\nRúbrica:\n${calificacion.texto_rubrica}\n\nTrabajo:\n${calificacion.texto_trabajo}`;

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("La API Key de Gemini no está configurada.");

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" } // Pedir JSON directamente
      })
    });

    if (!geminiResponse.ok) {
        const errorBody = await geminiResponse.json();
        const errorMessage = errorBody?.error?.message || `Error ${geminiResponse.status} ${geminiResponse.statusText}`;
      throw new Error(`Error en la API de Gemini: ${errorMessage}`);
    }

    const geminiData = await geminiResponse.json();
    if (!geminiData.candidates || !geminiData.candidates[0]?.content?.parts || !geminiData.candidates[0].content.parts[0]?.text) {
        throw new Error(`Respuesta inesperada o vacía de Gemini: ${JSON.stringify(geminiData)}`);
    }

    // Aunque pedimos JSON, parseamos para validar la estructura y por si acaso viene con ```json ... ```
    const rawGeminiText = geminiData.candidates[0].content.parts[0].text;
    const parsedJson = extractJson(rawGeminiText); // Usamos nuestra función extractora

    if (!parsedJson || typeof parsedJson.calificacion_total !== 'number' || typeof parsedJson.justificacion_texto !== 'string') {
        throw new Error(`La respuesta de la IA no fue un JSON válido con las claves esperadas. Respuesta cruda: ${rawGeminiText}`);
    }

    // 4. Guardar la respuesta JSON en 'calificaciones'
    // Guardamos el objeto parseado y validado
    const { error: updateIaResultError } = await supabaseAdmin
      .from('calificaciones')
      .update({ respuesta_ia_json: parsedJson }) // Guardar el JSON parseado
      .eq('id', calificacionId);
    if (updateIaResultError) throw new Error(`Error al guardar respuesta IA en calificación ${calificacionId}: ${updateIaResultError.message}`);

    // 5. Marcar como 'listo_para_guardar'
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'listo_para_guardar' }).eq('id', trabajo.id);
    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: 'Calificación IA recibida, listo para guardar' }).eq('id', calificacionId); // Actualizar progreso

    console.log(`Respuesta IA obtenida y guardada para trabajo ID ${trabajoId}, calificación ID ${calificacionId}.`);
    return new Response(JSON.stringify({ message: `Respuesta IA obtenida para trabajo ${trabajoId}.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    console.error(`Error llamando a IA para trabajo ID ${trabajoId} (Calificación ID: ${calificacionId}): ${errorMessage}`);
    // Marcar como fallido si tenemos los IDs
    if (trabajoId) {
        const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      try {
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido_ia', ultimo_error: errorMessage }).eq('id', trabajoId);
        if (calificacionId) {
          await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error en IA: ${errorMessage.substring(0, 100)}...` }).eq('id', calificacionId);
        }
      } catch (dbError) {
        console.error(`Error adicional al marcar como fallido (llamada IA): ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }
    return new Response(JSON.stringify({ message: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});