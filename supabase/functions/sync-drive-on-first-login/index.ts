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

    if (deleteError) console.warn('Advertencia: Limpieza de jobs falló:', deleteError.message);

    // 2. Buscar trabajo pendiente
    const { data: job, error: jobError } = await supabaseAdmin
      .from('drive_sync_jobs')
      .select('*')
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) {
      return new Response(JSON.stringify({ message: "No hay trabajos pendientes." }), { headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" } });
    }
    
    jobId = job.id;
    const userId = job.user_id;

    // 3. Marcar como procesando
    await supabaseAdmin.from('drive_sync_jobs').update({ status: 'processing' }).eq('id', jobId);

    // 4. Obtener datos
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!user) throw new Error(`Usuario ${userId} no encontrado.`);

    // OBTENER MATERIAS CON ALUMNOS
    const { data: materias, error: materiasError } = await supabaseAdmin
        .from('materias')
        .select(`*, alumnos(*)`) 
        .eq('user_id', user.id);
    if (materiasError) throw materiasError;

    // 5. Caso Base: Sin materias (Crear solo carpeta docente)
    const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    if (!googleScriptUrl) throw new Error("GOOGLE_SCRIPT_CREATE_MATERIA_URL no definido.");

    const docentePayload = { id: user.id, nombre: user.user_metadata?.full_name || user.email, email: user.email };

    if (!materias || materias.length === 0) {
       const payloadEmpty = {
         action: 'create_materias_batch',
         docente: docentePayload,
         materias: [] 
       };
       await fetch(googleScriptUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadEmpty) });
       
       await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: { ...(user.user_metadata || {}), drive_synced: true } });
       await supabaseAdmin.from('drive_sync_jobs').update({ status: 'completed', ultimo_error: null }).eq('id', jobId);
       return new Response(JSON.stringify({ message: "Carpeta docente verificada." }), { headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" } });
    }

    // 6. BUCLE DE MATERIAS (CORREGIDO: SIN "CONTINUE")
    for (const materia of materias) {
      console.log(`Sincronizando materia ${materia.nombre} (ID: ${materia.id})...`);
      
      // --- 🔥 CAMBIO CRÍTICO: ELIMINAMOS EL BLOQUE "IF EXISTE, SALTAR" 🔥 ---
      // Ahora SIEMPRE enviamos la materia a Google para que actualice las listas.
      
      const payload = {
        action: 'create_materia_struct',
        docente: docentePayload,
        materia: materia // Esto lleva la lista actualizada de alumnos
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
      
      // Actualizar IDs en BD (por si cambiaron o era la primera vez)
      const { drive_url, rubricas_spreadsheet_id, plagio_spreadsheet_id, calificaciones_spreadsheet_id, drive_folder_material_id } = scriptResponse;
      
      await supabaseAdmin.from('materias').update({
          drive_url, rubricas_spreadsheet_id, plagio_spreadsheet_id, calificaciones_spreadsheet_id, drive_folder_material_id
      }).eq('id', materia.id);

      console.log(`Materia ${materia.nombre} sincronizada con éxito.`);
    }

    // 7. Finalizar
    await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { ...(user.user_metadata || {}), drive_synced: true }
    });
    await supabaseAdmin.from('drive_sync_jobs').update({ status: 'completed', ultimo_error: null }).eq('id', jobId);

    return new Response(JSON.stringify({ success: true, message: "Sincronización completa." }), {
        headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" },
        status: 200
     });
  
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    console.error("Error en worker:", message);
    if (jobId) {
        await supabaseAdmin.from('drive_sync_jobs').update({ status: 'failed', ultimo_error: message }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ message }), {
        headers: { ...dynamicCorsHeaders, "Content-Type": "application/json" },
        status: 500
    });
  }
});