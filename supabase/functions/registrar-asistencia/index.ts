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
      .select('id, usado_por') // <-- OBTENER TAMBIÉN 'usado_por'
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
             throw new Error("Código QR inválido o expirado.");
        }
    }
    const sesionId = sesionActiva.id;
    const alumnosQueYaUsaron = sesionActiva.usado_por || []; // Array de IDs que ya usaron este token

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

    // --- 3. VERIFICAR SI ESTE ALUMNO YA USÓ ESTE TOKEN ---
    if (alumnosQueYaUsaron.includes(alumno_id)) {
        console.log(`Intento duplicado: Alumno ${alumno_id} ya usó el token para sesión ${sesionId}.`);
        // Devolver un mensaje claro, pero podría ser un 200 OK para no confundir al alumno
        // O un 409 Conflict si prefieres indicar el duplicado
        return new Response(JSON.stringify({ message: `Asistencia ya registrada previamente para ${matricula}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200, // O 409
        });
    }
    // --- FIN VERIFICACIÓN ---


    // 4. Registrar la asistencia (Upsert: inserta o actualiza si ya existía)
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

    // --- 5. AÑADIR alumno_id al array 'usado_por' de la sesión activa ---
    // Usamos array_append para añadir el ID de forma segura (evita duplicados si hay condiciones de carrera)
    // O podemos simplemente construir el nuevo array
    const nuevosUsadoPor = [...alumnosQueYaUsaron, alumno_id];
    const { error: updateSesionError } = await supabaseAdmin
        .from('sesiones_activas')
        .update({ usado_por: nuevosUsadoPor }) // Actualizar el array completo
        .eq('id', sesionId); // Actualizar solo esta sesión

    if (updateSesionError) {
        // Loguear el error pero no fallar la respuesta al alumno, ya que la asistencia sí se guardó
        console.error(`Error al actualizar 'usado_por' para sesión ${sesionId}:`, updateSesionError.message);
    } else {
        console.log(`Alumno ${alumno_id} añadido a 'usado_por' para sesión ${sesionId}.`);
    }
    // --- FIN ACTUALIZACIÓN 'usado_por' ---


    // 6. (Opcional) Enviar evento broadcast
    console.log(`Enviando broadcast a canal: asistencias-materia-${materia_id}`); // Log para verificar
    try {
        // Crear cliente *con clave de servicio* para enviar broadcast
         const supabaseServiceRoleClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
         );
        const channelName = `asistencias-materia-${materia_id}`;
        const channel = supabaseServiceRoleClient.channel(channelName);

        // Es importante hacer el 'subscribe' aunque solo vayas a enviar,
        // para asegurar que el canal esté listo.
        // Usamos una promesa para esperar a que la suscripción se confirme o falle.
        const subscribePromise = new Promise((resolve, reject) => {
            channel.subscribe((status, err) => {
                if (status === 'SUBSCRIBED') {
                    console.log(`Suscrito temporalmente a ${channelName} para enviar.`);
                    resolve(status);
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    console.error(`Error al suscribir a ${channelName} para enviar:`, err || status);
                    reject(new Error(`Fallo al suscribir al canal: ${err?.message || status}`));
                }
            });
        });

        // Esperar máximo 5 segundos por la suscripción
        await Promise.race([
            subscribePromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout esperando suscripción para broadcast")), 5000))
        ]);


        // Una vez suscrito (o si ya estaba listo), enviar el evento
        const status = await channel.send({
            type: 'broadcast',
            event: 'asistencia-registrada', // Nombre del evento que escuchará el frontend
            payload: { // Datos que quieres enviar
                alumno_id: alumno_id,
                unidad: unidad,
                sesion: sesion,
                presente: true,
                fecha: fechaHoy
            },
        });

        console.log(`Estado del envío de broadcast: ${status}`); // Debería ser 'ok' o 'error'

        if (status !== 'ok') {
             console.warn("El envío de broadcast no retornó 'ok'. Puede que el mensaje no llegue.");
        }

    } catch (broadcastError) {
         // Capturar errores específicos del broadcast y loguearlos, pero no detener la respuesta exitosa al alumno
         console.error("Error durante el proceso de broadcast:", broadcastError);
    }
    // --- FIN SECCIÓN BROADCAST ---

    // 7. Respuesta exitosa
    console.log(`Asistencia registrada OK para ${matricula}.`);
    return new Response(JSON.stringify({ message: `¡Asistencia registrada con éxito para ${matricula}!` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    // Manejo de errores
    console.error("Error general en registrar-asistencia:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400, // Usar 400 para errores de cliente (ej. token inválido, matrícula no encontrada)
    });
  }
});