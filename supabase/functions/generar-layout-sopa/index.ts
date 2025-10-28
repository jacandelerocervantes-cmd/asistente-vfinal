// supabase/functions/generar-layout-sopa/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from '../_shared/cors.ts';

interface RequestPayload {
    palabras: string[];
    filas: number;
    columnas: number;
    maxBacktrackAttempts?: number; // Opcional: límite para intentos de backtracking
    fillRandomLetters?: boolean; // Opcional: rellenar celdas vacías
}

interface PlacedWordSopa {
    word: string;
    startx: number; // Columna base 0
    starty: number; // Fila base 0
    direction: string; // ej., 'horizontal', 'vertical', 'diagonal-up-right'
}

interface WordSearchLayout {
    grid: string[][];
    words: PlacedWordSopa[];
    error?: string; // Para indicar si falló o es parcial
    finalRows?: number; // Para devolver el tamaño final usado
    finalCols?: number; // Para devolver el tamaño final usado
}

// --- Algoritmo de Generación de Sopa de Letras con Backtracking ---
// (Asegúrate de que estas funciones estén definidas aquí)
function generateWordSearchLayoutCustomWithBacktracking(
    palabrasInput: string[],
    rows: number,
    cols: number,
    maxBacktrackAttempts: number = 2000, // Aumentar intentos un poco
    fillRandomLetters: boolean = true
): WordSearchLayout | null { // Puede devolver null si falla catastróficamente
    const palabras = palabrasInput
        .map(p => p.toUpperCase().replace(/\s/g, ''))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    if (palabras.length === 0) return { grid: Array.from({ length: rows }, () => Array(cols).fill('?')), words: [] };

    const directions = [
        { dx: 1, dy: 0, name: 'horizontal' }, { dx: -1, dy: 0, name: 'horizontal-reverse' },
        { dx: 0, dy: 1, name: 'vertical' }, { dx: 0, dy: -1, name: 'vertical-reverse' },
        { dx: 1, dy: 1, name: 'diagonal-down-right' }, { dx: -1, dy: 1, name: 'diagonal-down-left' },
        { dx: 1, dy: -1, name: 'diagonal-up-right' }, { dx: -1, dy: -1, name: 'diagonal-up-left' }
    ];

    let backtrackCounter = 0;
    let stopBacktracking = false; // Flag para detener si se excede el límite

    function solve(
        wordIndex: number,
        currentGrid: string[][],
        currentPlacedWords: PlacedWordSopa[]
    ): WordSearchLayout | null {
        // Detener si ya excedimos el límite en una rama superior
        if (stopBacktracking) return { grid: currentGrid, words: currentPlacedWords };

        backtrackCounter++;
        if (backtrackCounter > maxBacktrackAttempts) {
            console.warn(`Máximo de intentos (${maxBacktrackAttempts}) alcanzado. Devolviendo layout parcial.`);
            stopBacktracking = true; // Activar el flag
            return { grid: currentGrid, words: currentPlacedWords };
        }

        if (wordIndex === palabras.length) {
            return { grid: currentGrid, words: currentPlacedWords }; // Éxito
        }

        const currentWord = palabras[wordIndex];
        const possiblePlacements: { startY: number, startX: number, dir: typeof directions[0] }[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                for (const dir of directions) {
                    if (canPlaceWordSopa(currentGrid, currentWord, c, r, dir, rows, cols)) {
                        possiblePlacements.push({ startY: r, startX: c, dir });
                    }
                }
            }
        }

        possiblePlacements.sort(() => Math.random() - 0.5); // Aleatoriedad

        for (const { startY, startX, dir } of possiblePlacements) {
            const newGrid: string[][] = currentGrid.map(row => [...row]);
            const newPlacedWords: PlacedWordSopa[] = [...currentPlacedWords];

            let tempX = startX;
            let tempY = startY;
            for (let i = 0; i < currentWord.length; i++) {
                newGrid[tempY][tempX] = currentWord[i];
                tempX += dir.dx;
                tempY += dir.dy;
            }
            newPlacedWords.push({ word: currentWord, startx: startX, starty: startY, direction: dir.name });

            const result = solve(wordIndex + 1, newGrid, newPlacedWords);

            // Si la recursión devuelve algo (completo o parcial por límite)
            if (result !== null) {
                 return result; // Propagar hacia arriba
            }
            // Si devuelve null (fallo en esta rama), el bucle continúa (backtrack)
            if (stopBacktracking) return { grid: currentGrid, words: currentPlacedWords }; // Si se activó el flag en una sub-rama, devolver parcial
        }

        // Si se probaron todas las posiciones y ninguna funcionó para esta palabra
        if (!stopBacktracking) {
             console.warn(`No se encontró lugar para la palabra "${currentWord}" (índice ${wordIndex}). Deteniendo.`);
             stopBacktracking = true; // Activar flag para detener
        }
        return { grid: currentGrid, words: currentPlacedWords }; // Devolver el estado parcial actual

    } // Fin solve

    const initialGrid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(''));
    stopBacktracking = false; // Resetear flag antes de empezar
    backtrackCounter = 0; // Resetear contador
    let finalLayout = solve(0, initialGrid, []);

    // Si solve devuelve null (falló en encontrar CUALQUIER lugar para una palabra), devolvemos null.
    if (finalLayout === null) {
        console.error("El backtracking falló completamente al inicio.");
        return null;
    }

    // Rellenar letras aleatorias si se solicita y el layout no es null
    if (fillRandomLetters && finalLayout) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // Rellenar solo si la celda está vacía ('')
                // No rellenar si es null (puede que el algoritmo use null para marcar bordes, etc.)
                if (finalLayout.grid[r][c] === '') {
                    finalLayout.grid[r][c] = alphabet[Math.floor(Math.random() * alphabet.length)];
                }
            }
        }
    }

    return finalLayout;
}

