// supabase/functions/queue-drive-sync/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
    // 1. Manejar solicitud OPTIONS de CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
  
    try {
        // 2. Autenticar al usuario (Docente)
        const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
        );
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) throw new Error("Usuario no autenticado.");

        // 3. Crear el cliente Admin
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        // 4. Usar UPSERT para crear un trabajo si no existe uno pendiente para este usuario
        const { data: jobData, error: upsertError } = await supabaseAdmin
            .from('drive_sync_jobs')
            .upsert(
                { user_id: user.id, status: 'pending' },
                {
                    onConflict: 'user_id',
                    ignoreDuplicates: false, // Queremos obtener el ID del trabajo
                }
            )
            .select('id')
            .single();

        if (upsertError) {
            console.error("Error en Upsert drive_sync_jobs:", upsertError);
            throw upsertError;
        }

        // 5. Invocar la función trabajadora (worker) de forma asíncrona pero SIN esperar aquí.
        // El cliente que llamó a `poll-drive-sync-status` se encargará de esperar.
        // Usamos el cliente admin para pasar la service_role_key y evitar problemas de JWT.
        supabaseAdmin.functions.invoke('sync-drive-on-first-login', {
            headers: {
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            }
        }).then(({ error }) => {
            if (error) {
                console.error(`Error en la invocación en segundo plano de sync-drive-on-first-login:`, error);
            } else {
                console.log(`Invocación en segundo plano de sync-drive-on-first-login completada para el trabajo del usuario ${user.id}.`);
            }
        });

        // 6. Devolver el ID del trabajo creado/encontrado
        return new Response(JSON.stringify({ jobId: jobData.id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
        });

    } catch (error) {
        // 7. Manejo de errores
        const message = error instanceof Error ? error.message : "Ocurrió un error desconocido.";
        console.error("Error grave en queue-drive-sync:", message);
        return new Response(JSON.stringify({ message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500
        });
    }
});