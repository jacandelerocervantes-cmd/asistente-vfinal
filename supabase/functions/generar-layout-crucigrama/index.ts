// supabase/functions/generar-layout-crucigrama/index.ts
import { serve } from "std/http/server.ts";
import { corsHeaders } from '../_shared/cors.ts';

// --- Interfaces ---
interface EntradaCrucigrama {
    pista: string; // clue
    palabra: string; // answer
}
interface PlacedWord {
    answer: string;
    clue: string;
    startx: number; // Columna base 0
    starty: number; // Fila base 0
    orientation: 'across' | 'down';
    position?: number; // Número de la pista (opcional, se puede calcular)
}
interface CrosswordLayout {
    rows: number;
    cols: number;
    table: (string | null)[][]; // La cuadrícula con letras o null
    words: PlacedWord[]; // Palabras colocadas con coordenadas relativas al inicio
    result: PlacedWord[]; // A menudo igual que words, puede usarse para las pistas numeradas
    failed?: string[]; // Palabras que no se pudieron colocar
    error?: string; // Para indicar fallo o estado parcial
}
interface RequestPayload {
    entradas: EntradaCrucigrama[];
}

// Tipo para la mejor posición encontrada
interface Placement {
    newStartX: number;
    newStartY: number;
    newOrientation: 'across' | 'down';
}

// --- Algoritmo de Generación de Crucigrama (Implementación Propia) ---

/**
 * Intenta colocar una palabra en la cuadrícula en una posición y orientación dadas.
 * Verifica límites y conflictos con letras existentes o adyacentes.
 */
function checkPlacement(
    grid: (string | null)[][],
    word: string,
    startX: number, // Columna
    startY: number, // Fila
    orientation: 'across' | 'down',
    rows: number,
    cols: number
): boolean {
    const wordLen = word.length;

    // 1. Revisar límites
    if (orientation === 'across') {
        if (startX < 0 || startY < 0 || startX + wordLen > cols || startY >= rows) return false;
        // Revisar si toca bordes justo antes o después
        if (startX > 0 && grid[startY][startX - 1] !== null) return false;
        if (startX + wordLen < cols && grid[startY][startX + wordLen] !== null) return false;
    } else { // down
        if (startX < 0 || startY < 0 || startX >= cols || startY + wordLen > rows) return false;
        // Revisar si toca bordes justo arriba o abajo
        if (startY > 0 && grid[startY - 1][startX] !== null) return false;
        if (startY + wordLen < rows && grid[startY + wordLen][startX] !== null) return false;
    }

    // 2. Revisar conflictos en la trayectoria de la palabra
    for (let i = 0; i < wordLen; i++) {
        let r = startY, c = startX;
        if (orientation === 'across') c += i; else r += i;
        const gridChar = grid[r][c];
        const wordChar = word[i];

        if (gridChar !== null && gridChar !== wordChar) return false; // Conflicto de letras

        // Revisar vecinos perpendiculares (si no es la letra de cruce)
        if (gridChar !== wordChar) { // Solo revisar si estamos colocando sobre celda vacía
             if (orientation === 'across') {
                 if (r > 0 && grid[r - 1][c] !== null) return false; // Vecino arriba
                 if (r < rows - 1 && grid[r + 1][c] !== null) return false; // Vecino abajo
             } else { // down
                 if (c > 0 && grid[r][c - 1] !== null) return false; // Vecino izquierda
                 if (c < cols - 1 && grid[r][c + 1] !== null) return false; // Vecino derecha
             }
        }
    }

    return true; // Si pasa todas las verificaciones
}

/**
 * Algoritmo principal para generar el layout del crucigrama.
 * Intenta colocar palabras buscando intersecciones.
 */
