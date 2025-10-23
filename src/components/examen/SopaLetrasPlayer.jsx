// src/components/examen/SopaLetrasPlayer.jsx
import React, { useState, useEffect, useRef } from 'react';
import './SopaLetrasPlayer.css'; // Crearemos este CSS

// --- Lógica básica para generar y mostrar la cuadrícula ---
// (Esta es una implementación MUY simple. Idealmente, usarías un algoritmo
// más robusto o una librería para colocar las palabras y rellenar)
const generarCuadriculaInicial = (tamano, palabras) => {
    const grid = Array.from({ length: tamano }, () => Array(tamano).fill(''));
    // Lógica muy básica de relleno (solo para visualización inicial)
    // Debería reemplazarse por un algoritmo que coloque las 'palabras'
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < tamano; i++) {
        for (let j = 0; j < tamano; j++) {
            grid[i][j] = letras[Math.floor(Math.random() * letras.length)];
        }
    }
    // Aquí iría la lógica para insertar las palabras reales en el grid
    // Por ahora, solo devolvemos letras aleatorias
    return grid;
};

const SopaLetrasPlayer = ({ pregunta, respuestaActual, onRespuestaChange }) => {
    const { datos_extra, texto_pregunta } = pregunta;
    const { palabras = [], tamano = 10 } = datos_extra || {};

    // Estado para la cuadrícula y la selección del usuario
    const [cuadricula, setCuadricula] = useState([]);
    const [seleccion, setSeleccion] = useState([]); // Array de {fila, col}
    const [palabrasEncontradas, setPalabrasEncontradas] = useState(respuestaActual?.encontradas || []); // Cargar estado guardado
    const [isMouseDown, setIsMouseDown] = useState(false);
    const gridRef = useRef(null);

    // Generar cuadrícula inicial (solo una vez o si cambian los datos)
    useEffect(() => {
        // En una implementación real, la generación/colocación de palabras sería más compleja
        // y probablemente debería venir pre-calculada o generarse aquí con un algoritmo.
        setCuadricula(generarCuadriculaInicial(tamano, palabras));
        // Resetear selección si la pregunta cambia
        setSeleccion([]);
        setPalabrasEncontradas(respuestaActual?.encontradas || []);
    }, [tamano, palabras, respuestaActual]); // Depende de la configuración y respuesta guardada

    // --- Lógica de Interacción (Simplificada) ---
    const handleMouseDown = (fila, col) => {
        setIsMouseDown(true);
        setSeleccion([{ fila, col }]); // Inicia nueva selección
    };

    const handleMouseEnter = (fila, col) => {
        if (!isMouseDown || seleccion.length === 0) return;

        // Lógica simple para seleccionar en línea recta (horizontal/vertical/diagonal)
        // Se necesitaría lógica más avanzada para validar la dirección
        const { fila: startFila, col: startCol } = seleccion[0];
        const newSeleccion = [{ fila: startFila, col: startCol }];
        const deltaFila = Math.sign(fila - startFila);
        const deltaCol = Math.sign(col - startCol);

        // Validar que sea una línea válida (o permitir selección libre?)
        // Por simplicidad, permitiremos selección libre por ahora.
        // Solo añadimos la celda actual si no está ya.
         if (!seleccion.some(cell => cell.fila === fila && cell.col === col)) {
             // Deberíamos validar la línea aquí en una versión completa
             setSeleccion(prev => [...prev, { fila, col }]);
         }
         // Esta es una versión muy básica, necesita mejorar la lógica de selección en línea
    };

     const handleMouseUp = () => {
        if (!isMouseDown) return;
        setIsMouseDown(false);

        // Construir la palabra seleccionada
        // (Necesita ordenar las celdas según la dirección de selección)
        const palabraSeleccionada = seleccion.map(cell => cuadricula[cell.fila][cell.col]).join('');
        const palabraInvertida = seleccion.map(cell => cuadricula[cell.fila][cell.col]).reverse().join('');


        // Comprobar si la palabra está en la lista (y no encontrada ya)
        if ((palabras.includes(palabraSeleccionada) && !palabrasEncontradas.includes(palabraSeleccionada)) ||
            (palabras.includes(palabraInvertida) && !palabrasEncontradas.includes(palabraInvertida)) ) {

            const palabraCorrecta = palabras.includes(palabraSeleccionada) ? palabraSeleccionada : palabraInvertida;

            // Marcar como encontrada y limpiar selección
            const nuevasEncontradas = [...palabrasEncontradas, palabraCorrecta];
            setPalabrasEncontradas(nuevasEncontradas);
            // Notificar al componente padre el cambio en la respuesta
            onRespuestaChange(pregunta.id, 'sopa_letras', { encontradas: nuevasEncontradas });
        }
        setSeleccion([]); // Limpiar selección visual
    };

    // Determinar si una celda está seleccionada
    const isSelected = (fila, col) => {
        return seleccion.some(cell => cell.fila === fila && cell.col === col);
    };

    // Renderizado
    return (
        <div className="sopa-letras-player">
            {/* <p className="instrucciones-pregunta">{texto_pregunta}</p> */}
            <div className="sopa-area">
                <div
                    ref={gridRef}
                    className="sopa-cuadricula"
                    style={{ gridTemplateColumns: `repeat(${tamano}, 1fr)` }}
                    onMouseLeave={() => { if(isMouseDown) handleMouseUp(); }} // Finalizar si el mouse sale
                >
                    {cuadricula.map((filaArr, filaIndex) =>
                        filaArr.map((letra, colIndex) => (
                            <div
                                key={`${filaIndex}-${colIndex}`}
                                className={`sopa-celda ${isSelected(filaIndex, colIndex) ? 'selected' : ''}`}
                                onMouseDown={() => handleMouseDown(filaIndex, colIndex)}
                                onMouseEnter={() => handleMouseEnter(filaIndex, colIndex)}
                                onMouseUp={handleMouseUp} // MouseUp en cualquier celda finaliza
                            >
                                {letra}
                            </div>
                        ))
                    )}
                </div>
                <div className="sopa-lista-palabras">
                    <h4>Palabras a encontrar:</h4>
                    <ul>
                        {palabras.map((palabra, index) => (
                            <li key={index} className={palabrasEncontradas.includes(palabra) ? 'encontrada' : ''}>
                                {palabra}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default SopaLetrasPlayer;