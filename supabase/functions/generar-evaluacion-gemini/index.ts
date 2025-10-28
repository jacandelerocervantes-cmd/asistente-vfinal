// supabase/functions/generar-evaluacion-gemini/index.ts
import { serve } from "std/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Ajusta en producción
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Interfaces Actualizadas ---
interface OpcionGenerada {
    texto_opcion: string;
    es_correcta: boolean;
}

// Interfaz para datos_extra (simplificada para generación inicial)
// La IA *no* generará la estructura completa (grid, layout), solo la base.
interface DatosExtraGenerados {
    palabras?: string[]; // Para sopa_letras
    entradas?: { palabra: string; pista: string }[]; // Para crucigrama
    columnas?: { texto: string, grupo: 'A' | 'B' }[]; // Para relacionar_columnas (solo texto y grupo inicial)
    pares_correctos?: { id_a_temp?: string, id_b_temp?: string }[]; // Placeholder para relacionar_columnas
}


interface PreguntaGenerada {
    texto_pregunta: string;
    // --- Añadir todos los tipos permitidos ---
    tipo_pregunta: 'opcion_multiple_unica' | 'opcion_multiple_multiple' | 'abierta' | 'sopa_letras' | 'crucigrama' | 'relacionar_columnas';
    puntos: number;
    opciones?: OpcionGenerada[]; // Solo para opción múltiple
    // --- Añadir datos_extra ---
    datos_extra?: DatosExtraGenerados | null; // Para tipos didácticos
}

interface EvaluacionGenerada {
    preguntas: PreguntaGenerada[];
}

interface RequestPayload {
    tema: string;
    num_preguntas: number;
    // --- Usar todos los tipos ---
    tipos_preguntas: ('opcion_multiple_unica' | 'opcion_multiple_multiple' | 'abierta' | 'sopa_letras' | 'crucigrama' | 'relacionar_columnas')[];
    instrucciones_adicionales?: string;
}

// Función auxiliar para extraer JSON (Respaldo por si Gemini añade ```json)
function extractJson(text: string): Record<string, unknown> | null {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!match) {
        // Intenta encontrar JSON sin los ```
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            text = text.substring(firstBrace, lastBrace + 1);
        } else {
             console.warn("extractJson: No encontró patrón ```json ... ``` ni { ... }");
             return null;
        }
    } else {
        text = match[1];
    }

    try {
        const parsed = JSON.parse(text.trim());
        console.log("extractJson: Parseo exitoso.");
        return parsed;
    } catch (e) {
        console.error("extractJson: Fallo al parsear JSON:", (e as Error).message);
        console.error("extractJson: JSON problemático:", text);
        return null;
    }
}


