// EN: supabase/functions/eliminar-recurso/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

// Helper para extraer el ID de la URL de Drive
function extractDriveIdFromUrl(driveUrl: string): string | null {
  if (!driveUrl) return null;
  const match = driveUrl.match(/(?:folders\/|d\/|id=|\/open\?id=)([-\w]{25,})/);
  return match ? match[1] : null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { recurso_id, tipo_recurso } = await req.json(); // ej: { recurso_id: 123, tipo_recurso: 'materia' }
    if (!recurso_id || !tipo_recurso) {
      throw new Error("Se requiere 'recurso_id' y 'tipo_recurso' (ej: 'materia' o 'actividad').");
    }

    // Usar Admin Client para bypassear RLS y borrar
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let driveId: string | null = null;
    let tableName: string = "";

    // 1. Obtener el ID de Drive desde Supabase
    if (tipo_recurso === 'materia') {
      tableName = 'materias';
      const { data, error } = await supabaseAdmin.from(tableName).select('drive_url').eq('id', recurso_id).single();
      if (error || !data) throw new Error(`Materia ${recurso_id} no encontrada.`);
      driveId = extractDriveIdFromUrl(data.drive_url || "");
      
    } else if (tipo_recurso === 'actividad') {
      tableName = 'actividades';
      const { data, error } = await supabaseAdmin.from(tableName).select('drive_folder_id').eq('id', recurso_id).single();
      if (error || !data) throw new Error(`Actividad ${recurso_id} no encontrada.`);
      driveId = data.drive_folder_id; // Este es un ID directo
    
    } else {
      throw new Error(`Tipo de recurso '${tipo_recurso}' no soportado.`);
    }

    // 2. Llamar a Apps Script para borrar en Drive (si existe el ID)
    if (driveId) {
      const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_CREATE_MATERIA_URL");
      if (!appsScriptUrl) throw new Error("URL de Apps Script no configurada.");
      
      const response = await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'eliminar_recurso_drive', drive_id: driveId }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error(`Error en Apps Script: ${await response.text()}`);
      const gasResult = await response.json();
      if (gasResult.status !== 'success') throw new Error(`Apps Script reportó un error: ${gasResult.message}`);
      console.log(`Drive: ${gasResult.message}`);
    } else {
      console.log(`No se encontró Drive ID para ${tipo_recurso} ${recurso_id}. Saltando borrado de Drive.`);
    }

    // 3. Borrar de Supabase (Paso final)
    const { error: deleteError } = await supabaseAdmin
      .from(tableName)
      .delete()
      .eq('id', recurso_id);

    if (deleteError) throw new Error(`Error al borrar de Supabase: ${deleteError.message}`);

    return new Response(JSON.stringify({ message: `${tipo_recurso} eliminado exitosamente de Supabase y Drive.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});