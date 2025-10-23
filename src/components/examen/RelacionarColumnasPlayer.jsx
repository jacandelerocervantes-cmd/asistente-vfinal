// src/components/examen/RelacionarColumnasPlayer.jsx
import React, { useState, useEffect } from 'react';
import './RelacionarColumnasPlayer.css'; // <-- Crear este CSS

// Función auxiliar para mezclar un array (Fisher-Yates shuffle)
function shuffleArray(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

const RelacionarColumnasPlayer = ({ pregunta, respuestaActual, onRespuestaChange }) => {
    const { datos_extra } = pregunta;
    const { columnas = [], pares_correctos = [] } = datos_extra || {}; // Asegurar arrays por defecto

    // Separar y mezclar columnas (asumiendo que los primeros N/2 son A y los siguientes N/2 son B)
    // Una mejor estructura en datos_extra podría tener un campo 'grupo': 'A' | 'B'
    const [columnaA, setColumnaA] = useState([]);
    const [columnaB, setColumnaB] = useState([]);

    // Estado para la selección actual y los pares formados
    const [seleccionA, setSeleccionA] = useState(null); // ID del elemento seleccionado en A
    const [seleccionB, setSeleccionB] = useState(null); // ID del elemento seleccionado en B
    const [paresFormados, setParesFormados] = useState(respuestaActual?.pares_seleccionados || []); // Cargar pares guardados

    // Inicializar y mezclar columnas al cargar o si cambian los datos
    useEffect(() => {
        // Lógica simple para separar: mitad y mitad
        const mitad = Math.ceil(columnas.length / 2);
        // Mezclar cada columna por separado
        setColumnaA(shuffleArray(columnas.slice(0, mitad)));
        setColumnaB(shuffleArray(columnas.slice(mitad)));
        // Cargar pares guardados
        setParesFormados(respuestaActual?.pares_seleccionados || []);
        // Limpiar selección activa
        setSeleccionA(null);
        setSeleccionB(null);
    }, [columnas, respuestaActual]); // Depende de la configuración y respuesta guardada

    // Manejar clic en un elemento de columna A
    const handleSelectA = (itemA) => {
        if (seleccionA === itemA.id) {
            setSeleccionA(null); // Deseleccionar si se vuelve a hacer clic
        } else {
            setSeleccionA(itemA.id); // Seleccionar
            // Si ya hay algo seleccionado en B, formar el par
            if (seleccionB) {
                formarPar(itemA.id, seleccionB);
            }
        }
    };

    // Manejar clic en un elemento de columna B
    const handleSelectB = (itemB) => {
        if (seleccionB === itemB.id) {
            setSeleccionB(null); // Deseleccionar
        } else {
            setSeleccionB(itemB.id); // Seleccionar
            // Si ya hay algo seleccionado en A, formar el par
            if (seleccionA) {
                formarPar(seleccionA, itemB.id);
            }
        }
    };

    // Formar un par y actualizar estado/guardar
    const formarPar = (idA, idB) => {
        const nuevoPar = { id_a: idA, id_b: idB };
        // Evitar duplicados exactos (en el mismo orden)
        if (!paresFormados.some(p => p.id_a === idA && p.id_b === idB)) {
            // Eliminar pares anteriores que usen cualquiera de estos IDs
            const nuevosPares = paresFormados.filter(p => p.id_a !== idA && p.id_b !== idA && p.id_a !== idB && p.id_b !== idB);
            nuevosPares.push(nuevoPar); // Añadir el nuevo par

            setParesFormados(nuevosPares);
            // Notificar al padre
            onRespuestaChange(pregunta.id, 'relacionar_columnas', { pares_seleccionados: nuevosPares });
        }
        // Limpiar selección activa después de formar el par
        setSeleccionA(null);
        setSeleccionB(null);
    };

    // Eliminar un par formado
    const eliminarPar = (parAEliminar) => {
        const nuevosPares = paresFormados.filter(p => !(p.id_a === parAEliminar.id_a && p.id_b === parAEliminar.id_b));
        setParesFormados(nuevosPares);
        onRespuestaChange(pregunta.id, 'relacionar_columnas', { pares_seleccionados: nuevosPares });
    };

    // Encontrar el texto de un item por su ID
    const getItemText = (id) => columnas.find(c => c.id === id)?.texto || '??';

    // Determinar si un item ya está en un par formado
    const isPaired = (id) => paresFormados.some(p => p.id_a === id || p.id_b === id);

    return (
        <div className="relacionar-columnas-player">
            {/* <p className="instrucciones-pregunta">{pregunta.texto_pregunta}</p> */}
            <div className="columnas-container">
                {/* Columna A */}
                <div className="columna-relacionar">
                    {columnaA.map(item => (
                        <button
                            key={item.id}
                            onClick={() => handleSelectA(item)}
                            className={`item-relacionar ${seleccionA === item.id ? 'seleccionado' : ''} ${isPaired(item.id) ? 'emparejado' : ''}`}
                            disabled={isPaired(item.id) && seleccionA !== item.id} // Deshabilitar si está emparejado y no seleccionado
                        >
                            {item.texto}
                        </button>
                    ))}
                </div>

                {/* Área de Pares Formados */}
                <div className="pares-formados">
                     <h4>Pares Formados:</h4>
                    {paresFormados.length === 0 && <p><i>Haz clic en un elemento de cada columna para relacionarlos.</i></p>}
                    <ul>
                        {paresFormados.map((par, index) => (
                            <li key={index}>
                                <span>{getItemText(par.id_a)}</span>
                                <span>↔</span>
                                <span>{getItemText(par.id_b)}</span>
                                <button onClick={() => eliminarPar(par)} title="Eliminar este par">×</button>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Columna B */}
                <div className="columna-relacionar">
                    {columnaB.map(item => (
                         <button
                            key={item.id}
                            onClick={() => handleSelectB(item)}
                            className={`item-relacionar ${seleccionB === item.id ? 'seleccionado' : ''} ${isPaired(item.id) ? 'emparejado' : ''}`}
                            disabled={isPaired(item.id) && seleccionB !== item.id}
                        >
                            {item.texto}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default RelacionarColumnasPlayer;