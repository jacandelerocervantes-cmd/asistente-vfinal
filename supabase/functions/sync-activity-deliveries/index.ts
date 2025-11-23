// supabase/functions/sync-activity-deliveries/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

    // 2. Llamar a Apps Script (Usando tu lógica probada)
    const googleUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    const response = await fetch(googleUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'get_folder_contents', // Esta acción ya existe en tu code.js
            folderId: actividad.drive_folder_entregas_id // Nota: En tu otro script usabas 'drive_folder_id', aquí 'folderId' según lo que espere tu Apps Script.
            // Si tu Apps Script espera 'drive_folder_id', cámbialo aquí abajo:
            // drive_folder_id: actividad.drive_folder_entregas_id 
        })
    });

    if (!response.ok) throw new Error("Error conectando con Google.");
    const googleData = await response.json();
    
    // Adaptarse a lo que devuelva tu script (archivos o data)
    const archivos = googleData.archivos || googleData.data || [];

    // 3. Guardar en Base de Datos
    let nuevos = 0;
    
    // Obtener alumnos para buscar coincidencias (Matrícula en nombre de archivo)
    const { data: alumnos } = await supabaseAdmin
        .from('alumnos')
        .select('id, matricula')
        .eq('materia_id', actividad.materia_id);
        
    const mapaAlumnos = new Map(alumnos?.map((a: { matricula: string; id: string }) => [a.matricula, a.id]));

    for (const archivo of archivos) {
        // Buscar dueño del archivo
        for (const [matricula, alumnoId] of mapaAlumnos) {
            if (archivo.name.includes(matricula)) {
                // Upsert en calificaciones
                const { error: upsertError } = await supabaseAdmin
                    .from('calificaciones')
                    .upsert({
                        actividad_id,
                        alumno_id: alumnoId,
                        estado: 'entregado',
                        evidencia_drive_file_id: archivo.id,
                        user_id: '481ce051-0e9a-4bd7-9e96-6c095a63183a' // ID del docente temporalmente para cumplir FK
                    }, { onConflict: 'actividad_id, alumno_id' });
                
                if (!upsertError) nuevos++;
                break; 
            }
        }
    }

    return new Response(JSON.stringify({ 
        message: "Sincronización exitosa.",
        nuevos,
        archivos_encontrados: archivos.length
    }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
    });
  }
});