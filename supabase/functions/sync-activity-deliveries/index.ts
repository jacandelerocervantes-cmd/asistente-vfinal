// supabase/functions/sync-activity-deliveries/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { actividad_id } = await req.json();
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("No auth header");

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    
    const { data: { user } } = await supabase.auth.getUser();
    const docenteId = user?.id;

    // 1. Datos Actividad
    const { data: act } = await admin.from('actividades').select('drive_folder_entregas_id, materia_id, tipo_entrega').eq('id', actividad_id).single();
    if (!act?.drive_folder_entregas_id) throw new Error("Sin carpeta Drive vinculada.");

    // 2. Mapa Alumnos y Grupos
    const { data: alumnos } = await admin.from('alumnos').select('id, matricula').eq('materia_id', act.materia_id);
    const mapaAlumnos = new Map();
    alumnos?.forEach(a => { if(a.matricula) mapaAlumnos.set(a.matricula.toUpperCase().trim(), a.id); });

    const mapaGrupos = new Map(); // alumnoId -> { grupo_id, miembros: [ids_compañeros] }
    if (['grupal', 'mixta'].includes(act.tipo_entrega)) {
        const { data: rels } = await admin.from('alumnos_grupos').select('alumno_id, grupo_id').in('alumno_id', alumnos?.map(a=>a.id)||[]);
        const grupos = new Map(); 
        rels?.forEach(r => { if(!grupos.has(r.grupo_id)) grupos.set(r.grupo_id, []); grupos.get(r.grupo_id).push(r.alumno_id); });
        rels?.forEach(r => { mapaGrupos.set(r.alumno_id, { grupo_id: r.grupo_id, miembros: grupos.get(r.grupo_id) }); });
    }

    // 3. Obtener Archivos (CON REINTENTOS para evitar error 429)
    let archivos = [];
    for (let i = 0; i < 3; i++) {
        const res = await fetch(Deno.env.get('GOOGLE_SCRIPT_CREATE_MATERIA_URL')!, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'get_folder_contents', drive_folder_id: act.drive_folder_entregas_id })
        });
        if (res.status === 429) { await wait(2000 * (i+1)); continue; } // Esperar y reintentar
        if (!res.ok) throw new Error("Error Google: " + res.status);
        const json = await res.json();
        archivos = json.archivos?.files || json.files || json.archivos || [];
        break;
    }

    // 4. Procesar
    let updates = 0;
    for (const file of archivos) {
        const name = file.name.toUpperCase();
        let alumnoId = null;
        for (const [mat, id] of mapaAlumnos) { if (name.includes(mat)) { alumnoId = id; break; } }

        if (alumnoId) {
            const targets = [];
            const grupoInfo = mapaGrupos.get(alumnoId);
            
            // Lógica Grupal/Mixta
            if (grupoInfo) {
                grupoInfo.miembros.forEach((mid: string) => targets.push({ id: mid, gid: grupoInfo.grupo_id }));
            } else {
                targets.push({ id: alumnoId, gid: null });
            }

            for (const t of targets) {
                const { error } = await admin.from('calificaciones').upsert({
                    actividad_id, alumno_id: t.id, grupo_id: t.gid,
                    estado: 'entregado', evidencia_drive_file_id: file.id, user_id: docenteId
                }, { onConflict: 'actividad_id, alumno_id' });
                if (!error) updates++;
            }
        }
    }

    return new Response(JSON.stringify({ message: "OK", procesados: updates }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});