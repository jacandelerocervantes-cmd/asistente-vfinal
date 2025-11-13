// supabase/functions/get-student-holistic-report/index.ts
import { serve } from 'std/http/server.ts'
import { createClient } from '@supabase/supabase-js'
import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

// --- Define interfaces for type safety ---
interface AttendanceStats {
  sesiones_totales: number;
  sesiones_asistidas: number;
  porcentaje_asistencia: number;
}

interface ActividadCalificacionResponse {
  calificacion_obtenida: number;
  actividades: { // Can be an object or an array of objects
    nombre: string;
  } | { nombre: string; }[] | null;
}

interface EvaluacionCalificacionResponse {
  calificacion_final: number;
  evaluaciones: { // Can be an object or an array of objects
    titulo: string;
  } | { titulo: string; }[] | null;
}

serve(async (req: Request) => {
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { alumno_id, materia_id } = await req.json()
    if (!alumno_id || !materia_id) {
      throw new Error('Faltan "alumno_id" o "materia_id".')
    }

    // Usar cliente Admin para tener acceso completo a las tablas
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Obtener nombre del alumno
    const { data: alumnoData, error: alumnoError } = await supabaseAdmin
      .from('alumnos')
      .select('nombre, apellido')
      .eq('id', alumno_id)
      .single()
    if (alumnoError) throw new Error(`Error buscando alumno: ${alumnoError.message}`)

    // 2. Obtener estadísticas de asistencia (usando la RPC con tipo genérico)
    const { data: asistenciaData, error: asistenciaError }: PostgrestSingleResponse<AttendanceStats> = await supabaseAdmin
      .rpc('get_student_attendance_stats', {
        p_alumno_id: alumno_id,
        p_materia_id: materia_id,
      })
      .single()
    if (asistenciaError) throw new Error(`Error en RPC de asistencia: ${asistenciaError.message}`)
    
    // 3. Obtener calificaciones de ACTIVIDADES
    const { data: actividadesData, error: actividadesError }: PostgrestSingleResponse<ActividadCalificacionResponse[]> = await supabaseAdmin
      .from('calificaciones')
      .select(`
        calificacion_obtenida,
        actividades!inner( nombre )
      `)
      .eq('alumno_id', alumno_id)
      .eq('materia_id', materia_id)
      .eq('estado', 'calificado')
      .not('actividad_id', 'is', null) // Asegurar que es una actividad
      
    if (actividadesError) throw new Error(`Error buscando actividades: ${actividadesError.message}`)

    // 4. Obtener calificaciones de EVALUACIONES
    const { data: evaluacionesData, error: evaluacionesError }: PostgrestSingleResponse<EvaluacionCalificacionResponse[]> = await supabaseAdmin
      .from('intentos_evaluacion')
      .select(`
        calificacion_final,
        evaluaciones!inner( titulo )
      `)
      .eq('alumno_id', alumno_id)
      .eq('evaluaciones.materia_id', materia_id) // Filtra por materia
      .eq('estado', 'calificado')
      .neq('evaluaciones.id', null) // Asegura que la evaluación existe

    if (evaluacionesError) throw new Error(`Error buscando evaluaciones: ${evaluacionesError.message}`)

    // 5. Procesar y formatear la respuesta
    const activities = (actividadesData || []).filter(act => act.actividades).map(act => {
      const actividad = Array.isArray(act.actividades) ? act.actividades[0] : act.actividades;
      return {
      name: actividad!.nombre,
      grade: act.calificacion_obtenida,
    }});
    const activity_average = activities.length > 0
      ? activities.reduce((acc, act) => acc + act.grade, 0) / activities.length
      : 0

    const evaluations = (evaluacionesData || []).filter(ev => ev.evaluaciones).map(ev => {
      const evaluacion = Array.isArray(ev.evaluaciones) ? ev.evaluaciones[0] : ev.evaluaciones;
      return {
      name: evaluacion!.titulo,
      grade: ev.calificacion_final,
    }});
    const evaluation_average = evaluations.length > 0
      ? evaluations.reduce((acc, ev) => acc + ev.grade, 0) / evaluations.length
      : 0

    const report = {
      student_name: `${alumnoData.nombre} ${alumnoData.apellido}`,
      attendance: {
        total_sessions: asistenciaData?.sesiones_totales ?? 0,
        attended_sessions: asistenciaData?.sesiones_asistidas ?? 0,
        percentage: parseFloat((asistenciaData?.porcentaje_asistencia ?? 0).toFixed(1))
      },
      activities: {
        list: activities,
        average: parseFloat(activity_average.toFixed(1))
      },
      evaluations: {
        list: evaluations,
        average: parseFloat(evaluation_average.toFixed(1))
      }
    }

    // 6. Devolver el reporte completo
    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
