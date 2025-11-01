// supabase/functions/poll-drive-sync-status/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

const POLLING_INTERVAL = 5000; // 5 segundos
const MAX_TIMEOUT = 295000; // 295 segundos (justo por debajo del límite de 5 min)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    try {
        // 1. Autenticar al usuario para obtener su ID
        const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
        );
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) throw new Error("Usuario no autenticado.");

        // 2. Invocar 'queue-drive-sync' para iniciar el trabajo y obtener el ID
        const { data: queueData, error: queueError } = await supabaseClient.functions.invoke('queue-drive-sync');
        if (queueError) throw new Error(`Error al encolar el trabajo: ${queueError.message}`);
        if (!queueData || !queueData.jobId) throw new Error("La función de encolado no devolvió un ID de trabajo.");
        
        const jobId = queueData.jobId;
        console.log(`Trabajo ${jobId} encolado para usuario ${user.id}. Iniciando sondeo...`);

        // 3. Iniciar el sondeo (polling)
        let elapsedTime = 0;
        while (elapsedTime < MAX_TIMEOUT) {
            const { data: job, error: jobError } = await supabaseAdmin
                .from('drive_sync_jobs')
                .select('status, ultimo_error')
                .eq('id', jobId)
                .single();

            if (jobError) throw new Error(`Error al consultar el estado del trabajo: ${jobError.message}`);

            if (job.status === 'completed') {
                console.log(`Trabajo ${jobId} completado.`);
                return new Response(JSON.stringify({ status: 'success', message: 'Sincronización completada.' }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                    status: 200,
                });
            }

            if (job.status === 'failed') {
                console.error(`Trabajo ${jobId} falló: ${job.ultimo_error}`);
                throw new Error(job.ultimo_error || 'El trabajo de sincronización falló sin un mensaje específico.');
            }

            // Si sigue 'pending' o 'processing', esperar y continuar
            await sleep(POLLING_INTERVAL);
            elapsedTime += POLLING_INTERVAL;
        }

        // Si se agota el tiempo de espera
        throw new Error("Se agotó el tiempo de espera para la sincronización. El proceso continúa en segundo plano, pero la página se desbloqueará.");

    } catch (error) {
        const message = error instanceof Error ? error.message : "Ocurrió un error desconocido.";
        console.error("Error en poll-drive-sync-status:", message);
        return new Response(JSON.stringify({ status: 'error', message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
        });
    }
});
