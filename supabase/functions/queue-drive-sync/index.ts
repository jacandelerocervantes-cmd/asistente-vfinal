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

        // 4. CORRECCIÓN: Usar UPSERT para crear o resetear un trabajo para este usuario
        // Esto asegura que si el usuario refresca la página, el trabajo se ponga en 'pending'
        const { error: upsertError } = await supabaseAdmin
            .from('drive_sync_jobs')
            .upsert(
                { user_id: user.id, status: 'pending' },
                { onConflict: 'user_id' }
            );

        if (upsertError) {
            console.error("Error en Upsert drive_sync_jobs:", upsertError);
            throw upsertError;
        }

        // 5. CORRECCIÓN: OBTENER el ID del trabajo para este usuario (garantizado que existe)
        const { data: jobData, error: selectError } = await supabaseAdmin
            .from('drive_sync_jobs')
            .select('id')
            .eq('user_id', user.id)
            .single();
        
        if (selectError) {
            console.error("Error seleccionando job_id después del upsert:", selectError);
            throw selectError;
        }
        if (!jobData) {
            // Esto no debería pasar si el upsert funcionó
            throw new Error("No se pudo encontrar el job_id después del upsert.");
        }

        const jobId = jobData.id; // Esto ahora es un ID numérico garantizado
        console.log(`queue-drive-sync: Asegurado job ${jobId} para user ${user.id}.`);


        // 6. Invocar la función trabajadora (worker) de forma asíncrona (sin await)
        // El cliente que llamó a `poll-drive-sync-status` se encargará de esperar.
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

        // 7. Devolver el ID del trabajo creado/encontrado
        return new Response(JSON.stringify({ jobId: jobId }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
        });

    } catch (error) {
        // 8. Manejo de errores
        const message = error instanceof Error ? error.message : "Ocurrió un error desconocido.";
        console.error("Error grave en queue-drive-sync:", message);
        return new Response(JSON.stringify({ message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500
        });
    }
});