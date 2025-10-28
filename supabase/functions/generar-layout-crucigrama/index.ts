// supabase/functions/generar-layout-crucigrama/index.ts
import { serve } from "std/http/server.ts";
// No more external library import for crossword

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PalabraClue {
    clue: string;
    answer: string; // Ensure answer is uppercase and no spaces for easier grid placement
}

interface PlacedWord {
    answer: string;
    clue: string;
    startx: number; // 0-indexed column
    starty: number; // 0-indexed row
    orientation: 'across' | 'down';
}

interface CrosswordLayout {
    rows: number;
    cols: number;
    table: (string | null)[][];
    words: PlacedWord[];
}

// --- Custom Crossword Generation Algorithm ---
function generateCrosswordLayoutCustom(palabrasInput: PalabraClue[]): CrosswordLayout {
    const GRID_SIZE = 50; // A generous grid size to start with
    const grid: (string | null)[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
    const placedWords: PlacedWord[] = [];

    // Prepare words: uppercase, remove spaces, sort by length (longest first)
    const palabras = palabrasInput
        .map(p => ({
            clue: p.clue,
            answer: p.answer.toUpperCase().replace(/\s/g, '')
        }))
        .sort((a, b) => b.answer.length - a.answer.length);

    if (palabras.length === 0) {
        return { rows: 0, cols: 0, table: [], words: [] };
    }

    // 1. Place the first (longest) word in the center of the initial grid, horizontally
    const firstWord = palabras[0];
    const startY = Math.floor(GRID_SIZE / 2);
    const startX = Math.floor((GRID_SIZE - firstWord.answer.length) / 2);

    for (let i = 0; i < firstWord.answer.length; i++) {
        grid[startY][startX + i] = firstWord.answer[i];
    }
    placedWords.push({
        answer: firstWord.answer,
        clue: firstWord.clue,
        startx: startX,
        starty: startY,
        orientation: 'across'
    });

    // 2. Try to place remaining words
    for (let i = 1; i < palabras.length; i++) {
        const currentWord = palabras[i];
        let bestPlacement: {
            placedWordIndex: number;
            charIndexCurrent: number; // index in currentWord
            charIndexPlaced: number; // index in placedWord
            newStartX: number;
            newStartY: number;
            newOrientation: 'across' | 'down';
            score: number; // e.g., number of intersections
        } | null = null;

        // Iterate through already placed words to find intersection points
        for (let pwIndex = 0; pwIndex < placedWords.length; pwIndex++) {
            const placed = placedWords[pwIndex];

            for (let charC = 0; charC < currentWord.answer.length; charC++) {
                for (let charP = 0; charP < placed.answer.length; charP++) {
                    if (currentWord.answer[charC] === placed.answer[charP]) {
                        // Found a potential intersection
                        const newOrientation = placed.orientation === 'across' ? 'down' : 'across';
                        let newStartX, newStartY;

                        if (newOrientation === 'down') { // Current word will be vertical
                            newStartX = placed.startx + charP;
                            newStartY = placed.starty - charC;
                        } else { // Current word will be horizontal
                            newStartX = placed.startx - charC;
                            newStartY = placed.starty + charP;
                        }

                        // Check if this placement is valid
                        const isValid = checkPlacement(grid, currentWord.answer, newStartX, newStartY, newOrientation);

                        if (isValid) {
                            // For simplicity, we'll just take the first valid placement.
                            // A more advanced algorithm would score placements (e.g., by number of intersections, compactness)
                            // and choose the best one.
                            bestPlacement = {
                                placedWordIndex: pwIndex,
                                charIndexCurrent: charC,
                                charIndexPlaced: charP,
                                newStartX: newStartX,
                                newStartY: newStartY,
                                newOrientation: newOrientation,
                                score: 1 // Simple score for now
                            };
                            // Break from inner loops once a valid placement is found for this word
                            break;
                        }
                    }
                }
                if (bestPlacement) break;
            }
            if (bestPlacement) break;
        }

        // If a valid placement was found, place the word
        if (bestPlacement) {
            const { newStartX, newStartY, newOrientation } = bestPlacement;
            for (let k = 0; k < currentWord.answer.length; k++) {
                if (newOrientation === 'across') {
                    grid[newStartY][newStartX + k] = currentWord.answer[k];
                } else {
                    grid[newStartY + k][newStartX] = currentWord.answer[k];
                }
            }
            placedWords.push({
                answer: currentWord.answer,
                clue: currentWord.clue,
                startx: newStartX,
                starty: newStartY,
                orientation: newOrientation
            });
        } else {
            console.warn(`Could not place word: ${currentWord.answer}`);
        }
    }

    // 3. Trim the grid
    let minRow = GRID_SIZE, maxRow = -1, minCol = GRID_SIZE, maxCol = -1;
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (grid[r][c] !== null) {
                if (r < minRow) minRow = r;
                if (r > maxRow) maxRow = r;
                if (c < minCol) minCol = c;
                if (c > maxCol) maxCol = c;
            }
        }
    }

    // Handle case where no words were placed or grid is empty
    if (minRow > maxRow || minCol > maxCol) {
        return { rows: 0, cols: 0, table: [], words: [] };
    }

    const finalRows = maxRow - minRow + 1;
    const finalCols = maxCol - minCol + 1;
    const trimmedGrid: (string | null)[][] = Array.from({ length: finalRows }, () => Array(finalCols).fill(null));

    for (let r = 0; r < finalRows; r++) {
        for (let c = 0; c < finalCols; c++) {
            trimmedGrid[r][c] = grid[minRow + r][minCol + c];
        }
    }

    // Adjust coordinates of placed words
    const finalPlacedWords = placedWords.map(pw => ({
        ...pw,
        startx: pw.startx - minCol,
        starty: pw.starty - minRow
    }));

    return {
        rows: finalRows,
        cols: finalCols,
        table: trimmedGrid,
        words: finalPlacedWords
    };
}