serve(async (req: Request) => {
  // Manejo de CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Autenticación (asumiendo que se llama desde el frontend logueado)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Se requiere cabecera de autorización."); // Seguridad básica
    // (Podrías añadir validación del token si es necesario, pero invoke lo hace por defecto si no pones --no-verify-jwt)


    const { tema, num_preguntas, tipos_preguntas, instrucciones_adicionales }: RequestPayload = await req.json();
    if (!tema || !num_preguntas || num_preguntas <= 0 || !tipos_preguntas || tipos_preguntas.length === 0) {
      throw new Error("Faltan parámetros requeridos o son inválidos: 'tema', 'num_preguntas' (>0), 'tipos_preguntas' (array no vacío).");
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("La API Key de Gemini (GEMINI_API_KEY) no está configurada como Secret en Supabase.");
    }

    // --- Construcción del Prompt Detallado ---
    const tiposPermitidosStr = tipos_preguntas.join(', ');
    let prompt = `
      Eres un asistente experto diseñando evaluaciones académicas para nivel ${instrucciones_adicionales?.includes('universitario') ? 'universitario' : 'técnico/preparatoria'}.
      Genera un borrador de examen sobre el tema "${tema}".
      El examen debe contener exactamente ${num_preguntas} preguntas.
      Los tipos de preguntas permitidos son: ${tiposPermitidosStr}. Intenta distribuir los tipos solicitados equitativamente. Por ejemplo, si se piden 10 preguntas y 5 tipos, haz 2 de cada tipo si es posible.
      Cada pregunta debe valer aproximadamente ${Math.round(100 / num_preguntas)} puntos. Asegúrate que la suma TOTAL de puntos de todas las preguntas sea exactamente 100. Ajusta los puntos de algunas preguntas ligeramente si es necesario para alcanzar 100.
    `;

    if (tipos_preguntas.includes('opcion_multiple_unica')) {
      prompt += `
      Para las preguntas de opción múltiple única ('opcion_multiple_unica'):
      - Incluye exactamente 4 opciones de respuesta (ni más ni menos).
      - Marca solo UNA opción como la correcta (es_correcta: true).
      - Los distractores deben ser verosímiles. Evita "Todas las anteriores" o "Ninguna de las anteriores".
      `;
    }
     if (tipos_preguntas.includes('opcion_multiple_multiple')) {
      prompt += `
      Para las preguntas de opción múltiple múltiple ('opcion_multiple_multiple'):
      - Incluye entre 4 y 6 opciones de respuesta.
      - Marca al menos UNA y como máximo N-1 opciones como correctas (es_correcta: true).
      - Los distractores deben ser verosímiles.
      `;
    }
    if (tipos_preguntas.includes('abierta')) {
        prompt += `
        Para las preguntas abiertas ('abierta'):
        - Formula preguntas claras que requieran una respuesta desarrollada (explicar, comparar, justificar). Evita preguntas de sí/no.
        `;
    }
    if (tipos_preguntas.includes('sopa_letras')) {
        prompt += `
        Para las preguntas de Sopa de Letras ('sopa_letras'):
        - El campo "texto_pregunta" debe ser la instrucción (Ej: "Encuentra las siguientes 5 palabras clave sobre...").
        - Incluye una clave "datos_extra" con un campo "palabras" (array de strings) que contenga entre 5 y 10 palabras relevantes al tema "${tema}", en MAYÚSCULAS y sin espacios. NO generes la cuadrícula, solo la lista de palabras.
        `;
    }
     if (tipos_preguntas.includes('crucigrama')) {
        prompt += `
        Para las preguntas de Crucigrama ('crucigrama'):
        - El campo "texto_pregunta" debe ser la instrucción (Ej: "Resuelve el crucigrama sobre...").
        - Incluye una clave "datos_extra" con un campo "entradas" (array de objetos).
        - Cada objeto en "entradas" debe tener "palabra" (string en MAYÚSCULAS, sin espacios) y "pista" (string, la definición o clue). Genera entre 5 y 8 entradas. NO generes el layout de la cuadrícula, solo las palabras y pistas.
        `;
    }
     if (tipos_preguntas.includes('relacionar_columnas')) {
        prompt += `
        Para las preguntas de Relacionar Columnas ('relacionar_columnas'):
        - El campo "texto_pregunta" debe ser la instrucción (Ej: "Relaciona los conceptos de la columna A con sus definiciones en la columna B").
        - Incluye una clave "datos_extra" con un campo "columnas" (array de objetos).
        - Genera entre 4 y 6 PARES de elementos relacionados. Para cada par, crea dos objetos en "columnas": uno con "grupo": "A" y el otro con "grupo": "B". Cada objeto debe tener un campo "texto" (string).
        - NO intentes definir los pares correctos, solo genera los elementos de ambas columnas.
        `;
    }

     if (instrucciones_adicionales) {
        prompt += `\nConsidera estas Instrucciones Adicionales del Docente: ${instrucciones_adicionales}`;
     }

    prompt += `

      Formato de Salida Obligatorio:
      Tu respuesta DEBE ser únicamente un objeto JSON válido, sin ningún texto, explicación, introducción o markdown (como \`\`\`json) antes o después del JSON.
      El JSON debe tener una única clave raíz llamada "preguntas".
      El valor de "preguntas" debe ser un array de objetos.
      Cada objeto dentro del array "preguntas" representa una pregunta y DEBE tener las siguientes claves:
      - "texto_pregunta": (string) El enunciado completo y claro de la pregunta.
      - "tipo_pregunta": (string) EXACTAMENTE uno de los siguientes valores: ${tipos_preguntas.map(t => `'${t}'`).join(' o ')}.
      - "puntos": (number) El valor numérico de la pregunta. La suma de todos los "puntos" en el array debe ser 100.
      - "opciones": (array de objetos) Esta clave SOLO debe existir si "tipo_pregunta" es "opcion_multiple_unica". Si existe, debe contener EXACTAMENTE 4 objetos, cada uno con:
          - "texto_opcion": (string) El texto de la opción.
          - "es_correcta": (boolean) Debe haber exactamente un 'true' y tres 'false' en las opciones de cada pregunta de opción múltiple.

      Ejemplo de estructura esperada (si solo se pide opción múltiple):
      {
        "preguntas": [
          {
            "texto_pregunta": "¿Cuál es la capital de Francia?",
            "tipo_pregunta": "opcion_multiple_unica",
            "puntos": 50,
            "opciones": [
              { "texto_opcion": "Berlín", "es_correcta": false },
              { "texto_opcion": "Madrid", "es_correcta": false },
              { "texto_opcion": "París", "es_correcta": true },
              { "texto_opcion": "Roma", "es_correcta": false }
            ]
          },
          {
            "texto_pregunta": "¿En qué año empezó la Segunda Guerra Mundial?",
            "tipo_pregunta": "opcion_multiple_unica",
            "puntos": 50,
            "opciones": [
              { "texto_opcion": "1939", "es_correcta": true },
              { "texto_opcion": "1941", "es_correcta": false },
              { "texto_opcion": "1945", "es_correcta": false },
              { "texto_opcion": "1914", "es_correcta": false }
            ]
          }
        ]
      }
      Asegúrate de seguir este formato JSON estrictamente.
    `;

    // --- Llamada a la API de Gemini ---
    console.log("Llamando a Gemini API...");
    // Usamos el modelo y endpoint que funcionó para la rúbrica
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Forzar respuesta JSON
        generationConfig: {
          response_mime_type: "application/json",
        },
      }),
    });

    console.log(`Respuesta Gemini Status: ${response.status}`);
    if (!response.ok) {
        const errorBodyText = await response.text();
        console.error("Error crudo de Gemini API:", errorBodyText);
        let errMsg = `Error ${response.status} de la API de Gemini.`;
        try { errMsg = JSON.parse(errorBodyText)?.error?.message || errMsg; } catch (_) { /* ignore */ }
        throw new Error(errMsg);
    }

    const data = await response.json();
    console.log("Respuesta de Gemini recibida.");

    // Extraer y parsear la respuesta JSON (ya debería venir limpia)
    const rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJsonText) {
        console.error("Respuesta Gemini inesperada (sin texto):", JSON.stringify(data));
        throw new Error(`Respuesta inesperada o vacía de Gemini.`);
    }
    console.log("Texto JSON crudo recibido:", rawJsonText);

    let generatedExam: EvaluacionGenerada;
    try {
        generatedExam = JSON.parse(rawJsonText) as EvaluacionGenerada;
    } catch (parseError) {
        console.error("Error al parsear JSON de Gemini:", parseError);
        // Intentar con la función de respaldo por si acaso
        const extracted = extractJson(rawJsonText);
        if (extracted && Array.isArray(extracted.preguntas)) {
            console.warn("Parseo directo falló, pero la extracción funcionó.");
            generatedExam = extracted as unknown as EvaluacionGenerada;
        } else {
             throw new Error(`La respuesta de Gemini no es un JSON válido. Respuesta cruda: ${rawJsonText}`);
        }
    }

    // --- Validaciones Post-Parseo ---
    if (!generatedExam || !Array.isArray(generatedExam.preguntas)) {
        throw new Error(`El JSON parseado no tiene la clave 'preguntas' o no es un array. Recibido: ${JSON.stringify(generatedExam)}`);
    }
    if (generatedExam.preguntas.length !== num_preguntas) {
        console.warn(`Se pidieron ${num_preguntas} preguntas pero se generaron ${generatedExam.preguntas.length}. Se devolverán las generadas.`);
        // No lanzamos error, pero advertimos.
    }
    const sumaPuntos = generatedExam.preguntas.reduce((sum, p) => sum + (Number(p.puntos) || 0), 0);
    if (sumaPuntos !== 100) {
         console.warn(`La suma de puntos generada es ${sumaPuntos}, no 100. Se devolverá así.`);
         // No lanzamos error, el docente puede ajustar.
    }
    // Validar estructura interna de cada pregunta (simplificado)
    for (const p of generatedExam.preguntas) {
        if (!p.texto_pregunta || !p.tipo_pregunta || typeof p.puntos !== 'number') {
            throw new Error(`Pregunta generada inválida (faltan claves o tipos incorrectos): ${JSON.stringify(p)}`);
        }
        if (p.tipo_pregunta === 'opcion_multiple_unica') {
            if (!Array.isArray(p.opciones) || p.opciones.length !== 4 || p.opciones.filter(o => o.es_correcta).length !== 1) {
                throw new Error(`Pregunta de opción múltiple generada inválida (opciones incorrectas): ${JSON.stringify(p)}`);
            }
        }
    }
    // --- Fin Validaciones ---


    // Añadir IDs temporales y flags para el frontend
    generatedExam.preguntas = generatedExam.preguntas.map((p, index) => ({
        ...p,
        id: `temp-ia-${Date.now()}-${index}`,
        isNew: true,
        orden: index,
        opciones: (p.opciones || []).map((opt, optIndex) => ({
            ...opt,
            id: `temp-opt-ia-${Date.now()}-${index}-${optIndex}`
        }))
    }));

    console.log(`Generación exitosa. ${generatedExam.preguntas.length} preguntas listas.`);

    // Devolver el JSON procesado
    return new Response(JSON.stringify(generatedExam), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en generar-evaluacion-gemini:", error);
    // Asegurarse de devolver un JSON de error válido
    const message = error instanceof Error ? error.message : "Error desconocido en la función.";

    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500, // Error interno del servidor
    });
  }
});