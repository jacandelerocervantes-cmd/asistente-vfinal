// supabase/functions/finalizar-sesion-asistencia/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "supabase";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- ¡NUEVO! Definimos tipos para mayor claridad y seguridad ---
interface Alumno {
  id: number;
  matricula: string;
  nombre: string;
  apellido: string;
}

interface Asistencia {
  alumno_id: number;
  presente: boolean;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { materia_id, unidad, sesion } = await req.json();
    
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get("Authorization")!;
    const { data: { user } } = await createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();

    if (!user) throw new Error("Usuario no autenticado.");

    const fechaHoy = new Date().toISOString().slice(0, 10);

    const { data: materia, error: materiaError } = await supabaseAdmin
        .from("materias").select("id, nombre, drive_url").eq("id", materia_id).single();
    if (materiaError || !materia) throw new Error("Materia no encontrada.");
    
    const { data: todosLosAlumnos, error: alumnosError } = await supabaseAdmin
      .from("alumnos").select("id, matricula, nombre, apellido").eq("materia_id", materia_id);
    if (alumnosError) throw alumnosError;

    const { data: presentesData } = await supabaseAdmin
      .from("asistencias").select("alumno_id, presente")
      .eq("materia_id", materia_id)
      .eq("fecha", fechaHoy).eq("unidad", unidad).eq("sesion", sesion);
    
    // Usamos el tipo 'Asistencia' que definimos
    const presentes = presentesData as Asistencia[];
    const presentesMap = new Map(presentes.map((p: Asistencia) => [p.alumno_id, p.presente]));

    // Usamos el tipo 'Alumno' que definimos
    const ausentes = (todosLosAlumnos as Alumno[])
      .filter((alumno: Alumno) => !presentesMap.has(alumno.id))
      .map((alumno: Alumno) => ({
        fecha: fechaHoy, unidad, sesion, presente: false,
        alumno_id: alumno.id, materia_id, user_id: user.id,
      }));

    if (ausentes.length > 0) {
      await supabaseAdmin.from("asistencias").insert(ausentes);
      ausentes.forEach(a => presentesMap.set(a.alumno_id, false));
    }
    
    const asistenciaFinal = (todosLosAlumnos as Alumno[]).map((alumno: Alumno) => ({
        matricula: alumno.matricula,
        nombre_completo: `${alumno.nombre} ${alumno.apellido}`.trim(),
        presente: presentesMap.get(alumno.id) || false
    }));
    
    const payload = {
        action: 'log_asistencia',
        drive_url: materia.drive_url,
        fecha: fechaHoy,
        unidad,
        sesion,
        asistencias: asistenciaFinal
    };

    let syncMessage = "Sincronización con Google Sheets omitida (la materia no tiene una URL de Drive).";
    const googleScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");

    if (googleScriptUrl && materia.drive_url) {
        fetch(googleScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }).catch(err => console.error('Error al llamar al Webhook de Google Script:', err.message));
        
        syncMessage = "Solicitud de sincronización con Google Sheets enviada.";
    }

    return new Response(JSON.stringify({ 
        message: "Sesión finalizada. Se registraron las inasistencias. " + syncMessage
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    });

  } catch (error) {
    console.error("ERROR en finalizar-sesion-asistencia:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
});