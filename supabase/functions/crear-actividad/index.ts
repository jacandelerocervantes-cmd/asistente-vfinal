// supabase/functions/crear-actividad/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

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
      .select('drive_url, rubricas_spreadsheet_id') // Obtenemos también el ID de la hoja de rúbricas
      .eq('id', materia_id)
      .single();

    if (materiaError) throw materiaError;
    if (!materia.drive_url) throw new Error("La materia no está sincronizada correctamente con Google Drive. Falta la URL de Drive.");
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
    if (!appsScriptUrl) throw new Error("La URL de Apps Script no está configurada.");

    // --- ¡MEJORA DE ROBUSTEZ! ---
    // Si el ID de la hoja de rúbricas no existe, lo creamos/obtenemos y lo guardamos.
    if (!materia.rubricas_spreadsheet_id) {
      console.log(`ID de hoja de rúbricas no encontrado para materia ${materia_id}. Creando...`);
      const sheetResponse = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_or_create_rubric_sheet', drive_url_materia: materia.drive_url }),
        headers: { 'Content-Type': 'application/json' }
      });
      const sheetData = await sheetResponse.json();
      if (sheetData.status !== 'success' || !sheetData.rubricas_spreadsheet_id) {
        throw new Error("No se pudo crear la hoja de cálculo de rúbricas necesaria.");
      }
      materia.rubricas_spreadsheet_id = sheetData.rubricas_spreadsheet_id;
      // Actualizamos la base de datos para futuras llamadas
      await supabase.from('materias').update({ rubricas_spreadsheet_id: materia.rubricas_spreadsheet_id }).eq('id', materia_id);
      console.log(`Hoja de rúbricas creada y guardada para materia ${materia_id}.`);
    }

    // 2. Crear las carpetas para la actividad
    let driveData;
    try {
      const folderResponse = await fetch(appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'create_activity_folder', drive_url_materia: materia.drive_url, nombre_actividad, unidad }), headers: { 'Content-Type': 'application/json' } });
      if (!folderResponse.ok) throw new Error(`Error de red al crear carpetas en Google Drive: ${folderResponse.statusText}`);
      driveData = await folderResponse.json();
      if(driveData.status !== 'success') throw new Error(driveData.message || "Error desconocido en Apps Script al crear carpetas.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Fallo en el paso de creación de carpetas: ${message}`);
    }
    
    // 3. Guardar la rúbrica
    let rubricaData;
    try {
      const rubricaPayload = {
        action: 'guardar_rubrica',
        rubricas_spreadsheet_id: materia.rubricas_spreadsheet_id, // <-- CORRECCIÓN: Usamos el ID directo
        nombre_actividad,
        criterios
      };
      const rubricaResponse = await fetch(appsScriptUrl, { 
        method: 'POST', 
        body: JSON.stringify(rubricaPayload), 
        headers: { 'Content-Type': 'application/json' } });
      if (!rubricaResponse.ok) throw new Error(`Error de red al guardar la rúbrica: ${rubricaResponse.statusText}`);
      rubricaData = await rubricaResponse.json();
      if(rubricaData.status !== 'success') throw new Error(rubricaData.message || "Error desconocido en Apps Script al guardar la rúbrica.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Fallo en el paso de guardado de rúbrica: ${message}`);
    }

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
        rubrica_sheet_range: rubricaData.rubrica_sheet_range, // Rango dentro de la hoja de rúbricas
        rubrica_spreadsheet_id: rubricaData.rubrica_spreadsheet_id // ID de la hoja de rúbricas
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
    // Captura el mensaje de error. Si es un error complejo (como el de la llamada fetch fallida), usa el mensaje.
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    
    // Esto asegurará que el mensaje se muestre en los logs de Supabase para depuración.
    console.error("ERROR en crear-actividad:", errorMessage);
    
    // Devuelve el mensaje de error específico al frontend con el código 400.
    return new Response(JSON.stringify({ message: errorMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
});