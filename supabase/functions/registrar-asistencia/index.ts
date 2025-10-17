// supabase/functions/registrar-asistencia/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- Cabeceras CORS para permitir peticiones desde el navegador ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define la estructura de los datos que esperamos recibir
interface AsistenciaRequest {
  matricula: string;
  materia_id: number;
  unidad: number;
  sesion: number;
  token: string; // El token temporal para validar la sesión
}

serve(async (req: Request) => {
  // --- Manejo de la petición de sondeo (pre-vuelo) OPTIONS ---
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { matricula, materia_id, unidad, sesion, token }: AsistenciaRequest = await req.json();
    if (!token) {
      throw new Error("Token de sesión faltante.");
    }

    // Usamos la Service Role Key para operaciones seguras en el backend
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. VALIDAR QUE LA SESIÓN DEL QR ESTÉ ACTIVA Y EL TOKEN SEA VÁLIDO
    const { data: sesionValida, error: sesionError } = await supabaseAdmin
      .from("sesiones_activas")
      .select("id")
      .eq("materia_id", materia_id)
      .eq("unidad", unidad)
      .eq("sesion", sesion)
      .eq("token", token)
      .gt("expires_at", "now()") // Verifica que el token no haya expirado
      .single();

    if (sesionError || !sesionValida) {
      throw new Error("Sesión de asistencia no activa o enlace inválido.");
    }

    // 2. BUSCAR AL ALUMNO POR SU MATRÍCULA
    const { data: alumno, error: alumnoError } = await supabaseAdmin
      .from("alumnos")
      .select("id, user_id") // user_id es el ID del docente
      .eq("matricula", matricula.toUpperCase())
      .eq("materia_id", materia_id)
      .single();

    if (alumnoError || !alumno) {
      throw new Error("Matrícula no encontrada en esta materia.");
    }

    // 3. VERIFICAR SI YA EXISTE UN REGISTRO PARA EVITAR DUPLICADOS
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const { data: asistenciaExistente, error: checkError } = await supabaseAdmin
      .from("asistencias")
      .select("id")
      .eq("alumno_id", alumno.id)
      .eq("fecha", fechaHoy)
      .eq("unidad", unidad)
      .eq("sesion", sesion)
      .maybeSingle();

    if (checkError) throw checkError;
    if (asistenciaExistente) {
      throw new Error("Asistencia ya registrada previamente.");
    }

    // 4. INSERTAR EL NUEVO REGISTRO DE ASISTENCIA
    const { data: nuevoRegistro, error: insertError } = await supabaseAdmin
      .from("asistencias")
      .insert({
        fecha: fechaHoy,
        unidad,
        sesion,
        presente: true,
        alumno_id: alumno.id,
        materia_id,
        user_id: alumno.user_id, // Asigna el registro al docente correcto
      })
      .select() // Pide que te devuelva el registro que acabas de insertar
      .single();

    if (insertError) throw insertError;

    // 5. ¡SOLUCIÓN! ENVIAR NOTIFICACIÓN MANUAL DE REALTIME
    // Esto es necesario porque las operaciones con SERVICE_ROLE_KEY no emiten eventos de Realtime por defecto.
    const channel = supabaseAdmin.channel(`asistencias-materia-${materia_id}`);
    await channel.send({
      type: 'broadcast',
      event: 'asistencia-registrada',
      payload: nuevoRegistro, // Enviamos el registro completo que acabamos de crear
    });

    return new Response(
      JSON.stringify({ message: "¡Asistencia registrada con éxito!" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(
      JSON.stringify({ message: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});