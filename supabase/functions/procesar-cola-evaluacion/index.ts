import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

// Configuración de reintentos para fetch
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      // Clonamos la respuesta por seguridad si necesitamos leerla varias veces internamente en el retry (aunque aquí retornamos directo)
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error("Fallo fetch tras reintentos");
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let job_id_global = null;
  let calificacion_id_global = null;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. OBTENER SIGUIENTE TRABAJO (Bloqueo para evitar concurrencia)
    const { data: jobData, error: jobError } = await supabaseAdmin.rpc('obtener_siguiente_trabajo_evaluacion');
    
    if (jobError) throw new Error(`Error RPC: ${jobError.message}`);
    if (!jobData || jobData.length === 0) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const jobId = jobData[0].job_id; // Ajustado según tu RPC que devuelve tabla(job_id)
    job_id_global = jobId;
    console.log(`--- Procesando Trabajo ID: ${jobId} ---`);

    // 2. LEER DETALLES DEL TRABAJO
    const { data: colaItem, error: colaError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .select(`
        *,
        calificaciones (
          id, actividad_id, alumno_id, grupo_id, evidencia_drive_file_id,
          actividades ( 
            id, nombre, unidad, rubrica_sheet_range, rubrica_spreadsheet_id,
            drive_folder_id, drive_folder_entregas_id, tipo_entrega, materia_id,
            materias ( nombre, calificaciones_spreadsheet_id, drive_url )
          ),
          alumnos ( id, nombre, apellido, matricula ),
          grupos ( id, nombre )
        )
      `)
      .eq('id', jobId)
      .single();

    if (colaError || !colaItem) throw new Error("No se encontró información del trabajo en la cola.");
    
    const calif = colaItem.calificaciones;
    calificacion_id_global = calif.id;
    const act = calif.actividades;
    const mat = act.materias;

    // Actualizar progreso visual
    await supabaseAdmin.from('calificaciones').update({ 
        estado: 'procesando', 
        progreso_evaluacion: '1/4: Obteniendo archivos...' 
    }).eq('id', calif.id);

    // 3. OBTENER TEXTO DEL ALUMNO (Google Apps Script)
    console.log("Paso 3: Obteniendo texto del alumno...");
    const scriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!;
    
    const payloadTexto = {
      action: 'get_student_work_text',
      drive_file_id: calif.evidencia_drive_file_id
    };

    const resTexto = await fetchWithRetry(scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadTexto)
    });

    // --- CORRECCIÓN DE LECTURA ---
    // Leemos el texto UNA sola vez y parseamos.
    const rawTextoResponse = await resTexto.text(); 
    let jsonTexto;
    try {
        jsonTexto = JSON.parse(rawTextoResponse);
    } catch (_e) {
        throw new Error(`Error parseando respuesta de Google (Texto Alumno): ${rawTextoResponse.substring(0, 200)}...`);
    }

    if (!resTexto.ok || jsonTexto.error) {
       // Si Google nos dice que requiere revisión manual (ej. es una imagen difícil), lo manejamos suavemente.
       if (jsonTexto.requiere_revision_manual) {
           console.log(`El trabajo ${calif.id} requiere revisión manual.`);
           await supabaseAdmin.from('calificaciones').update({ 
               estado: 'requiere_revision_manual',
               progreso_evaluacion: 'Requiere revisión manual (formato no legible)'
           }).eq('id', calif.id);
           
           // Marcamos el trabajo como completado (aunque con otro estado) para sacarlo de la cola
           await supabaseAdmin.from('cola_de_trabajos').update({ estado: 'completado', ultimo_error: 'Revisión Manual Requerida' }).eq('id', jobId);
           
           return new Response(JSON.stringify({ message: "Marcado para revisión manual" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
       }
       throw new Error(`Error obteniendo texto: ${jsonTexto.error || jsonTexto.message || rawTextoResponse}`);
    }

    const textoAlumno = jsonTexto.texto_trabajo;
    if (!textoAlumno || textoAlumno.length < 10) {
        throw new Error("El archivo parece estar vacío o tener muy poco texto legible.");
    }

    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '2/4: Analizando rúbrica...' }).eq('id', calif.id);

    // 4. OBTENER RÚBRICA
    const payloadRubrica = {
      action: 'get_rubric_text',
      spreadsheet_id: act.rubrica_spreadsheet_id,
      rubrica_sheet_range: act.rubrica_sheet_range
    };

    const resRubrica = await fetchWithRetry(scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadRubrica)
    });
    
    const rawRubricaResponse = await resRubrica.text();
    let jsonRubrica;
    try { jsonRubrica = JSON.parse(rawRubricaResponse); }
    catch(_e) { throw new Error(`Error parseando rúbrica: ${rawRubricaResponse.substring(0,200)}`); }

    if (!jsonRubrica.texto_rubrica) throw new Error("No se pudo obtener el texto de la rúbrica.");

    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '3/4: Evaluando con IA...' }).eq('id', calif.id);

    // 5. EVALUAR CON GEMINI
    console.log("Paso 5: Consultando a Gemini...");
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;

    const prompt = `
      Actúa como un profesor experto. Evalúa el siguiente trabajo escolar basándote ESTRICTAMENTE en la rúbrica proporcionada.
      
      RÚBRICA:
      ${jsonRubrica.texto_rubrica}

      TRABAJO DEL ALUMNO:
      "${textoAlumno.substring(0, 15000)}" 

      INSTRUCCIONES DE SALIDA:
      Responde SOLAMENTE con un JSON válido (sin bloques de código markdown). El formato debe ser:
      {
        "calificacion_total": (número entre 0 y 100),
        "justificacion_texto": "Explicación breve y constructiva dirigida al alumno sobre su nota, mencionando fortalezas y áreas de mejora según la rúbrica."
      }
    `;

    const resGemini = await fetchWithRetry(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const geminiJson = await resGemini.json();
    const rawAIResponse = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawAIResponse) throw new Error("Gemini no devolvió una respuesta válida.");

    // Limpieza del JSON de Gemini (a veces pone ```json ... ```)
    const cleanJsonString = rawAIResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    let evaluacion;
    try {
        evaluacion = JSON.parse(cleanJsonString);
    } catch (_e) {
        throw new Error(`La IA devolvió un formato inválido: ${cleanJsonString}`);
    }

    await supabaseAdmin.from('calificaciones').update({ progreso_evaluacion: '4/4: Guardando resultados...' }).eq('id', calif.id);

    // 6. GUARDAR EN GOOGLE SHEETS (Aquí ocurría el error "Body consumed")
    console.log("Paso 6: Guardando en Sheets...");
    
    const nombreAlumno = calif.alumnos ? `${calif.alumnos.nombre} ${calif.alumnos.apellido}` : "Desconocido";
    const nombreEquipo = calif.grupos ? calif.grupos.nombre : "";
    const matricula = calif.alumnos?.matricula || "S/M";

    const payloadSave = {
      action: 'guardar_calificacion_detallada',
      drive_url_materia: mat.drive_url, // Usamos la URL de la materia o el ID del sheet si el script lo soporta
      calificaciones_spreadsheet_id: mat.calificaciones_spreadsheet_id, // Asegúrate que tu script soporte esto si lo tienes
      unidad: act.unidad,
      actividad: { nombre: act.nombre, id: act.id }, // Solo metadatos
      calificaciones: [
        {
          matricula: matricula,
          nombre: nombreAlumno,
          equipo: nombreEquipo,
          calificacion: evaluacion.calificacion_total,
          retroalimentacion: evaluacion.justificacion_texto
        }
      ]
    };

    const resSave = await fetchWithRetry(scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadSave)
    });

    // --- CORRECCIÓN CLAVE: LEER UNA SOLA VEZ ---
    const rawSaveText = await resSave.text(); // <--- Leemos el stream AQUÍ y lo guardamos en variable
    let jsonSave;
    
    try {
        jsonSave = JSON.parse(rawSaveText); // Usamos la variable, NO resSave.json()
    } catch (_e) {
        throw new Error(`Google Apps Script devolvió respuesta inválida al guardar: ${rawSaveText}`);
    }

    if (!resSave.ok || jsonSave.status === 'error') {
        throw new Error(`Error lógico al guardar en Sheets: ${jsonSave.message || rawSaveText}`);
    }

    // 7. ACTUALIZAR DB LOCAL
    // Si es grupal/mixta, replicamos la nota a los compañeros del mismo grupo en la misma actividad
    // (Tu lógica de frontend ya agrupa, pero en BD guardamos individualmente)
    let idsAActualizar = [calif.id];
    
    if (calif.grupo_id && ['grupal', 'mixta'].includes(act.tipo_entrega)) {
        // Buscamos otros miembros del grupo en esta actividad que aún no tengan nota
        const { data: companeros } = await supabaseAdmin
            .from('calificaciones')
            .select('id')
            .eq('actividad_id', act.id)
            .eq('grupo_id', calif.grupo_id);
            
        if (companeros) {
            idsAActualizar = companeros.map(c => c.id);
        }
    }

    const { error: updateError } = await supabaseAdmin
      .from('calificaciones')
      .update({
        calificacion_obtenida: evaluacion.calificacion_total,
        estado: 'calificado',
        progreso_evaluacion: 'Completado',
        justificacion_sheet_cell: 'Ver en Sheets' // Opcional
      })
      .in('id', idsAActualizar);

    if (updateError) throw new Error(`Error actualizando Supabase: ${updateError.message}`);

    // 8. MARCAR TRABAJO COMO COMPLETADO
    await supabaseAdmin.from('cola_de_trabajos').update({
      estado: 'completado',
      updated_at: new Date()
    }).eq('id', jobId);

    return new Response(JSON.stringify({ success: true, calificacion: evaluacion.calificacion_total }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error("!!!!!!!!!! ERROR CAPTURADO !!!!!!!!!!");
    console.error(error);

    const errorMsg = error instanceof Error ? error.message : "Error desconocido";

    // Revertir estado si falló
    if (calificacion_id_global) {
       await supabaseAdmin.from('calificaciones').update({ 
           estado: 'entregado', // Regresa a entregado para reintentar
           progreso_evaluacion: `Error: ${errorMsg.substring(0, 30)}...` 
       }).eq('id', calificacion_id_global);
    }

    if (job_id_global) {
        // Aumentar intentos o marcar fallido
        await supabaseAdmin.from('cola_de_trabajos').update({ 
            estado: 'fallido', // La RPC se encarga de reintentar si intentos < 3
            ultimo_error: errorMsg
        }).eq('id', job_id_global);
    }

    return new Response(JSON.stringify({ error: errorMsg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});