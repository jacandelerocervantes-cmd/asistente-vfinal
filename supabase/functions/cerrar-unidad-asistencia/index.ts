// supabase/functions/cerrar-unidad-asistencia/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { materia_id, unidad } = await req.json();

    const authHeader = req.headers.get("Authorization")!;
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");
    
    // Inserta en la tabla de unidades cerradas
    const { error: insertError } = await supabaseClient
      .from('unidades_cerradas')
      .insert({ materia_id, unidad, user_id: user.id });

    if (insertError) throw insertError;

    // Usa un cliente Admin para obtener todos los datos necesarios sin restricciones de RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const { data: materia, error: materiaError } = await supabaseAdmin
      .from("materias").select("drive_url").eq("id", materia_id).single();
    if (materiaError || !materia) throw new Error("Materia no encontrada.");
      
    const { data: todosLosAlumnos, error: alumnosError } = await supabaseAdmin
      .from("alumnos").select("id, matricula, nombre, apellido").eq("materia_id", materia_id);
    if (alumnosError) throw alumnosError;

    const { data: registros_asistencia, error: asistenciasError } = await supabaseAdmin
      .from("asistencias")
      .select("alumno_id, presente, fecha, sesion")
      .eq("materia_id", materia_id)
      .eq("unidad", unidad);
    if (asistenciasError) throw asistenciasError;
    
    const payload = {
        action: 'cerrar_unidad',
        drive_url: materia.drive_url,
        unidad,
        alumnos: todosLosAlumnos,
        registros_asistencia: registros_asistencia,
    };

    let syncMessage = "Sincronización omitida (la materia no tiene una URL de Drive).";
    const googleScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");

    if (googleScriptUrl && materia.drive_url) {
        const response = await fetch(googleScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
          console.error("Error al sincronizar el cierre de unidad con Google Script.");
        }
        syncMessage = `Resumen de la Unidad ${unidad} generado en Google Sheets.`;
    }

    return new Response(JSON.stringify({ message: syncMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    });

  } catch (error) {
    console.error("ERROR en cerrar-unidad-asistencia:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
});