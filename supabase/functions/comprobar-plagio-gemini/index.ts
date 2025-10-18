// supabase/functions/comprobar-plagio-gemini/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlagioRequest {
  drive_file_ids: string[];
  materia_id: number;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  try {
    const { drive_file_ids, materia_id }: PlagioRequest = await req.json();
    if (!drive_file_ids || drive_file_ids.length < 2) {
      throw new Error("Se requieren al menos dos trabajos para comparar.");
    }
    if (!materia_id) {
      throw new Error("Se requiere el ID de la materia para guardar el reporte.");
    }

    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: materia, error: materiaError } = await supabase
      .from('materias')
      .select('drive_url') // Obtenemos la URL de la carpeta de la materia
      .eq('id', materia_id)
      .single();

    if (materiaError) throw materiaError;
    if (!materia || !materia.drive_url) throw new Error("La materia no tiene una URL de Drive configurada.");

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");
    
    const scriptResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'get_multiple_file_contents', drive_file_ids: drive_file_ids }),
      headers: { 'Content-Type': 'application/json' },
    });
    
    const scriptResult = await scriptResponse.json();
    if (scriptResult.status !== 'success') {
      throw new Error(`Apps Script devolvió un error: ${scriptResult.message}`);
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("La API Key de Gemini no está configurada.");

    let prompt = `Eres un asistente experto en detección de plagio académico...`; // Tu prompt aquí
    scriptResult.contenidos.forEach((contenido: { fileId: string; texto: string }) => {
      prompt += `\n\n--- TRABAJO fileId: ${contenido.fileId} ---\n${contenido.texto}\n--- FIN TRABAJO ---`;
    });
    
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

    if (plagioReport.reporte_plagio && plagioReport.reporte_plagio.length > 0) {
      const saveReportResponse = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'guardar_reporte_plagio',
          drive_url_materia: materia.drive_url,
          reporte_plagio: plagioReport.reporte_plagio
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!saveReportResponse.ok) {
        console.error("Error al guardar el reporte de plagio. La respuesta no fue OK.");
      }
    }

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