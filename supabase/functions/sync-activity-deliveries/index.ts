// supabase/functions/sync-activity-deliveries/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let actividad_id: string | null = null;

  try {
    const body = await req.json();
    actividad_id = body.actividad_id;
    if (!actividad_id) throw new Error("El 'actividad_id' es requerido en el cuerpo de la solicitud.");
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("No autorizado");
    
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario inválido");

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 2. Datos Actividad
    const { data: act } = await admin.from('actividades').select('drive_folder_entregas_id, materia_id, tipo_entrega').eq('id', actividad_id).single();
    if (!act?.drive_folder_entregas_id) throw new Error("Sin carpeta Drive");

    // 3. PREPARACIÓN DE MAPAS (Alumnos y Grupos)
    
    // A. Mapa de Alumnos: Matrícula -> ID
    const { data: alumnos } = await admin.from('alumnos').select('id, matricula').eq('materia_id', act.materia_id);
    const mapaAlumnos = new Map();
    alumnos?.forEach(a => { if(a.matricula) mapaAlumnos.set(a.matricula.toUpperCase().trim(), a.id); });

    // B. Mapa de Grupos: Nombre -> { id, miembros[] }
    // Esto es vital para encontrar archivos como "Los_Revolucionarios_Maqueta.docx"
    const mapaGruposPorNombre = new Map(); 
    const mapaGruposPorId = new Map(); // Para búsqueda rápida por ID de alumno

    // Obtener grupos y sus miembros
    const { data: gruposDeMateria } = await admin.from('grupos').select('id, nombre').eq('materia_id', act.materia_id);
    
    if (gruposDeMateria && gruposDeMateria.length > 0) {
        const grupoIds = gruposDeMateria.map(g => g.id);
        
        // Obtener miembros
        const { data: rels } = await admin.from('alumnos_grupos').select('alumno_id, grupo_id').in('grupo_id', grupoIds);
        
        // Organizar miembros por ID de grupo
        const miembrosPorGrupo = new Map();
        rels?.forEach(r => {
            if (!miembrosPorGrupo.has(r.grupo_id)) miembrosPorGrupo.set(r.grupo_id, []);
            miembrosPorGrupo.get(r.grupo_id).push(r.alumno_id);
            
            // También guardamos la referencia inversa Alumno -> Grupo
            mapaGruposPorId.set(r.alumno_id, { grupo_id: r.grupo_id });
        });

        // Construir el mapa final Nombre -> Datos
        gruposDeMateria.forEach(g => {
            // Normalizamos el nombre para la búsqueda (MAYÚSCULAS y sin espacios extra)
            // Ejemplo: "Los Revolucionarios" -> "LOSREVOLUCIONARIOS" para comparar flexiblemente
            // O mantenemos espacios pero normalizamos mayúsculas
            const nombreNormalizado = g.nombre.toUpperCase().trim();
            const nombreSinEspacios = nombreNormalizado.replace(/\s+/g, '_'); // "LOS_REVOLUCIONARIOS"
            const nombreSinEspacios2 = nombreNormalizado.replace(/\s+/g, ''); // "LOSREVOLUCIONARIOS"

            const datosGrupo = {
                id: g.id,
                nombre: g.nombre,
                miembros: miembrosPorGrupo.get(g.id) || []
            };

            mapaGruposPorNombre.set(nombreNormalizado, datosGrupo);
            // Guardamos variantes para facilitar el match con nombres de archivo
            mapaGruposPorNombre.set(nombreSinEspacios, datosGrupo);
            mapaGruposPorNombre.set(nombreSinEspacios2, datosGrupo);
        });
    }

    // 4. Conectar a Google CON REINTENTOS
    let archivos = [];
    let intentos = 0;
    while(intentos < 3) {
        try {
            const res = await fetch(Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    action: 'get_folder_contents', 
                    drive_folder_id: act.drive_folder_entregas_id,
                    mime_types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
                })
            });
            if (res.status === 429) {
                console.warn("Google 429. Esperando...");
                await wait(3000 * (intentos + 1));
                intentos++;
                continue;
            }
            if (!res.ok) throw new Error("Google Error " + res.status);
            const json = await res.json();
            archivos = json.archivos?.files || json.files || [];
            break; // Éxito
        } catch(e) {
            intentos++;
            if(intentos >= 3) throw e;
            await wait(1000);
        }
    }

    // 5. PROCESAR ARCHIVOS (Lógica Mejorada)
    let updates = 0;
    for (const file of archivos) {
        // Normalizar nombre del archivo para búsqueda
        const fileNameUpper = file.name.toUpperCase(); 
        const fileNameNormalized = fileNameUpper.replace(/\s+/g, '_'); // Reemplaza espacios con _ para coincidir con variantes

        const targets = new Map(); // Usar Map para evitar duplicados por alumno_id

        // A. BUSCAR POR MATRÍCULA (Individual o Líder)
        for (const [mat, id] of mapaAlumnos) { 
            if (fileNameUpper.includes(mat)) { 
                // Encontramos una matrícula. ¿A quién asignamos?
                const infoGrupo = mapaGruposPorId.get(id);
                
                if (['grupal', 'mixta'].includes(act.tipo_entrega) && infoGrupo) {
                    // Si es grupal/mixta y el alumno tiene grupo -> Asignar a TODO el grupo
                    // Buscar los miembros usando el ID del grupo
                    // (Tenemos que buscar el grupo en la lista original o reconstruirlo)
                    // Usamos una búsqueda inversa simple o iteramos los valores del mapa de nombres
                    // Más fácil: ya tenemos los miembros en mapaGruposPorId? No, ahí solo está la ref.
                    // Recuperamos los miembros del grupo ID:
                    for (const datosGrupo of mapaGruposPorNombre.values()) {
                        if (datosGrupo.id === infoGrupo.grupo_id) {
                            datosGrupo.miembros.forEach((mid: number) => {
                                targets.set(mid, { id: mid, gid: infoGrupo.grupo_id });
                            });
                            break;
                        }
                    }
                } else {
                    // Individual o sin grupo -> Solo a él
                    targets.set(id, { id: id, gid: null });
                }
            } 
        }

        // B. BUSCAR POR NOMBRE DE GRUPO (Nuevo requerimiento)
        // Solo si es entrega grupal o mixta
        if (['grupal', 'mixta'].includes(act.tipo_entrega)) {
            for (const [nombreGrupoKey, datosGrupo] of mapaGruposPorNombre) {
                // Verificamos si el nombre del archivo contiene el nombre del grupo
                // Ej: "Los_Revolucionarios_Maqueta" contiene "LOS_REVOLUCIONARIOS"
                if (fileNameNormalized.includes(nombreGrupoKey)) {
                    console.log(`¡Match de Grupo encontrado! Archivo: ${file.name} -> Grupo: ${datosGrupo.nombre}`);
                    
                    // Asignar a todos los miembros
                    datosGrupo.miembros.forEach((mid: number) => {
                        // .set sobreescribe si ya existía, evitando duplicados
                        targets.set(mid, { id: mid, gid: datosGrupo.id });
                    });
                }
            }
        }

        // C. GUARDAR EN BASE DE DATOS
        if (targets.size > 0) {
            for (const t of targets.values()) {
                const { error } = await admin.from('calificaciones').upsert({
                    actividad_id, 
                    alumno_id: t.id, 
                    grupo_id: t.gid,
                    estado: 'entregado', 
                    evidencia_drive_file_id: file.id, 
                    user_id: user.id,
                    drive_url_entrega: file.webViewLink // Guardar el link visualizable también es útil
                }, { onConflict: 'actividad_id, alumno_id' });
                
                if (!error) updates++;
                else console.error("Error upsert calificación:", error);
            }
        }
    }

    return new Response(JSON.stringify({ message: "Sincronizado", nuevos: updates }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    const message = `Error en sync-activity-deliveries para actividad ID ${actividad_id || 'desconocido'}: ${errorMessage}`;
    console.error(message);
    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});