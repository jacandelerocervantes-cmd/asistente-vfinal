// supabase/functions/get-student-ia-summary/index.ts
import { serve } from 'std/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { GoogleGenerativeAI } from '@google/generative-ai'

// Cargar la API Key de Gemini desde las variables de entorno
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
if (!GEMINI_API_KEY) {
  console.error("CRITICAL ERROR: GEMINI_API_KEY environment variable is not set.")
  throw new Error("Server configuration error: Missing Gemini API Key.");
}

serve(async (req: Request) => {
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Obtener los datos del reporte desde el body
    //    (El frontend nos envía los datos que ya consultó)
    const reportData = await req.json()
    if (!reportData) {
      throw new Error("No se recibieron datos del reporte.")
    }

    // 2. Inicializar Gemini
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" })

    // 3. Crear el Prompt
    const prompt = `
Eres un tutor académico y consejero experto. Estás analizando el reporte integral de un alumno para ayudar al docente a identificar los problemas clave.

Aquí están los datos del alumno:
- Nombre: ${reportData.student_name}
- Porcentaje de Asistencia: ${reportData.attendance.percentage}% (Total de sesiones: ${reportData.attendance.total_sessions}, Sesiones asistidas: ${reportData.attendance.attended_sessions})
- Promedio de Actividades: ${reportData.activities.average}
- Promedio de Evaluaciones: ${reportData.evaluations.average}

Por favor, genera un resumen en 2 o 3 viñetas concisas. Tu objetivo es darle al docente un punto de partida claro para su intervención.
- Identifica el problema MÁS URGENTE (ej. si la asistencia es < 80%, ese es el problema prioritario, ya que es un requisito).
- Compara el rendimiento entre actividades y evaluaciones para detectar discrepancias.
- Concluye con una recomendación accionable.
- Escribe en un tono profesional pero directo.
`

    // 4. Llamar a la API de Gemini
    const result = await model.generateContent(prompt)
    const response = await result.response
    const summaryText = response.text()

    // 5. Devolver el resumen
    return new Response(JSON.stringify({ summary: summaryText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Error in get-student-ia-summary:", error)
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})