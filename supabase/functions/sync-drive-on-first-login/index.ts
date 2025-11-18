// supabase/functions/sync-drive-on-first-login/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  const dynamicCorsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: dynamicCorsHeaders }); }
  
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response(JSON.stringify({ message: 'No autorizado' }), { status: 401, headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" } });
  }

  let jobId = null;
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    
    // 1. Limpiar trabajos antiguos
    const { error: deleteError } = await supabaseAdmin
      .from('drive_sync_jobs')
      .delete()
      .in('status', ['completed', 'failed']); 

    if (deleteError) console.warn('Advertencia: No se pudieron limpiar los jobs antiguos:', deleteError.message);

    // 2. Buscar un trabajo pendiente
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

    const { data: materias, error: materiasError } = await supabaseAdmin
        .from('materias')
        .select(`*, alumnos(*)`)
        .eq('user_id', user.id);
    if (materiasError) throw materiasError;

    // Configuración de Google Apps Script
    const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    if (!googleScriptUrl) throw new Error("GOOGLE_SCRIPT_CREATE_MATERIA_URL no definido.");

    const docentePayload = { id: user.id, nombre: user.user_metadata?.full_name || user.email, email: user.email };

    // --- CAMBIO PRINCIPAL AQUÍ ---
    // Si NO hay materias, forzamos la creación de la carpeta del docente usando 'create_materias_batch' con lista vacía.
    if (!materias || materias.length === 0) {
       console.log(`El usuario ${user.email} no tiene materias, pero crearemos su carpeta raíz.`);
       
       const payloadEmpty = {
         action: 'create_materias_batch', // Esta acción crea la carpeta del docente antes de iterar
         docente: docentePayload,
         materias: [] // Lista vacía
       };

       const response = await fetch(googleScriptUrl, { 
         method: 'POST', 
         headers: { 'Content-Type': 'application/json' }, 
         body: JSON.stringify(payloadEmpty) 
       });

       if (!response.ok) {
         throw new Error(`Error al crear carpeta base del docente: ${await response.text()}`);
       }
       
       console.log("Carpeta raíz del docente creada/verificada exitosamente.");
    } else {
       // Si HAY materias, usamos el bucle individual para evitar Timeouts de Supabase
       for (const materia of materias) {
         console.log(`Procesando materia ${materia.nombre} (ID: ${materia.id})...`);
         
         if (materia.drive_url) {
           console.log(`Materia ${materia.nombre} ya tiene drive_url, saltando.`);
           continue;
         }
   
         const payload = {
           action: 'create_materia_struct',
           docente: docentePayload,
           materia: materia
         };
   
         const response = await fetch(googleScriptUrl, { 
           method: 'POST', 
           headers: { 'Content-Type': 'application/json' }, 
           body: JSON.stringify(payload) 
         });
         
         const responseText = await response.text();
         if (!response.ok) throw new Error(`Apps Script error: ${responseText}`);
         
         const scriptResponse = JSON.parse(responseText);
         if (scriptResponse.status === 'error') throw new Error(`Google Script error: ${scriptResponse.message}`);
         
         // Actualizar materia en BD
         const { drive_url, rubricas_spreadsheet_id, plagio_spreadsheet_id, calificaciones_spreadsheet_id, drive_folder_material_id } = scriptResponse;
         await supabaseAdmin.from('materias').update({
             drive_url, rubricas_spreadsheet_id, plagio_spreadsheet_id, calificaciones_spreadsheet_id, drive_folder_material_id
         }).eq('id', materia.id);
   
         console.log(`Materia ${materia.nombre} sincronizada.`);
       }
    }
    // --- FIN DEL CAMBIO ---

    // 7. Marcar al usuario como sincronizado y el trabajo como completado
    await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { ...(user.user_metadata || {}), drive_synced: true }
    });

    await supabaseAdmin.from('drive_sync_jobs').update({ status: 'completed', ultimo_error: null }).eq('id', jobId);

    return new Response(JSON.stringify({ success: true, message: `Sincronización completada para ${user.email}.` }), {
        headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" },
        status: 200
     });
  
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ocurrió un error desconocido.";
    console.error("Error en sync-drive-on-first-login:", message);
    if (jobId) {
        await supabaseAdmin.from('drive_sync_jobs').update({ status: 'failed', ultimo_error: message }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ message }), {
        headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" },
        status: 500
    });
  }
});