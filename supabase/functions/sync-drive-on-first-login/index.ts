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
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");
    if (user.user_metadata?.drive_synced) {
      return new Response(JSON.stringify({ message: "El Drive del usuario ya está sincronizado." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    await supabaseAdmin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, drive_synced: true } });

    const { data: materias, error: materiasError } = await supabaseAdmin.from('materias').select(`*, alumnos ( matricula, nombre, apellido )`).eq('user_id', user.id).is('drive_url', null);
    if (materiasError) throw materiasError;

    if (materias.length > 0) {
        const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
        if (!googleScriptUrl) throw new Error("El secreto GOOGLE_SCRIPT_CREATE_MATERIA_URL no está definido.");

        const payload = { action: 'create_materias_batch', docente: { id: user.id, nombre: user.user_metadata?.full_name || user.email, email: user.email }, materias };
        const response = await fetch(googleScriptUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        
        // --- ¡CORRECCIÓN CLAVE! ---
        // Validar si la respuesta de la red fue exitosa antes de intentar leer el JSON.
        if (!response.ok) throw new Error(`Error en la llamada a Google Apps Script: ${response.statusText}`);

        const scriptResponse = await response.json();
        if (scriptResponse.status === 'error') throw new Error(`Error en el lote de Google Script: ${scriptResponse.message}`);

        // --- ¡CORRECCIÓN CLAVE! ---
        // Adaptado a la respuesta del code.gs final, que devuelve los 3 IDs de sheets.
        const { drive_urls, rubricas_spreadsheet_ids, plagio_spreadsheet_ids, calificaciones_spreadsheet_ids } = scriptResponse;
        if (drive_urls) {
            for (const materiaId in drive_urls) {
                await supabaseAdmin.from('materias').update({ 
                    drive_url: drive_urls[materiaId],
                    rubricas_spreadsheet_id: rubricas_spreadsheet_ids[materiaId],
                    plagio_spreadsheet_id: plagio_spreadsheet_ids[materiaId],
                    calificaciones_spreadsheet_id: calificaciones_spreadsheet_ids[materiaId]
                }).eq('id', materiaId);
            }
        }
    }

    return new Response(JSON.stringify({ success: true, message: `Sincronización completada.` }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido durante la sincronización.";
    return new Response(JSON.stringify({ message: errorMessage }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
  }
});