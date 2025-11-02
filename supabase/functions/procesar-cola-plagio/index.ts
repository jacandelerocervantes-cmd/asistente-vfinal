// supabase/functions/procesar-cola-plagio/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

// --- CORRECCIÓN: Añadir una función de "sleep" (pausa) ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Función para extraer JSON de la respuesta de Gemini
function extractJson(text: string): Record<string, unknown>[] | null {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch (e) {
        console.error("Fallo al parsear JSON del reporte de plagio:", e);
        return null;
    }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  // Seguridad: Solo permitir ejecución desde un Cron Job o llamada interna
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response(JSON.stringify({ message: 'No autorizado' }), { status: 401 });
  }

  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let jobId: number | null = null;

  try {
    // 1. Obtener UN trabajo pendiente y marcarlo como procesando
    const { data: job, error: jobError } = await supabaseAdmin
      .from('plagio_jobs')
      .select('*')
      .eq('status', 'pendiente')
      .order('created_at')
      .limit(1)
      .single();

    if (jobError) {
        // Si no hay filas, no es un error, simplemente no hay trabajo que hacer.
        if (jobError.code === 'PGRST116') {
            return new Response(JSON.stringify({ message: "No hay trabajos de plagio pendientes." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        throw jobError;
    }
    jobId = job.id;
    await supabaseAdmin.from('plagio_jobs').update({ status: 'procesando' }).eq('id', jobId);

    // 2. Obtener textos de Google Drive
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("URL de Apps Script no configurada.");

    const contentsRes = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_multiple_file_contents', drive_file_ids: job.drive_file_ids }),
    });
    if (!contentsRes.ok) throw new Error(`Error en Apps Script (get_multiple_file_contents): ${await contentsRes.text()}`);
    const contentsJson = await contentsRes.json();
    if (contentsJson.status !== 'success') throw new Error(contentsJson.message);

    const textos = contentsJson.contenidos.filter((c: any) => c.texto && !c.error).map((c: any) => ({ id: c.fileId, texto: c.texto }));
    if (textos.length < 2) throw new Error("No se pudo obtener el texto de al menos dos trabajos para comparar.");

    // 3. Llamar a Gemini para la comparación
    const prompt = `Compara los siguientes textos en busca de plagio entre ellos. Devuelve un array de objetos JSON, donde cada objeto representa un par de trabajos con similitud. Cada objeto debe tener las claves "trabajo_A_id", "trabajo_B_id", "porcentaje_similitud" (un número de 0 a 100), y "fragmentos_similares" (un array de strings con los fragmentos idénticos o muy similares). Si no hay plagio, devuelve un array vacío []. Formato de respuesta: [{"trabajo_A_id": "ID_1", "trabajo_B_id": "ID_2", "porcentaje_similitud": 95, "fragmentos_similares": ["fragmento 1", "fragmento 2"]}]. Los textos son:\n\n${textos.map((t: any) => `--- TRABAJO ID: ${t.id} ---\n${t.texto}\n\n`).join('')}`;
    
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada.");

    // --- CORRECCIÓN: Pausa de 1.5 segundos para evitar el Rate Limit de Gemini ---
    console.log(`Pausando 1.5s antes de llamar a Gemini API...`);
    await sleep(1500);

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!geminiResponse.ok) throw new Error(`Error en API Gemini: ${await geminiResponse.text()}`);
    const geminiData = await geminiResponse.json();
    const rawGeminiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawGeminiText) throw new Error("Respuesta inesperada de Gemini.");

    const reportePlagio = extractJson(rawGeminiText);

    // 4. Guardar el reporte en Google Sheets
    const reportePayload = {
      action: 'guardar_reporte_plagio',
      materia_id: job.materia_id, // Necesitamos el ID de la materia
      reporte_plagio: reportePlagio || []
    };
    const reporteRes = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportePayload),
    });
    if (!reporteRes.ok) throw new Error(`Error en Apps Script (guardar_reporte_plagio): ${await reporteRes.text()}`);
    const reporteJson = await reporteRes.json();
    if (reporteJson.status !== 'success') throw new Error(reporteJson.message);

    // 5. Actualizar el trabajo como completado
    await supabaseAdmin.from('plagio_jobs').update({ status: 'completado', resultado_plagio: reportePlagio }).eq('id', jobId);

    return new Response(JSON.stringify({ message: `Trabajo de plagio ${jobId} completado.` }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    if (jobId) {
      await supabaseAdmin.from('plagio_jobs').update({ status: 'fallido', ultimo_error: message }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
