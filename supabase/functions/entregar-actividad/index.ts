// supabase/functions/entregar-actividad/index.ts
import { serve } from 'std/http/server.ts'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

// Variables de entorno de Apps Script
const GAS_URL = Deno.env.get('APPS_SCRIPT_URL')
const AUTH_TOKEN = Deno.env.get('APPS_SCRIPT_AUTH_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

serve(async (req: Request) => {
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Validar que todas las variables de entorno necesarias estén configuradas
  if (!GAS_URL || !AUTH_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ message: 'Faltan variables de entorno críticas en el servidor.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    })
  }

  try {
    // 1. Obtener datos del frontend (alumno)
    const { 
      actividad_id,
      fileName, 
      mimeType, 
      base64Data 
    } = await req.json()
    
    if (!actividad_id || !fileName || !mimeType || !base64Data) {
      throw new Error('Faltan datos de la actividad o del archivo.')
    }

    // 2. Crear cliente de Supabase (Admin para RLS)
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SERVICE_ROLE_KEY
    )

    // 3. Obtener el ID del alumno y sus datos desde el token JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Usuario no autenticado.')
    }
    const jwt = authHeader.replace('Bearer ', '')
    const { data: user, error: userError } = await supabaseAdmin.auth.getUser(jwt)
    if (userError || !user.user) {
      throw new Error('Token de usuario inválido o expirado.')
    }
    const userId = user.user.id

    // 4. Buscar el registro 'alumnos' de este usuario
    const { data: alumnoData, error: alumnoError } = await supabaseAdmin
      .from('alumnos')
      .select('id, nombre, apellido, matricula, materia_id')
      .eq('user_id', userId)
      .single()
      
    if (alumnoError || !alumnoData) {
      throw new Error('No se encontró el registro de alumno.')
    }

    // 5. Obtener el ID de la carpeta Drive de la actividad
    const { data: actData, error: actError } = await supabaseAdmin
      .from('actividades')
      .select('drive_folder_id')
      .eq('id', actividad_id)
      .single()

    if (actError || !actData || !actData.drive_folder_id) {
      throw new Error('No se encontró la carpeta de la actividad.')
    }
    
    // 6. Llamar a Google Apps Script para subir el archivo
    const gasPayload = {
      action: 'handleEntregaActividad',
      payload: {
        actividad_drive_folder_id: actData.drive_folder_id,
        alumno: {
          id: alumnoData.id,
          nombre: alumnoData.nombre,
          apellido: alumnoData.apellido,
          matricula: alumnoData.matricula
        },
        fileName,
        mimeType,
        base64Data,
      },
    }

    const gasResponse = await fetch(GAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(gasPayload),
    })

    if (!gasResponse.ok) {
      const errorText = await gasResponse.text()
      throw new Error(`Error en Apps Script: ${errorText}`)
    }

    const driveResult = await gasResponse.json()
    if (driveResult.status === 'error') {
      throw new Error(`Error devuelto por Apps Script: ${driveResult.message}`)
    }

    // 7. Actualizar o insertar el registro en 'calificaciones' usando UPSERT
    // Esto maneja tanto el caso de una nueva entrega como una re-entrega.
    const { error: upsertError } = await supabaseAdmin
      .from('calificaciones')
      .upsert({
          materia_id: alumnoData.materia_id,
          alumno_id: alumnoData.id,
          actividad_id: actividad_id,
          estado: 'entregado', // Actualiza el estado
          drive_url_entrega: driveResult.data.fileUrl,
          fecha_entrega: new Date().toISOString(),
          // Opcional: No sobreescribir la calificación si ya existe
          // calificacion_obtenida: 0 
      }, {
          onConflict: 'alumno_id, actividad_id'
      })
    
    if (upsertError) {
      throw new Error(`Error al actualizar la entrega: ${upsertError.message}`)
    }

    // 8. Devolver éxito
    return new Response(
      JSON.stringify({ 
        message: 'Archivo entregado con éxito', 
        fileUrl: driveResult.data.fileUrl 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    // Manejo de errores más seguro y específico
    const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
    console.error('Error en entregar-actividad:', message, error);

    return new Response( // Aseguramos que el error siempre sea un objeto JSON
      JSON.stringify({ message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})