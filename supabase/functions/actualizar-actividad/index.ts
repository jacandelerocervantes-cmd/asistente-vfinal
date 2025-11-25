// supabase/functions/actualizar-actividad/index.ts

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  // 1. Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Crear Cliente Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 3. Leer y Validar el Body
    const body = await req.json();
    console.log("Payload recibido en actualizar-actividad:", JSON.stringify(body)); // <--- LOG CLAVE

    const { id, nombre, descripcion, esta_activo, unidad, tipo_entrega } = body;

    if (!id) {
      throw new Error("El campo 'id' es obligatorio para actualizar.");
    }

    // 4. Obtener datos actuales (para comparar si cambió el nombre)
    const { data: actividadActual, error: errorConsulta } = await supabase
        .from('actividades')
        .select('nombre, drive_folder_id')
        .eq('id', id)
        .single();

    if (errorConsulta || !actividadActual) {
        throw new Error("No se encontró la actividad original.");
    }

    // 5. Actualizar en Supabase
    const updates: {
        nombre?: string;
        descripcion?: string;
        esta_activo?: boolean;
        unidad?: number;
        tipo_entrega?: string;
    } = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (descripcion !== undefined) updates.descripcion = descripcion;
    if (esta_activo !== undefined) updates.esta_activo = esta_activo;
    if (unidad !== undefined) updates.unidad = unidad;
    if (tipo_entrega !== undefined) updates.tipo_entrega = tipo_entrega;

    const { error: errorUpdate } = await supabase
      .from('actividades')
      .update(updates)
      .eq('id', id);

    if (errorUpdate) throw new Error(`Error actualizando DB: ${errorUpdate.message}`);

    // 6. Sincronizar con Google Drive (Si cambió el nombre y tiene carpeta)
    let driveMessage = "No hubo cambios en Drive.";
    
    if (nombre && nombre !== actividadActual.nombre && actividadActual.drive_folder_id) {
        console.log("Nombre cambió. Actualizando carpeta en Drive...");
        
        const scriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
        if (scriptUrl) {
            try {
                const resDrive = await fetch(scriptUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'rename_folder', // Asegúrate de tener este caso en tu GAS code.js
                        folder_id: actividadActual.drive_folder_id,
                        new_name: nombre
                    })
                });
                
                if (resDrive.ok) {
                    driveMessage = "Carpeta renombrada en Drive.";
                } else {
                    console.error("Error renombrando carpeta Drive:", await resDrive.text());
                    driveMessage = "Alerta: Se actualizó en DB pero falló Drive.";
                }
            } catch (e) {
                console.error("Error conexión Drive:", e);
            }
        }
    }

    return new Response(
      JSON.stringify({ message: "Actividad actualizada correctamente", drive: driveMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido en la actualización.";
    console.error("Error en actualizar-actividad:", message, error);
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 } // Retorna 400 con el mensaje claro
    );
  }
});