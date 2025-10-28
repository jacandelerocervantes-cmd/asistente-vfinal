// supabase/functions/log-focus-change/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LogPayload {
  intento_id: number;
  tipo_evento: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Esta función DEBE ser llamada por un usuario autenticado.
    // El cliente Supabase creado con el header de autorización del usuario
    // aplicará las políticas de RLS automáticamente.
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { intento_id, tipo_evento }: LogPayload = await req.json();
    if (!intento_id || !tipo_evento) {
      throw new Error("Faltan 'intento_id' o 'tipo_evento'.");
    }

    const { error } = await supabaseClient
      .from('registros_actividad_intento')
      .insert({ intento_id, tipo_evento });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred.";
    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
