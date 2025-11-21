// supabase/functions/finalizar-sesion-asistencia/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts'; // Usar cors compartido para consistencia

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

    // Validación de usuario (Opcional si confías en el cliente, pero buena práctica)
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
        const { data: { user }, error } = await createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
        ).auth.getUser();
        if (error || !user) throw new Error("Usuario no autenticado.");
    }

    const fechaHoy = new Date().toISOString().slice(0, 10);

    // 1. CORRECCIÓN CRÍTICA: Obtener el ID del Sheet, no la URL de Drive
    const { data: materia, error: materiaError } = await supabaseAdmin
        .from("materias")
        .select("id, nombre, calificaciones_spreadsheet_id") // <--- CAMBIO AQUÍ
        .eq("id", materia_id)
        .single();

    if (materiaError || !materia) throw new Error("Materia no encontrada.");
    if (!materia.calificaciones_spreadsheet_id) throw new Error("La materia no tiene vinculado un archivo de calificaciones/asistencia.");
    
    const { data: todosLosAlumnos, error: alumnosError } = await supabaseAdmin
      .from("alumnos").select("id, matricula, nombre, apellido").eq("materia_id", materia_id);
    if (alumnosError) throw alumnosError;

    // Lógica de rellenar ausentes (Tu lógica original estaba perfecta aquí)
    const { data: presentesData } = await supabaseAdmin
      .from("asistencias").select("alumno_id, presente")
      .eq("materia_id", materia_id)
      .eq("fecha", fechaHoy).eq("unidad", unidad).eq("sesion", sesion);
    
    const presentes = (presentesData || []) as Asistencia[];
    const presentesMap = new Map(presentes.map((p) => [p.alumno_id, p.presente]));

    const ausentes = (todosLosAlumnos as Alumno[])
      .filter((alumno) => !presentesMap.has(alumno.id))
      .map((alumno) => ({
        fecha: fechaHoy, unidad, sesion, presente: false,
        alumno_id: alumno.id, materia_id, 
        // user_id: user.id // Omitimos user_id si usamos service role directo
      }));

    if (ausentes.length > 0) {
      await supabaseAdmin.from("asistencias").insert(ausentes);
      ausentes.forEach(a => presentesMap.set(a.alumno_id, false));
    }
    
    const asistenciaFinal = (todosLosAlumnos as Alumno[]).map((alumno) => ({
        matricula: alumno.matricula,
        nombre_completo: `${alumno.nombre} ${alumno.apellido}`.trim(),
        presente: presentesMap.get(alumno.id) || false
    }));
    
    const payload = {
        action: 'log_asistencia',
        calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id, // <--- CAMBIO AQUÍ
        fecha: fechaHoy,
        unidad,
        sesion,
        asistencias: asistenciaFinal
    };

    const googleScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    let googleResult = null;

    if (googleScriptUrl) {
        const response = await fetch(googleScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(`Error de Apps Script: ${responseText}`);
        }
        googleResult = JSON.parse(responseText);
    }

    return new Response(JSON.stringify({ 
        message: "Sesión finalizada y sincronizada.",
        google_result: googleResult
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    });

  } catch (error) {
    console.error("ERROR en finalizar-sesion-asistencia:", error);
    return new Response(JSON.stringify({ message: error instanceof Error ? error.message : "Error desconocido" }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
});