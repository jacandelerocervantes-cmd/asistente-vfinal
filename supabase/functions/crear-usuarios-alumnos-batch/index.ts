// supabase/functions/crear-usuarios-alumnos-batch/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts'; // Reutilizar CORS

interface AlumnoPayload {
    alumno_id: number; // ID de la tabla alumnos
    email: string;
    password?: string; // Usaremos matrícula si no se provee
    matricula: string; // Para usar como password por defecto
}

interface BatchPayload {
    alumnos: AlumnoPayload[];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Validar Docente
    const supabaseClient = createClient( Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user: docenteUser } } = await supabaseClient.auth.getUser();
    if (!docenteUser) throw new Error("Acceso denegado.");

    // 2. Obtener lista de alumnos del body
    const { alumnos }: BatchPayload = await req.json();
    if (!Array.isArray(alumnos) || alumnos.length === 0) {
      throw new Error("Se requiere un array 'alumnos' no vacío.");
    }

    // 3. Crear cliente Admin
    const supabaseAdmin = createClient( Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! );

    // 4. Procesar cada alumno en el lote
    const results = [];
    let successCount = 0;

    for (const alumno of alumnos) {
        const { alumno_id, email, password, matricula } = alumno;
        const finalPassword = password || matricula; // Usar matrícula si no hay password específico

        if (!alumno_id || !email || !finalPassword) {
            results.push({ alumno_id, email, success: false, error: "Datos incompletos (ID, email, matrícula/password)." });
            continue;
        }
         if (finalPassword.length < 6) {
             results.push({ alumno_id, email, success: false, error: "Contraseña (matrícula) muy corta (< 6 caracteres)." });
             continue;
         }

        try {
            // a. Crear usuario Auth
            console.log(`Batch: Creando usuario Auth para ${email}...`);
            const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
              email: email.toLowerCase().trim(),
              password: finalPassword,
              email_confirm: true,
            });

            let errorMessage = null;
            if (createError) {
                console.error(`Batch Error Auth (${email}):`, createError);
                 if (createError.message.includes('duplicate key') || createError.message.includes('already registered')) {
                    errorMessage = "Correo ya registrado en Auth.";
                 } else {
                     errorMessage = createError.message;
                 }
                 // Intentar buscar si ya existe un usuario con ese email para vincularlo si es posible
                 // const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers({ email: email.toLowerCase().trim() });
                 // if (existingUser?.users?.[0]) { /* lógica de vinculación si existe */ }

                 // Por ahora, solo reportamos el error
                results.push({ alumno_id, email, success: false, error: errorMessage });
                continue; // Pasar al siguiente alumno
            }

            if (!newUser?.user) throw new Error("Respuesta inesperada de createUser.");
            const newUserId = newUser.user.id;
            console.log(`Batch: Usuario Auth ${newUserId} creado para ${email}.`);

            // b. Vincular en tabla alumnos
            console.log(`Batch: Vinculando ${newUserId} con Alumno ${alumno_id}...`);
            const { error: updateError } = await supabaseAdmin
              .from('alumnos')
              .update({ user_id: newUserId })
              .eq('id', alumno_id)
              .is('user_id', null); // Solo actualizar si user_id es NULL para evitar sobrescribir

             if (updateError) {
                console.error(`Batch Error Update (${alumno_id}):`, updateError);
                // Si falla la vinculación, borrar el usuario Auth recién creado
                await supabaseAdmin.auth.admin.deleteUser(newUserId);
                console.warn(`Batch: Usuario Auth ${newUserId} borrado por fallo de vinculación.`);
                results.push({ alumno_id, email, success: false, error: `Fallo al vincular: ${updateError.message}` });
             } else {
                 console.log(`Batch: Vinculación exitosa para Alumno ${alumno_id}.`);
                 results.push({ alumno_id, email, success: true });
                 successCount++;
             }

        } catch (processError) { // Capturar errores inesperados en el bucle
            console.error(`Batch Error procesando ${email}:`, processError);
            const processErrorMessage = processError instanceof Error ? processError.message : "Error inesperado.";
            results.push({ alumno_id, email, success: false, error: processErrorMessage });
        }
    } // Fin for

    console.log(`Batch completado. Éxitos: ${successCount}/${alumnos.length}`);
    return new Response(JSON.stringify({
        totalProcesados: alumnos.length,
        exitosos: successCount,
        resultados: results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, // La función completó, los errores están en 'resultados'
    });

  } catch (error) { // Capturar errores generales (JSON inválido, no autenticado, etc.)
    console.error("Error Gral. crear-usuarios-alumnos-batch:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    const status = errorMessage.includes("Acceso denegado") ? 401 : 400;
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: status,
    });
  }
});