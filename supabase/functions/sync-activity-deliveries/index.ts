// supabase/functions/sync-activity-deliveries/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { actividad_id } = await req.json();
    if (!actividad_id) throw new Error("El 'actividad_id' es requerido.");
    
    // Configuración de clientes Supabase
    const authHeader = req.headers.get('Authorization');
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!, 
      Deno.env.get('SUPABASE_ANON_KEY')!, 
      { global: { headers: { Authorization: authHeader! } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuario inválido");

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1. Obtener datos de la actividad
    const { data: act } = await admin.from('actividades')
      .select('drive_folder_entregas_id, materia_id, tipo_entrega')
      .eq('id', actividad_id).single();
      
    if (!act?.drive_folder_entregas_id) throw new Error("Sin carpeta Drive vinculada");

    // 2. Preparar mapas de Alumnos y Grupos (Igual que antes)
    const { data: alumnos } = await admin.from('alumnos').select('id, matricula').eq('materia_id', act.materia_id);
    const mapaAlumnos = new Map();
    alumnos?.forEach(a => { if(a.matricula) mapaAlumnos.set(a.matricula.toUpperCase().trim(), a.id); });

    const mapaGruposPorNombre = new Map(); 
    const mapaGruposPorId = new Map();
    const { data: gruposDeMateria } = await admin.from('grupos').select('id, nombre').eq('materia_id', act.materia_id);
    
    if (gruposDeMateria && gruposDeMateria.length > 0) {
        const grupoIds = gruposDeMateria.map(g => g.id);
        const { data: rels } = await admin.from('alumnos_grupos').select('alumno_id, grupo_id').in('grupo_id', grupoIds);
        const miembrosPorGrupo = new Map();
        rels?.forEach(r => {
            if (!miembrosPorGrupo.has(r.grupo_id)) miembrosPorGrupo.set(r.grupo_id, []);
            miembrosPorGrupo.get(r.grupo_id).push(r.alumno_id);
            mapaGruposPorId.set(r.alumno_id, { grupo_id: r.grupo_id });
        });
        gruposDeMateria.forEach(g => {
            const nombreNormalizado = g.nombre.toUpperCase().trim();
            const datosGrupo = { id: g.id, nombre: g.nombre, miembros: miembrosPorGrupo.get(g.id) || [] };
            mapaGruposPorNombre.set(nombreNormalizado, datosGrupo);
            mapaGruposPorNombre.set(nombreNormalizado.replace(/\s+/g, '_'), datosGrupo);
        });
    }

    // 3. Obtener archivos de Google Drive
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
            if (res.status === 429) { await wait(3000); intentos++; continue; }
            if (!res.ok) throw new Error("Google Error");
            const json = await res.json();
            archivos = json.archivos?.files || json.files || [];
            break;
        } catch(_e) { intentos++; await wait(1000); }
    }

    // 4. PROCESAR Y ACTUALIZAR (AQUÍ ESTÁ LA LÓGICA DE PROTECCIÓN)
    let updates = 0;
    const activityType = act.tipo_entrega;

    for (const file of archivos) {
        const fileNameUpper = file.name.toUpperCase();
        const targets = new Map(); 
        
        // Lógica de Matching (Nombre vs Matricula/Grupo)
        let assignedAsGroup = false;
        if (['grupal', 'mixta'].includes(activityType)) {
            for (const [nombreGrupoKey, datosGrupo] of mapaGruposPorNombre) {
                if (fileNameUpper.replace(/\s+/g, '_').includes(nombreGrupoKey)) {
                    datosGrupo.miembros.forEach((mid: number) => targets.set(mid, { id: mid, gid: datosGrupo.id }));
                    assignedAsGroup = true;
                }
            }
        }
        if (!assignedAsGroup) {
            for (const [mat, id] of mapaAlumnos) { 
                if (fileNameUpper.includes(mat)) { 
                    const infoGrupo = mapaGruposPorId.get(id);
                    // Si es grupal pero subió individual, intentamos ligar al grupo
                    const gid = (activityType === 'grupal' && infoGrupo) ? infoGrupo.grupo_id : null;
                    targets.set(id, { id: id, gid: gid });
                } 
            }
        }

        // GUARDADO EN BD
        if (targets.size > 0) {
            for (const t of targets.values()) {
                // PASO CRÍTICO: Verificar estado actual antes de tocar nada
                const { data: currentState } = await admin.from('calificaciones')
                    .select('estado')
                    .eq('actividad_id', actividad_id)
                    .eq('alumno_id', t.id)
                    .maybeSingle();

                // LÓGICA DE PROTECCIÓN:
                // Si ya está 'calificado', lo forzamos a seguir siendo 'calificado'.
                // Si no, pasa a 'entregado'.
                const estadoFinal = (currentState?.estado === 'calificado') ? 'calificado' : 'entregado';

                const { error } = await admin.from('calificaciones').upsert({
                    actividad_id, 
                    alumno_id: t.id, 
                    grupo_id: t.gid,
                    estado: estadoFinal, // <--- Aquí protegemos el estado
                    evidencia_drive_file_id: file.id, 
                    drive_url_entrega: file.webViewLink,
                    user_id: user.id,
                    fecha_entrega: new Date().toISOString()
                }, { onConflict: 'actividad_id, alumno_id' });
                
                if (!error) updates++;
            }
        }
    }

    return new Response(JSON.stringify({ message: "Sincronizado", nuevos: updates }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});