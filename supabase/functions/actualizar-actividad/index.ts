// supabase/functions/actualizar-actividad/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define la estructura de los datos que esperamos recibir
interface Criterio {
  descripcion: string;
  puntos: number;
}

interface ActividadUpdateRequest {
  actividad_id: number; // <-- ID de la actividad a actualizar
  materia_id: number;
  drive_url_materia: string | null;
  nombre_actividad: string;
  unidad: number | null;
  tipo_entrega: string;
  criterios: Criterio[];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
      actividad_id,
      materia_id,
      drive_url_materia, 
      nombre_actividad, 
      unidad, 
      tipo_entrega,
      criterios
    }: ActividadUpdateRequest = await req.json();

    if (!actividad_id) {
        throw new Error("Se requiere el ID de la actividad para actualizarla.");
    }

    const authHeader = req.headers.get("Authorization")!;
    
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    // 1. Llama al Apps Script para (re)guardar la rúbrica y obtener el nuevo rango.
    // Usamos la misma función 'guardar_rubrica' que se encarga de sobreescribir si ya existe.
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    let rubricaSheetRange: string | null = null;
    if (drive_url_materia && criterios && criterios.length > 0) {
      const rubricaResponse = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'guardar_rubrica',
          drive_url_materia: drive_url_materia,
          nombre_actividad: nombre_actividad,
          criterios: criterios,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!rubricaResponse.ok) throw new Error("Error al actualizar la rúbrica en Google Sheets.");
      const rubricaData = await rubricaResponse.json();
      if(rubricaData.status === 'success') {
        rubricaSheetRange = rubricaData.rubrica_sheet_range;
      }
    }

    // 2. Actualizar los datos de la actividad en Supabase
    const { data: actividadActualizada, error: updateError } = await supabase
      .from('actividades')
      .update({
        nombre: nombre_actividad,
        unidad,
        tipo_entrega,
        rubrica_sheet_range: rubricaSheetRange,
      })
      .eq('id', actividad_id)
      .eq('user_id', user.id) // Asegura que el usuario solo puede editar sus propias actividades
      .select()
      .single();

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ 
        message: "Actividad actualizada exitosamente.",
        actividad: actividadActualizada
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