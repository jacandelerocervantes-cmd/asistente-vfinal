// src/pages/CalificacionManualPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import RespuestaAbiertaCard from '../components/materia_panel/RespuestaAbiertaCard'; // <-- Nuevo componente
import './CalificacionManualPanel.css'; // <-- Nuevo CSS

const CalificacionManualPanel = () => {
    const { evaluacionId } = useParams();
    const [evaluacion, setEvaluacion] = useState(null);
    const [intentos, setIntentos] = useState([]);
    const [preguntasAbiertas, setPreguntasAbiertas] = useState([]);
    const [respuestas, setRespuestas] = useState({}); // { intentoId: { preguntaId: respuestaData } }
    const [loading, setLoading] = useState(true);
    const [filtroEstado, setFiltroEstado] = useState('pendiente_revision'); // 'todos', 'pendiente_revision', 'calificado'

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            // Cargar datos de la evaluación
            const { data: evData, error: evError } = await supabase
                .from('evaluaciones')
                .select('id, titulo, materia_id')
                .eq('id', evaluacionId)
                .single();
            if (evError) throw evError;
            setEvaluacion(evData);

            // Cargar solo las preguntas abiertas de esta evaluación
            const { data: paData, error: paError } = await supabase
                .from('preguntas')
                .select('id, texto_pregunta, puntos')
                .eq('evaluacion_id', evaluacionId)
                .eq('tipo_pregunta', 'abierta'); // Filtrar por tipo
            if (paError) throw paError;
            setPreguntasAbiertas(paData || []);

            // Cargar los intentos de los alumnos para esta evaluación
            let queryIntentos = supabase
                .from('intentos_evaluacion')
                .select(`
                    id,
                    estado,
                    calificacion_final,
                    alumnos ( id, nombre, apellido )
                `)
                .eq('evaluacion_id', evaluacionId);

            if (filtroEstado !== 'todos') {
                queryIntentos = queryIntentos.eq('estado', filtroEstado);
            }

            const { data: intentosData, error: intentosError } = await queryIntentos;
            if (intentosError) throw intentosError;
            setIntentos(intentosData || []);

            // Cargar todas las respuestas a preguntas abiertas de estos intentos
            const intentoIds = (intentosData || []).map(i => i.id);
            if (intentoIds.length > 0 && paData.length > 0) {
                 const preguntaIds = paData.map(p => p.id);
                 const { data: respData, error: respError } = await supabase
                    .from('respuestas_alumno')
                    .select('*')
                    .in('intento_id', intentoIds)
                    .in('pregunta_id', preguntaIds); // Cargar solo respuestas a preguntas abiertas

                if (respError) throw respError;

                // Organizar respuestas por intento y pregunta
                const respuestasMap = {};
                (respData || []).forEach(r => {
                    if (!respuestasMap[r.intento_id]) {
                        respuestasMap[r.intento_id] = {};
                    }
                    respuestasMap[r.intento_id][r.pregunta_id] = r;
                });
                setRespuestas(respuestasMap);
            } else {
                 setRespuestas({}); // Limpiar si no hay intentos o preguntas abiertas
            }

        } catch (error) {
            console.error("Error cargando datos para calificar:", error);
            alert("Error al cargar datos: " + error.message);
        } finally {
            setLoading(false);
        }
    }, [evaluacionId, filtroEstado]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

     // Función para actualizar una respuesta específica en el estado local
     const handleRespuestaUpdateLocal = (intentoId, preguntaId, updatedFields) => {
        setRespuestas(prev => {
            const newRespuestas = { ...prev };
            if (newRespuestas[intentoId] && newRespuestas[intentoId][preguntaId]) {
                newRespuestas[intentoId][preguntaId] = {
                    ...newRespuestas[intentoId][preguntaId],
                    ...updatedFields
                };
            }
            return newRespuestas;
        });
    };

    // --- Lógica para recalcular y finalizar calificación (IMPORTANTE) ---
    const finalizarCalificacionIntento = async (intentoId) => {
        // Esta función debe ser llamada después de guardar la última pregunta abierta de un intento.
        // Similar a 'calificar-intento', pero ahora suma los puntos manuales.
        try {
             // Podríamos invocar una función Edge específica que haga esto
             // O hacerlo aquí en el cliente (menos seguro si hay lógica compleja)
             // Por simplicidad, invocaremos 'calificar-intento' de nuevo.
             // La función 'calificar-intento' debería modificarse para:
             // 1. NO sobreescribir puntos_obtenidos si es_correcta es NULL (pregunta abierta ya calificada).
             // 2. Sumar los puntos_obtenidos de todas las respuestas (auto + manuales).
             // 3. Marcar el intento como 'calificado' si TODAS las abiertas tienen puntos asignados.

             const { error } = await supabase.functions.invoke('calificar-intento', {
                 body: { intento_id: intentoId }
             });
             if (error) throw error;

             // Actualizar estado del intento localmente tras recalcular
             setIntentos(prev => prev.map(i => i.id === intentoId ? { ...i, estado: 'calificado' } : i));
             // Opcional: Recargar todo con fetchData()

        } catch (error) {
            console.error(`Error al finalizar calificación para intento ${intentoId}:`, error);
            alert("Error al recalcular la calificación final: " + error.message);
        }
    };


    if (loading) return <div className="container">Cargando panel de calificación...</div>;
    if (!evaluacion) return <div className="container">Evaluación no encontrada.</div>;

    return (
        <div className="calificacion-manual-panel container">
             <Link to={`/materia/${evaluacion.materia_id}?tab=Evaluaciones`} className="back-link">&larr; Volver a Evaluaciones</Link>
            <h2>Calificar: {evaluacion.titulo}</h2>
            <p>Revisión de preguntas abiertas.</p>

            <div className="filtros-calificacion">
                <label>Mostrar intentos:</label>
                <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
                    <option value="pendiente_revision">Pendientes de Revisión</option>
                    <option value="calificado">Ya Calificados</option>
                    <option value="todos">Todos</option>
                </select>
            </div>

            {preguntasAbiertas.length === 0 && <p>Esta evaluación no contiene preguntas abiertas.</p>}

            {intentos.length === 0 && filtroEstado === 'pendiente_revision' && preguntasAbiertas.length > 0 &&
                <p>No hay intentos pendientes de revisión para esta evaluación.</p>
            }

            <div className="intentos-list">
                {intentos.map(intento => (
                    <div key={intento.id} className="intento-card card">
                        <h4>{intento.alumnos?.apellido || 'Alumno'}, {intento.alumnos?.nombre || 'Desconocido'}</h4>
                        <p>Estado: {intento.estado} {intento.estado === 'calificado' ? `(${intento.calificacion_final}/100)` : ''}</p>
                        <div className="respuestas-abiertas-container">
                            {preguntasAbiertas.map(pregunta => {
                                const respuesta = respuestas[intento.id]?.[pregunta.id];
                                return (
                                    <RespuestaAbiertaCard
                                        key={`${intento.id}-${pregunta.id}`}
                                        pregunta={pregunta}
                                        respuesta={respuesta} // Puede ser undefined si el alumno no respondió
                                        intentoId={intento.id}
                                        onSave={handleRespuestaUpdateLocal} // Actualiza UI local al guardar
                                        onFinalizarIntento={finalizarCalificacionIntento} // Para recalcular al terminar
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default CalificacionManualPanel;