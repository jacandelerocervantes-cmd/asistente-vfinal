// src/components/materia_panel/EvaluacionForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import PreguntaForm from './PreguntaForm'; // Componente para gestionar preguntas individuales
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
        setPreguntas([...preguntas, {
            // Valores iniciales para una nueva pregunta
            id: `temp-${Date.now()}`, // ID temporal para el key en React
            texto_pregunta: '',
            tipo_pregunta: 'opcion_multiple_unica',
            puntos: 10,
            opciones: [{ id: `temp-opt-${Date.now()}`, texto_opcion: '', es_correcta: true }], // Empezar con una opción correcta
            orden: preguntas.length,
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
             // Marcar para borrado (o borrar directamente si prefieres, pero puede ser complejo manejar errores)
             // Por simplicidad ahora, la quitaremos visualmente, pero deberías manejar el borrado real en handleSubmit
             if(window.confirm("¿Eliminar esta pregunta? (Se borrará al guardar la evaluación)")) {
                // Opción 1: Marcar para borrado (más seguro)
                // setPreguntas(preguntas.map(p => p.id === preguntaId ? { ...p, toBeDeleted: true } : p));
                // Opción 2: Eliminar del estado (más simple visualmente)
                setPreguntas(preguntas.filter(p => p.id !== preguntaId));
                // **Importante:** Necesitarás lógica en handleSubmit para borrarla de la BD si eliges Opción 2.
             }
         }
    };


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

            // 2. Guardar/Actualizar/Borrar Preguntas y Opciones
            for (const pregunta of preguntas) {
                const preguntaData = {
                    evaluacion_id: savedEvaluacion.id,
                    user_id: user.id,
                    texto_pregunta: pregunta.texto_pregunta,
                    tipo_pregunta: pregunta.tipo_pregunta,
                    puntos: pregunta.puntos,
                    orden: pregunta.orden,
                    datos_extra: pregunta.datos_extra || null, // Asegurar que sea null si no hay datos extra
                };

                let savedPreguntaId;

                if (pregunta.isNew) { // Pregunta nueva
                    const { data: newP, error: insertPError } = await supabase
                        .from('preguntas')
                        .insert(preguntaData)
                        .select('id')
                        .single();
                    if (insertPError) throw insertPError;
                    savedPreguntaId = newP.id;
                } else if (!pregunta.toBeDeleted) { // Actualizar pregunta existente (si no está marcada para borrar)
                    const { error: updatePError } = await supabase
                        .from('preguntas')
                        .update(preguntaData)
                        .eq('id', pregunta.id);
                    if (updatePError) throw updatePError;
                    savedPreguntaId = pregunta.id;
                } else { // Borrar pregunta (si la marcaste con toBeDeleted)
                    const { error: deletePError } = await supabase
                        .from('preguntas')
                        .delete()
                        .eq('id', pregunta.id);
                    if (deletePError) console.warn(`No se pudo borrar la pregunta ${pregunta.id}:`, deletePError); // Advertir pero continuar
                    continue; // Saltar al siguiente ciclo si se borró
                }


                // 3. Gestionar Opciones (solo para tipos que las usan)
                if (pregunta.tipo_pregunta.startsWith('opcion_multiple') && savedPreguntaId && !pregunta.toBeDeleted) {
                     // Obtener IDs de opciones existentes en el estado
                    const opcionesActualesIds = (pregunta.opciones || []).map(opt => opt.id).filter(id => typeof id === 'number');

                    // Borrar opciones que ya no están en el estado
                    const { error: deleteOptError } = await supabase
                        .from('opciones')
                        .delete()
                        .eq('pregunta_id', savedPreguntaId)
                        .not('id', 'in', `(${opcionesActualesIds.join(',') || 0})`); // Borra si no está en la lista actual
                    if (deleteOptError) console.warn(`Error borrando opciones antiguas para pregunta ${savedPreguntaId}:`, deleteOptError);

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
                <h4>Preguntas</h4>
                {loadingPreguntas ? <p>Cargando preguntas...</p> : (
                    <div className="preguntas-list">
                        {preguntas.map((pregunta, index) => (
                             !pregunta.toBeDeleted && // No renderizar si está marcada para borrar
                            <PreguntaForm
                                key={pregunta.id || `new-${index}`} // Usa ID real o temporal
                                pregunta={pregunta}
                                index={index}
                                onUpdate={handleUpdatePregunta}
                                onDelete={handleDeletePregunta}
                            />
                        ))}
                        <button type="button" onClick={handleAddPregunta} className="btn-secondary">＋ Añadir Pregunta</button>
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