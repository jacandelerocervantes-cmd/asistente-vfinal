// supabase/functions/validar-alumno/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { matricula, correo }: { matricula: string, correo: string } = await req.json();
    if (!matricula || !correo) {
      throw new Error("Matrícula y correo son requeridos.");
    }

    // Usar cliente ADMIN para buscar al alumno sin RLS
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: alumno, error: findError } = await supabaseAdmin
      .from('alumnos')
      .select('id')
      .eq('matricula', matricula.toUpperCase())
      .eq('correo', correo.toLowerCase())
      .single();

    if (findError) throw findError;

    if (!alumno) {
      return new Response(JSON.stringify({ error: "Matrícula o correo no encontrado o no coinciden." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404 // Not Found
      });
    }

    // Podrías añadir lógica aquí para verificar si la materia está activa, etc.

    // Si se encuentra, devolvemos el ID del alumno
    return new Response(JSON.stringify({ alumnoId: alumno.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error("Error en validar-alumno:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 // Bad Request o 500 Internal Server Error
    });
  }
});