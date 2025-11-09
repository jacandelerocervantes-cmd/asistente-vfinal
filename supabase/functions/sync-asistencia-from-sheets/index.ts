// EN: supabase/functions/sync-asistencia-from-sheets/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { materia_id } = await req.json();
    if (!materia_id) throw new Error("Se requiere 'materia_id'.");

    // 1. Obtener token de usuario (docente) para pasarlo a la RPC
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Usuario no autenticado.");
    
    // 2. Crear Admin Client para obtener datos de la materia
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: materia, error: materiaError } = await supabaseAdmin
      .from('materias')
      .select('calificaciones_spreadsheet_id')
      .eq('id', materia_id)
      .single();

    if (materiaError) throw materiaError;
    if (!materia?.calificaciones_spreadsheet_id) {
      throw new Error("La materia no tiene un Sheet de calificaciones/asistencia configurado.");
    }
    
    // 3. Llamar a Apps Script para LEER los datos
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("URL de Apps Script no configurada.");

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'leer_datos_asistencia',
        calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error(`Error en Apps Script (leer): ${await response.text()}`);
    const gasResult = await response.json();
    if (gasResult.status !== 'success' || !Array.isArray(gasResult.asistencias)) {
      throw new Error(`Apps Script reportó un error: ${gasResult.message || 'No se recibieron datos.'}`);
    }

    const asistenciasDesdeSheet = gasResult.asistencias;
    if (asistenciasDesdeSheet.length === 0) {
      return new Response(JSON.stringify({ message: "No se encontraron datos de asistencia en Google Sheets para sincronizar." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 4. Llamar a la función RPC de Supabase para hacer el UPSERT
    // Usamos un cliente con el token del *usuario* para que las RLS y el 'auth.uid()' en la RPC funcionen.
    const supabaseUserClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: rpcData, error: rpcError } = await supabaseUserClient.rpc(
      'sincronizar_asistencias_desde_sheet',
      {
        p_materia_id: materia_id,
        p_asistencias: asistenciasDesdeSheet
      }
    );

    if (rpcError) throw rpcError;

    return new Response(JSON.stringify(rpcData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});