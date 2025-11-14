// supabase/functions/sync-activity-deliveries/index.ts
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { serve } from 'std/http/server.ts'

// Define the structure of a file from Google Drive
interface DriveFile {
  id: string;
  name: string;
  owner_email: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { actividad_id } = await req.json();
    if (!actividad_id) {
      throw new Error("Se requiere el ID de la actividad (actividad_id).");
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // --- 1. Obtener la carpeta de la actividad y la materia ---
    const { data: actividad, error: actividadError } = await supabaseAdmin
      .from('actividades')
      .select('folder_id, materia_id')
      .eq('id', actividad_id)
      .single();

    if (actividadError) throw new Error(`Actividad no encontrada: ${actividadError.message}`);
    if (!actividad.folder_id) throw new Error("La actividad no tiene una carpeta de Drive asociada.");

    // --- 2. Obtener la lista de alumnos inscritos en la materia ---
    const { data: alumnosInscritos, error: alumnosError } = await supabaseAdmin
      .from('alumnos_materias')
      .select('alumnos(id, email)')
      .eq('materia_id', actividad.materia_id);

    if (alumnosError) throw alumnosError;

    // Crear un mapa de email -> alumno_id para búsqueda rápida
    const emailToAlumnoIdMap = new Map(
      alumnosInscritos.map(item => [item.alumnos.email, item.alumnos.id])
    );

    // --- 3. Obtener los archivos de la carpeta de Drive ---
    const appsScriptUrl = Deno.env.get("GOOGLE_SCRIPT_URL"); // Asegúrate de que esta variable de entorno exista
    if (!appsScriptUrl) throw new Error("URL de Google Apps Script no configurada.");

    const driveResponse = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'obtener_entregas_drive', // La acción que tu GAS debe reconocer
        folderId: actividad.folder_id,
      }),
    });

    if (!driveResponse.ok) throw new Error(`Error en Google Apps Script: ${await driveResponse.text()}`);
    const driveData = await driveResponse.json();
    if (driveData.status !== 'success') throw new Error(driveData.message);

    const driveFiles: DriveFile[] = driveData.files;

    // --- 4. Obtener las calificaciones que ya existen para esta actividad ---
    const { data: calificacionesExistentes, error: calificacionesError } = await supabaseAdmin
      .from('calificaciones')
      .select('drive_file_id')
      .eq('actividad_id', actividad_id);

    if (calificacionesError) throw calificacionesError;
    const existingFileIds = new Set(calificacionesExistentes.map(c => c.drive_file_id));

    // --- 5. Reconciliar datos y encontrar nuevas entregas ---
    const nuevasCalificaciones = [];
    for (const file of driveFiles) {
      // Si el archivo ya tiene una calificación registrada, lo ignoramos
      if (existingFileIds.has(file.id)) {
        continue;
      }

      // Encontrar el alumno_id correspondiente al email del propietario del archivo
      const alumnoId = emailToAlumnoIdMap.get(file.owner_email);

      if (alumnoId) {
        nuevasCalificaciones.push({
          actividad_id: actividad_id,
          alumno_id: alumnoId,
          drive_file_id: file.id,
          // Otros valores por defecto que quieras establecer
          estado: 'entregado', 
        });
      }
    }

    // --- 6. Insertar solo las nuevas calificaciones ---
    if (nuevasCalificaciones.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('calificaciones')
        .insert(nuevasCalificaciones);

      if (insertError) throw insertError;
    }

    return new Response(
      JSON.stringify({ message: `Sincronización completada. Se encontraron y registraron ${nuevasCalificaciones.length} nuevas entregas.` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error('Error en sync-activity-deliveries:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
