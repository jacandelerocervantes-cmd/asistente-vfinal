// supabase/functions/generar-layout-sopa/index.ts
import { serve } from "std/http/server.ts";
// Podrías importar una librería para generar sopas de letras aquí si encuentras una
// import { WordSearch } from "npm:some-wordsearch-library";

const corsHeaders = { /* ... CORS headers ... */ };

interface RequestPayload {
    palabras: string[]; // Palabras a colocar (ya en MAYÚSCULAS)
    tamano: number;     // Tamaño de la cuadrícula (ej. 10 para 10x10)
    // Opciones adicionales (ej. permitir diagonales, etc.)
}

interface PosicionPalabra {
    palabra: string;
    fila_inicio: number;
    col_inicio: number;
    direccion: 'H' | 'V' | 'D1' | 'D2'; // Horizontal, Vertical, Diagonal 1 (\), Diagonal 2 (/)
}

interface SopaLayout {
    cuadricula: string[][]; // Array 2D de letras
    posiciones: PosicionPalabra[]; // Info sobre dónde se colocó cada palabra
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }
  try {
    const { palabras, tamano }: RequestPayload = await req.json();
    if (!palabras || palabras.length === 0 || !tamano || tamano < 5) {
      throw new Error("Parámetros inválidos para generar sopa de letras.");
    }

    // --- AQUÍ VA LA LÓGICA DE GENERACIÓN ---
    // 1. Crear una cuadrícula vacía de `tamano` x `tamano`.
    // 2. Intentar colocar cada `palabra` en la cuadrícula (horizontal, vertical, diagonal).
    //    - Manejar colisiones y asegurar que todas quepan (puede requerir reintentos o ajustar tamaño).
    // 3. Rellenar los espacios vacíos con letras aleatorias.
    // 4. Guardar la `cuadricula` (string[][]) y las `posiciones` de las palabras encontradas.

    // --- Placeholder (debes reemplazar esto) ---
    const placeholderCuadricula: string[][] = Array.from({ length: tamano }, () =>
        Array.from({ length: tamano }, () => 'X')
    );
    const placeholderPosiciones: PosicionPalabra[] = palabras.map((p, i) => ({
        palabra: p, fila_inicio: i, col_inicio: 0, direccion: 'H' // Posiciones de ejemplo
    }));
    const layout: SopaLayout = {
        cuadricula: placeholderCuadricula,
        posiciones: placeholderPosiciones
    };
    // --- Fin Placeholder ---

    // Devolver el layout generado
    return new Response(JSON.stringify(layout), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en generar-layout-sopa:", error);
    const errorMessage = error instanceof Error ? error.message : "Parámetros inválidos o error desconocido.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});