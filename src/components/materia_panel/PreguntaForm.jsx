// src/components/materia_panel/PreguntaForm.jsx
import React, { useState, useEffect } from 'react';
import './PreguntaForm.css'; // Asegúrate de que los estilos estén importados

// Componente auxiliar simple para la configuración de Sopa de Letras
const ConfigSopaLetras = ({ datos, onDatosChange }) => {
    // Estado interno para manejar el textarea y el input de tamaño
    const [palabrasTexto, setPalabrasTexto] = useState((datos?.palabras || []).join('\n'));
    const [tamano, setTamano] = useState(datos?.tamano || 10); // Tamaño por defecto 10x10

    // Efecto para sincronizar el estado interno si los 'datos' prop cambian desde el exterior
    useEffect(() => {
        setPalabrasTexto((datos?.palabras || []).join('\n'));
        setTamano(datos?.tamano || 10);
    }, [datos]);

    // Maneja cambios en el textarea de palabras
    const handlePalabrasChange = (e) => {
        const texto = e.target.value;
        setPalabrasTexto(texto); // Actualiza estado local del textarea
        // Procesa el texto para convertirlo en un array de palabras
        const palabrasArray = texto
            .split('\n') // Divide por saltos de línea
            .map(p => p.trim().toUpperCase()) // Quita espacios y convierte a mayúsculas
            .filter(Boolean); // Elimina líneas vacías
        // Llama a la función del padre para actualizar el objeto 'datos_extra'
        onDatosChange({ ...datos, palabras: palabrasArray });
    };

    // Maneja cambios en el input de tamaño
    const handleTamanoChange = (e) => {
         const nuevoTamano = parseInt(e.target.value, 10) || 10; // Convierte a número, default 10
         setTamano(nuevoTamano); // Actualiza estado local del input
         // Llama a la función del padre para actualizar el objeto 'datos_extra'
         onDatosChange({ ...datos, tamano: nuevoTamano });
    };

    // Renderiza los campos de configuración para Sopa de Letras
    return (
        <div className="config-didactica">
            <h4>Configuración Sopa de Letras</h4>
            <div className="form-group">
                <label>Palabras a encontrar (una por línea):</label>
                <textarea
                    rows="5"
                    value={palabrasTexto}
                    onChange={handlePalabrasChange}
                    placeholder={"REACT\nJAVASCRIPT\nCOMPONENTE..."} // Usar \n real
                />
            </div>
             <div className="form-group">
                <label>Tamaño de la cuadrícula (ej. 10 para 10x10):</label>
                <input
                    type="number"
                    min="5" // Tamaño mínimo razonable
                    max="20" // Tamaño máximo razonable
                    value={tamano}
                    onChange={handleTamanoChange}
                 />
            </div>
            {/* Aquí se podrían añadir más opciones de configuración en el futuro */}
        </div>
    );
};

