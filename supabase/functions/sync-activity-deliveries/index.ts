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

    // 3. Preparar Mapa de Grupos (CRUCIAL PARA MIXTAS/GRUPALES)
    const { data: alumnos } = await admin.from('alumnos').select('id, matricula').eq('materia_id', act.materia_id);
    const mapaAlumnos = new Map();
    alumnos?.forEach(a => { if(a.matricula) mapaAlumnos.set(a.matricula.toUpperCase().trim(), a.id); });

    const mapaGrupos = new Map();
    if (['grupal', 'mixta'].includes(act.tipo_entrega)) {
        // 1. Obtener solo los grupos de esta materia
        const { data: gruposDeMateria } = await admin.from('grupos').select('id').eq('materia_id', act.materia_id);
        const grupoIds = gruposDeMateria?.map(g => g.id) || [];
        const { data: rels } = await admin.from('alumnos_grupos').select('alumno_id, grupo_id').in('grupo_id', grupoIds);
        // Construir mapa: GrupoID -> [Array de AlumnoIDs]
        const grupos = new Map();
        rels?.forEach(r => { 
            if(!grupos.has(r.grupo_id)) grupos.set(r.grupo_id, []); 
            grupos.get(r.grupo_id).push(r.alumno_id);
        });
        // Construir mapa: AlumnoID -> {grupo_id, miembros}
        rels?.forEach(r => { 
            mapaGrupos.set(r.alumno_id, { grupo_id: r.grupo_id, miembros: grupos.get(r.grupo_id) }); 
        });
    }

    // 4. Conectar a Google CON REINTENTOS (SOLUCIÓN ERROR 429)
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

    // 5. Procesar
    let updates = 0;
    for (const file of archivos) {
        const name = file.name.toUpperCase();
        let uploaderId = null;
        // Detectar matrícula en nombre
        for (const [mat, id] of mapaAlumnos) { 
            if (name.includes(mat)) { uploaderId = id; break; } 
        }

        if (uploaderId) {
            const targets = [];
            // Lógica Inteligente de Grupos
            const infoGrupo = mapaGrupos.get(uploaderId);
            
            if (act.tipo_entrega === 'grupal') {
                if (!infoGrupo) throw new Error(`El alumno con matrícula en '${file.name}' no pertenece a ningún grupo para esta entrega grupal.`);
                // Entrega grupal -> A todos los miembros
                infoGrupo.miembros.forEach((mid: string) => targets.push({ id: mid, gid: infoGrupo.grupo_id }));
            } else if (act.tipo_entrega === 'mixta' && infoGrupo) {
                // Tiene grupo -> A todos los miembros del grupo
                infoGrupo.miembros.forEach((mid: string) => targets.push({ id: mid, gid: infoGrupo.grupo_id }));
            } else {
                // No tiene grupo o es individual -> Solo a él
                targets.push({ id: uploaderId, gid: null });
            }

            // Guardar
            for (const t of targets) {
                const { error } = await admin.from('calificaciones').upsert({
                    actividad_id, alumno_id: t.id, grupo_id: t.gid,
                    estado: 'entregado', evidencia_drive_file_id: file.id, user_id: user.id
                }, { onConflict: 'actividad_id, alumno_id' });
                if (!error) updates++;
            }
        }
    }

    return new Response(JSON.stringify({ message: "Sincronizado", nuevos: updates }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    const message = `Error en sync-activity-deliveries para actividad ID ${actividad_id || 'desconocido'}: ${errorMessage}`;
    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});