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
  drive_url_materia: string | null;
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
      drive_url_materia, 
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

    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    let driveFolderIdActividad: string | null = null;
    let driveFolderIdEntregas: string | null = null;
    let driveFolderIdCalificados: string | null = null;

    if (drive_url_materia) {
        const scriptResponse = await fetch(appsScriptUrl, {
            method: 'POST',
            body: JSON.stringify({
                action: 'create_activity_folder',
                drive_url_materia: drive_url_materia,
                nombre_actividad: nombre_actividad,
                unidad: unidad
            }),
            headers: { 'Content-Type': 'application/json' },
        });
        if (!scriptResponse.ok) throw new Error("Error al crear carpetas en Google Drive.");
        const driveData = await scriptResponse.json();
        if(driveData.status === 'success') {
          driveFolderIdActividad = driveData.drive_folder_id_actividad;
          driveFolderIdEntregas = driveData.drive_folder_id_entregas;
          driveFolderIdCalificados = driveData.drive_folder_id_calificados;
        }
    }

    let rubricaSheetRange: string | null = null;
    let rubricaSpreadsheetId: string | null = null;
    if (drive_url_materia && criterios && criterios.length > 0) {
      const rubricaResponse = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'guardar_rubrica',
          drive_url_materia: drive_url_materia, // Pasamos la URL de la materia
          nombre_actividad: nombre_actividad,
          criterios: criterios,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!rubricaResponse.ok) throw new Error("Error al guardar la rúbrica en Google Sheets.");
      const rubricaData = await rubricaResponse.json();
      if(rubricaData.status === 'success') {
        rubricaSheetRange = rubricaData.rubrica_sheet_range;
        rubricaSpreadsheetId = rubricaData.rubrica_spreadsheet_id;
      }
    }

    const { data: nuevaActividad, error: insertError } = await supabase
      .from('actividades')
      .insert({
        materia_id,
        nombre: nombre_actividad,
        unidad,
        tipo_entrega,
        user_id: user.id,
        descripcion: descripcion,
        drive_folder_id: driveFolderIdActividad,
        drive_folder_entregas_id: driveFolderIdEntregas,
        drive_folder_id_calificados: driveFolderIdCalificados,
        rubrica_sheet_range: rubricaSheetRange,
        rubrica_spreadsheet_id: rubricaSpreadsheetId,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ 
        message: "Actividad creada exitosamente y sincronizada con Google Drive.",
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