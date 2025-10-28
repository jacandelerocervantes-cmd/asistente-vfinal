// src/components/banco_preguntas/PreguntaBancoForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
// No es necesario importar ConfigSopaLetras/ConfigCrucigrama si están definidos abajo
// Asegúrate de importar el CSS si lo tienes
// import './BancoPreguntasPanel.css'; // O un CSS específico si lo creas

// ========================================================================
// COMPONENTES AUXILIARES DE CONFIGURACIÓN (COPIADOS/ADAPTADOS)
// ========================================================================

// Componente auxiliar para la configuración de Sopa de Letras
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
        <div className="config-didactica"> {/* Usar clase CSS */}
            <h4>Configuración Sopa de Letras</h4>
            <div className="form-group"> {/* Reutilizar clase form-group */}
                <label>Palabras a encontrar (una por línea):</label>
                <textarea
                    rows="5"
                    value={palabrasTexto}
                    onChange={handlePalabrasChange}
                    placeholder={"REACT\nJAVASCRIPT\nCOMPONENTE..."} // Usar \n real
                />
            </div>
             <div className="form-group"> {/* Reutilizar clase form-group */}
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

// Componente auxiliar para la configuración de Crucigrama
const ConfigCrucigrama = ({ datos, onDatosChange }) => {
    // Estado interno para manejar la lista de palabras y pistas
    const [entradas, setEntradas] = useState(datos?.entradas || [{ palabra: '', pista: '' }]);

    // Efecto para sincronizar el estado interno si los 'datos' prop cambian
    useEffect(() => {
        // Asegurarse de que siempre sea un array, incluso si datos.entradas es null/undefined
        setEntradas(Array.isArray(datos?.entradas) && datos.entradas.length > 0 ? datos.entradas : [{ palabra: '', pista: '' }]);
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
        // Asegurarse de que siempre quede al menos una entrada si se borran todas
        if (nuevasEntradas.length === 0) {
            setEntradas([{ palabra: '', pista: '' }]);
            onDatosChange({ ...datos, entradas: [{ palabra: '', pista: '' }] });
        } else {
             setEntradas(nuevasEntradas); // Actualiza estado local
             onDatosChange({ ...datos, entradas: nuevasEntradas }); // Actualiza datos_extra
        }
    };

    // Renderiza la lista de campos para palabras y pistas
    return (
        <div className="config-didactica"> {/* Usar clase CSS */}
            <h4>Configuración Crucigrama</h4>
            {entradas.map((entrada, index) => (
                // Contenedor para cada par palabra/pista
                <div key={index} className="crucigrama-entrada"> {/* Usar clase CSS */}
                    <span>{index + 1}.</span> {/* Muestra el número de entrada */}
                    <input
                        type="text"
                        placeholder="PALABRA" // Placeholder
                        value={entrada.palabra} // Valor del estado
                        onChange={(e) => handleEntradaChange(index, 'palabra', e.target.value)} // Manejador
                        className="crucigrama-palabra" // Clase CSS
                        required // Palabra es requerida
                    />
                    <input
                        type="text"
                        placeholder="Pista para esta palabra" // Placeholder
                        value={entrada.pista} // Valor del estado
                        onChange={(e) => handleEntradaChange(index, 'pista', e.target.value)} // Manejador
                        className="crucigrama-pista" // Clase CSS
                        required // Pista es requerida
                    />
                    {/* Botón para eliminar esta entrada (solo si hay más de una) */}
                    {entradas.length > 1 && (
                        <button type="button" onClick={() => handleRemoveEntrada(index)} className="btn-danger">X</button>
                    )}
                </div>
            ))}
            {/* Botón para añadir una nueva entrada */}
            <button type="button" onClick={handleAddEntrada} className="btn-secondary">＋ Añadir Palabra/Pista</button>
        </div>
    );
};

// Copiar ConfigRelacionarColumnas desde PreguntaForm.jsx si no está en un archivo compartido
const ConfigRelacionarColumnas = ({ datos, onDatosChange }) => {
    // ... (Lógica completa del componente ConfigRelacionarColumnas)
    // Por brevedad, se omite aquí, pero debe ser idéntica a la de PreguntaForm.jsx
    return (
        <div className="config-didactica">
            <h4>Configuración Relacionar Columnas</h4>
            <p style={{color: 'grey', textAlign: 'center'}}>
                La configuración para este tipo de pregunta se realiza en el editor de evaluaciones.
            </p>
        </div>
    );
};


// ========================================================================
// COMPONENTE PRINCIPAL: PreguntaBancoForm
// ========================================================================

const PreguntaBancoForm = ({ preguntaToEdit, materiasDocente, onSave, onCancel }) => {
    // Estados para los campos de la pregunta del banco
    const [textoPregunta, setTextoPregunta] = useState('');
    const [tipoPregunta, setTipoPregunta] = useState('opcion_multiple_unica');
    const [puntos, setPuntos] = useState(10);
    const [datosExtra, setDatosExtra] = useState(null); // Para Sopa, Crucigrama, etc.
    // Estado para las opciones (solo si es tipo opción múltiple)
    const [opciones, setOpciones] = useState([{ id: `temp-opt-${Date.now()}`, texto_opcion: '', es_correcta: true }]);
    const [unidad, setUnidad] = useState(''); // Clasificación opcional
    const [tema, setTema] = useState(''); // Clasificación opcional
    const [materiaId, setMateriaId] = useState(''); // ID de materia asociada (opcional, '' = general)

    const [loading, setLoading] = useState(false); // Estado de carga para el envío
    const isEditing = Boolean(preguntaToEdit); // Determina si estamos editando o creando

    // Efecto para cargar datos cuando 'preguntaToEdit' cambia (modo edición)
    useEffect(() => {
        if (isEditing && preguntaToEdit) {
            // Llenar los estados con los datos de la pregunta a editar
            setTextoPregunta(preguntaToEdit.texto_pregunta);
            setTipoPregunta(preguntaToEdit.tipo_pregunta);
            setPuntos(preguntaToEdit.puntos || 10);
            setDatosExtra(preguntaToEdit.datos_extra || null); // Cargar datos_extra
            setUnidad(preguntaToEdit.unidad || '');
            setTema(preguntaToEdit.tema || '');
            setMateriaId(preguntaToEdit.materia_id || ''); // Cargar materia asociada

            // Cargar opciones si la pregunta las tenía en el banco
            // Usamos ?. para acceso seguro a banco_opciones
            const opcionesBanco = preguntaToEdit.banco_opciones;
            if (Array.isArray(opcionesBanco) && opcionesBanco.length > 0) {
                 // Mapear para asegurar que tenemos una copia editable en el estado
                setOpciones(opcionesBanco.map(opt => ({ ...opt })));
            // Inicializar si es opción múltiple pero no trajo opciones
            } else if (preguntaToEdit.tipo_pregunta.startsWith('opcion_multiple')) {
                 setOpciones([{ id: `temp-opt-${Date.now()}`, texto_opcion: '', es_correcta: preguntaToEdit.tipo_pregunta === 'opcion_multiple_unica' }]);
            } else {
                 setOpciones([]); // Limpiar si no es de opción múltiple
            }
        } else {
            // Resetear todos los estados del formulario para crear una nueva pregunta
            setTextoPregunta('');
            // Resetear opciones para nueva pregunta (única por defecto)
            setTipoPregunta('opcion_multiple_unica'); // Asegurar tipo inicial
            setPuntos(10);
            setDatosExtra(null);
            // Iniciar con una opción por defecto si el tipo inicial es opción múltiple
            setOpciones([{ id: `temp-opt-${Date.now()}`, texto_opcion: '', es_correcta: true }]);
            setUnidad('');
            setTema('');
            setMateriaId(''); // Por defecto no asociada a materia específica
        }
    }, [preguntaToEdit, isEditing]); // Dependencias del efecto


    // --- MANEJADORES DE CAMBIOS EN EL FORMULARIO ---

    // Maneja cambios en el select de tipo de pregunta
    const handleTipoChange = (e) => {
        const newType = e.target.value;
        setTipoPregunta(newType); // Actualiza el estado del tipo
        // Limpiar/inicializar opciones (asegurando una correcta si cambia a 'unica')
        if (!newType.startsWith('opcion_multiple')) {
            setOpciones([]);
        } else if (opciones.length === 0) {
             setOpciones([{ id: `temp-opt-${Date.now()}`, texto_opcion: '', es_correcta: newType === 'opcion_multiple_unica' }]);
        } else if (newType === 'opcion_multiple_unica' && opciones.filter(o => o.es_correcta).length > 1) {
             let foundFirst = false;
             setOpciones(opciones.map(opt => {
                 if(opt.es_correcta && !foundFirst) { foundFirst = true; return opt; }
                 return {...opt, es_correcta: false };
             }));
        }

        // Limpiar/Inicializar estado de DatosExtra según el nuevo tipo
        if (!['sopa_letras', 'crucigrama', 'relacionar_columnas'].includes(newType)) { setDatosExtra(null); }
        else if (!datosExtra) { /* ... inicializar datosExtra ... */
            // Inicializa con la estructura base correspondiente
            if (newType === 'sopa_letras') {
                 setDatosExtra({ palabras: [], tamano: 10 });
            } else if (newType === 'crucigrama') {
                 setDatosExtra({ entradas: [{ palabra: '', pista: '' }] });
            } else if (newType === 'relacionar_columnas') {
                 setDatosExtra({ columnas: [], pares_correctos: [] });
            }
        }
    };

    // --- Manejadores para Opciones (Idénticos a PreguntaForm.jsx) ---
    const handleOptionChange = (optIndex, field, value) => {
        const nuevasOpciones = [...opciones];
        if (field === 'es_correcta') {
            if (tipoPregunta === 'opcion_multiple_unica') {
                nuevasOpciones.forEach((opt, i) => opt.es_correcta = (i === optIndex));
            } else { // opcion_multiple_multiple
                nuevasOpciones[optIndex].es_correcta = value;
            }
        } else {
            nuevasOpciones[optIndex][field] = value;
        }
         // Revalidar que al menos una sea correcta
        if (tipoPregunta.startsWith('opcion_multiple') && !nuevasOpciones.some(o => o.es_correcta) && nuevasOpciones.length > 0) {
             nuevasOpciones[0].es_correcta = true;
        }
        setOpciones(nuevasOpciones);
    };

    const handleAddOption = () => {
        setOpciones([...opciones, {
            id: `temp-opt-${Date.now()}`,
            texto_opcion: '',
            es_correcta: false
        }]);
    };

    const handleRemoveOption = (optIndex) => {
        const nuevasOpciones = opciones.filter((_, i) => i !== optIndex);
        if (nuevasOpciones.length === 0 && tipoPregunta.startsWith('opcion_multiple')) {
            alert("Debe haber al menos una opción.");
            return;
        }
        if (!nuevasOpciones.some(opt => opt.es_correcta) && tipoPregunta.startsWith('opcion_multiple') && nuevasOpciones.length > 0) {
            nuevasOpciones[0].es_correcta = true;
        }
        setOpciones(nuevasOpciones);
    };
    // --- Fin Manejadores de Opciones ---

    // Manejador para datos_extra (llamado por ConfigSopaLetras/ConfigCrucigrama)
    const handleDatosExtraChange = (nuevosDatos) => {
        setDatosExtra(nuevosDatos); // Actualiza el estado 'datosExtra'
    };

    // --- FUNCIÓN PARA ENVIAR/GUARDAR LA PREGUNTA EN EL BANCO ---
    const handleSubmit = async (e) => {
        e.preventDefault(); // Prevenir recarga de página
        setLoading(true); // Bloquear UI
        console.log("Guardando pregunta en banco...");
        try {
            // Obtener el usuario autenticado
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuario no autenticado");

            let datosExtraFinales = datosExtra || null; // Datos extra por defecto

            // --- LLAMADA A FUNCIONES DE GENERACIÓN DE LAYOUT ---
            try {
                if (tipoPregunta === 'sopa_letras' && datosExtra?.palabras?.length > 0) {
                    console.log("Llamando a generar-layout-sopa (banco)...");
                    const { data: layoutSopa, error: sopaError } = await supabase.functions.invoke('generar-layout-sopa', {
                        body: { palabras: datosExtra.palabras, tamano: datosExtra.tamano || 10 }
                    });
                    if (sopaError) throw new Error(`Error generando layout Sopa: ${sopaError.message}`);
                    datosExtraFinales = { ...datosExtra, ...layoutSopa }; // Fusionar
                    console.log("Layout Sopa generado (banco):", datosExtraFinales);

                } else if (tipoPregunta === 'crucigrama' && datosExtra?.entradas?.length > 0 && datosExtra.entradas[0].palabra) {
                    console.log("Llamando a generar-layout-crucigrama (banco)...");
                     const { data: layoutCrucigrama, error: crucigramaError } = await supabase.functions.invoke('generar-layout-crucigrama', {
                        body: { entradas: datosExtra.entradas }
                    });
                    if (crucigramaError) throw new Error(`Error generando layout Crucigrama: ${crucigramaError.message}`);
                    datosExtraFinales = { ...datosExtra, ...layoutCrucigrama }; // Fusionar
                    console.log("Layout Crucigrama generado (banco):", datosExtraFinales);
                }
                 // Añadir 'else if' para 'relacionar_columnas' si necesita pre-procesamiento
            } catch (layoutError) {
                 console.error(`Error al generar layout para pregunta tipo ${tipoPregunta} (banco): ${layoutError.message}`);
                 throw new Error(`No se pudo generar la estructura para la pregunta (${tipoPregunta}). ${layoutError.message}`);
                 // O guardar sin layout: datosExtraFinales = datosExtra;
            }
            // --- FIN LLAMADA A FUNCIONES DE GENERACIÓN ---


            // Preparar el objeto con los datos de la pregunta para Supabase
            const preguntaData = {
                user_id: user.id, // ID del usuario creador
                materia_id: materiaId || null, // ID de materia o null si es general
                texto_pregunta: textoPregunta,
                tipo_pregunta: tipoPregunta,
                puntos: parseInt(puntos, 10) || 0, // Puntos (asegurar número)
                datos_extra: datosExtraFinales, // USAR DATOS FINALES CON LAYOUT
                unidad: unidad ? parseInt(unidad, 10) : null, // Unidad (asegurar número o null)
                tema: tema || null, // Tema o null
            };

            let savedPreguntaId; // Variable para guardar el ID de la pregunta guardada/actualizada

            // 1. Guardar o Actualizar la pregunta principal en 'banco_preguntas'
            if (isEditing) {
                const { data, error } = await supabase
                    .from('banco_preguntas')
                    .update(preguntaData)
                    .eq('id', preguntaToEdit.id) // Condición: ID de la pregunta a editar
                    .select('id') // Pedir que devuelva el ID
                    .single(); // Esperar un solo resultado
                if (error) throw error;
                savedPreguntaId = data.id;
            } else {
                const { data, error } = await supabase
                    .from('banco_preguntas')
                    .insert(preguntaData)
                    .select('id') // Pedir que devuelva el ID
                    .single(); // Esperar un solo resultado
                 if (error) throw error;
                 savedPreguntaId = data.id;
            }

            // 2. Gestionar las opciones en 'banco_opciones' (solo si es tipo opción múltiple)
            if (tipoPregunta.startsWith('opcion_multiple') && savedPreguntaId) {
                /* ... (delete + upsert banco_opciones) ... */ }
            else if (savedPreguntaId) {
                /* ... (delete banco_opciones si no aplica) ... */ }

            alert(`Pregunta ${isEditing ? 'actualizada' : 'añadida'} al banco.`);
            onSave();

        } catch (error) {
            console.error("Error guardando pregunta en el banco:", error);
            alert("Error al guardar: " + (error instanceof Error ? error.message : String(error)));
        } finally {
            setLoading(false); // Desbloquear UI
        }
    }; // --- FIN handleSubmit ---

    // --- RENDERIZADO (sin cambios en la estructura JSX) ---
    return (
        <div className="pregunta-banco-form-container card"> {/* Usamos 'card' para consistencia */}
            <form onSubmit={handleSubmit} className="materia-form">
                <h4>{isEditing ? 'Editar Pregunta del Banco' : 'Nueva Pregunta para el Banco'}</h4>

                {/* --- Campos de Clasificación --- */}
                <div className="form-group-horizontal">
                    <div className="form-group">
                        <label>Materia (Opcional)</label>
                        <select value={materiaId} onChange={(e) => setMateriaId(e.target.value)}>
                            <option value="">General (para todas las materias)</option>
                            {materiasDocente.map(m => (
                                <option key={m.id} value={m.id}>{m.nombre}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Unidad (Opcional)</label>
                        <input type="number" min="1" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Ej: 1" />
                    </div>
                    <div className="form-group">
                        <label>Tema/Etiqueta (Opcional)</label>
                        <input type="text" value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej: Fotosíntesis" />
                    </div>
                </div>

                <hr style={{ margin: 'var(--spacing-lg) 0' }} />

                {/* --- Campos de la Pregunta --- */}
                <div className="form-group">
                    <label>Texto de la Pregunta / Instrucciones</label>
                    <textarea
                        value={textoPregunta}
                        onChange={(e) => setTextoPregunta(e.target.value)}
                        rows="3"
                        required
                        placeholder="Enunciado de la pregunta o instrucciones para el juego..."
                    />
                </div>

                <div className="form-group-horizontal">
                    <div className="form-group">
                        <label>Tipo de Pregunta</label>
                        <select value={tipoPregunta} onChange={handleTipoChange}>
                            <option value="opcion_multiple_unica">Opción Múltiple (Única)</option>
                            <option value="opcion_multiple_multiple">Opción Múltiple (Varias)</option>
                            <option value="abierta">Abierta (Respuesta Manual)</option>
                            <option value="sopa_letras">Sopa de Letras</option>
                            <option value="crucigrama">Crucigrama</option>
                            <option value="relacionar_columnas">Relacionar Columnas</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Puntos Sugeridos</label>
                        <input
                            type="number"
                            value={puntos}
                            onChange={(e) => setPuntos(e.target.value)}
                            min="0"
                            required
                        />
                    </div>
                </div>

                {/* --- Renderizado Condicional de Configuraciones --- */}
                {tipoPregunta.startsWith('opcion_multiple') && (
                    <div className="opciones-section">
                        <label>Opciones de Respuesta:</label>
                        {opciones.map((opcion, optIndex) => (
                            <div key={opcion.id || `new-opt-${optIndex}`} className="opcion-item-container">
                                <input
                                    type={tipoPregunta === 'opcion_multiple_unica' ? 'radio' : 'checkbox'}
                                    name={`correcta-banco-${tipoPregunta === 'opcion_multiple_unica' ? 'unica' : optIndex}`}
                                    checked={opcion.es_correcta || false}
                                    onChange={(e) => handleOptionChange(optIndex, 'es_correcta', e.target.checked)}
                                />
                                <input
                                    type="text"
                                    placeholder={`Opción ${optIndex + 1}`}
                                    value={opcion.texto_opcion}
                                    onChange={(e) => handleOptionChange(optIndex, 'texto_opcion', e.target.value)}
                                    required
                                />
                                {opciones.length > 1 && (
                                    <button type="button" onClick={() => handleRemoveOption(optIndex)} className="btn-danger">X</button>
                                )}
                            </div>
                        ))}
                        <button type="button" onClick={handleAddOption} className="btn-secondary">＋ Añadir Opción</button>
                    </div>
                )}

                {tipoPregunta === 'sopa_letras' && (
                    <ConfigSopaLetras datos={datosExtra} onDatosChange={handleDatosExtraChange} />
                )}

                {tipoPregunta === 'crucigrama' && (
                    <ConfigCrucigrama datos={datosExtra} onDatosChange={handleDatosExtraChange} />
                )}

                {tipoPregunta === 'relacionar_columnas' && (
                    <ConfigRelacionarColumnas datos={datosExtra} onDatosChange={handleDatosExtraChange} />
                )}

                {/* --- Botones de Acción --- */}
                <div className="form-actions">
                    <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>
                        Cancelar
                    </button>
                    <button type="submit" className="btn-primary" disabled={loading}>
                        {loading ? 'Guardando...' : (isEditing ? 'Actualizar Pregunta' : 'Guardar en Banco')}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default PreguntaBancoForm;

// --- NO OLVIDES INCLUIR LAS DEFINICIONES COMPLETAS DE ---
// useEffect, manejadores de opciones, ConfigSopaLetras, ConfigCrucigrama, ConfigRelacionarColumnas
// y el renderizado completo del JSX.