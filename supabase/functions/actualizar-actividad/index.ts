import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    // Aceptamos 'id' o 'actividad_id' por compatibilidad
    const id = body.id || body.actividad_id;
    const { nombre, criterios, descripcion, unidad, tipo_entrega, rubricas_spreadsheet_id } = body;

    if (!id) throw new Error("ID de actividad requerido");

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Obtener datos ANTIGUOS para comparar
    const { data: oldData, error: oldError } = await supabase
      .from('actividades')
      .select('*')
      .eq('id', id)
      .single();

    if (oldError || !oldData) throw new Error("Actividad no encontrada");

    // 2. Preparar actualizaciones
    const updates: {
      nombre?: string;
      criterios?: unknown;
      descripcion?: string;
      unidad?: number;
      tipo_entrega?: string;
      rubrica_sheet_range?: string;
    } = {};
    if (nombre) updates.nombre = nombre;
    if (criterios) updates.criterios = criterios;
    if (descripcion !== undefined) updates.descripcion = descripcion;
    if (unidad) updates.unidad = unidad;
    if (tipo_entrega) updates.tipo_entrega = tipo_entrega;

    // 3. Sincronizar con Google (Apps Script) si cambió Nombre o Criterios
    // Necesitamos la URL del Script
    const scriptUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    
    if (scriptUrl && (nombre || criterios)) {
        // A. Renombrar Carpeta en Drive (Si cambió el nombre)
        if (nombre && nombre !== oldData.nombre && oldData.drive_folder_id) {
            await fetch(scriptUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'renombrar_carpeta', // Asegúrate de tener este caso en tu Apps Script, o usa un genérico
                    drive_id: oldData.drive_folder_id,
                    nuevo_nombre: nombre
                })
            }).catch(e => console.error("Error renombrando carpeta:", e));
        }

        // B. Actualizar Rúbrica en Sheet (Borrar vieja -> Crear nueva)
        // Esto garantiza que el Sheet siempre coincida con la BD
        if (rubricas_spreadsheet_id && oldData.rubrica_sheet_range) {
            // 1. Borrar la anterior
            await fetch(scriptUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'eliminar_rubrica',
                    rubricas_spreadsheet_id: rubricas_spreadsheet_id,
                    rubrica_sheet_range: oldData.rubrica_sheet_range
                })
            });

            // 2. Crear la nueva (con el nuevo nombre y criterios)
            const resNueva = await fetch(scriptUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'guardar_rubrica',
                    rubricas_spreadsheet_id: rubricas_spreadsheet_id,
                    nombre_actividad: nombre || oldData.nombre,
                    criterios: criterios || oldData.criterios
                })
            });
            
            const jsonNueva = await resNueva.json();
            if (jsonNueva.rubrica_sheet_range) {
                updates.rubrica_sheet_range = jsonNueva.rubrica_sheet_range;
            }
        }
    }

    // 4. Guardar en Supabase
    const { data, error } = await supabase
      .from('actividades')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ message: "Actividad actualizada", actividad: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});