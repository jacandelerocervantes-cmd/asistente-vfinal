// supabase/functions/comprobar-plagio-gemini/index.ts

import { serve } from "std/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

interface PlagioRequest {
  drive_file_ids: string[];
}

interface GeminiResponse {
  similitud_encontrada: boolean;
  tipo_similitud?: string;
  fragmento_sospechoso_A?: string;
  fragmento_sospechoso_B?: string;
  explicacion?: string;
}

interface Coincidencia {
  fragmento_A: string;
  fragmento_B: string;
  tipo_similitud: string;
  explicacion_gemini: string;
  ubicacion_aprox_A: string;
  ubicacion_aprox_B: string;
}

interface ReportePlagio {
  trabajo_A_id: string;
  trabajo_B_id: string;
  porcentaje_similitud_significativa: number;
  coincidencias: Coincidencia[];
}

// --- Helper para crear el prompt de Gemini ---
function createGeminiPrompt(fragmentoA: string, fragmentoB: string): string {
  return `
    # ROL Y OBJETIVO
    Actúa como un revisor académico experto en integridad y ética de la investigación, con especialización en ciencias naturales, agronomía y biología. Tu tarea es analizar dos fragmentos de texto (Fragmento A y Fragmento B) para detectar plagio, priorizando la similitud conceptual sobre la coincidencia literal.

    # CONTEXTO IMPORTANTE
    - Ignora similitudes que se basen en terminología científica estándar, nombres de especies (ej. *Zea mays*), fórmulas químicas, o descripciones de metodologías de laboratorio o campo que sean de conocimiento común en la disciplina.
    - Ignora por completo las coincidencias en listas de referencias bibliográficas.
    - Concéntrate en la estructura argumental, la secuencia de ideas, la interpretación de datos y las conclusiones.

    # INSTRUCCIONES DE ANÁLISIS
    Compara el "Fragmento A" con el "Fragmento B". Si detectas una similitud significativa, realiza lo siguiente:
    1.  **Identifica el Tipo de Similitud:** Clasifica la similitud en una de las siguientes categorías:
        - "Copia Literal": El texto es idéntico o casi idéntico.
        - "Copia con Sinónimos": Copia literal donde se han reemplazado palabras clave por sinónimos obvios.
        - "Paráfrasis Cercana": La estructura de la oración es la misma, pero las palabras han sido cambiadas. La idea subyacente es idéntica.
        - "Similitud Conceptual / Reutilización de Idea": La estructura de la oración es diferente, pero la idea, argumento, o conclusión específica es la misma y no es de conocimiento general.
        - "Coincidencia de Datos": Se presentan los mismos datos numéricos, resultados o secuencias específicas sin la debida atribución.

    2.  **Extrae los Fragmentos:** Cita textualmente la parte específica del "Fragmento A" y del "Fragmento B" donde se encuentra la similitud.

    3.  **Proporciona una Explicación:** Justifica brevemente (1-2 frases) por qué consideras que es una similitud relevante, basándote en la clasificación que hiciste.

    # FORMATO DE SALIDA OBLIGATORIO
    Tu respuesta DEBE ser únicamente un objeto JSON válido.
    - Si NO encuentras similitudes significativas, devuelve: {"similitud_encontrada": false}.
    - Si SÍ encuentras similitudes, devuelve un objeto JSON con la siguiente estructura:
    {
      "similitud_encontrada": true,
      "tipo_similitud": "Aquí la categoría que identificaste",
      "fragmento_sospechoso_A": "El texto exacto del Fragmento A",
      "fragmento_sospechoso_B": "El texto exacto del Fragmento B",
      "explicacion": "Tu justificación breve aquí"
    }

    # TEXTOS A COMPARAR
    Fragmento A: """
    ${fragmentoA}
    """

    Fragmento B: """
    ${fragmentoB}
    """
  `;
}

