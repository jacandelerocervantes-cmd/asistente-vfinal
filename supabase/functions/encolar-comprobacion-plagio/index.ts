// supabase/functions/encolar-comprobacion-plagio/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  try {
    const { drive_file_ids, materia_id } = await req.json();
    if (!drive_file_ids || !Array.isArray(drive_file_ids) || drive_file_ids.length < 2 || !materia_id) {
      throw new Error("Se requieren 'drive_file_ids' (array con al menos 2 IDs) y 'materia_id'.");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: job, error } = await supabaseAdmin
      .from('plagio_jobs')
      .insert({
        user_id: user.id,
        materia_id: materia_id,
        drive_file_ids: drive_file_ids,
        status: 'pendiente'
      })
      .select()
      .single();

    if (error) throw error;

    // Opcional: Invocar al procesador asíncronamente para una respuesta más rápida
    supabaseAdmin.functions.invoke('procesar-cola-plagio', {
      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` }
    }).catch(console.error);

    return new Response(JSON.stringify({ message: "Comprobación de plagio encolada.", jobId: job.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 202, // 202 Accepted: La solicitud ha sido aceptada para procesamiento
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    return new Response(JSON.stringify({ message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
