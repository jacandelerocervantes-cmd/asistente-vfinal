// supabase/functions/registrar-asistencia/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

interface AsistenciaRequest {
    matricula: string;
    materia_id: number;
    unidad: number;
    sesion: number;
    token: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { matricula, materia_id, unidad, sesion, token }: AsistenciaRequest = await req.json();

    if (!matricula || !materia_id || !unidad || !sesion || !token) {
        throw new Error("Faltan datos requeridos.");
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Validar sesión activa
    const now = new Date().toISOString();
    const { data: sesionActiva, error: sesionError } = await supabaseAdmin
      .from('sesiones_activas')
      .select('id, usado_por')
      .eq('materia_id', materia_id)
      .eq('unidad', unidad)
      .eq('sesion', sesion)
      .eq('token', token)
      .gte('expires_at', now)
      .maybeSingle();

    if (sesionError) throw new Error(`Error validando sesión: ${sesionError.message}`);
    if (!sesionActiva) throw new Error("Código QR inválido o expirado.");

    const sesionId = sesionActiva.id;
    const alumnosQueYaUsaron = sesionActiva.usado_por || [];

    // 2. Buscar alumno (CORRECCIÓN: Tolerancia a duplicados)
    const { data: alumno, error: alumnoError } = await supabaseAdmin
      .from('alumnos')
      .select('id')
      .eq('matricula', matricula.toUpperCase())
      .eq('materia_id', materia_id)
      .limit(1)       // <--- TOMA SOLO UNO
      .maybeSingle(); // <--- NO EXPLOTA SI HAY MÁS

    if (alumnoError) throw new Error(`Error buscando alumno: ${alumnoError.message}`);
    if (!alumno) throw new Error(`Matrícula "${matricula}" no encontrada en esta materia.`);

    const alumno_id = alumno.id;

    // 3. Verificar si ya registró
    if (alumnosQueYaUsaron.includes(alumno_id)) {
        return new Response(JSON.stringify({ message: `Ya registraste tu asistencia.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
    }

    // 4. Registrar asistencia (Upsert)
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const { error: upsertError } = await supabaseAdmin
      .from('asistencias')
      .upsert({
          fecha: fechaHoy,
          unidad: unidad,
          sesion: sesion,
          alumno_id: alumno_id,
          materia_id: materia_id,
          presente: true
      }, { onConflict: 'fecha,unidad,sesion,alumno_id' });

    if (upsertError) throw new Error(`Error guardando asistencia: ${upsertError.message}`);

    // 5. Actualizar el uso del QR
    const nuevosUsadoPor = [...alumnosQueYaUsaron, alumno_id];
    await supabaseAdmin.from('sesiones_activas').update({ usado_por: nuevosUsadoPor }).eq('id', sesionId);

    // 6. Enviar señal en tiempo real (Broadcast)
    try {
        const channel = supabaseAdmin.channel(`asistencias-materia-${materia_id}`);
        channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                channel.send({
                    type: 'broadcast',
                    event: 'asistencia-registrada',
                    payload: { alumno_id, unidad, sesion, presente: true, fecha: fechaHoy }
                });
            }
        });
    } catch (e) { console.error("Error broadcast:", e); }

    return new Response(JSON.stringify({ message: `¡Asistencia registrada: ${matricula}!` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});