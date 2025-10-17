// supabase/functions/sync-drive-on-first-login/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "supabase";

console.log("Función 'sync-drive-on-first-login' v-batch inicializada.");

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
    if (!user) throw new Error("No se pudo obtener la información del usuario.");

    if (user.user_metadata?.drive_synced) {
      return new Response(JSON.stringify({ message: "El Drive del usuario ya está sincronizado." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: materias, error: materiasError } = await supabaseAdmin
      .from('materias')
      .select(`*, alumnos ( matricula, nombre, apellido )`)
      .eq('user_id', user.id)
      .is('drive_url', null);

    if (materiasError) throw materiasError;

    if (materias.length > 0) {
        console.log(`Se encontraron ${materias.length} materias para sincronizar en un solo lote.`);
        const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
        if (!googleScriptUrl) throw new Error("El secreto GOOGLE_SCRIPT_CREATE_MATERIA_URL no está definido.");

        // --- ¡CORRECCIÓN APLICADA AQUÍ! ---
        const payload = {
            action: 'create_materias_batch', // Se usa la acción correcta para lotes
            docente: { 
                id: user.id, 
                nombre: user.user_metadata?.full_name || user.email,
                email: user.email
            },
            materias: materias // Se envía el array completo de materias
        };

        const response = await fetch(googleScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        
        const scriptResponse = await response.json();
        if (scriptResponse.status === 'error') throw new Error(`Error en el lote de Google Script: ${scriptResponse.message}`);

        if (scriptResponse.drive_urls) {
            for (const materiaId in scriptResponse.drive_urls) {
                await supabaseAdmin
                    .from('materias')
                    .update({ drive_url: scriptResponse.drive_urls[materiaId] })
                    .eq('id', materiaId);
            }
        }
    }

    await supabaseAdmin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, drive_synced: true } });
    console.log(`Usuario ${user.email} marcado como sincronizado.`);

    return new Response(JSON.stringify({ success: true, message: `Sincronización completada. ${materias.length} materias procesadas.` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });

  } catch (error) {
    console.error("ERROR en sync-drive-on-first-login:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});