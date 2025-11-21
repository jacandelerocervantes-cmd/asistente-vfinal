import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { materia_id } = await req.json();
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1. Obtener ID del Sheet
    const { data: materia } = await supabaseAdmin.from('materias').select('calificaciones_spreadsheet_id').eq('id', materia_id).single();
    if (!materia?.calificaciones_spreadsheet_id) throw new Error("Sin hoja de cálculo vinculada.");

    // 2. Pedir datos a Google Apps Script
    const googleUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    const response = await fetch(googleUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'leer_datos_asistencia',
        calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id
      })
    });

    if (!response.ok) throw new Error("Error conectando con Google.");
    const googleData = await response.json();
    if (googleData.status === 'error') throw new Error(googleData.message);

    const registros = googleData.asistencias || [];
    if (registros.length === 0) {
        return new Response(JSON.stringify({ message: "No se encontraron registros en el Sheet para sincronizar." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 3. Obtener IDs de alumnos (Mapa Matrícula -> ID)
    const { data: alumnos } = await supabaseAdmin.from('alumnos').select('id, matricula').eq('materia_id', materia_id);
    const mapaAlumnos = new Map(alumnos?.map(a => [a.matricula, a.id]));

    // 4. Preparar Upserts
    let insertados = 0;
    let omitidos = 0;

    for (const reg of registros) {
        const alumno_id = mapaAlumnos.get(reg.matricula);
        if (alumno_id) {
            const { error } = await supabaseAdmin.from('asistencias').upsert({
                materia_id,
                alumno_id,
                fecha: reg.fecha,
                unidad: reg.unidad,
                sesion: reg.sesion,
                presente: reg.presente
            }, { onConflict: 'fecha,unidad,sesion,alumno_id' });
            
            if (!error) insertados++;
        } else {
            omitidos++;
        }
    }

    return new Response(JSON.stringify({ 
        message: "Sincronización completada.",
        insertados,
        omitidos_matricula_no_encontrada: omitidos
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});