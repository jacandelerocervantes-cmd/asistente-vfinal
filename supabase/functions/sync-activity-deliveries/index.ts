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

    // 1. Autenticación y Cliente
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("No autorizado");

    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error("Usuario no autenticado.");
    const docenteUserId = user.id; // ID del docente para el campo user_id

    // Cliente Admin para acceso total a datos
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 2. Obtener datos de la actividad (incluyendo tipo_entrega)
    const { data: actividad, error: actError } = await supabaseAdmin
        .from('actividades')
        .select('drive_folder_entregas_id, materia_id, tipo_entrega') // <-- Importante: tipo_entrega
        .eq('id', actividad_id)
        .single();

    if (actError || !actividad?.drive_folder_entregas_id) {
        throw new Error("La actividad no tiene carpeta de entregas vinculada.");
    }

    // 3. Preparar Mapas de Alumnos y Grupos
    
    // A. Obtener todos los alumnos de la materia
    const { data: alumnos } = await supabaseAdmin
        .from('alumnos')
        .select('id, matricula')
        .eq('materia_id', actividad.materia_id);
        
    const mapaAlumnos = new Map(); // Matrícula -> ID
    alumnos?.forEach(a => {
        if (a.matricula) mapaAlumnos.set(a.matricula.toUpperCase().trim(), a.id);
    });

    // B. Obtener Grupos (Solo si es Grupal o Mixta)
    const mapaGrupos = new Map(); // AlumnoID -> { grupo_id, miembros: [id1, id2...] }
    
    if (['grupal', 'mixta'].includes(actividad.tipo_entrega)) {
        // Obtener asignaciones de grupo para estos alumnos
        const { data: asignaciones } = await supabaseAdmin
            .from('alumnos_grupos')
            .select('alumno_id, grupo_id')
            .in('alumno_id', alumnos?.map(a => a.id) || []);
        
        // Paso 1: Mapa temporal GrupoID -> Lista de Miembros
        const groupMembersMap = new Map();
        asignaciones?.forEach(rel => {
            if (!groupMembersMap.has(rel.grupo_id)) {
                groupMembersMap.set(rel.grupo_id, []);
            }
            groupMembersMap.get(rel.grupo_id).push(rel.alumno_id);
        });

        // Paso 2: Mapa final AlumnoID -> Info de su Grupo
        asignaciones?.forEach(rel => {
            mapaGrupos.set(rel.alumno_id, {
                grupo_id: rel.grupo_id,
                miembros: groupMembersMap.get(rel.grupo_id) || []
            });
        });
        console.log(`Mapa de grupos construido. ${mapaGrupos.size} alumnos tienen grupo.`);
    }

    // 4. Llamar a Apps Script para obtener archivos
    const googleUrl = Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL');
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

    // Normalizar respuesta de Google
    let archivos: DriveFile[] = [];
    if (googleData.archivos && Array.isArray(googleData.archivos.files)) {
        archivos = googleData.archivos.files;
    } else if (Array.isArray(googleData.files)) {
        archivos = googleData.files;
    } else if (Array.isArray(googleData.archivos)) {
        archivos = googleData.archivos;
    }
    console.log(`Google devolvió ${archivos.length} archivos.`);

    // 5. Procesar y Sincronizar
    let nuevos = 0;
    const detalles = [];

    for (const archivo of archivos) {
        const nombreArchivo = archivo.name ? archivo.name.toUpperCase() : "";
        let uploaderId = null;

        // Buscar quién subió el archivo (Matrícula en el nombre)
        for (const [matricula, id] of mapaAlumnos) {
            if (nombreArchivo.includes(matricula)) {
                uploaderId = id;
                break; // Encontrado
            }
        }

        if (uploaderId) {
            // Determinar a quiénes se les asigna la entrega
            const targets = []; // Array de { alumno_id, grupo_id? }

            // Verificar si aplica lógica grupal
            const infoGrupo = mapaGrupos.get(uploaderId);
            
            if (['grupal', 'mixta'].includes(actividad.tipo_entrega) && infoGrupo) {
                // CASO GRUPAL: Asignar a todos los miembros del grupo
                infoGrupo.miembros.forEach((miembroId: number) => {
                    targets.push({ 
                        alumno_id: miembroId, 
                        grupo_id: infoGrupo.grupo_id 
                    });
                });
                detalles.push(`Grupales: ${archivo.name} -> Grupo ID ${infoGrupo.grupo_id} (${targets.length} miembros)`);
            } else {
                // CASO INDIVIDUAL (o mixto sin grupo)
                targets.push({ 
                    alumno_id: uploaderId, 
                    grupo_id: null 
                });
                detalles.push(`Individual: ${archivo.name} -> Alumno ID ${uploaderId}`);
            }

            // Realizar Upserts para todos los destinatarios
            for (const target of targets) {
                const { error: upsertError } = await supabaseAdmin
                    .from('calificaciones')
                    .upsert({
                        actividad_id: actividad_id,
                        alumno_id: target.alumno_id,
                        grupo_id: target.grupo_id, // Guardar el ID del grupo si existe
                        estado: 'entregado',
                        evidencia_drive_file_id: archivo.id,
                        user_id: docenteUserId // El registro pertenece al docente
                    }, { onConflict: 'actividad_id, alumno_id' });
                
                if (!upsertError) nuevos++;
                else console.error(`Error upsert alumno ${target.alumno_id}:`, upsertError);
            }

        } else {
            detalles.push(`Ignorado (sin matrícula): ${archivo.name}`);
        }
    }

    return new Response(JSON.stringify({ 
        message: `Sincronización exitosa. Registros procesados: ${nuevos}.`,
        nuevos,
        detalles_debug: detalles
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error) {
    console.error("Error sync-activity:", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});