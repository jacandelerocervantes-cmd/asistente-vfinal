// supabase/functions/get-at-risk-students/index.ts
import { serve } from 'std/http/server.ts'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req: Request) => {
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { materia_id } = await req.json()
    if (!materia_id) {
      throw new Error('Falta "materia_id".')
    }

    // Usar cliente Admin para llamar a la RPC
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Llamar a la nueva RPC 'get_materia_at_risk_report'
    // Podemos pasar los umbrales o usar los defaults (80% y 70)
    const { data: riskData, error: rpcError } = await supabaseAdmin
      .rpc('get_materia_at_risk_report', {
        p_materia_id: materia_id,
        // Opcional: p_risk_attendance_threshold: 80,
        // Opcional: p_risk_grade_threshold: 70
      })

    if (rpcError) throw rpcError

    // Devolver la lista de alumnos en riesgo
    return new Response(JSON.stringify({ at_risk_students: riskData || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Error in get-at-risk-students:", error)
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
