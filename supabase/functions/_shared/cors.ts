// supabase/functions/_shared/cors.ts
// Contiene los encabezados CORS reutilizables para todas las funciones.

// OBTÉN TU URL DE VERCEL (ej. https://asistentedocencia.vercel.app)
const ALLOWED_ORIGIN = 'https://asistentedocencia.vercel.app';

export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT', // Métodos permitidos
};