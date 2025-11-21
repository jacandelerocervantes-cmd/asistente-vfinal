// supabase/functions/cerrar-unidad-asistencia/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { materia_id, unidad } = await req.json();
    if (!materia_id || !unidad) throw new Error("Faltan datos (materia_id, unidad).");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Obtener ID del Sheet
    const { data: materia, error: matError } = await supabaseAdmin
        .from('materias').select('calificaciones_spreadsheet_id').eq('id', materia_id).single();
    
    if (matError || !materia?.calificaciones_spreadsheet_id) throw new Error("No hay hoja de cálculo vinculada.");

    // 2. Llamar a Apps Script para calcular promedios
    const googleUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    const response = await fetch(googleUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'cerrar_unidad', // Asegúrate de que en code.js este caso llame a handleCerrarUnidadAsistencia
            calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id,
            unidad: unidad
        })
    });

    if (!response.ok) throw new Error("Error al conectar con Google.");
    const googleData = await response.json();
    if (googleData.status === 'error') throw new Error(googleData.message);

    // 3. ¡CORRECCIÓN RLS! Guardar el cierre en la Base de Datos DESDE AQUÍ (Backend)
    const { error: dbError } = await supabaseAdmin
        .from('unidades_cerradas')
        .insert({ materia_id, unidad })
        .ignoreDuplicates(); // Si ya estaba cerrada, no pasa nada

    if (dbError) throw new Error(`Error al guardar cierre en BD: ${dbError.message}`);

    return new Response(JSON.stringify({ 
        message: googleData.message || "Unidad cerrada correctamente." 
    }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
    });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
    });
  }
});