// Helper function to check if a word can be placed
function checkPlacement(
    grid: (string | null)[][],
    word: string,
    startX: number,
    startY: number,
    orientation: 'across' | 'down'
): boolean {
    const GRID_SIZE = grid.length; // Assuming square grid for simplicity

    // 1. Check bounds
    if (orientation === 'across') {
        if (startX < 0 || startY < 0 || startX + word.length > GRID_SIZE || startY >= GRID_SIZE) {
            return false;
        }
    } else { // 'down'
        if (startX < 0 || startY < 0 || startX >= GRID_SIZE || startY + word.length > GRID_SIZE) {
            return false;
        }
    }

    // 2. Check for conflicts with existing letters and adjacent words
    for (let i = 0; i < word.length; i++) {
        let r = startY, c = startX;
        if (orientation === 'across') {
            c += i;
        } else {
            r += i;
        }

        const charInGrid = grid[r][c];
        const charInWord = word[i];

        // If cell is occupied by a different letter, it's a conflict
        if (charInGrid !== null && charInGrid !== charInWord) {
            return false;
        }

        // Check for adjacent words (parallel conflicts)
        // This is a simplified check. A full crossword generator has more complex rules.
        // Ensure there's a blank space or grid boundary before/after the word,
        // and above/below (for horizontal) or left/right (for vertical) if not intersecting.

        // Check before the word (if not the first char)
        if (i === 0) {
            if (orientation === 'across' && c > 0 && grid[r][c - 1] !== null) return false;
            if (orientation === 'down' && r > 0 && grid[r - 1][c] !== null) return false;
        }
        // Check after the word (if not the last char)
        if (i === word.length - 1) {
            if (orientation === 'across' && c < GRID_SIZE - 1 && grid[r][c + 1] !== null) return false;
            if (orientation === 'down' && r < GRID_SIZE - 1 && grid[r + 1][c] !== null) return false;
        }

        // Check perpendicular neighbors (only if not an intersection point)
        if (charInGrid === null || charInGrid === charInWord) { // Only check if it's not an existing intersection
            if (orientation === 'across') {
                // Check above
                if (r > 0 && grid[r - 1][c] !== null && grid[r - 1][c] !== charInWord) return false;
                // Check below
                if (r < GRID_SIZE - 1 && grid[r + 1][c] !== null && grid[r + 1][c] !== charInWord) return false;
            } else { // 'down'
                // Check left
                if (c > 0 && grid[r][c - 1] !== null && grid[r][c - 1] !== charInWord) return false;
                // Check right
                if (c < GRID_SIZE - 1 && grid[r][c + 1] !== null && grid[r][c + 1] !== charInWord) return false;
            }
        }
    }

    return true;
}

interface RequestPayload {
    palabras: PalabraClue[];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { palabras }: RequestPayload = await req.json();

    if (!palabras || !Array.isArray(palabras) || palabras.length === 0) {
      throw new Error("Parámetro inválido: se requiere un array 'palabras' con objetos {clue, answer}.");
    }

    console.log(`Generando crucigrama con ${palabras.length} palabras...`);

    const layout = generateCrosswordLayoutCustom(palabras);

    if (!layout || layout.words.length === 0) {
        throw new Error("No se pudo generar un crucigrama con las palabras proporcionadas.");
    }

    console.log(`Crucigrama generado: ${layout.rows}x${layout.cols}.`);

    return new Response(JSON.stringify(layout), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en generar-layout-crucigrama:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido al generar el crucigrama.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});