// Componente auxiliar simple para la configuración de Crucigrama
const ConfigCrucigrama = ({ datos, onDatosChange }) => {
    // Estado interno para manejar la lista de palabras y pistas
    const [entradas, setEntradas] = useState(datos?.entradas || [{ palabra: '', pista: '' }]);

    // Efecto para sincronizar el estado interno si los 'datos' prop cambian
    useEffect(() => {
        setEntradas(datos?.entradas || [{ palabra: '', pista: '' }]);
    }, [datos]);

    // Maneja cambios en los inputs de palabra o pista
    const handleEntradaChange = (index, field, value) => {
        const nuevasEntradas = [...entradas]; // Copia el array de entradas
        // Procesa la palabra: mayúsculas y sin espacios
        const valorProcesado = field === 'palabra' ? value.toUpperCase().replace(/\s/g, '') : value;
        nuevasEntradas[index][field] = valorProcesado; // Actualiza el valor en la copia
        setEntradas(nuevasEntradas); // Actualiza el estado local
        // Llama a la función del padre para actualizar 'datos_extra'
        onDatosChange({ ...datos, entradas: nuevasEntradas });
    };

    // Añade una nueva fila vacía para palabra/pista
    const handleAddEntrada = () => {
        const nuevasEntradas = [...entradas, { palabra: '', pista: '' }];
        setEntradas(nuevasEntradas);
        // Actualiza datos_extra inmediatamente para reflejar la nueva entrada vacía
        onDatosChange({ ...datos, entradas: nuevasEntradas });
    };

    // Elimina una fila de palabra/pista por su índice
    const handleRemoveEntrada = (index) => {
        const nuevasEntradas = entradas.filter((_, i) => i !== index); // Filtra la entrada a eliminar
        setEntradas(nuevasEntradas); // Actualiza estado local
        // Llama a la función del padre para actualizar 'datos_extra'
        onDatosChange({ ...datos, entradas: nuevasEntradas });
    };

    // Renderiza la lista de campos para palabras y pistas
    return (
        <div className="config-didactica">
            <h4>Configuración Crucigrama</h4>
            {entradas.map((entrada, index) => (
                // Contenedor para cada par palabra/pista
                <div key={index} className="crucigrama-entrada">
                    <span>{index + 1}.</span> {/* Muestra el número de entrada */}
                    <input
                        type="text"
                        placeholder="PALABRA" // Placeholder
                        value={entrada.palabra} // Valor del estado
                        onChange={(e) => handleEntradaChange(index, 'palabra', e.target.value)} // Manejador
                        className="crucigrama-palabra" // Clase CSS
                    />
                    <input
                        type="text"
                        placeholder="Pista para esta palabra" // Placeholder
                        value={entrada.pista} // Valor del estado
                        onChange={(e) => handleEntradaChange(index, 'pista', e.target.value)} // Manejador
                        className="crucigrama-pista" // Clase CSS
                    />
                    {/* Botón para eliminar esta entrada */}
                    <button type="button" onClick={() => handleRemoveEntrada(index)} className="btn-danger">X</button>
                </div>
            ))}
            {/* Botón para añadir una nueva entrada */}
            <button type="button" onClick={handleAddEntrada} className="btn-secondary">＋ Añadir Palabra/Pista</button>
        </div>
    );
};

