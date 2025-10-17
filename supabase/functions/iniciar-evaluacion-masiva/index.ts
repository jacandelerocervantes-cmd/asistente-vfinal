// supabase/functions/iniciar-evaluacion-masiva/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define la estructura de los datos que esperamos recibir desde el frontend
interface EvaluacionRequest {
  calificaciones_ids: number[]; // Un array con los IDs de las calificaciones a procesar
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { calificaciones_ids }: EvaluacionRequest = await req.json();
    if (!calificaciones_ids || calificaciones_ids.length === 0) {
      throw new Error("Se requiere una lista de IDs de calificaciones para iniciar la evaluación.");
    }

    const authHeader = req.headers.get("Authorization")!;
    
    // Cliente que actúa en nombre del docente autenticado
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    // 1. Preparamos una "orden de trabajo" para cada calificación seleccionada
    const trabajosParaLaCola = calificaciones_ids.map(id => ({
      calificacion_id: id,
      user_id: user.id,
      estado: 'pendiente', // Marcamos el trabajo como listo para ser procesado
      intentos: 0
    }));

    // 2. Insertamos todas las órdenes de trabajo en la tabla 'cola_de_trabajos'
    const { error: insertError } = await supabase
      .from('cola_de_trabajos')
      .insert(trabajosParaLaCola);

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ 
        message: `Evaluación de ${trabajosParaLaCola.length} trabajos iniciada. Las calificaciones aparecerán automáticamente en unos momentos.`
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
});