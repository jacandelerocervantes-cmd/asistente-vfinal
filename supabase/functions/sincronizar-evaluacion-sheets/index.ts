import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { actividad_id } = await req.json();
    console.log(`>>> INICIANDO SINCRONIZACIÓN para Actividad ID: ${actividad_id}`); // LOG 1

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Obtener info de la actividad
    const { data: actividad, error: actError } = await supabaseClient
      .from('actividades')
      .select('nombre, unidad, materia_id, materias(drive_url)')
      .eq('id', actividad_id)
      .single();

    if (actError || !actividad) throw new Error("Actividad no encontrada");
    console.log(`Actividad: "${actividad.nombre}" | Unidad: ${actividad.unidad}`); // LOG 2

    // 2. Llamar a Apps Script
    const appsScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!;
    
    console.log(`Buscando reporte para actividad: "${actividad.nombre}" en unidad ${actividad.unidad}`);
    console.log("Contactando a Google Apps Script para leer reporte..."); // LOG 3
    
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'leer_reporte_detallado',
        // @ts-ignore: Supabase types
        drive_url_materia: actividad.materias.drive_url,
        unidad: actividad.unidad,
        nombre_actividad: actividad.nombre
      })
    });

    const gasData = await response.json();
    if (gasData.status !== 'success') {
        console.error("Error Apps Script:", gasData);
        throw new Error("Error leyendo Reporte en Drive: " + (gasData.message || 'Desconocido'));
    }
    
    const resultadosDrive = gasData.calificaciones; // Array [{matricula, retroalimentacion, ...}]
    console.log(`Registros recuperados del Reporte en Drive: ${resultadosDrive?.length || 0}`); // LOG 4

    if (!resultadosDrive || resultadosDrive.length === 0) {
        return new Response(JSON.stringify({ message: "El reporte en Drive está vacío o no se pudo leer." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Preparar Datos de Alumnos para Match
    const { data: alumnos } = await supabaseClient
        .from('alumnos')
        .select('id, matricula')
        .eq('materia_id', actividad.materia_id);
    
    const mapAlumnos = new Map(alumnos?.map(a => [a.matricula.toUpperCase().trim(), a.id]));
    console.log(`Alumnos en BD para esta materia: ${mapAlumnos.size}`); // LOG 5

    // 4. Procesar Actualización
    let actualizados = 0;
    let noEncontrados = 0;

    for (const item of resultadosDrive) {
        const matriculaLimpia = String(item.matricula).toUpperCase().trim();
        const alumnoId = mapAlumnos.get(matriculaLimpia);

        if (alumnoId) {
            // LOG DE PROGRESO (Opcional, puede saturar si son muchos)
            // console.log(`Actualizando alumno ${matriculaLimpia}...`); 

            const { error: upError } = await supabaseClient
                .from('calificaciones')
                .update({ 
                    retroalimentacion: item.retroalimentacion,
                    estado: 'calificado' // Aseguramos el estado
                })
                .eq('actividad_id', actividad_id)
                .eq('alumno_id', alumnoId);
            
            if (!upError) actualizados++;
            else console.error(`Error actualizando ${matriculaLimpia}:`, upError.message);
        } else {
            console.warn(`Matrícula en Reporte NO encontrada en BD: "${matriculaLimpia}"`);
            noEncontrados++;
        }
    }

    const mensajeFinal = `Sincronización completada. ${actualizados} registros actualizados desde el Reporte de Actividad. (${noEncontrados} matrículas no coincidieron)`;
    console.log(mensajeFinal); // LOG FINAL

    return new Response(JSON.stringify({ 
        message: mensajeFinal
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error("CRITICAL ERROR en sincronizar-evaluacion-sheets:", error);
    // @ts-ignore: error type
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});