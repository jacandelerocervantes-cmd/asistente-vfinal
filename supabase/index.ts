// supabase/functions/procesar-cola-guardar-resultados/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Interfaces relevantes
interface MateriaConDrive {
    id: number;
    drive_url: string | null; // Necesario para guardar en sheets
    calificaciones_spreadsheet_id: string | null; // Necesario para obtener justificación luego
}
interface ActividadConMateria {
    id: number;
    nombre: string;
    unidad: number;
    materias: MateriaConDrive | null;
}
interface AlumnoBasico {
    id: number;
    matricula: string;
    nombre: string;
    apellido: string;
}
interface GrupoBasico {
    id: number;
    nombre: string;
}
interface CalificacionConRespuestaIA {
    id: number;
    actividad_id: number;
    alumno_id: number | null;
    grupo_id: number | null;
    respuesta_ia_json: { // Asumimos que guardamos el JSON parseado
        calificacion_total: number;
        justificacion_texto: string;
    } | null;
    // Carga las relaciones necesarias
    actividades: ActividadConMateria | null;
}
interface TrabajoColaParaGuardar {
    id: number;
    calificacion_id: number;
    user_id: string; // Para propagación
    calificaciones: CalificacionConRespuestaIA | null;
}

serve(async (_req: Request) => {
  if (_req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let trabajoId: number | null = null;
  let calificacionId: number | null = null;
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // 1. Buscar UN trabajo listo para guardar
    const { data: trabajoData, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`id, calificacion_id, user_id, calificaciones (id, actividad_id, alumno_id, grupo_id, respuesta_ia_json, actividades (id, nombre, unidad, materias (id, drive_url, calificaciones_spreadsheet_id)))`)
      .eq('estado', 'listo_para_guardar')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (trabajoError) throw new Error(`Error al buscar trabajo listo para guardar: ${trabajoError.message}`);
    if (!trabajoData) {
      return new Response(JSON.stringify({ message: "No hay trabajos listos para guardar resultados." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const trabajo = trabajoData as unknown as TrabajoColaParaGuardar;
    trabajoId = trabajo.id;

    // --- Validación ---
    const calificacion = trabajo.calificaciones;
    if (!calificacion || typeof calificacion !== 'object') {
      throw new Error(`Trabajo ID ${trabajo.id} no tiene calificación asociada.`);
    }
    calificacionId = calificacion.id;

    if (!calificacion.respuesta_ia_json || typeof calificacion.respuesta_ia_json.calificacion_total !== 'number' || typeof calificacion.respuesta_ia_json.justificacion_texto !== 'string') {
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido_guardado', ultimo_error: 'Falta la respuesta IA o tiene formato incorrecto.' }).eq('id', trabajo.id);
      throw new Error(`Calificación ID ${calificacionId} no tiene respuesta IA válida.`);
    }

    const actividad = calificacion.actividades;
    if (!actividad || typeof actividad !== 'object') {
      throw new Error(`Calificación ID ${calificacionId} no tiene actividad asociada.`);
    }
    const materia = actividad.materias;
    if (!materia || typeof materia !== 'object' || !materia.drive_url) { // Necesitamos drive_url para sheets
      throw new Error(`Actividad ID ${actividad.id} no tiene materia o URL de Drive asociada.`);
    }
    // --- Fin Validación ---

    // 2. Marcar como 'guardando_resultados'
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'guardando_resultados' }).eq('id', trabajo.id);
    await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: '3/4: Guardando resultados...' }).eq('id', calificacionId);

    // 3. Preparar datos para Google Sheets
    const { calificacion_total, justificacion_texto } = calificacion.respuesta_ia_json;
    let calificacionesParaReporte: { matricula: string; nombre: string; equipo: string; calificacion: number; retroalimentacion: string; }[] = [];

    if (calificacion.grupo_id) {
      console.log(`[Trabajo ${trabajoId}] Obteniendo miembros del grupo ID: ${calificacion.grupo_id}`); // Log
      const { data: miembros, error: errorMiembros } = await supabaseAdmin
          .from('alumnos_grupos')
          // Selecciona explícitamente las columnas de las tablas relacionadas
          .select(`
        alumno:alumnos (id, matricula, nombre, apellido),
        grupo:grupos (id, nombre)
      `)
          .eq('grupo_id', calificacion.grupo_id);

      // Loguea el resultado CRUDO de la consulta
      console.log(`[Trabajo ${trabajoId}] Raw data 'miembros':`, JSON.stringify(miembros));
      // Loguea si hubo error en la consulta
      if (errorMiembros) {
          console.error(`[Trabajo ${trabajoId}] Error consultando miembros:`, errorMiembros);
          throw errorMiembros; // Lanza el error para que sea capturado por el catch principal
      }
      if (!Array.isArray(miembros)) throw new Error("La consulta de miembros de grupo no devolvió un array.");

      calificacionesParaReporte = miembros.map((m: any) => {
         const alumno = m.alumno; // Accede usando el alias 'alumno'
         const grupo = m.grupo;   // Accede usando el alias 'grupo'
         // Valida que ambos objetos y la matrícula existan
         if (!alumno || !grupo || !alumno.matricula) {
             console.warn(`[Trabajo ${trabajoId}] Datos incompletos para miembro del grupo ${calificacion.grupo_id}. Alumno: ${JSON.stringify(alumno)}, Grupo: ${JSON.stringify(grupo)}`);
             return null; // Marcar para filtrar luego
         }
         return {
             matricula: alumno.matricula,
             nombre: `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim(),
             equipo: grupo.nombre,
             calificacion: calificacion_total, // Asegúrate que calificacion_total esté definida
             retroalimentacion: justificacion_texto // Asegúrate que justificacion_texto esté definida
         };
      }).filter(Boolean) as any[]; // Filtrar los nulos

      // Loguea el array ANTES de enviarlo
      console.log(`[Trabajo ${trabajoId}] 'calificacionesParaReporte' (grupo) preparado:`, JSON.stringify(calificacionesParaReporte));

    } else if (calificacion.alumno_id) {
      const { data: alumno, error: errorAlumno } = await supabaseAdmin
          .from('alumnos')
          .select('matricula, nombre, apellido')
          .eq('id', calificacion.alumno_id)
          .single();
      if (errorAlumno) throw errorAlumno;
      if (!alumno) throw new Error(`No se encontró el alumno con ID ${calificacion.alumno_id}`);

      calificacionesParaReporte.push({
        matricula: alumno.matricula,
        nombre: `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim(),
        equipo: '', // Sin equipo para entregas individuales
        calificacion: calificacion_total,
        retroalimentacion: justificacion_texto
      });
      console.log(`[Trabajo ${trabajoId}] 'calificacionesParaReporte' (individual) preparado:`, JSON.stringify(calificacionesParaReporte));
    } else {
        // Caso inesperado: ni alumno_id ni grupo_id
        throw new Error(`La calificación ID ${calificacionId} no tiene alumno_id ni grupo_id.`);
    }

    // *** NUEVA VALIDACIÓN CRÍTICA ***
    if (calificacionesParaReporte.length === 0) {
        console.error(`[Trabajo ${trabajoId}] Error Crítico: 'calificacionesParaReporte' está vacío ANTES de llamar a Apps Script. No se llamará a Apps Script.`);
        throw new Error("No se pudieron generar los datos de calificación para el reporte (array vacío)."); // Esto causará que el trabajo falle aquí con un error claro.
    }

    // 4. Llamar a Google Apps Script para guardar en Sheets
    console.log(`[Trabajo ${trabajoId}] Llamando a Apps Script 'guardar_calificacion_detallada'...`);
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    const reportePayload = {
      action: 'guardar_calificacion_detallada',
      drive_url_materia: materia.drive_url, // URL de la carpeta raíz de la materia
      unidad: actividad.unidad,
      actividad: { nombre: actividad.nombre, id: actividad.id },
      calificaciones: calificacionesParaReporte
    };

    const reporteRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify(reportePayload), headers: { 'Content-Type': 'application/json' } });
    if (!reporteRes.ok) throw new Error(`Apps Script (guardar_calificacion_detallada) falló: ${await reporteRes.text()}`);
    const reporteJson = await reporteRes.json();
    if (reporteJson.status !== 'success') throw new Error(`Apps Script (guardar_calificacion_detallada) reportó error: ${reporteJson.message}`);

    // --- ¡NUEVO! Guardar la referencia a la celda de justificación si Apps Script la devuelve ---
    // Ajusta esto según lo que devuelva tu función `handleGuardarCalificacionDetallada` en Apps Script
    // Por ejemplo, si devuelve algo como: { status: 'success', justificacion_cells: {'matricula1': 'Sheet!C2', ...} }
    // O si solo devuelve una celda para el primer alumno/grupo: { status: 'success', justificacion_cell_ref: 'Sheet!C2' }
    // Aquí asumiremos que devuelve una referencia única para la primera entrada (simplificado):
    const justificacionSheetCell = reporteJson.justificacion_cell_ref || null; // O ajusta según la respuesta real

    // 5. Actualizar Supabase (final)
    await supabaseAdmin.from('calificaciones').update({
        calificacion_obtenida: calificacion_total,
        // Guardamos la justificación directamente aquí también para acceso rápido
        // (alternativa a leerla siempre desde Sheets con get-justification-text)
        // justificacion_texto: justificacion_texto, // Descomenta si quieres duplicar la justificación aquí
        justificacion_sheet_cell: justificacionSheetCell, // Guardar referencia a Sheets
        estado: 'calificado',
        progreso_evaluacion: 'Completado'
      }).eq('id', calificacionId);

    // Propagación para grupos
    if (calificacion.grupo_id && calificacionesParaReporte.length > 0) {
        // Obtener los IDs de los alumnos miembros
        const { data: miembros, error: errorMiembros } = await supabaseAdmin
            .from('alumnos_grupos').select('alumno_id').eq('grupo_id', calificacion.grupo_id);
        if (errorMiembros) throw new Error(`No se pudieron obtener los miembros del grupo para propagación: ${errorMiembros.message}`);
        if (!Array.isArray(miembros)) throw new Error("La consulta de miembros (propagación) no devolvió un array.");

        const calificacionesAlumnos = miembros.map((miembro: { alumno_id: number }) => ({
            actividad_id: calificacion.actividad_id,
            alumno_id: miembro.alumno_id,
            user_id: trabajo.user_id, // Usar el user_id del trabajo original
            calificacion_obtenida: calificacion_total,
            estado: 'calificado',
            progreso_evaluacion: 'Completado (Grupal)',
            grupo_id: calificacion.grupo_id, // Mantener referencia al grupo original
             // Podrías decidir si propagar o no la referencia a Sheets aquí
            justificacion_sheet_cell: justificacionSheetCell
        }));

        if (calificacionesAlumnos.length > 0) {
            const { error: upsertError } = await supabaseAdmin
                .from('calificaciones')
                .upsert(calificacionesAlumnos, { onConflict: 'actividad_id, alumno_id' }); // Upsert por si ya existía una entrada individual
            if (upsertError) throw new Error(`Error al propagar calificaciones grupales: ${upsertError.message}`);
        }
    }

    // 6. Marcar trabajo como completado
    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', ultimo_error: null, intentos: 0 }).eq('id', trabajo.id);

    console.log(`Resultados guardados para trabajo ID ${trabajoId}, calificación ID ${calificacionId}.`);
    return new Response(JSON.stringify({ message: `Resultados guardados para trabajo ${trabajoId}.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    console.error(`Error guardando resultados para trabajo ID ${trabajoId} (Calificación ID: ${calificacionId}): ${errorMessage}`);
    // Marcar como fallido si tenemos los IDs
    if (trabajoId) {
      try {
        await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido_guardado', ultimo_error: errorMessage }).eq('id', trabajoId);
        if (calificacionId) {
          await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error guardando: ${errorMessage.substring(0, 100)}...` }).eq('id', calificacionId);
        }
      } catch (dbError) {
        console.error(`Error adicional al marcar como fallido (guardar resultados): ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }
    return new Response(JSON.stringify({ message: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});