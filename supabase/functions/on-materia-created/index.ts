// supabase/functions/on-materia-created/index.ts
// NOTA: Esta función fue reemplazada por 'sync-drive-on-first-login' y ya no debería estar en uso.

import { serve } from "std/http/server.ts";
import { createClient } from "supabase";

console.log("Función 'on-materia-created' (obsoleta) inicializada.");

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { record: materia } = await req.json();
    if (!materia) throw new Error("Payload del webhook no contenía el registro 'record'.");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(materia.user_id);
    if (userError) throw userError;
    if (!user) throw new Error(`Usuario con ID ${materia.user_id} no encontrado.`);
    
    const nombreDocente = user.user_metadata?.full_name || user.email;
    if (!nombreDocente) throw new Error("No se pudo obtener ni 'full_name' ni 'email' para el usuario.");

    const { data: alumnos, error: alumnosError } = await supabaseAdmin
      .from('alumnos')
      .select('matricula, nombre, apellido')
      .eq('materia_id', materia.id);
    if (alumnosError) throw alumnosError;

    const payload = {
      action: 'create_materia',
      materia: { id: materia.id, nombre: materia.nombre, semestre: materia.semestre, unidades: materia.unidades },
      docente: { id: user.id, nombre: nombreDocente, email: user.email },
      alumnos: alumnos
    };

    const googleScriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    if (!googleScriptUrl) throw new Error("El secreto GOOGLE_SCRIPT_CREATE_MATERIA_URL no está definido.");
    
    const response = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const scriptResponse = await response.json();
    if (scriptResponse.status === 'error') throw new Error(`Error en Google Script: ${scriptResponse.message}`);

    if (scriptResponse.drive_url) {
      await supabaseAdmin.from('materias').update({ drive_url: scriptResponse.drive_url }).eq('id', materia.id);
    }

    return new Response(JSON.stringify({ success: true, message: 'Proceso completado.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});