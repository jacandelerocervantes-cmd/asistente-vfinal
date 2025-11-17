// supabase/functions/sync-drive-on-first-login/index.ts
// AHORA ES UN TRABAJADOR DE COLA (CRON JOB)
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  const dynamicCorsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: dynamicCorsHeaders }); }
  
  // VERIFICACIÓN DE SEGURIDAD (Para Cron Job)
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response(JSON.stringify({ message: 'No autorizado' }), { status: 401, headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" } });
  }

  let jobId = null;
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    
    // *** PASO 1 (NUEVO): Limpiar trabajos antiguos ***
    // Esta función (worker) SÍ tiene permisos para borrar.
    const { error: deleteError } = await supabaseAdmin
      .from('drive_sync_jobs')
      .delete()
      .in('status', ['completed', 'failed']); // Borra los que ya terminaron o fallaron

    if (deleteError) {
      // Registrar como advertencia, no es un error fatal
      console.warn('Advertencia: No se pudieron limpiar los jobs antiguos:', deleteError.message);
    } else {
      console.log("Limpieza de trabajos antiguos completada.");
    }
    // *** FIN PASO 1 (NUEVO) ***

    // 2. Buscar un trabajo pendiente (lógica original)
    const { data: job, error: jobError } = await supabaseAdmin
      .from('drive_sync_jobs')
      .select('*')
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) {
      return new Response(JSON.stringify({ message: "No hay trabajos de sincronización pendientes." }), { headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" } });
    }
    
    jobId = job.id;
    const userId = job.user_id;

    // 3. Marcar trabajo como 'processing'
    await supabaseAdmin.from('drive_sync_jobs').update({ status: 'processing' }).eq('id', jobId);

    // 4. Obtener datos del docente y materias
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!user) throw new Error(`Usuario ${userId} no encontrado.`);

    // Obtenemos las materias CON sus alumnos (los que cargamos con el SQL)
    const { data: materias, error: materiasError } = await supabaseAdmin
        .from('materias')
        .select(`*, alumnos(*)`) // <-- Importante: incluir alumnos()
        .eq('user_id', user.id);
    if (materiasError) throw materiasError;

    if (!materias || materias.length === 0) {
       await supabaseAdmin.auth.admin.updateUserById(userId, {
           user_metadata: { ...(user.user_metadata || {}), drive_synced: true }
       });
       await supabaseAdmin.from('drive_sync_jobs').update({ status: 'completed', ultimo_error: null }).eq('id', jobId);
       return new Response(JSON.stringify({ message: "No hay materias. Trabajo completado." }), { headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" } });
    }

    // 5. LLAMAR A GOOGLE APPS SCRIPT (¡EN BUCLE, UNA MATERIA A LA VEZ!)
    const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    if (!googleScriptUrl) throw new Error("GOOGLE_SCRIPT_CREATE_MATERIA_URL no definido.");

    const docentePayload = { id: user.id, nombre: user.user_metadata?.full_name || user.email, email: user.email };

    for (const materia of materias) {
      console.log(`Procesando materia ${materia.nombre} (ID: ${materia.id})...`);
      
      // Solo procesar si AÚN no tiene un drive_url (para reintentar si falla)
      if (materia.drive_url) {
        console.log(`Materia ${materia.nombre} ya tiene drive_url, saltando.`);
        continue;
      }

      const payload = {
        action: 'create_materia_struct',
        docente: docentePayload,
        materia: materia // Enviar la materia individual CON sus alumnos
      };

      // Esta llamada es rápida (procesa solo 1 materia)
      const response = await fetch(googleScriptUrl, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });
      
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Apps Script devolvió error ${response.status} procesando materia ${materia.id}: ${responseText}`);
      }
      
      const scriptResponse = JSON.parse(responseText);
      if (scriptResponse.status === 'error') {
        throw new Error(`Error de Google Script procesando materia ${materia.id}: ${scriptResponse.message}`);
      }
      
      // 6. Actualizar CADA materia en la base de datos CON LOS IDs correctos
      const { drive_url, rubricas_spreadsheet_id, plagio_spreadsheet_id, calificaciones_spreadsheet_id, drive_folder_material_id } = scriptResponse;
      
      const { error: updateError } = await supabaseAdmin.from('materias').update({
          drive_url: drive_url,
          rubricas_spreadsheet_id: rubricas_spreadsheet_id,
          plagio_spreadsheet_id: plagio_spreadsheet_id,
          calificaciones_spreadsheet_id: calificaciones_spreadsheet_id,
          drive_folder_material_id: drive_folder_material_id
      }).eq('id', materia.id);

      if(updateError) {
        throw new Error(`Error guardando IDs de Drive para materia ${materia.id}: ${updateError.message}`);
      }
      console.log(`Materia ${materia.nombre} (ID: ${materia.id}) actualizada en BD.`);
    }
    // Fin del bucle

    // 7. Marcar al usuario como sincronizado
    await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { ...(user.user_metadata || {}), drive_synced: true }
    });

    // 8. Marcar el trabajo como completado
    await supabaseAdmin.from('drive_sync_jobs').update({ status: 'completed', ultimo_error: null }).eq('id', jobId);

    return new Response(JSON.stringify({ success: true, message: `Trabajo ${jobId} completado (sincronizadas ${materias.length} materias).` }), {
        headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" },
        status: 200
     });
  
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ocurrió un error desconocido.";
    console.error("Error en sync-drive-on-first-login (bucle):", message);
    if (jobId) {
        // Marcar el trabajo como fallido si algo salió mal
        await supabaseAdmin.from('drive_sync_jobs').update({ status: 'failed', ultimo_error: message }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ message }), {
        headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" },
        status: 500
    });
  }
});