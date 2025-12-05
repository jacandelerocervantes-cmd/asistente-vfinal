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

    // Usamos el cliente Admin para saltarnos las RLS y poder escribir/leer con privilegios
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Validar que la sesión del QR siga activa (tiempo y token)
    const now = new Date().toISOString();
    
    // Solo necesitamos el ID para confirmar existencia y actualizar logs después
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
    // Recuperamos el array actual o iniciamos uno vacío para el log
    const alumnosQueYaUsaron = sesionActiva.usado_por || [];

    // 2. Buscar al alumno (con tolerancia a duplicados en la BD)
    const { data: alumno, error: alumnoError } = await supabaseAdmin
      .from('alumnos')
      .select('id')
      .eq('matricula', matricula.toUpperCase())
      .eq('materia_id', materia_id)
      .limit(1)       // <--- Toma solo el primero encontrado
      .maybeSingle(); // <--- Evita error si hay múltiples (aunque no debería)

    if (alumnoError) throw new Error(`Error buscando alumno: ${alumnoError.message}`);
    if (!alumno) throw new Error(`Matrícula "${matricula}" no encontrada en esta materia.`);

    const alumno_id = alumno.id;
    const fechaHoy = new Date().toISOString().slice(0, 10);

    // --- CORRECCIÓN CRÍTICA (SOLUCIÓN DE "RACE CONDITION" HUMANA) ---
    // 3. Verificar ESTADO REAL en la tabla 'asistencias'
    // En lugar de ver si "ya usó el QR", vemos si "ya tiene asistencia hoy".
    // Si el profe se la quitó manual, esto devolverá null o false, permitiendo registrar de nuevo.
    const { data: asistenciaExistente } = await supabaseAdmin
        .from('asistencias')
        .select('presente')
        .eq('materia_id', materia_id)
        .eq('alumno_id', alumno_id)
        .eq('fecha', fechaHoy)
        .eq('unidad', unidad)
        .eq('sesion', sesion)
        .maybeSingle();

    // Si existe registro Y está marcado como presente, bloqueamos.
    if (asistenciaExistente && asistenciaExistente.presente) {
        return new Response(JSON.stringify({ message: `Ya registraste tu asistencia.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200, // Devolvemos 200 (OK) pero con mensaje informativo
        });
    }

    // 4. Registrar/Actualizar asistencia (Upsert)
    // Esto fuerza 'presente: true' incluso si antes estaba en false (borrado lógico) o no existía.
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

    // 5. Actualizar el log del QR (Auditoría)
    // Esto es solo para estadística interna, no afecta la lógica de permiso.
    // Solo agregamos el ID si no estaba en la lista del log para no llenarlo de duplicados.
    if (!alumnosQueYaUsaron.includes(alumno_id)) {
        const nuevosUsadoPor = [...alumnosQueYaUsaron, alumno_id];
        // Ejecutamos update sin await para no bloquear la respuesta al usuario (fire and forget)
        supabaseAdmin.from('sesiones_activas')
            .update({ usado_por: nuevosUsadoPor })
            .eq('id', sesionId)
            .then(({ error }) => {
                if (error) console.error("Error actualizando log de sesión:", error);
            });
    }

    // NOTA: Eliminamos el bloque de Realtime Broadcast manual.
    // Como tu frontend ahora escucha directamente a la DB (postgres_changes), 
    // la inserción en el paso 4 disparará la actualización automáticamente.

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