function generateCrosswordLayoutCustom(wordsToPlace: { clue: string, answer: string }[]): CrosswordLayout | null {
    if (!wordsToPlace || wordsToPlace.length === 0) return null;

    // Preparar y ordenar palabras (más largas primero)
    const words = wordsToPlace
        .map(w => ({ clue: w.clue, answer: w.answer.toUpperCase().replace(/\s/g, '') }))
        .filter(w => w.answer.length > 0) // Filtrar vacías
        .sort((a, b) => b.answer.length - a.answer.length);

    if (words.length === 0) return null;

    const GRID_BUFFER = 5; // Margen alrededor del área usada
    let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;

    let grid: (string | null)[][] = [];
    let placedWords: PlacedWord[] = [];
    const failedWords: string[] = [];
    let startGridSize = Math.max(20, words[0].answer.length * 2); // Tamaño inicial heurístico

    function tryGenerate(currentGridSize: number): boolean {
        // Reiniciar estado para este intento
        grid = Array.from({ length: currentGridSize }, () => Array(currentGridSize).fill(null));
        placedWords = [];
        minRow = currentGridSize; maxRow = -1; minCol = currentGridSize; maxCol = -1;

        // 1. Colocar la primera palabra (la más larga) horizontalmente en el centro
        const firstWord = words[0];
        const startY = Math.floor(currentGridSize / 2);
        const startX = Math.floor((currentGridSize - firstWord.answer.length) / 2);

        if (!checkPlacement(grid, firstWord.answer, startX, startY, 'across', currentGridSize, currentGridSize)) {
            console.error("No se pudo colocar ni la primera palabra.");
            return false; // Fallo catastrófico inicial
        }

        for (let i = 0; i < firstWord.answer.length; i++) {
            grid[startY][startX + i] = firstWord.answer[i];
        }
        placedWords.push({
            answer: firstWord.answer, clue: firstWord.clue, startx: startX, starty: startY, orientation: 'across'
        });
        minRow = Math.min(minRow, startY); maxRow = Math.max(maxRow, startY);
        minCol = Math.min(minCol, startX); maxCol = Math.max(maxCol, startX + firstWord.answer.length - 1);


        // 2. Intentar colocar las palabras restantes
        const wordsToPlaceIndexes = Array.from({ length: words.length }, (_, i) => i).slice(1);
        let placedCount = 1;
        let attempts = 0; // Para evitar bucles infinitos si algunas no encajan

        while (wordsToPlaceIndexes.length > 0 && attempts < words.length * 5) { // Límite de intentos
            attempts++;
            const wordIndex = wordsToPlaceIndexes.shift(); // Tomar el siguiente índice
            if (wordIndex === undefined) break; // Seguridad
            const currentWord = words[wordIndex];
            let bestScore = -1;
            let bestPlacement: Placement | null = null;

            // Buscar la mejor intersección posible
            for (let pwIdx = 0; pwIdx < placedWords.length; pwIdx++) {
                const existingWord = placedWords[pwIdx];
                for (let i = 0; i < currentWord.answer.length; i++) {
                    for (let j = 0; j < existingWord.answer.length; j++) {
                        if (currentWord.answer[i] === existingWord.answer[j]) {
                            const newOrientation = existingWord.orientation === 'across' ? 'down' : 'across';
                            let newStartX: number, newStartY: number;
                            if (newOrientation === 'across') {
                                newStartX = existingWord.startx - i;
                                newStartY = existingWord.starty + j;
                            } else {
                                newStartX = existingWord.startx + j;
                                newStartY = existingWord.starty - i;
                            }

                            if (checkPlacement(grid, currentWord.answer, newStartX, newStartY, newOrientation, currentGridSize, currentGridSize)) {
                                // Calcular 'score' (número de nuevas intersecciones creadas) - simple
                                let score = 0;
                                for(let k=0; k<currentWord.answer.length; k++){
                                    let r = newStartY, c = newStartX;
                                    if(newOrientation === 'across') c += k; else r += k;
                                    if(grid[r][c] === currentWord.answer[k]) score++; // Contar intersecciones
                                }

                                if (score > bestScore) {
                                    bestScore = score;
                                    bestPlacement = { newStartX, newStartY, newOrientation };
                                }
                            }
                        }
                    }
                }
            } // Fin búsqueda de intersección

            // Si se encontró un lugar válido
            if (bestPlacement) {
                const { newStartX, newStartY, newOrientation } = bestPlacement;
                for (let k = 0; k < currentWord.answer.length; k++) {
                    let r = newStartY, c = newStartX;
                    if (newOrientation === 'across') c += k; else r += k;
                    grid[r][c] = currentWord.answer[k];
                    // Actualizar límites
                    minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
                    minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c);
                }
                placedWords.push({
                    answer: currentWord.answer, clue: currentWord.clue, startx: newStartX, starty: newStartY, orientation: newOrientation
                });
                placedCount++;
                attempts = 0; // Resetear contador de intentos si logramos colocar una
            } else {
                wordsToPlaceIndexes.push(wordIndex); // Poner al final para reintentar
            }

        } // Fin while wordsToPlaceIndexes

        // Si no se colocaron todas, marcar como fallo para este tamaño
        if (placedCount < words.length) {
            failedWords.length = 0; // Limpiar fallidas de intentos anteriores
            wordsToPlaceIndexes.forEach(idx => failedWords.push(words[idx].answer));
            console.warn(`Intento con tamaño ${currentGridSize} incompleto. Faltaron: ${failedWords.join(', ')}`);
            return false; // Indicar fallo
        }

        return true; // Indicar éxito
    } // Fin tryGenerate

    // Bucle principal para intentar generar y ajustar tamaño
    let success = tryGenerate(startGridSize);
    let retryCount = 0;
    const MAX_RETRIES = 5; // Número máximo de reintentos aumentando tamaño
    const SIZE_INCREMENT = 3; // Cuánto aumentar el tamaño cada vez

    while (!success && retryCount < MAX_RETRIES) {
        retryCount++;
        startGridSize += SIZE_INCREMENT;
        console.log(`Reintento ${retryCount}/${MAX_RETRIES}: Aumentando tamaño a ${startGridSize}...`);
        success = tryGenerate(startGridSize);
    }

    // Si después de los reintentos sigue sin éxito, devolvemos null o el último parcial
    if (!success) {
        console.error(`No se pudo generar el crucigrama completo después de ${MAX_RETRIES + 1} intentos.`);
        // Podríamos devolver el último layout parcial (contenido en 'placedWords' y 'grid')
        // o devolver null indicando fallo total. Devolveremos el parcial.
         if (placedWords.length === 0) return null; // Fallo total si ni la primera palabra se colocó
    }

    // 3. Recortar la cuadrícula final
    if (minRow > maxRow || minCol > maxCol) { // Seguridad por si algo salió muy mal
        return { rows: 0, cols: 0, table: [], words: [], result: [], failed: words.map(w=>w.answer), error: "Fallo al determinar límites" };
    }

    const finalRows = maxRow - minRow + 1 + (GRID_BUFFER * 2);
    const finalCols = maxCol - minCol + 1 + (GRID_BUFFER * 2);
    const trimmedGrid: (string | null)[][] = Array.from({ length: finalRows }, () => Array(finalCols).fill(null));

    for (let r = 0; r < startGridSize; r++) {
        for (let c = 0; c < startGridSize; c++) {
            if (grid[r][c] !== null && r >= minRow && r <= maxRow && c >= minCol && c <= maxCol) {
                trimmedGrid[r - minRow + GRID_BUFFER][c - minCol + GRID_BUFFER] = grid[r][c];
            }
        }
    }

    // Ajustar coordenadas y añadir número de posición/pista
    let positionCounter = 1;
    const wordPositions = new Map<string, number>(); // Para asignar número único por celda de inicio
    const finalPlacedWords = placedWords.map(pw => {
        const newStartX = pw.startx - minCol + GRID_BUFFER;
        const newStartY = pw.starty - minRow + GRID_BUFFER;
        const posKey = `${newStartY}-${newStartX}`;
        let position = wordPositions.get(posKey);
        if (position === undefined) {
             position = positionCounter++;
             wordPositions.set(posKey, position);
        }
        return {
            ...pw,
            startx: newStartX,
            starty: newStartY,
            position: position
        };
    }).sort((a,b)=> a.position! - b.position!); // Ordenar por número de pista


    return {
        rows: finalRows,
        cols: finalCols,
        table: trimmedGrid,
        words: finalPlacedWords, // Palabras con coordenadas ajustadas
        result: finalPlacedWords, // Mismo array para 'result'
        failed: failedWords.length > 0 ? failedWords : undefined,
        error: failedWords.length > 0 ? "Layout incompleto" : undefined // Añadir error si es parcial
    };
}
// --- Fin Algoritmo ---


