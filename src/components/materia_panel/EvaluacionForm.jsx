// src/components/materia_panel/EvaluacionForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import PreguntaForm from './PreguntaForm';
import BancoPreguntasPanel from '../banco_preguntas/BancoPreguntasPanel'; // <-- 1. Importar el panel del banco
import GenerarEvaluacionModal from './GenerarEvaluacionModal';
import './EvaluacionForm.css';

// Estilos pueden ser similares a ActividadForm/MateriaForm

const EvaluacionForm = ({ materia, evaluacionToEdit, onSave, onCancel }) => {
    const [titulo, setTitulo] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [unidad, setUnidad] = useState(1);
    const [fechaApertura, setFechaApertura] = useState('');
    const [fechaCierre, setFechaCierre] = useState('');
    const [tiempoLimite, setTiempoLimite] = useState(''); // En minutos
    const [estado, setEstado] = useState('borrador');
    const [preguntas, setPreguntas] = useState([]); // Almacenará las preguntas de esta evaluación
    const [loading, setLoading] = useState(false);
    const [loadingPreguntas, setLoadingPreguntas] = useState(false);
    const [showGenerarModal, setShowGenerarModal] = useState(false);
    const [showBancoModal, setShowBancoModal] = useState(false); // <-- 2. Estado para el modal del banco
    const isEditing = Boolean(evaluacionToEdit);

    // Cargar datos de la evaluación si estamos editando
    useEffect(() => {
        if (isEditing && evaluacionToEdit) {
            setTitulo(evaluacionToEdit.titulo);
            setDescripcion(evaluacionToEdit.descripcion || '');
            setUnidad(evaluacionToEdit.unidad || 1);
            setFechaApertura(evaluacionToEdit.fecha_apertura ? evaluacionToEdit.fecha_apertura.substring(0, 16) : ''); // Formato para datetime-local
            setFechaCierre(evaluacionToEdit.fecha_cierre ? evaluacionToEdit.fecha_cierre.substring(0, 16) : '');
            setTiempoLimite(evaluacionToEdit.tiempo_limite || '');
            setEstado(evaluacionToEdit.estado || 'borrador');
            // Cargar las preguntas asociadas
            fetchPreguntas(evaluacionToEdit.id);
        } else {
            // Resetear para nueva evaluación
            setTitulo('');
            setDescripcion('');
            setUnidad(1);
            setFechaApertura('');
            setFechaCierre('');
            setTiempoLimite('');
            setEstado('borrador');
            setPreguntas([]);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [evaluacionToEdit, isEditing]);

    const fetchPreguntas = async (evaluacionId) => {
        setLoadingPreguntas(true);
        try {
            const { data, error } = await supabase
                .from('preguntas')
                // Seleccionar preguntas y sus opciones anidadas
                .select(`
                    *,
                    opciones ( * )
                `)
                .eq('evaluacion_id', evaluacionId)
                .order('orden', { ascending: true })
                .order('created_at', { foreignTable: 'opciones', ascending: true }); // Ordenar opciones también

            if (error) throw error;
            setPreguntas(data || []);
        } catch (error) {
            console.error("Error cargando preguntas:", error);
            alert("No se pudieron cargar las preguntas asociadas.");
        } finally {
            setLoadingPreguntas(false);
        }
    };

    // --- Manejadores para Preguntas ---
    const handleAddPregunta = () => {
        // Calcular puntos sugeridos para mantener total cerca de 100
        const preguntasVisibles = preguntas.filter(p => !p.toBeDeleted);
        const puntosSugeridos = preguntasVisibles.length > 0
           ? Math.max(1, Math.round(100 / (preguntasVisibles.length + 1)))
           : 100;

        setPreguntas([...preguntas, {
            // Valores iniciales para una nueva pregunta
            id: `temp-${Date.now()}`, // ID temporal para el key en React
            texto_pregunta: '',
            tipo_pregunta: 'opcion_multiple_unica', // Sugerir puntos
            puntos: puntosSugeridos,
            opciones: [{ id: `temp-opt-${Date.now()}`, texto_opcion: '', es_correcta: true }], // Empezar con una opción correcta
            orden: preguntas.filter(p => !p.toBeDeleted).length, // Orden basado en visibles
            isNew: true // Flag para indicar que es nueva
        }]);
    };

    const handleUpdatePregunta = (updatedPregunta) => {
        setPreguntas(preguntas.map(p => p.id === updatedPregunta.id ? updatedPregunta : p));
    };

    const handleDeletePregunta = (preguntaId) => {
         // Si es una pregunta ya guardada (ID numérico), la marcamos para borrar en el backend al guardar la evaluación
         // Si es una pregunta nueva (ID temporal), simplemente la quitamos del estado
         if (typeof preguntaId === 'string' && preguntaId.startsWith('temp-')) {
            setPreguntas(preguntas.filter(p => p.id !== preguntaId));
         } else {
             if(window.confirm("¿Eliminar esta pregunta de la base de datos al guardar?")) {
                 // Marcar para borrado en el backend
                 setPreguntas(preguntas.map(p => p.id === preguntaId ? { ...p, toBeDeleted: true } : p));
             }
         }
    };

    // --- NUEVA FUNCIÓN PARA RECIBIR PREGUNTAS DE IA ---
    const handlePreguntasGeneradas = (preguntasGeneradas) => {
        // Opción 2: Preguntar al usuario
        if (preguntas.filter(p => !p.toBeDeleted).length > 0 && !window.confirm("Ya tienes preguntas definidas. ¿Deseas reemplazar las preguntas actuales con las generadas por la IA?")) {
             // Añadir al final si el usuario cancela el reemplazo
            const nuevasPreguntasOrdenadas = preguntasGeneradas.map((p, index) => ({
                ...p,
                orden: preguntas.filter(p => !p.toBeDeleted).length + index // Reajustar orden
            }));
             setPreguntas(prev => [...prev.filter(p => !p.toBeDeleted), ...nuevasPreguntasOrdenadas]); // Añadir al final de las existentes no marcadas para borrar
        } else {
             // Reemplazar (o si no había preguntas antes)
             setPreguntas(preguntasGeneradas);
        }
    };
    // --- FIN NUEVA FUNCIÓN ---

    // --- 4. NUEVA FUNCIÓN: Manejar la selección de una pregunta del banco ---
    const handleSeleccionarPreguntaBanco = (preguntaSeleccionada) => {
        // Asignar orden correcto basado en las preguntas visibles actuales
        const ordenNuevo = preguntas.filter(p => !p.toBeDeleted).length;
        const preguntaConOrden = { ...preguntaSeleccionada, orden: ordenNuevo };

        // Añadir la pregunta seleccionada al estado 'preguntas'
        setPreguntas(prev => [...prev, preguntaConOrden]);

        // Cerrar el modal del banco
        setShowBancoModal(false);
    };
    // --- FIN NUEVA FUNCIÓN ---




    // --- Guardar Evaluación y sus Preguntas ---
    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            const evaluacionData = {
                materia_id: materia.id,
                user_id: user.id,
                titulo,
                descripcion,
                unidad: parseInt(unidad, 10),
                fecha_apertura: fechaApertura || null,
                fecha_cierre: fechaCierre || null,
                tiempo_limite: tiempoLimite ? parseInt(tiempoLimite, 10) : null,
                estado,
            };

            let savedEvaluacion;

            // 1. Guardar/Actualizar la Evaluación Principal
            if (isEditing) {
                const { data, error } = await supabase
                    .from('evaluaciones')
                    .update(evaluacionData)
                    .eq('id', evaluacionToEdit.id)
                    .select()
                    .single();
                if (error) throw error;
                savedEvaluacion = data;
            } else {
                const { data, error } = await supabase
                    .from('evaluaciones')
                    .insert(evaluacionData)
                    .select()
                    .single();
                if (error) throw error;
                savedEvaluacion = data;
            }

            // 2. Gestionar Preguntas (MODIFICADO para reasignar orden)
            const preguntasParaGuardar = preguntas.filter(p => !p.toBeDeleted); // Solo procesar las visibles
            // Obtener IDs originales si estamos editando (para saber qué borrar)
            const preguntasOriginalesIds = isEditing ? (await supabase.from('preguntas').select('id').eq('evaluacion_id', evaluacionToEdit.id)).data?.map(p => p.id) || [] : [];
            const idsPreguntasActuales = new Set(preguntasParaGuardar.filter(p => typeof p.id === 'number').map(p => p.id)); // IDs de BD en el estado actual

            // Borrar preguntas que ya no están (las marcadas para borrar o las que se quitaron de la lista)
            const idsParaBorrar = preguntasOriginalesIds.filter(id => !idsPreguntasActuales.has(id));
             if (idsParaBorrar.length > 0) {
                console.log("Borrando preguntas:", idsParaBorrar);
                await supabase.from('preguntas').delete().in('id', idsParaBorrar);
            }


             // Upsert (Insertar/Actualizar) preguntas actuales
            for (const [index, pregunta] of preguntasParaGuardar.entries()) {
                const preguntaData = {
                    evaluacion_id: savedEvaluacion.id,
                    user_id: user.id,
                    texto_pregunta: pregunta.texto_pregunta,
                    tipo_pregunta: pregunta.tipo_pregunta,
                    puntos: pregunta.puntos || 0,
                    orden: index, // Reasignar orden basado en la posición actual
                    datos_extra: pregunta.datos_extra || null,
                };
                let savedPreguntaId;

                if (pregunta.isNew) { // Insertar
                    const { data: newP, error: insertPError } = await supabase
                    .from('preguntas')
                    .insert(preguntaData)
                    .select('id')
                    .single();
                    if (insertPError) throw insertPError;
                    savedPreguntaId = newP.id;
                } else if (typeof pregunta.id === 'number') { // Actualizar
                    const { error: updatePError } = await supabase
                        .from('preguntas')
                        .update(preguntaData)
                        .eq('id', pregunta.id);
                    if (updatePError) throw updatePError;
                    savedPreguntaId = pregunta.id;
                }


                // 3. Gestionar Opciones (solo para tipos que las usan)
                if (pregunta.tipo_pregunta.startsWith('opcion_multiple') && savedPreguntaId) {
                    // Obtener IDs de opciones existentes en el estado que no son nuevas
                    const opcionesExistentesIds = (pregunta.opciones || []).map(opt => opt.id).filter(id => typeof id === 'number');

                    // Borrar opciones que ya no están en el estado
                    if (isEditing) { // Solo tiene sentido borrar si estamos editando
                        const { error: deleteOptError } = await supabase
                            .from('opciones')
                            .delete()
                            .eq('pregunta_id', savedPreguntaId)
                            .not('id', 'in', `(${opcionesExistentesIds.join(',') || 0})`);
                        if (deleteOptError) console.warn(`Error borrando opciones antiguas para pregunta ${savedPreguntaId}:`, deleteOptError);
                    }

                    // Upsert (Insertar o Actualizar) opciones del estado
                    const opcionesParaUpsert = (pregunta.opciones || []).map((opt, index) => ({
                        id: (typeof opt.id === 'number' ? opt.id : undefined), // Solo pasa ID si es numérico (existente)
                        pregunta_id: savedPreguntaId,
                        user_id: user.id,
                        texto_opcion: opt.texto_opcion,
                        es_correcta: opt.es_correcta || false,
                        orden: index
                    }));

                    if(opcionesParaUpsert.length > 0) {
                        const { error: upsertOptError } = await supabase
                            .from('opciones')
                            .upsert(opcionesParaUpsert);
                        if (upsertOptError) throw upsertOptError;
                    }
                } else if (savedPreguntaId) {
                    // Si el tipo de pregunta cambió y ya no usa opciones, borrarlas
                    const { error: deleteOptError } = await supabase.from('opciones').delete().eq('pregunta_id', savedPreguntaId);
                    if (deleteOptError) console.warn(`Error limpiando opciones para pregunta ${savedPreguntaId}:`, deleteOptError);
                }
            } // Fin del bucle de preguntas

            alert(`Evaluación "${savedEvaluacion.titulo}" ${isEditing ? 'actualizada' : 'creada'} exitosamente.`);
            onSave();

        } catch (error) {
            console.error("Error guardando evaluación:", error);
            alert("Error al guardar la evaluación: " + error.message);
        } finally {
            setLoading(false);
        }
    };


    // Renderizado del Formulario
    return (
        <div className="evaluacion-form-container">
            {/* --- RENDERIZAR MODAL --- */}
            <GenerarEvaluacionModal
                show={showGenerarModal}
                onClose={() => setShowGenerarModal(false)}
                onGenerar={handlePreguntasGeneradas}
            />
            <form onSubmit={handleSubmit} className="materia-form">
                <h3>{isEditing ? 'Editar Evaluación' : 'Nueva Evaluación'}</h3>

                {/* Campos de la Evaluación */}
                <div className="form-group">
                    <label htmlFor="titulo">Título</label>
                    <input id="titulo" type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
                </div>
                <div className="form-group">
                    <label htmlFor="descripcion">Descripción (Opcional)</label>
                    <textarea id="descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
                </div>
                 <div className="form-group-horizontal">
                     <div className="form-group">
                        <label htmlFor="unidad_evaluacion">Unidad</label>
                        <select id="unidad_evaluacion" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
                             {Array.from({ length: materia?.unidades || 1 }, (_, i) => i + 1).map(u => (
                                <option key={u} value={u}>Unidad {u}</option>
                            ))}
                        </select>
                    </div>
                     <div className="form-group">
                        <label htmlFor="estado">Estado</label>
                        <select id="estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
                            <option value="borrador">Borrador</option>
                            <option value="publicado">Publicado</option>
                            <option value="cerrado">Cerrado</option>
                        </select>
                    </div>
                 </div>
                 <div className="form-group-horizontal">
                    <div className="form-group">
                        <label htmlFor="fechaApertura">Fecha Apertura (Opcional)</label>
                        <input id="fechaApertura" type="datetime-local" value={fechaApertura} onChange={(e) => setFechaApertura(e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="fechaCierre">Fecha Cierre (Opcional)</label>
                        <input id="fechaCierre" type="datetime-local" value={fechaCierre} onChange={(e) => setFechaCierre(e.target.value)} />
                    </div>
                     <div className="form-group">
                        <label htmlFor="tiempoLimite">Límite Tiempo (min, opcional)</label>
                        <input id="tiempoLimite" type="number" min="1" value={tiempoLimite} onChange={(e) => setTiempoLimite(e.target.value)} />
                    </div>
                 </div>


                {/* Sección de Preguntas */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--spacing-xl)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--spacing-sm)', marginBottom: 'var(--spacing-lg)'}}>
                    <h4>Preguntas</h4>
                    <div style={{ display: 'flex', gap: 'var(--spacing-md)'}}> {/* Contenedor para botones */}
                        {/* Botón Generar IA */}
                        <button
                            type="button"
                            onClick={() => setShowGenerarModal(true)}
                            className="btn-secondary" // O el estilo que prefieras
                            disabled={loading || loadingPreguntas}
                            title="Generar preguntas automáticamente usando Inteligencia Artificial"
                        >
                            ✨ Crear con IA
                        </button>
                         {/* --- 3. Botón para abrir el modal del Banco --- */}
                        <button type="button" onClick={() => setShowBancoModal(true)} className="btn-secondary" disabled={loading || loadingPreguntas}>
                            🏦 Añadir desde Banco
                        </button>
                    </div>
                </div>
                {loadingPreguntas ? <p>Cargando preguntas...</p> : (
                    <div className="preguntas-list">
                        {preguntas.filter(p => !p.toBeDeleted).length === 0 && ( // Mensaje si no hay preguntas visibles
                             <p style={{textAlign: 'center', color: '#666', margin: 'var(--spacing-lg) 0'}}>No hay preguntas. Añade manualmente, genera con IA o importa desde el banco.</p>
                        )}
                        {preguntas
                            .filter(p => !p.toBeDeleted) // Filtrar las marcadas para borrar
                            .sort((a, b) => a.orden - b.orden) // Ordenar por el campo 'orden'
                            .map((pregunta, indexVisual) => (
                            <PreguntaForm
                                key={pregunta.id} // Usa ID real o temporal
                                pregunta={pregunta}
                                index={indexVisual} // Índice visual basado en el array ordenado y filtrado
                                onUpdate={handleUpdatePregunta}
                                onDelete={handleDeletePregunta}
                            />
                        ))}
                        <button type="button" onClick={handleAddPregunta} className="btn-secondary" style={{ alignSelf: 'center', marginTop: 'var(--spacing-md)'}}>＋ Añadir Pregunta Manualmente</button>
                    </div>
                )}


                {/* Acciones */}
                <div className="form-actions">
                    <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={loading || loadingPreguntas}>
                        {loading ? 'Guardando...' : (isEditing ? 'Actualizar Evaluación' : 'Guardar Evaluación')}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default EvaluacionForm;