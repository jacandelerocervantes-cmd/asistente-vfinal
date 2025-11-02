// supabase/functions/sync-drive-on-first-login/index.ts
// AHORA ES UN TRABAJADOR DE COLA (CRON JOB)
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

// CORRECCIÓN: Definir la interfaz para el objeto 'job' para dar contexto a TypeScript.
interface DriveSyncJob {
  id: number; // bigint from postgres is a number or string in JS
  created_at: string; // timestampz is a string
  user_id: string; // uuid is a string
  status: 'pending' | 'processing' | 'completed' | 'failed';
  ultimo_error: string | null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }
  
  // VERIFICACIÓN DE SEGURIDAD (Para Cron Job)
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response(JSON.stringify({ message: 'No autorizado' }), { status: 401 });
  }

  let jobId = null;
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    // 1. CORRECCIÓN: Obtener y bloquear atómicamente el siguiente trabajo pendiente usando una función RPC.
    // Esto previene que múltiples instancias del worker tomen el mismo trabajo (Race Condition).
    // CORRECCIÓN: Se ajusta la llamada RPC para que TypeScript infiera el tipo correctamente.
    // La función RPC devuelve un array, por lo que no usamos .single() y tomamos el primer elemento.
    const { data: jobs, error: jobError } = await supabaseAdmin.rpc('get_and_lock_sync_job');
    const job = jobs ? (jobs as DriveSyncJob[])[0] : null;

    if (jobError) throw jobError;
    if (!job) {
      console.log("No hay trabajos de sincronización pendientes.");
      return new Response(JSON.stringify({ message: "No hay trabajos de sincronización pendientes." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    jobId = job.id;
    const userId = job.user_id;
    console.log(`Trabajo ${jobId} para usuario ${userId} seleccionado y marcado como 'processing'.`);

    // El paso 2 (marcar como 'processing') ya no es necesario aquí, la función RPC lo hace atómicamente.

    // 3. Obtener datos del docente y materias
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!user) throw new Error(`Usuario ${userId} no encontrado.`);

    const { data: materias, error: materiasError } = await supabaseAdmin
        .from('materias')
        .select(`*, alumnos(*)`)
        .eq('user_id', user.id);
    if (materiasError) throw materiasError;

    // Si el usuario no tiene materias, el proceso debe terminar exitosamente.
    if (!materias || materias.length === 0) {
       console.log(`Usuario ${userId} no tiene materias. Finalizando trabajo ${jobId} como completado.`);
       await supabaseAdmin.auth.admin.updateUserById(userId, {
           user_metadata: { ...(user.user_metadata || {}), drive_synced: true }
       });
       await supabaseAdmin.from('drive_sync_jobs').update({ status: 'completed' }).eq('id', jobId);
       
       return new Response(JSON.stringify({ success: true, message: "No hay materias. Trabajo completado." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4. LLAMAR A GOOGLE APPS SCRIPT (La tarea larga)
    const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    if (!googleScriptUrl) throw new Error("GOOGLE_SCRIPT_CREATE_MATERIA_URL no definido.");

    const payload = { action: 'create_materias_batch', docente: { id: user.id, nombre: user.user_metadata?.full_name || user.email, email: user.email }, materias };
    
    const response = await fetch(googleScriptUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Apps Script devolvió error ${response.status}: ${responseText}`);
    
    const scriptResponse = JSON.parse(responseText);
    if (scriptResponse.status === 'error') throw new Error(`Error de Google Script: ${scriptResponse.message}`);

    // 5. Actualizar tablas de Supabase con la respuesta de Google
    // CORRECCIÓN: Desestructurar todos los IDs que devuelve el Apps Script
    const { 
        drive_urls, 
        rubricas_spreadsheet_ids, 
        plagio_spreadsheet_ids, 
        calificaciones_spreadsheet_ids 
    } = scriptResponse;
    
    // CORRECCIÓN: Usar una condición más general (o revisar todos los arrays si es necesario)
    if (drive_urls) {
        const updatePromises = Object.keys(drive_urls).map(materiaId => {
            return supabaseAdmin.from('materias').update({
                drive_url: drive_urls[materiaId],
                // CORRECCIÓN: Descomentar y usar las variables correctas
                rubricas_spreadsheet_id: rubricas_spreadsheet_ids[materiaId],
                plagio_spreadsheet_id: plagio_spreadsheet_ids[materiaId],
                calificaciones_spreadsheet_id: calificaciones_spreadsheet_ids[materiaId]
            }).eq('id', parseInt(materiaId, 10));
        });
        await Promise.all(updatePromises);
    }

    // 6. Marcar al usuario como sincronizado
    await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { ...(user.user_metadata || {}), drive_synced: true }
    });

    // 7. Marcar el trabajo como completado
    await supabaseAdmin.from('drive_sync_jobs').update({ status: 'completed' }).eq('id', jobId);

    return new Response(JSON.stringify({ success: true, message: `Trabajo ${jobId} completado.` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
     });
  
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ocurrió un error desconocido.";
    console.error("Error en el cron job sync-drive:", message);
    if (jobId) {
        // Marcar el trabajo como fallido si algo salió mal
        // CORRECCIÓN: Añadir el mensaje de error a la columna ultimo_error
        await supabaseAdmin.from('drive_sync_jobs')
            .update({ status: 'failed', ultimo_error: message }) // <-- AÑADIDO
            .eq('id', jobId);
    }
    return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500
    });
  }
});