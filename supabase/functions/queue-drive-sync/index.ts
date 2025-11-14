// supabase/functions/queue-drive-sync/index.ts
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { serve } from 'std/http/server.ts' // Usar la ruta del import_map

serve(async (req) => {
  // Manejo de CORS
    if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
    }
  
    try {
    // --- ¡CAMBIO AQUÍ! ---
    // 1. Leer el provider_token del body que envía el frontend
    const { provider_token } = await req.json()
    if (!provider_token) {
      throw new Error('No se recibió el provider_token desde el cliente.')
    }
    // --- FIN DEL CAMBIO ---

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 2. Obtener el usuario (solo para el ID)
    const userRes = await supabaseAdmin.auth.getUser(
      req.headers.get('Authorization')!.replace('Bearer ', '')
    )
    if (userRes.error) throw userRes.error
    const user = userRes.data.user

    // 3. Borrar trabajos antiguos
    const { error: deleteError } = await supabaseAdmin
      .from('drive_sync_jobs')
      .delete()
      .eq('user_id', user.id)
      
    if (deleteError) {
        console.warn('No se pudo borrar el job antiguo, puede que no existiera:', deleteError.message)
    }

    // 4. Insertar el nuevo trabajo (¡ahora sí con el token!)
    const { data: newJob, error: insertError } = await supabaseAdmin
      .from('drive_sync_jobs')
      .insert({
        user_id: user.id,
        status: 'pending',
        provider_token: provider_token, // <-- Usar el token del body
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Error en insert drive_sync_job:', insertError)
      throw insertError
    }

    // Devolver éxito
    return new Response(
      JSON.stringify({ job_id: newJob.id, status: 'pending' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    console.error('Error en queue-drive-sync:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})