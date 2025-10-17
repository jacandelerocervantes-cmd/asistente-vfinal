// supabase/functions/crear-actividad/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define la estructura de los datos, incluyendo el nuevo campo
interface ActividadData {
  materia_id: number;
  drive_url_materia: string | null;
  nombre_actividad: string;
  unidad: number | null;
  tipo_entrega: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { materia_id, drive_url_materia, nombre_actividad, unidad, tipo_entrega }: ActividadData = await req.json();
    const authHeader = req.headers.get("Authorization")!;
    
    // Usamos un cliente con la sesión del usuario para la inserción inicial y validación
    const supabaseUserClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Usamos un cliente Admin para operaciones que requieren elevación de privilegios (actualizar con el ID de Drive)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user } } = await supabaseUserClient.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    // 1. Guardar los metadatos de la actividad en Supabase para obtener un ID
    const { data: nuevaActividad, error: insertError } = await supabaseUserClient
      .from('actividades')
      .insert({
        materia_id,
        nombre: nombre_actividad,
        unidad,
        tipo_entrega,
        user_id: user.id,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // 2. Llamar al Apps Script para crear las carpetas (esta lógica no cambia)
    if (drive_url_materia) {
        const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
        if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

        const appsScriptPayload = {
            action: 'create_activity_folder',
            drive_url_materia: drive_url_materia,
            nombre_actividad: nombre_actividad,
            unidad: unidad
        };
        
        fetch(appsScriptUrl, {
            method: 'POST',
            body: JSON.stringify(appsScriptPayload),
            headers: { 'Content-Type': 'application/json' },
        }).catch(err => console.error("Error al llamar al Apps Script:", err.message));
    } else {
        console.warn(`Advertencia: No se crearon carpetas en Drive porque la materia con ID ${materia_id} no tiene una 'drive_url' asociada.`);
    }

    return new Response(JSON.stringify({ 
        message: "Actividad creada exitosamente.",
        actividad: nuevaActividad
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