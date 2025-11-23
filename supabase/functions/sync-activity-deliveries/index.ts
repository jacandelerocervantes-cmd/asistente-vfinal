// supabase/functions/sync-activity-deliveries/index.ts
import { serve } from "std/http/server.ts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { actividad_id } = await req.json();
    if (!actividad_id) throw new Error("Falta actividad_id");

    const supabaseAdmin: SupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Obtener ID de la carpeta de entregas
    const { data: actividad, error: actError } = await supabaseAdmin
        .from('actividades')
        .select('drive_folder_entregas_id, materia_id')
        .eq('id', actividad_id)
        .single();

    if (actError || !actividad?.drive_folder_entregas_id) {
        throw new Error("La actividad no tiene carpeta de entregas vinculada.");
    }

    // 2. Llamar a Apps Script
    const googleUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    console.log(`Consultando Drive Folder: ${actividad.drive_folder_entregas_id}`);
    
    const response = await fetch(googleUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'get_folder_contents', 
            folderId: actividad.drive_folder_entregas_id 
        })
    });

    if (!response.ok) throw new Error(`Error Google: ${response.status} ${response.statusText}`);
    const googleData = await response.json();
    const archivos = googleData.archivos || googleData.data || [];

    console.log(`Google devolvió ${archivos.length} archivos.`);

    // 3. Sincronizar con la base de datos (Lógica Mejorada)
    let nuevos = 0;
    const detalles = []; // Para depuración
    
    // Obtener alumnos y equipos
    const { data: alumnos } = await supabaseAdmin
        .from('alumnos')
        .select('id, matricula, nombre, apellido')
        .eq('materia_id', actividad.materia_id);
        
    // Mapa de Matrículas (Normalizado a mayúsculas)
    const mapaAlumnos = new Map();
    alumnos?.forEach((a: { matricula: string; id: string }) => {
        if (a.matricula) mapaAlumnos.set(a.matricula.toUpperCase().trim(), a.id);
    });

    for (const archivo of archivos) {
        const nombreArchivo = archivo.name.toUpperCase(); // Normalizar nombre archivo
        let encontrado = false;

        // Buscar coincidencia con Matrículas
        for (const [matricula, alumnoId] of mapaAlumnos) {
            if (nombreArchivo.includes(matricula)) {
                // ¡COINCIDENCIA!
                const { error: upsertError } = await supabaseAdmin
                    .from('calificaciones')
                    .upsert({
                        actividad_id,
                        alumno_id: alumnoId,
                        estado: 'entregado',
                        evidencia_drive_file_id: archivo.id,
                        user_id: '481ce051-0e9a-4bd7-9e96-6c095a63183a' // ID del docente temporal
                    }, { onConflict: 'actividad_id, alumno_id' });
                
                if (!upsertError) {
                    nuevos++;
                    encontrado = true;
                    detalles.push(`Vinculado: ${archivo.name} -> Alumno ID ${alumnoId}`);
                } else {
                    console.error("Error upsert:", upsertError);
                }
                // No hacemos break aquí por si un archivo pertenece a un equipo (varios alumnos), 
                // aunque para individual con break bastaría. Lo dejamos sin break por seguridad en grupales.
            }
        }
        
        if (!encontrado) detalles.push(`Ignorado: ${archivo.name} (No contiene ninguna matrícula conocida)`);
    }

    return new Response(JSON.stringify({ 
        message: `Sincronización: ${nuevos} entregas procesadas.`,
        nuevos,
        total_archivos_drive: archivos.length,
        detalles_debug: detalles // Esto te servirá para ver qué pasó
    }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
    });

  } catch (error) {
    console.error("Error sync-activity:", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
    });
  }
});