// --- Función envoltorio (ya no necesita bucle, el algoritmo interno lo maneja) ---
function intentarGenerarCrucigrama(
    entradas: EntradaCrucigrama[]
): CrosswordLayout {
    console.log(`Intentando generar crucigrama para ${entradas.length} entradas...`);
    const palabrasParaGenerador = entradas.map(e => ({ clue: e.pista, answer: e.palabra.toUpperCase().replace(/\s/g, '') }));

    // @ts-ignore // Si Deno se queja
    const layout = generateCrosswordLayoutCustom(palabrasParaGenerador);

    if (!layout) {
         // Fallo catastrófico
         return {
             rows: 5, cols: 5, table: Array.from({ length: 5 }, () => Array(5).fill('?')),
             words: [], result: [],
             error: "Generación fallida."
         }
    }
     if (layout.failed && layout.failed.length > 0) {
        layout.error = `Layout incompleto (${layout.failed.length} palabras no colocadas).`;
        console.warn(layout.error, layout.failed);
     }

    return layout;
}
// --- Fin función envoltorio ---


serve(async (req: Request) => {
  // Manejo OPTIONS
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  try {
    const payload: RequestPayload = await req.json();
    console.log("Payload recibido en generar-layout-crucigrama:", JSON.stringify(payload));
    const { entradas } = payload;

    // Validación inicial
    if (!entradas || !Array.isArray(entradas) || entradas.length === 0 ||
        !entradas.every(e => typeof e.palabra === 'string' && typeof e.pista === 'string')) {
      throw new Error("Parámetro inválido: se requiere un array 'entradas' con objetos {palabra, pista}.");
    }

    // --- LLAMAR A LA FUNCIÓN CON REINTENTOS INTERNOS ---
    const layout = intentarGenerarCrucigrama(entradas);
    // --- FIN LLAMADA ---

    // Devolver el layout (completo, parcial o de error) con status 200
    return new Response(JSON.stringify(layout), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) { // Captura errores de validación inicial o JSON
    console.error("Error en generar-layout-crucigrama:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});