// supabase/functions/queue-drive-sync/index.ts

import { createClient } from '@supabase/supabase-js'
import { getCorsHeaders } from '../_shared/cors.ts'
// --- 1. CORRECCIÓN DE LA IMPORTACIÓN ---
// Usamos el 'import_map.json' que ya existe en tu proyecto
import { serve } from 'std/http/server.ts' 
// --- FIN DE LA CORRECCIÓN ---

serve(async (req: Request) => { 
  const dynamicCorsHeaders = getCorsHeaders(req);
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: dynamicCorsHeaders })
  }

  try {
    // El provider_token se recibe pero no se usa, lo cual está bien.
    const { provider_token } = await req.json()
    if (!provider_token) {
      throw new Error('No se recibió el provider_token desde el cliente.')
    }

    // 1. Crear el CLIENTE DE USUARIO.
    // Este cliente usará la ANON_KEY y el JWT del header.
    // Gracias a la política RLS, tendrá permiso para escribir.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!, 
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    
    // Obtener el usuario desde el token
    const userRes = await supabaseClient.auth.getUser(
      req.headers.get('Authorization')!.replace('Bearer ', '')
    )
    if (userRes.error) throw userRes.error
    const user = userRes.data.user
    
    // --- BLOQUE DE BORRADO ELIMINADO ---
    // Esta función, llamada por el usuario, ya no borra trabajos antiguos.
    // La limpieza la hará el worker 'sync-drive-on-first-login'.

    // Insertar el nuevo trabajo
    // La RLS debe permitir al usuario autenticado insertar en esta tabla
    // donde user_id == auth.uid()
    const { data: newJob, error: insertError } = await supabaseClient
      .from('drive_sync_jobs')
      .insert({
        user_id: user.id,
        status: 'pending',
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Error en insert drive_sync_job (RLS?):', insertError.message) 
      throw insertError
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