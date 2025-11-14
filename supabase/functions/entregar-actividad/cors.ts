// supabase/functions/entregar-actividad/_shared/cors.ts
// Contiene los encabezados CORS reutilizables para esta función.

const ALLOWED_ORIGIN = Deno.env.get('CORS_ALLOWED_ORIGIN') || 'http://localhost:3000';

export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};