// --- NUEVO: Componente auxiliar para Config Relacionar Columnas ---
const ConfigRelacionarColumnas = ({ datos, onDatosChange }) => {
    const [items, setItems] = useState(datos?.columnas || [{ id: `item-A-${Date.now()}`, texto: '', grupo: 'A' }, { id: `item-B-${Date.now()}`, texto: '', grupo: 'B' }]);
    const [pares, setPares] = useState(datos?.pares_correctos || []); // [{ id_columna_a: '', id_columna_b: '' }]

    useEffect(() => {
        // Sincronizar estado interno si cambian las props
        setItems(datos?.columnas || [{ id: `item-A-${Date.now()}`, texto: '', grupo: 'A' }, { id: `item-B-${Date.now()}`, texto: '', grupo: 'B' }]);
        setPares(datos?.pares_correctos || []);
    }, [datos]);

    // Manejar cambios en el texto de un item
    const handleItemChange = (index, value) => {
        const nuevosItems = [...items];
        nuevosItems[index].texto = value;
        setItems(nuevosItems);
        onDatosChange({ ...datos, columnas: nuevosItems, pares_correctos: pares }); // Pasar también los pares
    };

    // Añadir un nuevo item a una columna
    const handleAddItem = (grupo) => {
        const nuevosItems = [...items, { id: `item-${grupo}-${Date.now()}`, texto: '', grupo }];
        setItems(nuevosItems);
         onDatosChange({ ...datos, columnas: nuevosItems, pares_correctos: pares });
    };

    // Eliminar un item y sus pares asociados
    const handleRemoveItem = (index) => {
        const itemIdToRemove = items[index].id;
        const nuevosItems = items.filter((_, i) => i !== index);
        // Eliminar pares que contengan este item
        const nuevosPares = pares.filter(p => p.id_columna_a !== itemIdToRemove && p.id_columna_b !== itemIdToRemove);
        setItems(nuevosItems);
        setPares(nuevosPares);
         onDatosChange({ ...datos, columnas: nuevosItems, pares_correctos: nuevosPares });
    };

    // Manejar selección para formar un par (simplificado con selects)
    const handleParChange = (parIndex, columnaKey, selectedItemId) => {
         const nuevosPares = [...pares];
         nuevosPares[parIndex][columnaKey] = selectedItemId;
         // Evitar que un item se relacione consigo mismo o que se repita el par exacto
         // (Se necesita lógica más robusta aquí)
         setPares(nuevosPares);
         onDatosChange({ ...datos, columnas: items, pares_correctos: nuevosPares });
    };

     const handleAddPar = () => {
         const nuevosPares = [...pares, { id_columna_a: '', id_columna_b: '' }];
         setPares(nuevosPares);
         onDatosChange({ ...datos, columnas: items, pares_correctos: nuevosPares });
     };

     const handleRemovePar = (parIndex) => {
         const nuevosPares = pares.filter((_, i) => i !== parIndex);
         setPares(nuevosPares);
         onDatosChange({ ...datos, columnas: items, pares_correctos: nuevosPares });
     };


    const itemsA = items.filter(i => i.grupo === 'A');
    const itemsB = items.filter(i => i.grupo === 'B');

    return (
        <div className="config-didactica">
            <h4>Configuración Relacionar Columnas</h4>
            <div className="columnas-definicion">
                {/* Columna A */}
                <div className="columna-items">
                    <h5>Columna A</h5>
                    {itemsA.map((item, index) => (
                        <div key={item.id} className="item-input">
                            <input
                                type="text"
                                placeholder={`Elemento A${index + 1}`}
                                value={item.texto}
                                onChange={(e) => handleItemChange(items.findIndex(i => i.id === item.id), e.target.value)}
                                required
                            />
                            {itemsA.length > 1 && <button type="button" onClick={() => handleRemoveItem(items.findIndex(i => i.id === item.id))} className="btn-danger">X</button>}
                        </div>
                    ))}
                    <button type="button" onClick={() => handleAddItem('A')} className="btn-secondary">＋ Añadir Item A</button>
                </div>
                {/* Columna B */}
                <div className="columna-items">
                    <h5>Columna B</h5>
                     {itemsB.map((item, index) => (
                         <div key={item.id} className="item-input">
                            <input
                                type="text"
                                placeholder={`Elemento B${index + 1}`}
                                value={item.texto}
                                onChange={(e) => handleItemChange(items.findIndex(i => i.id === item.id), e.target.value)}
                                required
                            />
                             {itemsB.length > 1 && <button type="button" onClick={() => handleRemoveItem(items.findIndex(i => i.id === item.id))} className="btn-danger">X</button>}
                        </div>
                    ))}
                     <button type="button" onClick={() => handleAddItem('B')} className="btn-secondary">＋ Añadir Item B</button>
                </div>
            </div>

             {/* Definición de Pares Correctos */}
            <div className="pares-definicion">
                <h5>Pares Correctos</h5>
                 {pares.map((par, index) => (
                     <div key={index} className="par-input">
                         <select value={par.id_columna_a} onChange={(e) => handleParChange(index, 'id_columna_a', e.target.value)} required>
                             <option value="">-- Selecciona A --</option>
                             {itemsA.map(item => <option key={item.id} value={item.id}>{item.texto.substring(0,20)}...</option>)}
                         </select>
                         <span>↔</span>
                         <select value={par.id_columna_b} onChange={(e) => handleParChange(index, 'id_columna_b', e.target.value)} required>
                             <option value="">-- Selecciona B --</option>
                             {itemsB.map(item => <option key={item.id} value={item.id}>{item.texto.substring(0,20)}...</option>)}
                         </select>
                         <button type="button" onClick={() => handleRemovePar(index)} className="btn-danger">X</button>
                     </div>
                 ))}
                 <button type="button" onClick={handleAddPar} className="btn-secondary">＋ Añadir Par Correcto</button>
             </div>
        </div>
    );
};
// --- FIN COMPONENTE AUXILIAR ---

