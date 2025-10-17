// supabase/functions/crear-actividad/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Criterio {
  descripcion: string;
  puntos: number;
}

interface ActividadData {
  materia_id: number;
  nombre_actividad: string;
  unidad: number | null;
  tipo_entrega: string;
  criterios: Criterio[];
  descripcion: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
      materia_id,
      nombre_actividad, 
      unidad, 
      tipo_entrega, 
      criterios,
      descripcion
    }: ActividadData = await req.json();

    const authHeader = req.headers.get("Authorization")!;
    
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado.");

    // --- ¡LÓGICA CORREGIDA Y MÁS ESTRICTA! ---
    // 1. Obtener los datos de la materia, incluyendo los nuevos IDs de los sheets
    const { data: materia, error: materiaError } = await supabase
      .from('materias')
      .select('drive_url, rubricas_spreadsheet_id')
      .eq('id', materia_id)
      .single();

    if (materiaError) throw materiaError;
    if (!materia.drive_url || !materia.rubricas_spreadsheet_id) {
      throw new Error("La materia no está sincronizada correctamente con Google Drive. Faltan IDs de Drive/Sheets.");
    }

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    // 2. Crear las carpetas para la actividad
    const folderResponse = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'create_activity_folder', drive_url_materia: materia.drive_url, nombre_actividad, unidad }), headers: { 'Content-Type': 'application/json' } });
    if (!folderResponse.ok) throw new Error("Error al crear carpetas en Google Drive.");
    const driveData = await folderResponse.json();
    if(driveData.status !== 'success') throw new Error(driveData.message);
    
    // 3. Guardar la rúbrica
    const rubricaResponse = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'guardar_rubrica', rubricas_spreadsheet_id: materia.rubricas_spreadsheet_id, nombre_actividad, criterios }), headers: { 'Content-Type': 'application/json' } });
    if (!rubricaResponse.ok) throw new Error("Error al guardar la rúbrica.");
    const rubricaData = await rubricaResponse.json();
    if(rubricaData.status !== 'success') throw new Error(rubricaData.message);

    // 4. Guardar todo en Supabase
    const { data: nuevaActividad, error: insertError } = await supabase.from('actividades').insert({
        materia_id,
        nombre: nombre_actividad,
        unidad,
        tipo_entrega,
        user_id: user.id,
        descripcion: descripcion,
        drive_folder_id: driveData.drive_folder_id_actividad,
        drive_folder_entregas_id: driveData.drive_folder_id_entregas,
        drive_folder_id_calificados: driveData.drive_folder_id_calificados,
        rubrica_sheet_range: rubricaData.rubrica_sheet_range,
        rubrica_spreadsheet_id: materia.rubricas_spreadsheet_id
      }).select().single();
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ 
        message: "Actividad creada y sincronizada.",
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