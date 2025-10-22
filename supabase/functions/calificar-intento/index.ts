// supabase/functions/calificar-intento/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AlumnoValidationRequest {
  matricula: string;
  correo: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { matricula, correo }: AlumnoValidationRequest = await req.json();

    if (!matricula || !correo) {
      throw new Error("Se requiere matrícula y correo.");
    }

    // Usar el SERVICE_ROLE_KEY para poder consultar la tabla 'alumnos' sin RLS de usuario.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: alumno, error } = await supabaseAdmin
      .from('alumnos')
      .select('id')
      .eq('matricula', matricula.trim().toUpperCase())
      .eq('correo', correo.trim().toLowerCase())
      .single();

    if (error || !alumno) {
      throw new Error("Matrícula o correo incorrectos.");
    }

    return new Response(JSON.stringify({ alumnoId: alumno.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});