// Helper para verificar si se puede colocar la palabra
function canPlaceWordSopa(
    grid: string[][],
    word: string,
    startX: number, // column
    startY: number, // row
    direction: { dx: number, dy: number },
    rows: number,
    cols: number
): boolean {
    let currentX = startX;
    let currentY = startY;
    for (let i = 0; i < word.length; i++) {
        if (currentY < 0 || currentY >= rows || currentX < 0 || currentX >= cols) return false; // Fuera de límites
        if (grid[currentY][currentX] !== '' && grid[currentY][currentX] !== word[i]) return false; // Conflicto
        currentX += direction.dx;
        currentY += direction.dy;
    }
    return true; // Válido
}
// --- Fin Algoritmo ---

// --- Nueva función envoltorio con bucle de reintento ---
function intentarGenerarSopa(
    palabras: string[],
    filasInicial: number,
    columnasInicial: number,
    maxIntentosAjuste: number = 5, // Intentar aumentar tamaño hasta 5 veces
    incremento: number = 1, // Aumentar filas y columnas en 1 cada vez
    maxBacktrack?: number,
    fillRandom?: boolean
): WordSearchLayout {
    let currentFilas = filasInicial;
    let currentColumnas = columnasInicial;
    let intentos = 0;
    let layout: WordSearchLayout | null = null;
    const numPalabrasTotal = palabras.filter(Boolean).length; // Contar palabras no vacías

    // Estimación inicial del tamaño mínimo (basado en la palabra más larga)
    const palabraMasLarga = palabras.reduce((max, p) => Math.max(max, p.replace(/\s/g, '').length), 0);
    currentFilas = Math.max(currentFilas, palabraMasLarga, 5); // Asegurar mínimo de 5 o longitud de palabra más larga
    currentColumnas = Math.max(currentColumnas, palabraMasLarga, 5);
    if (currentFilas !== filasInicial || currentColumnas !== columnasInicial) {
        console.log(`Ajustando tamaño inicial a ${currentFilas}x${currentColumnas} basado en la palabra más larga (${palabraMasLarga}).`);
    }


    while (intentos <= maxIntentosAjuste) {
        console.log(`Intento ${intentos + 1}/${maxIntentosAjuste + 1}: Generando sopa ${currentFilas}x${currentColumnas}...`);
        layout = generateWordSearchLayoutCustomWithBacktracking(
            palabras, currentFilas, currentColumnas, maxBacktrack, fillRandom ?? true
        );

        // Verificar si se colocaron todas las palabras
        if (layout && layout.words.length === numPalabrasTotal) {
            console.log("¡Éxito! Todas las palabras fueron colocadas.");
            layout.finalRows = currentFilas; // Guardar tamaño final
            layout.finalCols = currentColumnas;
            return layout; // Devolver layout completo
        }

        // Si falló o no colocó todas, incrementar tamaño y reintentar
        intentos++;
        if (intentos <= maxIntentosAjuste) {
            console.warn(`Intento ${intentos} fallido o incompleto (${layout?.words?.length ?? 0}/${numPalabrasTotal} palabras). Aumentando tamaño...`);
            currentFilas += incremento;
            currentColumnas += incremento;
        }
    }

    // Si se agotaron los intentos
    console.error(`Se agotaron los ${maxIntentosAjuste + 1} intentos para generar la sopa de letras completa.`);
    // Devolver el último layout obtenido (que podría ser parcial o null si falló catastróficamente)
    // Si layout es null, crear uno vacío de error.
    if (!layout) {
         layout = {
             grid: Array.from({ length: filasInicial }, () => Array(columnasInicial).fill('X')),
             words: [],
             error: "Generación fallida incluso tras reintentos."
         }
    } else {
        layout.error = "Layout incompleto tras reintentos."; // Marcar como incompleto
    }
    layout.finalRows = currentFilas; // Guardar tamaño final intentado
    layout.finalCols = currentColumnas;
    return layout;
}
// --- Fin función envoltorio ---


