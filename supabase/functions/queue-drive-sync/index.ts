// supabase/functions/queue-drive-sync/index.ts

import { createClient } from '@supabase/supabase-js'
import { getCorsHeaders } from '../_shared/cors.ts'
import { serve } from 'std/http/server.ts'

serve(async (req: Request) => { 
  const dynamicCorsHeaders = getCorsHeaders(req);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: dynamicCorsHeaders })
  }

  try {
    // Ignoramos el body para evitar errores de parseo, no necesitamos el token
    await req.json().catch(() => {}); 

    // 1. Crear cliente de usuario
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!, 
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    
    const userRes = await supabaseClient.auth.getUser()
    if (userRes.error) throw userRes.error
    const user = userRes.data.user
    
    // --- CORRECCIÓN CRÍTICA: USAR UPSERT ---
    // En lugar de 'insert' (que falla si ya existe), usamos 'upsert'.
    // Esto reinicia el estado a 'pending' si ya había un trabajo atascado.
    const { data: newJob, error: insertError } = await supabaseClient
      .from('drive_sync_jobs')
      .upsert({
        user_id: user.id,
        status: 'pending',
        ultimo_error: null // Limpiamos cualquier error previo
      }, { onConflict: 'user_id' }) // Indicamos que el conflicto es por user_id
      .select('id')
      .single()

    if (insertError) {
      console.error('Error upsert drive_sync_job:', insertError.message) 
      throw insertError
    }

    // 3. DISPARADOR INMEDIATO AL WORKER
    console.log(`Trabajo ${newJob.id} listo. Invocando worker...`);
    
    const workerUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sync-drive-on-first-login`;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (workerUrl && serviceKey) {
        // Llamada asíncrona (no bloquea la respuesta al frontend)
        fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${serviceKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({}) 
        }).catch(err => console.error("Error al invocar worker (async):", err));
    }

    return new Response(
      JSON.stringify({ jobId: newJob.id, status: 'pending' }),
      { headers: { ...dynamicCorsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (e: any) {
    console.error('Error en queue-drive-sync:', e.message)
    return new Response(
      JSON.stringify({ error: e.message }),
      { headers: { ...dynamicCorsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})