// --- Componente Principal PreguntaForm ---
// Recibe la pregunta actual, su índice visual, y funciones para actualizarla o eliminarla
const PreguntaForm = ({ pregunta, index, onUpdate, onDelete }) => {

    // Manejador genérico para cambios en inputs de texto (como el texto de la pregunta)
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        // Llama a onUpdate pasando una copia de la pregunta con el campo modificado
        onUpdate({ ...pregunta, [name]: value });
    };

    // Manejador específico para el input de puntos (asegura que sea número)
    const handlePuntosChange = (e) => {
        // Permite borrar el campo (valor vacío) o convierte a número entero
        const value = e.target.value === '' ? '' : parseInt(e.target.value, 10);
        // Si no es un número válido (NaN), asigna 0, si no, el valor numérico
        onUpdate({ ...pregunta, puntos: isNaN(value) ? 0 : value });
    };

    // Manejador para cambios en el select de tipo de pregunta
    const handleTipoChange = (e) => {
        const newType = e.target.value; // El nuevo tipo seleccionado
        const updatedPregunta = { ...pregunta, tipo_pregunta: newType }; // Copia la pregunta y actualiza el tipo

        // Limpiar/inicializar opciones
        if (['abierta', 'sopa_letras', 'crucigrama'].includes(newType)) {
            updatedPregunta.opciones = [];
        } else if (newType.startsWith('opcion_multiple') && (!pregunta.opciones || pregunta.opciones.length === 0)) {
            // Si cambia a opción múltiple (única o varias) y no había opciones, añadir una inicial
             updatedPregunta.opciones = [{ id: `temp-opt-${Date.now()}`, texto_opcion: '', es_correcta: newType === 'opcion_multiple_unica' }]; // Correcta solo si es única
        } else if (newType === 'opcion_multiple_unica' && pregunta.opciones?.filter(o => o.es_correcta).length > 1) {
            // Si cambia a ÚNICA y había VARIAS correctas, dejar solo la primera como correcta
            let foundFirst = false;
            updatedPregunta.opciones = pregunta.opciones.map(opt => {
                if(opt.es_correcta && !foundFirst) {
                     foundFirst = true;
                     return opt;
                }
                return {...opt, es_correcta: false };
            });
        }

        // Si el nuevo tipo NO usa configuración didáctica (datos_extra), limpia ese campo
        if (!['sopa_letras', 'crucigrama', 'relacionar_columnas'].includes(newType)) { // <-- Añadir relacionar
             updatedPregunta.datos_extra = null; // O {} si prefieres un objeto vacío
        }
        // Si se cambia a un tipo didáctico y datos_extra no existe o es nulo, inicialízalo
        else if (!pregunta.datos_extra) {
             if (newType === 'sopa_letras') updatedPregunta.datos_extra = { palabras: [], tamano: 10 };
             else if (newType === 'crucigrama') updatedPregunta.datos_extra = { entradas: [{ palabra: '', pista: '' }] };
             // --- NUEVO: Inicializar para relacionar ---
             else if (newType === 'relacionar_columnas') updatedPregunta.datos_extra = { columnas: [{ id: `item-A-${Date.now()}`, texto: '', grupo: 'A' }, { id: `item-B-${Date.now()}`, texto: '', grupo: 'B' }], pares_correctos: [] };
             // --- FIN NUEVO ---
        }

        // Llama a onUpdate con la pregunta modificada
        onUpdate(updatedPregunta);
    };

    // --- Manejadores para Opciones de Respuesta (Opción Múltiple) ---

    // Maneja cambios en el texto o el estado 'correcta' de una opción
    const handleOptionChange = (optIndex, field, value) => {
        // Crea una copia del array de opciones (o un array vacío si no existe)
        const nuevasOpciones = [...(pregunta.opciones || [])];
        if (field === 'es_correcta') {
            // Si es opción única (RADIO), desmarcar las demás
            if (pregunta.tipo_pregunta === 'opcion_multiple_unica') {
                 nuevasOpciones.forEach((opt, i) => opt.es_correcta = (i === optIndex)); // Solo la actual es true
            } else { // Si es opción múltiple (CHECKBOX), simplemente cambia el valor
                 nuevasOpciones[optIndex].es_correcta = value;
            }
        } else { // Si es cambio de texto
            nuevasOpciones[optIndex][field] = value;
        }
        // Validar que al menos una opción sea correcta si es opción múltiple
        if (pregunta.tipo_pregunta.startsWith('opcion_multiple') && !nuevasOpciones.some(o => o.es_correcta) && nuevasOpciones.length > 0) {
             // Si ninguna queda marcada (ej. al borrar la última correcta), marcar la primera como fallback
             // Opcional: podrías mostrar una advertencia al usuario en lugar de esto
             nuevasOpciones[0].es_correcta = true;
             console.warn("Se marcó la primera opción como correcta porque ninguna lo era.");
        }
        onUpdate({ ...pregunta, opciones: nuevasOpciones });
    };

     // Añade una nueva opción vacía al final
     const handleAddOption = () => {
        const nuevasOpciones = [...(pregunta.opciones || []), {
            id: `temp-opt-${Date.now()}`, // ID temporal único
            texto_opcion: '', // Texto vacío
            es_correcta: false // Por defecto no es correcta
        }];
        // Llama a onUpdate con el nuevo array de opciones
        onUpdate({ ...pregunta, opciones: nuevasOpciones });
    };

    // Elimina una opción por su índice
    const handleRemoveOption = (optIndex) => {
        // Filtra el array, manteniendo todas excepto la del índice especificado
        const nuevasOpciones = (pregunta.opciones || []).filter((_, i) => i !== optIndex);

        // Validaciones para asegurar estado consistente
        if (nuevasOpciones.length === 0 && pregunta.tipo_pregunta.startsWith('opcion_multiple')) {
             alert("Debe haber al menos una opción."); // Evita dejar sin opciones
             return;
         }
         // Re-validar que al menos una sea correcta después de borrar
         if (pregunta.tipo_pregunta.startsWith('opcion_multiple') && !nuevasOpciones.some(opt => opt.es_correcta) && nuevasOpciones.length > 0) {
            nuevasOpciones[0].es_correcta = true;
         }
        onUpdate({ ...pregunta, opciones: nuevasOpciones });
    };

    // --- Fin Manejadores de Opciones ---


    // --- NUEVO: Manejador para cambios en datos_extra (llamado por componentes hijos) ---
    const handleDatosExtraChange = (nuevosDatos) => {
        // Llama a onUpdate pasando la pregunta con el campo 'datos_extra' actualizado
        onUpdate({ ...pregunta, datos_extra: nuevosDatos });
    };


    // --- Renderizado del Componente ---
    return (
        // Contenedor principal para la tarjeta de la pregunta
        <div className="pregunta-form-item card"> {/* Aplica clases CSS */}
            {/* Encabezado con número de pregunta y botón eliminar */}
            <div>
                <strong>Pregunta {index + 1}</strong>
                <button type="button" onClick={() => onDelete(pregunta.id)} className="btn-danger">Eliminar Pregunta</button>
            </div>

            {/* Campo para el texto/enunciado de la pregunta */}
            <div className="form-group">
                <label>Texto de la Pregunta {pregunta.tipo_pregunta !== 'opcion_multiple_unica' && pregunta.tipo_pregunta !== 'abierta' ? '(Instrucciones para el juego)' : ''}</label>
                <textarea
                    name="texto_pregunta" // name coincide con la clave en el estado
                    value={pregunta.texto_pregunta} // Valor del estado
                    onChange={handleInputChange} // Manejador de cambio
                    rows={3} // Altura inicial
                    required // Campo obligatorio
                    placeholder={ // Placeholder dinámico según el tipo
                        pregunta.tipo_pregunta === 'sopa_letras' ? "Ej: Encuentra las siguientes palabras relacionadas con..." :
                        pregunta.tipo_pregunta === 'crucigrama' ? "Ej: Resuelve el siguiente crucigrama usando las pistas..." :
                        "Enunciado de la pregunta..."
                    }
                />
            </div>

            {/* Contenedor horizontal para Tipo de Pregunta y Puntos */}
            <div className="form-group-horizontal">
                {/* Selector de Tipo de Pregunta */}
                <div className="form-group">
                    <label>Tipo de Pregunta</label>
                    <select name="tipo_pregunta" value={pregunta.tipo_pregunta} onChange={handleTipoChange}>
                        {/* Opciones definidas */}
                        <option value="opcion_multiple_unica">Opción Múltiple (Única)</option>
                        <option value="opcion_multiple_multiple">Opción Múltiple (Varias)</option>
                        <option value="abierta">Abierta (Respuesta Manual)</option>
                        <option value="sopa_letras">Sopa de Letras</option>
                        <option value="crucigrama">Crucigrama</option>
                        <option value="relacionar_columnas">Relacionar Columnas</option>
                    </select>
                </div>
                 {/* Input para Puntos */}
                 <div className="form-group">
                    <label>Puntos</label>
                    <input
                        type="number"
                        name="puntos"
                        value={pregunta.puntos} // Valor del estado
                        onChange={handlePuntosChange} // Manejador
                        min="0" // Valor mínimo
                        required // Campo obligatorio
                        // style={{width: '80px'}} // Estilo en línea (o mover a CSS)
                    />
                </div>
            </div>

            {/* --- Renderizado Condicional de Configuraciones --- */}

            {/* Sección de Opciones (Solo para opción múltiple) */}
            {pregunta.tipo_pregunta.startsWith('opcion_multiple') && (
                <div className="opciones-section">
                    <label>Opciones de Respuesta:</label>
                    {/* Mapea las opciones existentes o un array vacío */}
                    {(pregunta.opciones || []).map((opcion, optIndex) => (
                        // Contenedor para cada opción individual
                        <div key={opcion.id || `new-opt-${optIndex}`} className="opcion-item-container"> {/* Usar clase CSS */}
                            {/* Input radio (única) o checkbox (múltiple) */}
                            <input
                                type={pregunta.tipo_pregunta === 'opcion_multiple_unica' ? 'radio' : 'checkbox'}
                                // name compartido para radios del mismo grupo, puede ser diferente para checks
                                name={`correcta-${pregunta.id}-${pregunta.tipo_pregunta === 'opcion_multiple_unica' ? 'unica' : optIndex }`}
                                checked={opcion.es_correcta || false} // Estado checked
                                // Manejador de cambio, pasa índice, campo y nuevo valor (checked)
                                onChange={(e) => handleOptionChange(optIndex, 'es_correcta', e.target.checked)}
                            />
                            {/* Input para el texto de la opción */}
                            <input
                                type="text"
                                placeholder={`Opción ${optIndex + 1}`}
                                value={opcion.texto_opcion} // Valor del estado
                                // Manejador de cambio, pasa índice, campo y nuevo valor (texto)
                                onChange={(e) => handleOptionChange(optIndex, 'texto_opcion', e.target.value)}
                                required // Texto de opción obligatorio
                                // style={{flexGrow: 1}} // Estilo en línea (o mover a CSS)
                            />
                            {/* Mostrar botón eliminar solo si hay más de 1 opción */}
                            {(pregunta.opciones || []).length > 1 && (
                                <button type="button" onClick={() => handleRemoveOption(optIndex)} className="btn-danger">X</button>
                            )}
                        </div>
                    ))}
                    {/* Botón para añadir una nueva opción */}
                    <button type="button" onClick={handleAddOption} className="btn-secondary">＋ Añadir Opción</button>
                </div>
            )}

            {/* Renderizar Configuración Sopa de Letras si es el tipo seleccionado */}
            {pregunta.tipo_pregunta === 'sopa_letras' && (
                <ConfigSopaLetras
                    // Pasa los datos_extra (o un objeto inicial si no existen)
                    datos={pregunta.datos_extra || { palabras: [], tamano: 10 }}
                    // Pasa la función para manejar cambios en esos datos
                    onDatosChange={handleDatosExtraChange}
                />
            )}

            {/* Renderizar Configuración Crucigrama si es el tipo seleccionado */}
            {pregunta.tipo_pregunta === 'crucigrama' && (
                <ConfigCrucigrama
                     // Pasa los datos_extra (o un objeto inicial si no existen)
                     datos={pregunta.datos_extra || { entradas: [{ palabra: '', pista: '' }] }}
                     // Pasa la función para manejar cambios en esos datos
                     onDatosChange={handleDatosExtraChange}
                 />
            )}

            {/* --- NUEVO: Renderizar Config Relacionar --- */}
            {pregunta.tipo_pregunta === 'relacionar_columnas' && (
                <ConfigRelacionarColumnas
                    datos={pregunta.datos_extra || { columnas: [], pares_correctos: [] }} // Pasar datos o inicializar
                    onDatosChange={handleDatosExtraChange}
                />
            )}
            {/* --- FIN NUEVO --- */}

        </div> // Fin de .pregunta-form-item
    );
};

export default PreguntaForm; // Exporta el componente principal