serve(async (req: Request) => {
  // Manejo OPTIONS (sin cambios)
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  try {
    const payload: RequestPayload = await req.json();
    console.log("Payload recibido en generar-layout-sopa:", JSON.stringify(payload));

    const { palabras, filas, columnas, maxBacktrackAttempts, fillRandomLetters } = payload;

    // Validación (sin cambios)
    const errorDetalle: string[] = []; let isValid = true;
    if (!palabras || !Array.isArray(palabras) || palabras.length === 0) { isValid = false; errorDetalle.push("'palabras' (array no vacío)"); }
    if (typeof filas !== 'number' || isNaN(filas) || filas <= 0) { isValid = false; errorDetalle.push("'filas' (número > 0)"); }
    if (typeof columnas !== 'number' || isNaN(columnas) || columnas <= 0) { isValid = false; errorDetalle.push("'columnas' (número > 0)"); }
    if (!isValid) { throw new Error(`Parámetros inválidos: se requieren ${errorDetalle.join(', ')}.`); }

    console.log(`Generando sopa de letras de ${filas}x${columnas} con ${palabras.length} palabras...`);

    // --- LLAMAR A LA FUNCIÓN CON REINTENTOS ---
    const layout = intentarGenerarSopa(
        palabras,
        filas,
        columnas,
        5, // Máximo 5 reintentos aumentando tamaño
        1, // Incrementar en 1 fila/columna cada vez
        maxBacktrackAttempts, // Pasar límite de backtracking si se proporcionó
        fillRandomLetters
    );
    // --- FIN LLAMADA ---


    // Devolver el layout (completo, parcial o de error) con status 200
    return new Response(JSON.stringify(layout), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) { // Captura errores de validación inicial o JSON
    console.error("Error en generar-layout-sopa:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});