// --- Función principal del servidor ---
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  try {
    const { drive_file_ids }: PlagioRequest = await req.json();
    if (!drive_file_ids || drive_file_ids.length < 2) {
      throw new Error("Se requieren al menos dos trabajos para comparar.");
    }

    // 1. Obtener contenido de los archivos desde Google Apps Script
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");
    
    console.log(`Obteniendo contenido para ${drive_file_ids.length} archivos...`);
    const scriptResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'get_multiple_file_contents', drive_file_ids: drive_file_ids }),
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!scriptResponse.ok) throw new Error(`Error ${scriptResponse.status} de Apps Script: ${await scriptResponse.text()}`);
    const scriptResult = await scriptResponse.json();
    if (scriptResult.status !== 'success') {
      throw new Error(`Apps Script devolvió un error: ${scriptResult.message}`);
    }

    const trabajos = scriptResult.contenidos.map((c: { fileId: string; texto: string }) => ({
      id: c.fileId,
      parrafos: c.texto.toLowerCase().replace(/\s+/g, ' ').split(/\n\s*\n/).filter(Boolean),
    }));

    // 2. Crear pares de comparación
    const pares = [];
    for (let i = 0; i < trabajos.length; i++) {
      for (let j = i + 1; j < trabajos.length; j++) {
        pares.push([trabajos[i], trabajos[j]]);
      }
    }

    // 3. Procesar cada par
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("La API Key de Gemini no está configurada.");
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    const BATCH_SIZE = 10; // Número de llamadas concurrentes a Gemini

    const reportesFinales: ReportePlagio[] = [];

    for (const [trabajoA, trabajoB] of pares) {
      console.log(`Comparando ${trabajoA.id} vs ${trabajoB.id}`);
      const comparaciones = [];
      for (let i = 0; i < trabajoA.parrafos.length; i++) {
        for (let j = 0; j < trabajoB.parrafos.length; j++) {
          comparaciones.push({ parrafoA: trabajoA.parrafos[i], parrafoB: trabajoB.parrafos[j], indexA: i, indexB: j });
        }
      }

      const coincidencias: Coincidencia[] = [];
      const parrafosUnicosCoincidentesA = new Set<number>();

      for (let i = 0; i < comparaciones.length; i += BATCH_SIZE) {
        const batch = comparaciones.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (comp) => {
          const prompt = createGeminiPrompt(comp.parrafoA, comp.parrafoB);
          try {
            const res = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" },
              }),
            });
            if (!res.ok) return null;
            const data = await res.json();
            const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawJson) return null;
            const result = JSON.parse(rawJson) as GeminiResponse;
            if (result.similitud_encontrada) {
              return { ...result, ...comp };
            }
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "Error desconocido al parsear JSON de Gemini";
            console.error("Error en llamada a Gemini:", errorMessage);
            return null;
          }
          return null;
        });

        const results = await Promise.all(promises);
        results.forEach(r => {
          if (r) {
            coincidencias.push({
              fragmento_A: r.fragmento_sospechoso_A!,
              fragmento_B: r.fragmento_sospechoso_B!,
              tipo_similitud: r.tipo_similitud!,
              explicacion_gemini: r.explicacion!,
              ubicacion_aprox_A: `Párrafo ${r.indexA + 1} / ${trabajoA.parrafos.length}`,
              ubicacion_aprox_B: `Párrafo ${r.indexB + 1} / ${trabajoB.parrafos.length}`,
            });
            parrafosUnicosCoincidentesA.add(r.indexA);
          }
        });
      }

      const porcentaje = trabajoA.parrafos.length > 0
        ? (parrafosUnicosCoincidentesA.size / trabajoA.parrafos.length) * 100
        : 0;

      reportesFinales.push({
        trabajo_A_id: trabajoA.id,
        trabajo_B_id: trabajoB.id,
        porcentaje_similitud_significativa: parseFloat(porcentaje.toFixed(1)),
        coincidencias: coincidencias,
      });
    }

    console.log("Análisis de plagio completado.");
    return new Response(JSON.stringify({ reporte_plagio: reportesFinales }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error fatal en comprobar-plagio-gemini:", errorMessage);
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});