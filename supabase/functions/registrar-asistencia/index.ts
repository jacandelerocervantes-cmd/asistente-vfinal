// supabase/functions/registrar-asistencia/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // O tu URL específica en producción
  'Access-Control-Allow-Headers': 'apikey, content-type', // Solo lo necesario para una función pública
};

interface AsistenciaRequest {
    matricula: string;
    materia_id: number;
    unidad: number;
    sesion: number;
    token: string;
}

serve(async (req: Request) => {
  // Manejo de CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { matricula, materia_id, unidad, sesion, token }: AsistenciaRequest = await req.json();

    // Validar inputs básicos
    if (!matricula || !materia_id || !unidad || !sesion || !token) {
        throw new Error("Faltan datos requeridos (matrícula, materia, unidad, sesión, token).");
    }

    // Usar cliente Admin para validar token y buscar alumno (bypass RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Validar el token y la sesión activa
    const now = new Date().toISOString();
    const { data: sesionActiva, error: sesionError } = await supabaseAdmin
      .from('sesiones_activas')
      .select('id')
      .eq('materia_id', materia_id)
      .eq('unidad', unidad)
      .eq('sesion', sesion)
      .eq('token', token)
      .gte('expires_at', now) // Asegurarse que no haya expirado
      .maybeSingle(); // Puede que no exista o haya expirado

    if (sesionError) throw new Error(`Error al validar sesión: ${sesionError.message}`);
    if (!sesionActiva) {
        // Intentar buscar si existe pero ya expiró para dar mensaje más claro
        const { data: sesionExpirada } = await supabaseAdmin
            .from('sesiones_activas')
            .select('id')
            .eq('materia_id', materia_id)
            .eq('unidad', unidad)
            .eq('sesion', sesion)
            .eq('token', token)
            .single();
        if (sesionExpirada) {
             throw new Error("El código QR ha expirado. Pide al docente que genere uno nuevo.");
        } else {
             throw new Error("Código QR inválido o la sesión no coincide.");
        }
    }

    // 2. Buscar al alumno por matrícula y materia
    const { data: alumno, error: alumnoError } = await supabaseAdmin
      .from('alumnos')
      .select('id') // Solo necesitamos el ID del alumno
      .eq('matricula', matricula.toUpperCase()) // Asegurar mayúsculas
      .eq('materia_id', materia_id)
      .single(); // Esperamos encontrar un solo alumno

    if (alumnoError) throw new Error(`Error al buscar alumno: ${alumnoError.message}`);
    if (!alumno) throw new Error(`Matrícula "${matricula}" no encontrada para esta materia.`);

    const alumno_id = alumno.id;
    const fechaHoy = new Date().toISOString().slice(0, 10);

    // 3. Registrar la asistencia (Upsert: inserta o actualiza si ya existía)
    const { error: upsertError } = await supabaseAdmin
      .from('asistencias')
      .upsert({
          fecha: fechaHoy,
          unidad: unidad,
          sesion: sesion,
          alumno_id: alumno_id,
          materia_id: materia_id,
          presente: true, // Marcar como presente
          // user_id: null // No aplica user_id aquí, es registro del alumno
      }, {
          onConflict: 'fecha,unidad,sesion,alumno_id' // Clave única para evitar duplicados
      });

    if (upsertError) throw new Error(`Error al guardar asistencia: ${upsertError.message}`);

    // 4. (Opcional) Invalidar/Borrar token usado para evitar reutilización
    // await supabaseAdmin.from('sesiones_activas').delete().eq('id', sesionActiva.id);
    // O podrías marcarlo como usado en lugar de borrarlo.

    // 5. (Opcional) Enviar evento broadcast para UI en tiempo real del docente
    // Nota: Necesita configuración de Realtime en la tabla 'asistencias' y canal adecuado
    /*
    const channel = supabaseAdmin.channel(`asistencias-materia-${materia_id}`);
    await channel.send({
        type: 'broadcast',
        event: 'asistencia-registrada',
        payload: { alumno_id, unidad, sesion, presente: true, fecha: fechaHoy },
    });
    supabaseAdmin.removeChannel(channel);
    */

    // 6. Respuesta exitosa
    return new Response(JSON.stringify({ message: `¡Asistencia registrada con éxito para ${matricula}!` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    // Manejo de errores
    console.error("Error en registrar-asistencia:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400, // Usar 400 para errores de cliente (ej. token inválido, matrícula no encontrada)
    });
  }
});