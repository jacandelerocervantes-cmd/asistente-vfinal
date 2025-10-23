// supabase/functions/sincronizar-evaluacion-sheets/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Ajusta en producción
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestPayload {
    evaluacion_id: number;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Autenticación del docente
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Se requiere cabecera de autorización.");

    const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    const { evaluacion_id }: RequestPayload = await req.json();
    if (!evaluacion_id) {
      throw new Error("Falta el parámetro 'evaluacion_id'.");
    }

    console.log(`Iniciando sincronización para evaluación ID: ${evaluacion_id} por usuario ${user.id}`);

    // Usar cliente Admin para asegurar acceso a todos los datos necesarios
    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Obtener datos de la evaluación y materia (incluyendo el ID de Sheets)
    const { data: evaluacionData, error: evalError } = await supabaseAdmin
        .from('evaluaciones')
        .select(`
            id,
            titulo,
            unidad,
            materias (
                id,
                calificaciones_spreadsheet_id
            )
        `)
        .eq('id', evaluacion_id)
        .eq('user_id', user.id) // Asegurar que el docente sea el dueño
        .single();

    if (evalError) throw new Error(`Error al obtener evaluación: ${evalError.message}`);
    if (!evaluacionData) throw new Error("Evaluación no encontrada o no pertenece al usuario.");

    // Supabase puede devolver la relación como un array, tomamos el primer elemento.
    const materia = (Array.isArray(evaluacionData.materias) ? evaluacionData.materias[0] : evaluacionData.materias) as { id: number; calificaciones_spreadsheet_id: string | null; } | null;

    if (!materia || !materia.calificaciones_spreadsheet_id) {
        throw new Error("La materia asociada a esta evaluación no tiene configurado un ID de Google Sheet para reportes.");
    }

    const spreadsheetId = materia.calificaciones_spreadsheet_id;
    const nombreEvaluacion = evaluacionData.titulo;
    const unidadEvaluacion = evaluacionData.unidad;

    // 2. Obtener todos los intentos en estado 'calificado' para esta evaluación
    const { data: intentosCalificados, error: intentosError } = await supabaseAdmin
        .from('intentos_evaluacion')
        .select(`
            id,
            calificacion_final,
            alumnos (
                id,
                matricula,
                nombre,
                apellido
            )
        `)
        .eq('evaluacion_id', evaluacion_id)
        .eq('estado', 'calificado') // Solo los ya calificados
        .not('calificacion_final', 'is', null); // Asegurarse que tengan calificación

    if (intentosError) throw new Error(`Error al obtener intentos calificados: ${intentosError.message}`);

    if (!intentosCalificados || intentosCalificados.length === 0) {
        console.log(`No hay intentos calificados para sincronizar para evaluación ID: ${evaluacion_id}`);
        return new Response(JSON.stringify({ message: "No hay calificaciones finales para sincronizar." }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
    }

    console.log(`Encontrados ${intentosCalificados.length} intentos calificados para enviar a Sheets.`);

    // 3. Preparar el payload para Apps Script
    const calificacionesParaSheets = intentosCalificados.map(intento => {
        // Supabase puede devolver la relación como un array, tomamos el primer elemento.
        const alumno = (Array.isArray(intento.alumnos) ? intento.alumnos[0] : intento.alumnos) as { id: number; matricula: string; nombre: string; apellido: string; } | null;
        return {
            matricula: alumno ? alumno.matricula : 'N/A',
            nombre: alumno ? `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim() : 'Alumno Desconocido',
            calificacion_final: intento.calificacion_final
        };
    }).filter(cal => cal.matricula !== 'N/A'); // Filtrar por si acaso

     if (calificacionesParaSheets.length === 0) {
        console.log(`Después del filtrado, no quedaron calificaciones válidas para enviar.`);
        return new Response(JSON.stringify({ message: "No se encontraron datos de alumnos válidos en los intentos calificados." }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200, // No es un error fatal, simplemente no hay nada que enviar
        });
    }


    const payloadSheets = {
        action: 'guardar_calificaciones_evaluacion',
        calificaciones_spreadsheet_id: spreadsheetId,
        nombre_evaluacion: nombreEvaluacion,
        unidad: unidadEvaluacion,
        calificaciones: calificacionesParaSheets
    };

    // 4. Llamar a Google Apps Script
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    console.log("Enviando datos a Google Apps Script...");
    const scriptResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify(payloadSheets),
      headers: { 'Content-Type': 'application/json' },
    });

    const responseText = await scriptResponse.text(); // Leer como texto primero
    console.log(`Respuesta de Apps Script (status ${scriptResponse.status}): ${responseText}`);
    if (!scriptResponse.ok) {
        throw new Error(`Google Apps Script devolvió un error (${scriptResponse.status}): ${responseText}`);
    }

    let scriptResult;
    try {
        scriptResult = JSON.parse(responseText); // Intentar parsear como JSON
    } catch (_e) {
        throw new Error(`La respuesta de Apps Script no es un JSON válido: ${responseText}`);
    }

    if (scriptResult.status !== 'success') {
      throw new Error(`Google Apps Script reportó un error: ${scriptResult.message}`);
    }

    console.log(`Sincronización completada para evaluación ID: ${evaluacion_id}`);
    return new Response(JSON.stringify({ message: scriptResult.message || "Sincronización con Google Sheets completada." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en sincronizar-evaluacion-sheets:", error);
    const message = error instanceof Error ? error.message : "Error desconocido durante la sincronización.";
    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});