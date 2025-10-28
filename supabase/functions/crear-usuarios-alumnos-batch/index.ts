// supabase/functions/crear-usuarios-alumnos-batch/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts'; // Importar CORS

interface AlumnoPayload {
    alumno_id: number; // ID de la tabla alumnos
    email: string;
    matricula: string; // Para usar como password
}

interface BatchPayload {
    alumnos: AlumnoPayload[];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Validar Docente (Autenticado)
    const supabaseClient = createClient( Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user: docenteUser } } = await supabaseClient.auth.getUser();
    if (!docenteUser) throw new Error("Acceso denegado. Se requiere autenticación de docente.");

    // 2. Obtener lista de alumnos
    const { alumnos }: BatchPayload = await req.json();
    if (!Array.isArray(alumnos) || alumnos.length === 0) {
      throw new Error("Se requiere un array 'alumnos' no vacío.");
    }

    // 3. Crear cliente Admin
    const supabaseAdmin = createClient( Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! );

    // 4. Procesar lote
    const results = [];
    let successCount = 0;

    for (const alumno of alumnos) {
        const { alumno_id, email, matricula } = alumno;
        const finalPassword = matricula; // Usar matrícula como contraseña

        if (!alumno_id || !email || !finalPassword) {
            results.push({ alumno_id, email, success: false, error: "Datos incompletos (ID, email, matrícula)." });
            continue;
        }
         if (finalPassword.length < 6) { // Requisito mínimo de Supabase Auth
             results.push({ alumno_id, email, success: false, error: "Contraseña (matrícula) debe tener al menos 6 caracteres." });
             continue;
         }

        try {
            // a. Crear usuario Auth
            console.log(`Batch: Creando usuario Auth para ${email}...`);
            const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
              email: email.toLowerCase().trim(),
              password: finalPassword,
              email_confirm: true, // Auto-confirmar ya que lo crea el docente
            });

            if (createError) {
                let errorMessage = createError.message;
                 if (createError.message.includes('duplicate key') || createError.message.includes('already registered')) {
                    errorMessage = "Correo ya registrado en Supabase Auth.";
                 }
                console.error(`Batch Error Auth (${email}):`, errorMessage);
                results.push({ alumno_id, email, success: false, error: errorMessage });
                continue;
            }

            if (!newUser?.user) throw new Error("Respuesta inesperada de createUser.");
            const newUserId = newUser.user.id;
            console.log(`Batch: Usuario Auth ${newUserId} creado.`);

            // b. Vincular en tabla alumnos
            console.log(`Batch: Vinculando ${newUserId} con Alumno ${alumno_id}...`);
            // Solo actualiza si user_id es NULL
            const { error: updateError } = await supabaseAdmin
              .from('alumnos')
              .update({ user_id: newUserId })
              .eq('id', alumno_id)
              .is('user_id', null); 

             if (updateError) {
                console.error(`Batch Error Update (${alumno_id}):`, updateError);
                await supabaseAdmin.auth.admin.deleteUser(newUserId); // Rollback
                console.warn(`Batch: Usuario Auth ${newUserId} borrado por fallo de vinculación.`);
                results.push({ alumno_id, email, success: false, error: `Fallo al vincular: ${updateError.message}` });
             } else {
                 console.log(`Batch: Vinculación exitosa para Alumno ${alumno_id}.`);
                 results.push({ alumno_id, email, success: true, user_id: newUserId });
                 successCount++;
             }
        } catch (processError: unknown) {
            console.error(`Batch Error procesando ${email}:`, processError);
            const errorMessage = processError instanceof Error ? processError.message : "Error inesperado.";
            results.push({ alumno_id, email, success: false, error: errorMessage });
        }
    } // Fin for

    console.log(`Batch completado. Éxitos: ${successCount}/${alumnos.length}`);
    return new Response(JSON.stringify({
        totalProcesados: alumnos.length,
        exitosos: successCount,
        resultados: results // Devuelve el detalle
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: unknown) {
    console.error("Error Gral. crear-usuarios-alumnos-batch:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido en la función.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: errorMessage.includes("Acceso denegado") ? 401 : 400,
    });
  }
});