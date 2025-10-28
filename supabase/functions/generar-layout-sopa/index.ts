// supabase/functions/generar-layout-sopa/index.ts
import { serve } from "std/http/server.ts";
// No more external library import for wordsearch

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestPayload {
    palabras: string[];
    filas: number;
    columnas: number;
    maxBacktrackAttempts?: number; // Optional: limit for backtracking attempts
    fillRandomLetters?: boolean; // Optional: whether to fill empty cells with random letters
}

interface PlacedWordSopa {
    word: string;
    startx: number; // 0-indexed column
    starty: number; // 0-indexed row
    direction: string; // e.g., 'horizontal', 'vertical', 'diagonal-up-right'
}

interface WordSearchLayout {
    grid: string[][];
    words: PlacedWordSopa[];
}

// --- Custom Word Search Generation Algorithm ---
function generateWordSearchLayoutCustomWithBacktracking(
    palabrasInput: string[],
    rows: number,
    cols: number,
    maxBacktrackAttempts: number = 1000, // Limit total backtracking attempts
    fillRandomLetters: boolean = true
): WordSearchLayout {
    // Prepare words: uppercase, remove spaces, sort by length (longest first for better placement chances)
    const palabras = palabrasInput
        .map(p => p.toUpperCase().replace(/\s/g, ''))
        .sort((a, b) => b.length - a.length);

    const directions = [ // All 8 directions
        { dx: 1, dy: 0, name: 'horizontal' },         // Right
        { dx: -1, dy: 0, name: 'horizontal-reverse' }, // Left
        { dx: 0, dy: 1, name: 'vertical' },          // Down
        { dx: 0, dy: -1, name: 'vertical-reverse' },  // Up
        { dx: 1, dy: 1, name: 'diagonal-down-right' }, // Down-Right
        { dx: -1, dy: 1, name: 'diagonal-down-left' }, // Down-Left
        { dx: 1, dy: -1, name: 'diagonal-up-right' },  // Up-Right
        { dx: -1, dy: -1, name: 'diagonal-up-left' }   // Up-Left
    ];

    let backtrackCounter = 0;

    // Recursive backtracking function
    function solve(
        wordIndex: number,
        currentGrid: string[][],
        currentPlacedWords: PlacedWordSopa[]
    ): WordSearchLayout | null {
        backtrackCounter++;
        if (backtrackCounter > maxBacktrackAttempts) {
            console.warn(`Max backtrack attempts (${maxBacktrackAttempts}) reached. Aborting.`);
            return null;
        }

        // Base case: All words have been placed successfully
        if (wordIndex === palabras.length) {
            return { grid: currentGrid, words: currentPlacedWords };
        }

        const currentWord = palabras[wordIndex];

        // Try all possible starting positions and directions for the current word
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

        // Shuffle possible placements to introduce randomness and avoid predictable patterns
        possiblePlacements.sort(() => Math.random() - 0.5);

        for (const { startY, startX, dir } of possiblePlacements) {
            // Create a new grid and placed words list for this attempt (to avoid modifying previous states)
            const newGrid: string[][] = currentGrid.map(row => [...row]);
            const newPlacedWords: PlacedWordSopa[] = [...currentPlacedWords];

            // Place the word on the new grid
            let tempX = startX;
            let tempY = startY;
            for (let i = 0; i < currentWord.length; i++) {
                newGrid[tempY][tempX] = currentWord[i];
                tempX += dir.dx;
                tempY += dir.dy;
            }
            newPlacedWords.push({
                word: currentWord,
                startx: startX,
                starty: startY,
                direction: dir.name
            });

            // Recursively try to place the next word
            const result = solve(wordIndex + 1, newGrid, newPlacedWords);
            if (result !== null) {
                return result; // Solution found!
            }
            // If not successful, backtrack (the loop will try the next possible placement)
        }

        return null; // No valid placement found for the current word
    }

    // Start the backtracking process
    const initialGrid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(''));
    const finalLayout = solve(0, initialGrid, []);

    if (finalLayout === null) {
        console.warn("No se pudo colocar todas las palabras en la sopa de letras con el backtracking.");
        // If backtracking failed, return an empty layout or a partially filled one
        return { grid: initialGrid, words: [] };
    }

    // Fill remaining empty cells with random letters if requested
    if (fillRandomLetters) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (finalLayout.grid[r][c] === '') {
                    finalLayout.grid[r][c] = alphabet[Math.floor(Math.random() * alphabet.length)];
                }
            }
        }
    }

    return finalLayout;
}

// Helper function to check if a word can be placed at a given position and direction
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
        // Check bounds
        if (currentY < 0 || currentY >= rows || currentX < 0 || currentX >= cols) {
            return false;
        }
        // Check for conflicts with existing different letters
        if (grid[currentY][currentX] !== '' && grid[currentY][currentX] !== word[i]) {
            return false;
        }
        currentX += direction.dx;
        currentY += direction.dy;
    }
    return true; // If all checks pass, the placement is valid
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const { palabras, filas, columnas, maxBacktrackAttempts, fillRandomLetters }: RequestPayload = await req.json();
    
    if (!palabras || !Array.isArray(palabras) || palabras.length === 0 || !filas || !columnas) {
      throw new Error("Parámetros inválidos: se requieren 'palabras' (array), 'filas' (número) y 'columnas' (número).");
    }

    console.log(`Generando sopa de letras de ${filas}x${columnas} con ${palabras.length} palabras...`);

    const layout = generateWordSearchLayoutCustomWithBacktracking(
        palabras,
        filas,
        columnas,
        maxBacktrackAttempts,
        fillRandomLetters
    );

    if (!layout || layout.words.length !== palabras.length) {
        // If not all words were placed, it means the backtracking failed to find a complete solution
        throw new Error("No se pudo generar la sopa de letras colocando todas las palabras con los parámetros proporcionados. Intente con un tamaño de cuadrícula mayor o menos palabras.");
    }

    return new Response(JSON.stringify(layout), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error("Error en generar-layout-sopa:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido al generar la sopa de letras.";
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});