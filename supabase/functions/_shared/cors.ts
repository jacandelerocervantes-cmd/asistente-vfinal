// supabase/functions/_shared/cors.ts

// Lista de orígenes permitidos
const allowedOrigins = [
  'https://asistentedocencia.vercel.app', // Producción
  'http://localhost:3000',               // Desarrollo Vite (React)
  'http://127.0.0.1:3000',             // Desarrollo Vite (React)
  'http://localhost:5173',               // Desarrollo Vite (Default)
  'http://127.0.0.1:5173',             // Desarrollo Vite (Default)
];

/**
 * Genera los headers de CORS dinámicamente, permitiendo el origen
 * si está en la lista de permitidos.
 * @param req La solicitud entrante (Request) para leer el header 'origin'.
 * @returns Un objeto con los headers de CORS.
 */
export const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get('origin');
  
  // Si el origen de la solicitud está en nuestra lista, úsalo.
  // Si no (ej. Postman, curl), usa el de producción como default.
  const ALLOWED_ORIGIN = (origin && allowedOrigins.includes(origin)) 
    ? origin 
    : allowedOrigins[0]; 

  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT', // Métodos permitidos
  };
};

// Exportar un set estático para OPTIONS (necesario por cómo funcionan algunas funciones)
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Permite TODOS para OPTIONS
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT', // Métodos permitidos
};