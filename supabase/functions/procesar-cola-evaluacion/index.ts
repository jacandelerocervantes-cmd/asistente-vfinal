// supabase/functions/procesar-cola-evaluacion/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Interfaces para seguridad de tipos ---
interface Materia {
    id: number;
    drive_url: string;
}

interface Actividad {
    id: number;
    nombre: string;
    unidad: number;
    rubrica_spreadsheet_id: string;
    rubrica_sheet_range: string;
    materias: Materia | null;
}

interface Calificacion {
    id: number;
    actividad_id: number;
    alumno_id?: number | null;
    grupo_id?: number | null;
    evidencia_drive_file_id: string;
    actividades: Actividad | null;
}

interface TrabajoCola {
    id: number;
    user_id: string;
    // La consulta de Supabase con `calificaciones(*)` devuelve un array
    calificaciones: Calificacion[];
}

// --- Función auxiliar para extraer JSON ---
function extractJson(text: string): Record<string, unknown> | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch (_e) {
        return null;
    }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let trabajoId: number | null = null;
  let calificacionId: number | null = null;

  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    
    const { data: trabajoData, error: trabajoError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`id, user_id, calificaciones (*, actividades (*, materias (*)))`)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (trabajoError && trabajoError.code !== 'PGRST116') { // Ignorar error "No rows found"
        throw new Error(`Error al buscar trabajo: ${trabajoError.message}`);
    }
    if (!trabajoData) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const trabajo = trabajoData as unknown as TrabajoCola;
    trabajoId = trabajo.id;

    // --- ¡CORRECCIÓN CLAVE! La relación se devuelve como un array, tomamos el primer elemento ---
    const calificacion = trabajo.calificaciones?.[0];
    if (!calificacion || typeof calificacion !== 'object' || Array.isArray(calificacion)) {
      throw new Error(`El trabajo ID ${trabajo.id} no tiene una calificación asociada válida.`);
    }
    calificacionId = calificacion.id;

    const actividad = calificacion.actividades;
    if (!actividad || typeof actividad !== 'object' || Array.isArray(actividad)) {
      throw new Error(`La calificación ID ${calificacion.id} no tiene una actividad asociada válida.`);
    }

    const materia = actividad.materias;
    if (!materia || typeof materia !== 'object' || Array.isArray(materia)) {
        throw new Error(`La actividad ID ${actividad.id} no tiene una materia asociada válida.`);
    }
    // --- Fin de la validación ---

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'procesando' }).eq('id', trabajo.id);
    
    const updateProgress = async (progreso: string) => {
      if (calificacionId) {
        await supabaseAdmin.from('calificaciones').update({ estado: 'procesando', progreso_evaluacion: progreso }).eq('id', calificacionId);
      }
    };

    await updateProgress("1/4: Obteniendo textos...");
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL")!;

    const rubricRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_rubric_text', spreadsheet_id: actividad.rubrica_spreadsheet_id, rubrica_sheet_range: actividad.rubrica_sheet_range }), headers: { 'Content-Type': 'application/json' } });
    if (!rubricRes.ok) throw new Error(`Error de red al obtener rúbrica: ${rubricRes.statusText}`);
    const rubricJson = await rubricRes.json();
    if (rubricJson.status !== 'success') throw new Error(`Apps Script (get_rubric_text) falló: ${rubricJson.message}`);
    
    const workRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_student_work_text', drive_file_id: calificacion.evidencia_drive_file_id }), headers: { 'Content-Type': 'application/json' } });
    if (!workRes.ok) throw new Error(`Error de red al obtener trabajo: ${workRes.statusText}`);
    const workJson = await workRes.json();
    if (workJson.status !== 'success') throw new Error(`Apps Script (get_student_work_text) falló: ${workJson.message}`);

    await updateProgress("2/4: Calificando con IA...");
    const prompt = `Evalúa el trabajo basándote en la rúbrica. Tu respuesta DEBE ser únicamente un objeto JSON con las claves "calificacion_total" (number) y "justificacion_texto" (string).\n\nRúbrica:\n${rubricJson.texto_rubrica}\n\nTrabajo:\n${workJson.texto_trabajo}`;
    
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    const geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } }) });
    
    if (!geminiResponse.ok) throw new Error(`Error en la API de Gemini: ${(await geminiResponse.json()).error.message}`);
    
    const geminiData = await geminiResponse.json();
     if (!geminiData.candidates || !geminiData.candidates[0]?.content?.parts || !geminiData.candidates[0].content.parts[0]?.text) {
        throw new Error(`Respuesta inesperada de Gemini: ${JSON.stringify(geminiData)}`);
     }
    const geminiText = geminiData.candidates[0].content.parts[0].text;
    
    const parsedJson = extractJson(geminiText);
    if (!parsedJson || typeof parsedJson.calificacion_total !== 'number' || typeof parsedJson.justificacion_texto !== 'string') {
        throw new Error(`La respuesta de la IA no fue un JSON válido o le faltan claves. Respuesta: ${geminiText}`);
    }
    const { calificacion_total, justificacion_texto } = parsedJson;

    await updateProgress("3/4: Generando reportes de calificación...");
    
    let calificacionesParaReporte: { matricula: string; nombre: string; equipo: string; calificacion: number; retroalimentacion: string; }[] = [];
    if (calificacion.grupo_id) {
      const { data: miembros, error: errorMiembros } = await supabaseAdmin.from('alumnos_grupos').select('alumnos(matricula, nombre, apellido), grupos(nombre)').eq('grupo_id', calificacion.grupo_id);
      if (errorMiembros) throw errorMiembros;
      if (!Array.isArray(miembros)) throw new Error("La consulta de miembros de grupo no devolvió un array.");

      calificacionesParaReporte = miembros.map((m) => {
         // Supabase devuelve las relaciones como arrays. Accedemos al primer elemento.
         const alumno = Array.isArray(m.alumnos) ? m.alumnos[0] : m.alumnos;
         const grupo = Array.isArray(m.grupos) ? m.grupos[0] : m.grupos;
         if (!alumno || !grupo) throw new Error("Estructura de miembro de grupo inesperada.");
         return {
             matricula: alumno.matricula,
             nombre: `${alumno.nombre} ${alumno.apellido}`,
             equipo: grupo.nombre,
             calificacion: calificacion_total,
             retroalimentacion: justificacion_texto
         };
      });
    } else {
      const { data: alumno, error: errorAlumno } = await supabaseAdmin.from('alumnos').select('matricula, nombre, apellido').eq('id', calificacion.alumno_id).single();
      if (errorAlumno) throw errorAlumno;
      if (!alumno) throw new Error(`No se encontró el alumno con ID ${calificacion.alumno_id}`);

      calificacionesParaReporte.push({
        matricula: alumno.matricula,
        nombre: `${alumno.nombre} ${alumno.apellido}`,
        equipo: '',
        calificacion: calificacion_total,
        retroalimentacion: justificacion_texto
      });
    }

    const reportePayload = {
      action: 'guardar_calificacion_detallada',
      drive_url_materia: materia.drive_url,
      unidad: actividad.unidad,
      actividad: { nombre: actividad.nombre, id: actividad.id },
      calificaciones: calificacionesParaReporte
    };
    
    const reporteRes = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify(reportePayload), headers: { 'Content-Type': 'application/json' } });
    if (!reporteRes.ok) throw new Error(`Apps Script (guardar_calificacion_detallada) falló: ${await reporteRes.text()}`);
    const reporteJson = await reporteRes.json();
     if (reporteJson.status !== 'success') throw new Error(`Apps Script (guardar_calificacion_detallada) reportó error: ${reporteJson.message}`);
    
    await updateProgress("4/4: Finalizando...");
    
    // Actualizar la calificación principal (individual o grupal)
    await supabaseAdmin.from('calificaciones').update({ calificacion_obtenida: calificacion_total, estado: 'calificado', progreso_evaluacion: 'Completado' }).eq('id', calificacion.id);

    // Si es un grupo, propagar la nota a los miembros individuales para consistencia en la BD
    if (calificacion.grupo_id) {
        const { data: miembros, error: errorMiembros } = await supabaseAdmin.from('alumnos_grupos').select('alumno_id').eq('grupo_id', calificacion.grupo_id);
        if (errorMiembros) throw new Error(`No se pudieron obtener los miembros del grupo: ${errorMiembros.message}`);
         if (!Array.isArray(miembros)) throw new Error("La consulta de miembros (propagación) no devolvió un array.");

        const calificacionesAlumnos = miembros.map((miembro: { alumno_id: number }) => ({
            actividad_id: calificacion.actividad_id,
            alumno_id: miembro.alumno_id,
            user_id: trabajo.user_id,
            calificacion_obtenida: calificacion_total,
            estado: 'calificado',
            progreso_evaluacion: 'Completado (Grupal)',
        }));

        if (calificacionesAlumnos.length > 0) {
            const { error: upsertError } = await supabaseAdmin.from('calificaciones').upsert(calificacionesAlumnos, { onConflict: 'actividad_id, alumno_id' });
            if (upsertError) throw new Error(`Error al propagar calificaciones: ${upsertError.message}`);
        }
    }

    await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado' }).eq('id', trabajo.id);
    
    return new Response(JSON.stringify({ message: `Trabajo ${trabajo.id} procesado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const processError = error instanceof Error ? error.message : "Error desconocido.";
    console.error(`ERROR GRAVE procesando trabajo ID ${trabajoId}: ${processError}`); // Log del error
    
    try {
        if (calificacionId) {
          await supabaseAdmin.from('calificaciones').update({ estado: 'fallido', progreso_evaluacion: `Error: ${processError}` }).eq('id', calificacionId);
        }
        if (trabajoId) {
          await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'fallido', ultimo_error: processError }).eq('id', trabajoId);
        }
    } catch (dbError) {
        console.error(`Error adicional al marcar como fallido en BD: ${dbError instanceof Error ? String(dbError.message) : String(dbError)}`);
    }
    
    return new Response(JSON.stringify({ message: processError }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
  }
});