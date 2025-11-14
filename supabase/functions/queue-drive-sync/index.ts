// supabase/functions/queue-drive-sync/index.ts

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
// --- 1. CORRECCIÓN DE LA IMPORTACIÓN ---
// Usamos el 'import_map.json' que ya existe en tu proyecto
import { serve } from 'std/http/server.ts' 
// --- FIN DE LA CORRECCIÓN ---

serve(async (req: Request) => { 
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { provider_token } = await req.json()
    if (!provider_token) {
      throw new Error('No se recibió el provider_token desde el cliente.')
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const userRes = await supabaseAdmin.auth.getUser(
      req.headers.get('Authorization')!.replace('Bearer ', '')
    )
    if (userRes.error) throw userRes.error
    const user = userRes.data.user
    
    // Borrar trabajos antiguos
    const { error: deleteError } = await supabaseAdmin
      .from('drive_sync_jobs')
      .delete()
      .eq('user_id', user.id)
      
    if (deleteError) {
        console.warn('No se pudo borrar el job antiguo:', deleteError.message)
    }

    // Insertar el nuevo trabajo
    const { data: newJob, error: insertError } = await supabaseAdmin
      .from('drive_sync_jobs')
      .insert({
        user_id: user.id,
        status: 'pending',
        provider_token: provider_token,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Error en insert drive_sync_job:', insertError.message) // <-- Corregido
      throw insertError
    }

    return new Response(
      JSON.stringify({ job_id: newJob.id, status: 'pending' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  // --- 2. CORRECCIÓN DE TIPO 'unknown' ---
  } catch (e: any) { // Usamos 'any' para acceder a .message
  // --- FIN DE LA CORRECCIÓN ---
    console.error('Error en queue-drive-sync:', e.message)
    return new Response(
      JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})