import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { actividad_id } = await req.json();
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Obtener info de la actividad
    const { data: actividad, error: actError } = await supabaseClient
      .from('actividades')
      .select('materia_id, nombre, unidad, materias(drive_url)')
      .eq('id', actividad_id)
      .single();

    if (actError || !actividad) throw new Error("Actividad no encontrada");

    // 2. Llamar a Apps Script para leer el Excel
    const appsScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!;
    // @ts-ignore: Supabase types
    const driveUrl = Array.isArray(actividad.materias) ? actividad.materias[0]?.drive_url : actividad.materias?.drive_url;

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'leer_reporte_detallado',
        drive_url_materia: driveUrl,
        unidad: actividad.unidad,
        nombre_actividad: actividad.nombre
      })
    });

    const gasData = await response.json();
    if (gasData.status !== 'success') {
        throw new Error("Error leyendo Excel: " + (gasData.message || 'Desconocido'));
    }
    
    const resultadosExcel = gasData.calificaciones; // Array [{matricula, retroalimentacion, ...}]
    if (!resultadosExcel || resultadosExcel.length === 0) {
        return new Response(JSON.stringify({ message: "El reporte en Excel está vacío." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Actualizar Supabase
    let actualizados = 0;
    
    // Obtenemos IDs de alumnos por matrícula para hacer el match
    const { data: alumnos } = await supabaseClient.from('alumnos').select('id, matricula').eq('materia_id', actividad.materia_id);
    const mapAlumnos = new Map(alumnos?.map(a => [a.matricula.toUpperCase().trim(), a.id]));

    for (const item of resultadosExcel) {
        const alumnoId = mapAlumnos.get(item.matricula);
        if (alumnoId) {
            const { error: upError } = await supabaseClient
                .from('calificaciones')
                .update({ 
                    retroalimentacion: item.retroalimentacion,
                    // Opcional: sincronizar nota también si quieres
                    // calificacion_obtenida: item.calificacion 
                })
                .eq('actividad_id', actividad_id)
                .eq('alumno_id', alumnoId);
            
            if (!upError) actualizados++;
        }
    }

    return new Response(JSON.stringify({ 
        message: `Sincronización completada. ${actualizados} registros actualizados desde el Excel.` 
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});