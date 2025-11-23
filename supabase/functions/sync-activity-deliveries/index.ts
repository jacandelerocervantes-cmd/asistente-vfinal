// supabase/functions/sync-activity-deliveries/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

interface DriveFile {
  id: string;
  name: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { actividad_id } = await req.json();
    if (!actividad_id) throw new Error("Falta actividad_id");

    // 1. Obtener el usuario (Docente) que llama a la función
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("No autorizado");

    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error("Usuario no autenticado.");
    
    const docenteUserId = user.id; // <--- ESTE ES EL ID QUE USAREMOS

    // 2. Cliente Admin para operaciones de base de datos
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 3. Obtener datos de la actividad
    const { data: actividad, error: actError } = await supabaseAdmin
        .from('actividades')
        .select('drive_folder_entregas_id, materia_id')
        .eq('id', actividad_id)
        .single();

    if (actError || !actividad?.drive_folder_entregas_id) {
        throw new Error("La actividad no tiene carpeta de entregas vinculada.");
    }

    // 4. Llamar a Apps Script
    const googleUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
    console.log(`Consultando Drive Folder: ${actividad.drive_folder_entregas_id}`);
    
    const response = await fetch(googleUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'get_folder_contents', 
            drive_folder_id: actividad.drive_folder_entregas_id
        })
    });

    if (!response.ok) throw new Error(`Error Google: ${response.status} ${response.statusText}`);
    const googleData = await response.json();

    // Manejo robusto de la respuesta de Google
    // { status: 'success', archivos: { folders: [...], files: [...] } }
    // Debemos acceder a googleData.archivos.files
    let archivos: DriveFile[] = [];
    
    if (googleData.archivos && Array.isArray(googleData.archivos.files)) {
        archivos = googleData.archivos.files;
    } else if (Array.isArray(googleData.files)) {
        archivos = googleData.files;
    } else if (Array.isArray(googleData.archivos)) {
        archivos = googleData.archivos;
    }

    console.log(`Google devolvió ${archivos.length} archivos (entregas).`);

    // 5. Sincronizar con BD
    let nuevos = 0;
    const detalles = [];
    
    const { data: alumnos } = await supabaseAdmin
        .from('alumnos')
        .select('id, matricula') // Ya no necesitamos user_id del alumno aquí estrictamente
        .eq('materia_id', actividad.materia_id);
        
    const mapaAlumnos = new Map();
    alumnos?.forEach(a => {
        if (a.matricula) mapaAlumnos.set(a.matricula.toUpperCase().trim(), a.id);
    });

    for (const archivo of archivos) {
        const nombreArchivo = archivo.name ? archivo.name.toUpperCase() : "";
        let encontrado = false;

        for (const [matricula, alumnoId] of mapaAlumnos) {
            if (nombreArchivo.includes(matricula)) {
                const { error: upsertError } = await supabaseAdmin
                    .from('calificaciones')
                    .upsert({
                        actividad_id,
                        alumno_id: alumnoId,
                        estado: 'entregado',
                        evidencia_drive_file_id: archivo.id,
                        user_id: docenteUserId // <--- CORRECCIÓN: Usamos el ID del docente
                    }, { onConflict: 'actividad_id, alumno_id' });
                
                if (!upsertError) {
                    nuevos++;
                    encontrado = true;
                    detalles.push(`Vinculado: ${archivo.name} -> Alumno ID ${alumnoId}`);
                } else {
                    console.error("Error upsert:", upsertError);
                }
            }
        }
        if (!encontrado) detalles.push(`Ignorado (sin matrícula coincidente): ${archivo.name}`);
    }

    return new Response(JSON.stringify({ 
        message: `Sincronización exitosa. ${nuevos} entregas procesadas.`,
        nuevos,
        detalles_debug: detalles
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error) {
    console.error("Error sync-activity:", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});