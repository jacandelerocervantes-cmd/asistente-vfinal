// supabase/functions/crear-usuario-alumno/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from '../_shared/cors.ts';


serve(async (req: Request) => {
  // Manejo de pre-flight request (OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Validar que quien llama es un docente autenticado
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user: docenteUser } } = await supabaseClient.auth.getUser();
    if (!docenteUser) throw new Error("Acceso denegado: Solo docentes pueden crear usuarios.");
    // Podrías añadir validación de rol aquí si lo implementas

    // 2. Obtener datos del alumno desde el body
    const { alumno_id, email, password } = await req.json();
    if (!alumno_id || !email || !password) {
      throw new Error("Faltan datos: se requiere alumno_id, email y password.");
    }
    if (!email.includes('@')) {
        throw new Error("Formato de correo electrónico inválido.");
    }


    // 3. Crear cliente Admin
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 4. Crear el usuario en Supabase Auth
    console.log(`Intentando crear usuario Auth para email: ${email}`);
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password: password,
      email_confirm: true, // Marcar como confirmado
      // Opcional: user_metadata
    });

    if (createError) {
      console.error("Error al crear usuario Auth:", createError);
      if (createError.message.includes('duplicate key') || createError.message.includes('already registered')) {
          throw new Error(`El correo '${email}' ya está registrado.`);
      }
      if (createError.message.includes('Password should be at least')) {
           throw new Error('La contraseña debe tener al menos 6 caracteres.');
      }
      throw new Error(`Error al crear cuenta: ${createError.message}`);
    }

    if (!newUser || !newUser.user) {
      throw new Error("No se pudo crear la cuenta (respuesta inesperada).");
    }
    const newUserId = newUser.user.id;
    console.log(`Usuario Auth creado con ID: ${newUserId}`);

    // 5. Vincular user_id al registro del alumno
    console.log(`Vinculando User ID ${newUserId} con Alumno ID ${alumno_id}`);
    // Verificar si el alumno ya tiene un user_id
    const { data: alumnoExistente, error: checkError } = await supabaseAdmin
        .from('alumnos')
        .select('user_id')
        .eq('id', alumno_id)
        .maybeSingle();

    if (checkError) throw new Error(`Error verificando alumno ${alumno_id}: ${checkError.message}`);
    if (alumnoExistente && alumnoExistente.user_id && alumnoExistente.user_id !== newUserId) {
        // Si ya está vinculado a OTRO user_id, borrar el recién creado
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        throw new Error(`El alumno ID ${alumno_id} ya tiene otra cuenta (${alumnoExistente.user_id}) asociada.`);
    }
    if (alumnoExistente && alumnoExistente.user_id === newUserId) {
        console.warn(`El alumno ${alumno_id} ya estaba vinculado a esta cuenta ${newUserId}.`);
        // Continuar como éxito si ya estaba vinculado correctamente
    } else {
        // Solo actualizar si no estaba vinculado o estaba vinculado a null
        const { error: updateError } = await supabaseAdmin
          .from('alumnos')
          .update({ user_id: newUserId })
          .eq('id', alumno_id);

        if (updateError) {
          console.error(`Error al vincular User ID ${newUserId} con Alumno ID ${alumno_id}:`, updateError);
          try { await supabaseAdmin.auth.admin.deleteUser(newUserId); } catch (e) { console.error("Error borrando usuario Auth tras fallo:", e); }
          throw new Error(`Error al vincular cuenta: ${updateError.message}`);
        }
    }


    console.log(`Vinculación exitosa.`);
    return new Response(JSON.stringify({ success: true, message: `Cuenta para ${email} creada y vinculada.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en crear-usuario-alumno:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    const status = errorMessage.includes('ya está registrado') || errorMessage.includes('ya tiene') ? 409
                 : errorMessage.includes('Faltan datos') || errorMessage.includes('inválido') || errorMessage.includes('contraseña') ? 400
                 : 500;

    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: status,
    });
  }
});