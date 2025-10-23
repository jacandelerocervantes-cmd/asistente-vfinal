// src/components/examen/CrucigramaPlayer.jsx
import React, { useState, useEffect } from 'react';
import './CrucigramaPlayer.css'; // Crearemos este CSS

// --- Lógica de generación de cuadrícula (MUY SIMPLIFICADA) ---
// En una implementación real, necesitarías un algoritmo que posicione las palabras
// que se cruzan y determine el tamaño y las celdas negras.
// Esta función es solo un placeholder para mostrar algo.
const generarCuadriculaPlaceholder = (entradas) => {
    // Determinar tamaño simple basado en la palabra más larga (muy básico)
    const tamano = Math.max(10, ...entradas.map(e => e.palabra.length)) + 2;
    const grid = Array.from({ length: tamano }, () => Array(tamano).fill(null)); // null = celda negra

    // Colocar palabras de forma muy simple (horizontalmente, una debajo de otra)
    let filaActual = 1;
    entradas.forEach((entrada, index) => {
        if (filaActual < tamano -1 && entrada.palabra.length < tamano - 2) {
             grid[filaActual][0] = index + 1; // Poner número de pista
            for(let i = 0; i < entrada.palabra.length; i++) {
                grid[filaActual][i + 1] = { letra: '', correcta: entrada.palabra[i] }; // Objeto para letra actual y correcta
            }
            filaActual += 2; // Espacio entre palabras
        }
    });
    return grid;
};


const CrucigramaPlayer = ({ pregunta, respuestaActual, onRespuestaChange }) => {
    const { datos_extra, texto_pregunta } = pregunta;
    const { entradas = [] } = datos_extra || {};

    const [cuadricula, setCuadricula] = useState([]);
    const [respuestasUsuario, setRespuestasUsuario] = useState(respuestaActual?.grid || {}); // { 'fila-col': 'L' }

     // Generar cuadrícula (solo una vez o si cambian las entradas)
    useEffect(() => {
        // En una implementación real, la generación sería compleja.
        const gridGenerada = generarCuadriculaPlaceholder(entradas);
        setCuadricula(gridGenerada);

        // Cargar respuestas guardadas si existen
        if (respuestaActual?.grid) {
             setRespuestasUsuario(respuestaActual.grid);
        } else {
             // Inicializar respuestas si no hay guardadas
             const initialRespuestas = {};
             gridGenerada.forEach((filaArr, fila) => {
                 filaArr.forEach((celda, col) => {
                     if (celda && typeof celda === 'object') { // Si es una celda de letra
                         initialRespuestas[`${fila}-${col}`] = ''; // Inicializar vacía
                     }
                 });
             });
             setRespuestasUsuario(initialRespuestas);
        }
    }, [entradas, respuestaActual]); // Depende de las entradas y la respuesta guardada

    // Manejar cambio en un input de la cuadrícula
    const handleInputChange = (fila, col, valor) => {
        const nuevaLetra = valor.toUpperCase().slice(-1); // Última letra, mayúscula
        const key = `${fila}-${col}`;
        const nuevasRespuestas = { ...respuestasUsuario, [key]: nuevaLetra };
        setRespuestasUsuario(nuevasRespuestas);
        onRespuestaChange(pregunta.id, 'crucigrama', { grid: nuevasRespuestas }); // Guardar todo el estado de la cuadrícula

         // Mover foco automáticamente a la siguiente celda horizontal (si es posible)
         if (nuevaLetra && col + 1 < cuadricula[fila].length && cuadricula[fila][col + 1]) {
             const nextInput = document.getElementById(`cell-${fila}-${col + 1}`);
             nextInput?.focus();
         }
    };


    // Separar pistas horizontales y verticales (basado en la cuadrícula generada, aquí es simple)
    const pistasHorizontales = entradas.map((e, i) => ({ num: i + 1, pista: e.pista, palabra: e.palabra })); // Simplificado
    const pistasVerticales = []; // Placeholder

    return (
        <div className="crucigrama-player">
            {/* <p className="instrucciones-pregunta">{texto_pregunta}</p> */}
            <div className="crucigrama-area">
                <div className="crucigrama-cuadricula" style={{ gridTemplateColumns: `repeat(${cuadricula[0]?.length || 1}, 1fr)` }}>
                    {cuadricula.map((filaArr, filaIndex) =>
                        filaArr.map((celda, colIndex) => {
                            if (celda === null) {
                                // Celda negra
                                return <div key={`${filaIndex}-${colIndex}`} className="crucigrama-celda negra"></div>;
                            } else if (typeof celda === 'number') {
                                // Celda con número de pista
                                return <div key={`${filaIndex}-${colIndex}`} className="crucigrama-celda numero">{celda}</div>;
                            } else {
                                // Celda de input para letra
                                const key = `${filaIndex}-${colIndex}`;
                                return (
                                    <div key={key} className="crucigrama-celda letra">
                                        <input
                                            id={`cell-${key}`}
                                            type="text"
                                            maxLength="1"
                                            value={respuestasUsuario[key] || ''}
                                            onChange={(e) => handleInputChange(filaIndex, colIndex, e.target.value)}
                                            // onKeyDown, onFocus etc. para navegación con flechas (más avanzado)
                                        />
                                    </div>
                                );
                            }
                        })
                    )}
                </div>
                <div className="crucigrama-pistas">
                    <div className="pistas-columna">
                        <h4>Horizontales</h4>
                        <ol>
                            {pistasHorizontales.map(p => <li key={`h-${p.num}`}><span>{p.num}.</span> {p.pista}</li>)}
                        </ol>
                    </div>
                    {pistasVerticales.length > 0 && (
                        <div className="pistas-columna">
                            <h4>Verticales</h4>
                            <ol>
                                {pistasVerticales.map(p => <li key={`v-${p.num}`}><span>{p.num}.</span> {p.pista}</li>)}
                            </ol>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CrucigramaPlayer;