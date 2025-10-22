// src/pages/ExamenAlumno.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom'; // Asegúrate de importar Link
import { supabase } from '../supabaseClient';
import './ExamenAlumno.css'; // <--- AÑADIR ESTA LÍNEA

const ExamenAlumno = () => {
    const { evaluacionId } = useParams();
    const navigate = useNavigate();
    const [evaluacion, setEvaluacion] = useState(null);
    const [preguntas, setPreguntas] = useState([]);
    const [respuestas, setRespuestas] = useState({}); // { preguntaId: respuesta }
    const [intento, setIntento] = useState(null);
    const [preguntaActualIndex, setPreguntaActualIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tiempoRestante, setTiempoRestante] = useState(null); // en segundos
    const [alumnoInfo, setAlumnoInfo] = useState(null);

    // Cargar info del alumno y verificar/crear intento
    useEffect(() => {
        const authData = sessionStorage.getItem('alumnoAuth');
        if (!authData) {
            navigate('/alumno/portal');
            return;
        }
        const parsedAuth = JSON.parse(authData);
        setAlumnoInfo(parsedAuth);

        const iniciarOContinuarIntento = async () => {
            setLoading(true);
            setError('');
            try {
                // 1. Buscar intento existente
                const { data: intentoExistente, error: errIntento } = await supabase
                    .from('intentos_evaluacion')
                    .select('*')
                    .eq('evaluacion_id', evaluacionId)
                    .eq('alumno_id', parsedAuth.alumnoId)
                    .maybeSingle();

                if (errIntento) throw errIntento;

                let intentoActual = intentoExistente;

                // 2. Si no existe, crear uno nuevo
                if (!intentoActual) {
                    const { data: nuevoIntento, error: errNuevo } = await supabase
                        .from('intentos_evaluacion')
                        .insert({
                            evaluacion_id: evaluacionId,
                            alumno_id: parsedAuth.alumnoId,
                            estado: 'en_progreso'
                        })
                        .select()
                        .single();
                    if (errNuevo) throw errNuevo;
                    intentoActual = nuevoIntento;
                } else if (intentoActual.estado !== 'en_progreso') {
                     throw new Error("Este examen ya ha sido completado o finalizado.");
                }

                setIntento(intentoActual);

                // 3. Cargar Evaluación y Preguntas (con opciones)
                const { data: evData, error: errEv } = await supabase
                    .from('evaluaciones')
                    .select('*, preguntas(*, opciones(*))')
                    .eq('id', evaluacionId)
                    .single();

                if (errEv) throw errEv;
                setEvaluacion(evData);

                // TODO: Implementar aleatoriedad si se guarda en intentoActual.respuestas_mezcladas
                const preguntasOrdenadas = (evData.preguntas || []).sort((a, b) => a.orden - b.orden);
                setPreguntas(preguntasOrdenadas);

                // 4. Cargar respuestas guardadas previamente para este intento
                const { data: respuestasGuardadas, error: errResp } = await supabase
                    .from('respuestas_alumno')
                    .select('*')
                    .eq('intento_id', intentoActual.id);

                if (errResp) throw errResp;
                const respuestasMap = {};
                respuestasGuardadas.forEach(r => {
                    respuestasMap[r.pregunta_id] = r.respuesta_texto || r.respuesta_opciones || r.respuesta_json;
                });
                setRespuestas(respuestasMap);

                // 5. Iniciar temporizador si aplica
                if (evData.tiempo_limite) {
                    const inicio = new Date(intentoActual.fecha_inicio);
                    const ahora = new Date();
                    const transcurrido = Math.floor((ahora - inicio) / 1000); // Segundos transcurridos
                    const limiteTotal = evData.tiempo_limite * 60;
                    const restante = limiteTotal - transcurrido;
                    setTiempoRestante(restante > 0 ? restante : 0);
                }

            } catch (err) {
                console.error("Error al iniciar/cargar examen:", err);
                setError(err.message || 'No se pudo cargar el examen.');
                 // Podrías redirigir o mostrar un mensaje permanente
            } finally {
                setLoading(false);
            }
        };

        iniciarOContinuarIntento();

    }, [evaluacionId, navigate]);

     // Efecto para el temporizador
     useEffect(() => {
        if (tiempoRestante === null || tiempoRestante <= 0) return;
        const timerId = setInterval(() => {
            setTiempoRestante(prev => {
                if (prev <= 1) {
                    clearInterval(timerId);
                    finalizarIntento('tiempo_agotado'); // Finalizar automáticamente
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tiempoRestante]); // Solo depende de tiempoRestante

    // Función para guardar respuesta (se llama al cambiar)
    const guardarRespuesta = useCallback(async (preguntaId, respuesta) => {
        if (!intento) return;

        // Actualiza estado local inmediatamente para UI reactiva
        setRespuestas(prev => ({ ...prev, [preguntaId]: respuesta }));

        try {
             // Determina qué campo usar en la BD
            let updateData = {};
            if (typeof respuesta === 'string') {
                 updateData = { respuesta_texto: respuesta, respuesta_opciones: null, respuesta_json: null };
            } else if (Array.isArray(respuesta)) {
                 updateData = { respuesta_texto: null, respuesta_opciones: respuesta, respuesta_json: null };
            } else { // Asumimos JSON para otros tipos
                 updateData = { respuesta_texto: null, respuesta_opciones: null, respuesta_json: respuesta };
            }

            const { error } = await supabase
                .from('respuestas_alumno')
                .upsert({
                    intento_id: intento.id,
                    pregunta_id: preguntaId,
                    ...updateData
                }, { onConflict: 'intento_id, pregunta_id' });

            if (error) throw error;
            console.log(`Respuesta guardada para pregunta ${preguntaId}`);

        } catch (err) {
            console.error(`Error guardando respuesta para pregunta ${preguntaId}:`, err);
            // Podríamos mostrar un indicador de error al usuario
        }
    }, [intento]);

    // Manejar cambio en respuestas
    const handleRespuestaChange = (preguntaId, tipo, value, opcionId = null) => {
        let nuevaRespuesta;
        if (tipo === 'abierta') {
            nuevaRespuesta = value;
        } else if (tipo === 'opcion_multiple_unica') {
             nuevaRespuesta = [opcionId]; // Guardamos el ID de la opción seleccionada en un array
        }
        // else if (tipo === 'opcion_multiple_multiple') { ... } // Lógica para checkboxes
        else { return; } // Otros tipos no manejados en Fase 1

        guardarRespuesta(preguntaId, nuevaRespuesta);
    };

    const irAPregunta = (index) => {
        if (index >= 0 && index < preguntas.length) {
            setPreguntaActualIndex(index);
        }
    };

    // Finalizar intento
    const finalizarIntento = async (razon = 'manual') => {
         if (!intento) return;
         setLoading(true); // Bloquear UI

         // Confirmación si es manual
         if (razon === 'manual' && !window.confirm("¿Estás seguro de finalizar y enviar tu examen?")) {
            setLoading(false);
            return;
         }

        try {
            const { error } = await supabase
                .from('intentos_evaluacion')
                .update({ estado: 'completado', fecha_fin: new Date().toISOString() })
                .eq('id', intento.id);
            if (error) throw error;

             // Invocar función de autocalificación (¡Importante!)
             const { error: gradeError } = await supabase.functions.invoke('calificar-intento', {
                 body: { intento_id: intento.id }
             });
             // No lanzamos error si la calificación falla, pero sí lo registramos
             if (gradeError) {
                 console.error("Error al invocar la función de calificación:", gradeError);
             }

            alert(razon === 'tiempo_agotado' ? "El tiempo ha terminado. Tu examen ha sido enviado." : "Examen finalizado y enviado.");
            navigate('/alumno/evaluaciones'); // Volver al dashboard del alumno

        } catch (err) {
             console.error("Error al finalizar el intento:", err);
             alert("Error al finalizar el examen: " + err.message);
             setLoading(false);
        }
    };


    // --- Renderizado ---
    if (loading) return <div className="examen-container"><p>Cargando examen...</p></div>;
    if (error) return <div className="error-container"><p>Error: {error}</p><Link to="/alumno/evaluaciones" className="btn-secondary">Volver al Dashboard</Link></div>;
    if (!evaluacion || preguntas.length === 0) return <div className="error-container"><p>No se encontró la evaluación o no tiene preguntas.</p><Link to="/alumno/evaluaciones" className="btn-secondary">Volver</Link></div>;

    const preguntaActual = preguntas[preguntaActualIndex];
    const respuestaActual = respuestas[preguntaActual.id];

    // Formatear tiempo restante
    const formatTiempo = (segundos) => {
        if (segundos === null) return '';
        if (segundos <= 0) return 'Tiempo agotado';
        const mins = Math.floor(segundos / 60);
        const secs = segundos % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    return (
        <div className="examen-container">
            <div className="examen-header">
                <h2>{evaluacion.titulo}</h2>
                {tiempoRestante !== null && <div className="examen-timer">Tiempo: {formatTiempo(tiempoRestante)}</div>}
            </div>

            <div className="pregunta-container">
                <p className="pregunta-texto">
                    {preguntaActual.texto_pregunta}
                    <span className="pregunta-puntos">({preguntaActual.puntos} pts)</span>
                </p>

                {/* Renderizar según tipo de pregunta */}
                {preguntaActual.tipo_pregunta === 'abierta' && (
                    <textarea
                        className="respuesta-abierta"
                        rows="5"
                        value={respuestaActual || ''}
                        onChange={(e) => handleRespuestaChange(preguntaActual.id, 'abierta', e.target.value)}
                        placeholder="Escribe tu respuesta aquí..."
                    />
                )}

                {preguntaActual.tipo_pregunta === 'opcion_multiple_unica' && (
                    <ul className="opciones-list">
                        {(preguntaActual.opciones || []).map(op => (
                            <li key={op.id} className="opcion-item">
                                <label>
                                    <input
                                        type="radio"
                                        name={`pregunta-${preguntaActual.id}`}
                                        checked={Array.isArray(respuestaActual) && respuestaActual[0] === op.id}
                                        onChange={() => handleRespuestaChange(preguntaActual.id, 'opcion_multiple_unica', null, op.id)}
                                    />
                                    <span>{op.texto_opcion}</span>
                                </label>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="examen-navigation">
                <button onClick={() => irAPregunta(preguntaActualIndex - 1)} disabled={preguntaActualIndex === 0}>
                    &larr; Anterior
                </button>
                <span>Pregunta {preguntaActualIndex + 1} / {preguntas.length}</span>
                {preguntaActualIndex < preguntas.length - 1 ? (
                    <button onClick={() => irAPregunta(preguntaActualIndex + 1)}>
                        Siguiente &rarr;
                    </button>
                ) : (
                    <button onClick={() => finalizarIntento('manual')} className="btn-primary" disabled={loading}>
                        Finalizar Examen
                    </button>
                )}
            </div>
        </div>
    );
};

export default ExamenAlumno;