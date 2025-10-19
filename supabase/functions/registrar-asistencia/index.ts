// supabase/functions/sync-drive-on-first-login/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }
  try {
    const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: materias, error: materiasError } = await supabaseAdmin
        .from('materias')
        .select(`*`)
        .eq('user_id', user.id);
    if (materiasError) throw materiasError;

    if (!materias || materias.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No hay materias para sincronizar." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }
    
    const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    if (!googleScriptUrl) throw new Error("El secreto GOOGLE_SCRIPT_CREATE_MATERIA_URL no está definido.");

    const payload = { action: 'create_materias_batch', docente: { id: user.id, nombre: user.user_metadata?.full_name || user.email, email: user.email }, materias };
    
    const response = await fetch(googleScriptUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Apps Script devolvió un error de red: ${responseText}`);

    const scriptResponse = JSON.parse(responseText);
    if (scriptResponse.status === 'error') throw new Error(`Error reportado por Google Script: ${scriptResponse.message}`);

    const { drive_urls, rubricas_spreadsheet_ids, plagio_spreadsheet_ids, calificaciones_spreadsheet_ids } = scriptResponse;
    
    // --- ¡ESTA ES LA LÓGICA CORREGIDA Y COMPLETA! ---
    if (drive_urls && rubricas_spreadsheet_ids && plagio_spreadsheet_ids && calificaciones_spreadsheet_ids) {
        for (const materiaId in drive_urls) {
            const { error: updateError } = await supabaseAdmin.from('materias').update({ 
                drive_url: drive_urls[materiaId],
                rubricas_spreadsheet_id: rubricas_spreadsheet_ids[materiaId],
                plagio_spreadsheet_id: plagio_spreadsheet_ids[materiaId],
                calificaciones_spreadsheet_id: calificaciones_spreadsheet_ids[materiaId]
            }).eq('id', materiaId);

            if (updateError) {
                throw new Error(`Error al guardar en Supabase para la materia ${materiaId}: ${updateError.message}`);
            }
        }
    } else {
        throw new Error("La respuesta de Apps Script fue exitosa pero no contenía todos los IDs necesarios.");
    }

    await supabaseAdmin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, drive_synced: true } });

    return new Response(JSON.stringify({ success: true, message: `Sincronización completada.` }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
  }
});