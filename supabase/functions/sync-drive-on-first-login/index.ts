// supabase/functions/sync-drive-on-first-login/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }
  try {
    // Autenticación y obtener usuario
    const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");
    const userId = user.id; // Guardar ID para el catch

    console.log(`[Sync Function] Iniciando para user ${userId}...`);

    // Crear cliente Admin
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // --- REVISAR METADATOS OTRA VEZ AQUÍ ---
    // Hacemos una verificación rápida aquí también por si acaso
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError) throw new Error(`Error al re-verificar usuario: ${userError.message}`);
    if (userData?.user?.user_metadata?.drive_synced === true) {
        console.log(`[Sync Function] Sincronización ya marcada como completada para ${userId}. Saliendo.`);
        // Devolver éxito indicando que no se hizo nada nuevo
        return new Response(JSON.stringify({ success: true, message: "La sincronización ya estaba completada." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200 // OK, no necesita sincronizar
        });
    }
    // --- FIN REVISIÓN METADATOS ---


    // Obtener materias CON alumnos
    console.log(`[Sync Function] Obteniendo materias y alumnos para user ${userId}...`);
    const { data: materias, error: materiasError } = await supabaseAdmin
        .from('materias')
        .select(`*, alumnos(*)`) // <-- Asegurar alumnos(*)
        .eq('user_id', user.id);
    if (materiasError) throw materiasError;

    if (!materias || materias.length === 0) {
      console.log(`[Sync Function] No hay materias para sincronizar para user ${userId}.`);
       // --- IMPORTANTE: Actualizar metadata aunque no haya materias ---
       // Para evitar que se llame de nuevo en el futuro si crea materias después.
       await supabaseAdmin.auth.admin.updateUserById(userId, {
           user_metadata: { ...(userData?.user?.user_metadata || {}), drive_synced: true }
       });
       console.log(`[Sync Function] Metadatos actualizados a drive_synced: true (sin materias).`);
       return new Response(JSON.stringify({ success: true, message: "No hay materias para sincronizar." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }
    console.log(`[Sync Function] Encontradas ${materias.length} materias.`);
    
    // Llamar a Google Apps Script
    const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    if (!googleScriptUrl) throw new Error("El secreto GOOGLE_SCRIPT_CREATE_MATERIA_URL no está definido.");

    const payload = { action: 'create_materias_batch', docente: { id: user.id, nombre: user.user_metadata?.full_name || user.email, email: user.email }, materias };
    
    console.log(`[Sync Function] Llamando a Apps Script...`);
    const response = await fetch(googleScriptUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const responseText = await response.text();
    console.log(`[Sync Function] Respuesta Apps Script (status ${response.status}): ${responseText.substring(0, 500)}...`); // Loguear inicio respuesta
    if (!response.ok) throw new Error(`Apps Script devolvió error ${response.status}: ${responseText}`);

    const scriptResponse = JSON.parse(responseText);
    if (scriptResponse.status === 'error') throw new Error(`Error reportado por Google Script: ${scriptResponse.message}`);

    // Procesar respuesta de Apps Script y actualizar Supabase
    const { drive_urls, rubricas_spreadsheet_ids, plagio_spreadsheet_ids, calificaciones_spreadsheet_ids } = scriptResponse;
    
    if (drive_urls && rubricas_spreadsheet_ids && plagio_spreadsheet_ids && calificaciones_spreadsheet_ids) {
        console.log("[Sync Function] Actualizando IDs de Drive/Sheets en Supabase...");
        // Bucle para actualizar materias (usar Promise.all para eficiencia)
        const updatePromises = Object.keys(drive_urls).map(materiaId => {
            return supabaseAdmin.from('materias').update({
                drive_url: drive_urls[materiaId],
                rubricas_spreadsheet_id: rubricas_spreadsheet_ids[materiaId],
                plagio_spreadsheet_id: plagio_spreadsheet_ids[materiaId],
                calificaciones_spreadsheet_id: calificaciones_spreadsheet_ids[materiaId]
            }).eq('id', parseInt(materiaId, 10)); // Convertir ID a número
        });
        const results = await Promise.all(updatePromises);
        // Verificar errores en las actualizaciones
        results.forEach((result, index) => {
             if (result.error) {
                 console.error(`[Sync Function] Error al actualizar materia ID ${Object.keys(drive_urls)[index]}:`, result.error.message);
                 // Considerar si lanzar un error general o solo loguear
            }
        });
        console.log("[Sync Function] Actualización de materias en Supabase completada.");
    } else {
        // Loguear pero no necesariamente fallar si Apps Script no devolvió todos los IDs (podría ser un caso válido)
        console.warn("[Sync Function] Apps Script no devolvió todos los IDs esperados (drive_urls, rubricas_ids, etc.).");
    }

    // --- ACTUALIZAR METADATOS DEL USUARIO AL FINAL Y CON ÉXITO ---
    console.log(`[Sync Function] Marcando drive_synced: true para user ${userId}...`);
    const { error: metaUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
         // Asegurar merge con metadata existente
        user_metadata: { ...(userData?.user?.user_metadata || {}), drive_synced: true }
    });
    if (metaUpdateError) {
        // Loguear el error pero no fallar la respuesta principal, la sincronización se hizo.
        console.error(`[Sync Function] Error al actualizar metadatos drive_synced para ${userId}:`, metaUpdateError.message);
    } else {
         console.log(`[Sync Function] Metadatos actualizados exitosamente.`);
    }
    // --- FIN ACTUALIZACIÓN METADATOS ---


    // Respuesta final exitosa
    console.log(`[Sync Function] Sincronización completada exitosamente para user ${userId}.`);
    return new Response(JSON.stringify({ success: true, message: `Sincronización completada.` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
     });
  
  } catch (error) {
    console.error("[Sync Function] ERROR:", error);
    const message = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
    // Devolver error 500
    return new Response(JSON.stringify({ message: message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500 // Error interno
    });
  }
});