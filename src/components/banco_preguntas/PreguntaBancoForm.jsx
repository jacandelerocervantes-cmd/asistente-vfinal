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
                    placeholder="REACT\nJAVASCRIPT\nCOMPONENTE..." // Placeholder de ejemplo
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
        if (!['sopa_letras', 'crucigrama'].includes(newType)) { setDatosExtra(null); }
        else if (!datosExtra) { /* ... inicializar datosExtra ... */
            // Inicializa con la estructura base correspondiente
            if (newType === 'sopa_letras') {
                 setDatosExtra({ palabras: [], tamano: 10 });
            } else if (newType === 'crucigrama') {
                 setDatosExtra({ entradas: [{ palabra: '', pista: '' }] });
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
        setLoading(true); // Activar indicador de carga
        try {
            // Obtener el usuario autenticado
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuario no autenticado");

            // Preparar el objeto con los datos de la pregunta para Supabase
            const preguntaData = {
                user_id: user.id, // ID del usuario creador
                materia_id: materiaId || null, // ID de materia o null si es general
                texto_pregunta: textoPregunta,
                tipo_pregunta: tipoPregunta,
                puntos: parseInt(puntos, 10) || 0, // Puntos (asegurar número)
                datos_extra: datosExtra, // Datos JSON para juegos
                unidad: unidad ? parseInt(unidad, 10) : null, // Unidad (asegurar número o null)
                tema: tema || null, // Tema o null
            };

            let savedPreguntaId; // Variable para guardar el ID de la pregunta guardada/actualizada

            // 1. Guardar o Actualizar la pregunta principal en 'banco_preguntas'
            if (isEditing) {
                // Modo Edición: UPDATE
                console.log("Actualizando pregunta en banco:", preguntaData);
                const { data, error } = await supabase
                    .from('banco_preguntas')
                    .update(preguntaData)
                    .eq('id', preguntaToEdit.id) // Condición: ID de la pregunta a editar
                    .select('id') // Pedir que devuelva el ID
                    .single(); // Esperar un solo resultado
                if (error) throw error; // Lanzar error si falla
                savedPreguntaId = data.id; // Guardar el ID
                console.log("Pregunta actualizada con ID:", savedPreguntaId);
            } else {
                // Modo Creación: INSERT
                console.log("Insertando nueva pregunta en banco:", preguntaData);
                const { data, error } = await supabase
                    .from('banco_preguntas')
                    .insert(preguntaData)
                    .select('id') // Pedir que devuelva el ID
                    .single(); // Esperar un solo resultado
                 if (error) throw error; // Lanzar error si falla
                 savedPreguntaId = data.id; // Guardar el ID
                 console.log("Nueva pregunta insertada con ID:", savedPreguntaId);
            }

            // 2. Gestionar las opciones en 'banco_opciones' (solo si es tipo opción múltiple)
            if (tipoPregunta.startsWith('opcion_multiple') && savedPreguntaId) {
                console.log(`Gestionando opciones para pregunta ${savedPreguntaId}...`);
                // Obtener los IDs numéricos de las opciones que están actualmente en el estado 'opciones'
                const opcionesActualesIds = opciones
                    .map(opt => opt.id)
                    .filter(id => typeof id === 'number'); // Solo IDs reales de la BD

                // Borrar opciones de la BD que ya NO estén en el estado 'opciones' actual
                console.log(`Borrando opciones antiguas no presentes en [${opcionesActualesIds.join(', ')}]`);
                const { error: deleteError } = await supabase
                    .from('banco_opciones')
                    .delete()
                    .eq('banco_pregunta_id', savedPreguntaId) // Borrar solo de esta pregunta
                    .not('id', 'in', `(${opcionesActualesIds.join(',') || 0})`); // No borrar las que sí están (usa 0 si el array está vacío)
                if (deleteError) console.warn("Error borrando opciones antiguas:", deleteError.message); // Advertir si falla el borrado

                // Preparar los datos de las opciones actuales para Upsert (Insertar o Actualizar)
                 const opcionesParaUpsert = opciones.map((opt, index) => ({
                    id: (typeof opt.id === 'number' ? opt.id : undefined), // Pasar 'id' solo si es numérico (existente)
                    banco_pregunta_id: savedPreguntaId, // ID de la pregunta padre
                    user_id: user.id, // ID del usuario creador
                    texto_opcion: opt.texto_opcion,
                    es_correcta: opt.es_correcta || false, // Asegurar booleano
                    orden: index // Guardar el orden actual
                }));

                // Realizar el Upsert si hay opciones para guardar/actualizar
                if (opcionesParaUpsert.length > 0) {
                    console.log(`Realizando upsert para ${opcionesParaUpsert.length} opciones.`);
                    const { error: upsertError } = await supabase
                        .from('banco_opciones')
                        .upsert(opcionesParaUpsert);
                     if (upsertError) throw upsertError; // Lanzar error si falla el upsert
                } else {
                     console.log("No hay opciones para hacer upsert.");
                }
            }
            // Si NO es de opción múltiple, asegurarse de borrar cualquier opción huérfana que pudiera existir
             else if (savedPreguntaId) {
                  console.log(`Tipo no es opción múltiple, asegurando que no haya opciones huérfanas para pregunta ${savedPreguntaId}.`);
                  const { error: deleteOrphanError } = await supabase
                    .from('banco_opciones')
                    .delete()
                    .eq('banco_pregunta_id', savedPreguntaId);
                 if (deleteOrphanError) console.warn("Error borrando opciones huérfanas:", deleteOrphanError.message);
             }


            // 3. Éxito: Notificar y llamar a onSave
            alert(`Pregunta ${isEditing ? 'actualizada' : 'añadida'} exitosamente en el banco.`);
            onSave(); // Llama a la función del componente padre (BancoPreguntasPanel)

        } catch (error) {
            // Manejo de errores
            console.error("Error guardando pregunta en el banco:", error);
            alert("Error al guardar la pregunta: " + (error instanceof Error ? error.message : String(error)));
        } finally {
            setLoading(false); // Desactivar indicador de carga
        }
    };


    // --- RENDERIZADO DEL FORMULARIO JSX ---
    return (
         <div className="pregunta-banco-form-container card"> {/* Contenedor principal */}
             <form onSubmit={handleSubmit} className="materia-form"> {/* Reutilizar estilos de materia-form */}
                 <h3>{isEditing ? 'Editar Pregunta del Banco' : 'Añadir Nueva Pregunta al Banco'}</h3>

                 {/* --- Sección de Clasificación (Materia, Unidad, Tema) --- */}
                 <div className="form-group-horizontal"> {/* Contenedor horizontal */}
                     {/* Selector de Materia */}
                     <div className="form-group">
                        <label htmlFor="banco_materia">Asociar a Materia (Opcional)</label>
                        <select id="banco_materia" value={materiaId} onChange={(e) => setMateriaId(e.target.value)}>
                            <option value="">-- General (Sin materia específica) --</option>
                            {/* Mapear las materias del docente para las opciones */}
                            {materiasDocente.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                        </select>
                    </div>
                     {/* Input para Unidad */}
                     <div className="form-group">
                         <label htmlFor="banco_unidad">Unidad Temática (Opcional)</label>
                         <input id="banco_unidad" type="number" min="1" value={unidad} onChange={(e) => setUnidad(e.target.value)} />
                     </div>
                     {/* Input para Tema */}
                     <div className="form-group">
                         <label htmlFor="banco_tema">Tema / Palabra Clave (Opcional)</label>
                         <input id="banco_tema" type="text" value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej: React Hooks, Derivadas"/>
                     </div>
                 </div>

                 {/* Separador visual */}
                 <hr style={{ margin: 'var(--spacing-lg) 0' }} />

                 {/* --- Sección de Definición de la Pregunta --- */}
                 {/* Textarea para el Texto/Enunciado */}
                 <div className="form-group">
                     <label>Texto de la Pregunta / Instrucciones</label>
                     <textarea
                         name="texto_pregunta" // Importante para handleInputChange si se reutilizara
                         value={textoPregunta}
                         onChange={(e) => setTextoPregunta(e.target.value)}
                         rows={4} // Un poco más alta
                         required
                         placeholder={ // Placeholder dinámico
                            tipoPregunta === 'sopa_letras' ? "Instrucciones para la Sopa de Letras..." :
                            tipoPregunta === 'crucigrama' ? "Instrucciones para el Crucigrama..." :
                            "Escribe aquí el enunciado de la pregunta..."
                         }
                     />
                 </div>

                 {/* Contenedor horizontal para Tipo y Puntos */}
                 <div className="form-group-horizontal">
                     {/* Selector de Tipo de Pregunta */}
                     <div className="form-group">
                         <label>Tipo de Pregunta</label>
                         <select name="tipo_pregunta" value={tipoPregunta} onChange={handleTipoChange}>
                             <option value="opcion_multiple_unica">Opción Múltiple (Única)</option>
                             <option value="opcion_multiple_multiple">Opción Múltiple (Varias)</option>
                             <option value="abierta">Abierta (Respuesta Manual)</option>
                             <option value="sopa_letras">Sopa de Letras</option>
                             <option value="crucigrama">Crucigrama</option>
                             {/* Añadir más tipos aquí si se implementan */}
                         </select>
                     </div>
                      {/* Input para Puntos Sugeridos */}
                      <div className="form-group">
                         <label>Puntos Sugeridos</label>
                         <input
                             type="number"
                             name="puntos"
                             value={puntos}
                             onChange={(e) => setPuntos(e.target.value)}
                             min="0"
                             required
                         />
                     </div>
                 </div>

                 {/* --- Renderizado Condicional de Configuraciones --- */}

                 {/* Sección Opciones (si es opción múltiple) */}
                 {tipoPregunta.startsWith('opcion_multiple') && (
                      <div className="opciones-section"> {/* Usar clase CSS */}
                          <label>Opciones de Respuesta:</label>
                          {/* Mapeo para renderizar cada opción */}
                          {opciones.map((opcion, optIndex) => (
                              <div key={opcion.id || `new-opt-${optIndex}`} className="opcion-item-container"> {/* Usar clase CSS */}
                                  <input
                                      type={tipoPregunta === 'opcion_multiple_unica' ? 'radio' : 'checkbox'}
                                      name={`correcta-banco-${preguntaToEdit?.id || 'new'}-${tipoPregunta === 'opcion_multiple_unica' ? 'unica' : optIndex}`}
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
                                  {/* Mostrar botón eliminar solo si hay más de una opción */}
                                  {opciones.length > 1 && (
                                      <button type="button" onClick={() => handleRemoveOption(optIndex)} className="btn-danger">X</button>
                                  )}
                              </div>
                          ))}
                          {/* Botón para añadir nueva opción */}
                          <button type="button" onClick={handleAddOption} className="btn-secondary">＋ Añadir Opción</button>
                      </div>
                 )}

                 {/* Sección Configuración Sopa de Letras */}
                 {tipoPregunta === 'sopa_letras' && (
                     <ConfigSopaLetras datos={datosExtra} onDatosChange={handleDatosExtraChange} />
                 )}

                 {/* Sección Configuración Crucigrama */}
                 {tipoPregunta === 'crucigrama' && (
                     <ConfigCrucigrama datos={datosExtra} onDatosChange={handleDatosExtraChange} />
                 )}

                 {/* --- Botones de Acción del Formulario --- */}
                 <div className="form-actions"> {/* Usar clase CSS */}
                    {/* Botón Cancelar */}
                    <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>Cancelar</button>
                    {/* Botón Guardar/Actualizar */}
                    <button type="submit" className="btn-primary" disabled={loading}>
                        {loading ? 'Guardando...' : (isEditing ? 'Actualizar Pregunta en Banco' : 'Guardar Pregunta en Banco')}
                    </button>
                 </div>

             </form> {/* Fin del form */}
         </div> // Fin del contenedor principal
    );
};

export default PreguntaBancoForm; // Exportar el componente