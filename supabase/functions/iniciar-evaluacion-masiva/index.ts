// supabase/functions/iniciar-evaluacion-masiva/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  calificaciones_ids: number[];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log("Iniciando 'iniciar-evaluacion-masiva'...");
    const body: RequestBody = await req.json();
    const { calificaciones_ids } = body;

    if (!calificaciones_ids || !Array.isArray(calificaciones_ids) || calificaciones_ids.length === 0) {
      throw new Error("Se requiere un array 'calificaciones_ids' con al menos un ID.");
    }
    console.log(`Recibidos ${calificaciones_ids.length} IDs de calificación para encolar.`);

    // Obtener el user_id del token de autorización
    const authHeader = req.headers.get("Authorization")!;
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");
    console.log(`Usuario autenticado: ${user.id}`);

    // Usar cliente con rol de servicio para insertar en la cola
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Crear un objeto por cada ID para insertar en la cola
    const trabajosParaInsertar = calificaciones_ids.map(id => ({
      calificacion_id: id, // <-- ¡CLAVE! Asegura la relación
      estado: 'pendiente',
      intentos: 0,
      user_id: user.id // Asociar el trabajo al usuario que lo solicita
    }));
    console.log("Preparando inserción de trabajos:", trabajosParaInsertar);

    // Insertar todos los trabajos en la tabla cola_de_trabajos
    const { error: insertError } = await supabaseAdmin
      .from('cola_de_trabajos')
      .insert(trabajosParaInsertar);

    if (insertError) {
      console.error("Error al insertar trabajos en la cola:", insertError);
      throw new Error(`Error al encolar trabajos: ${insertError.message}`);
    }

    console.log(`${trabajosParaInsertar.length} trabajos añadidos a la cola exitosamente.`);
    
    console.log(`Disparando 'procesar-cola-evaluacion' asíncronamente...`);
    // Opcional: Invocar inmediatamente 'procesar-cola-evaluacion' una vez
    // --- CORRECCIÓN: Añadir el header de autorización ---
    supabaseAdmin.functions.invoke('procesar-cola-evaluacion', {
      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` }
    }).catch(err => {
      // Loguear el error de la invocación asíncrona, pero no fallar la respuesta al usuario
      console.error("Error al invocar 'procesar-cola-evaluacion' de forma asíncrona:", err.message);
    });

    return new Response(JSON.stringify({ message: `${calificaciones_ids.length} trabajos de evaluación añadidos a la cola.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    console.error("ERROR GRAVE en 'iniciar-evaluacion-masiva':", errorMessage);
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400, // Devolver 400 en caso de error
    });
  }
});