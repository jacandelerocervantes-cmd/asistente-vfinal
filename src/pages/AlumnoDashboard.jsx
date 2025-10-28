// src/pages/AlumnoDashboard.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './AlumnoDashboard.css'; // <--- AÑADIR ESTA LÍNEA

const AlumnoDashboard = () => {
    const [evaluaciones, setEvaluaciones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [alumnoInfo, setAlumnoInfo] = useState(null);
    const [user, setUser] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        const getSession = async () => {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session) {
                navigate('/alumno/login');
                return;
            }
            setUser(session.user);
            // El email o matrícula se puede obtener de session.user.email o user_metadata
            setAlumnoInfo({ matricula: session.user.email }); // Ajustar si usas matrícula en metadata
            fetchEvaluaciones(session.user.id);
        };

        const fetchEvaluaciones = async (userId) => {
            setLoading(true);
            try {
                // Usamos la función RPC, ahora pasando el user_id
                const { data, error } = await supabase.rpc('obtener_evaluaciones_alumno', {
                    p_user_id: userId
                });

                if (error) throw error;
                setEvaluaciones(data || []);
            } catch (error) {
                console.error("Error cargando evaluaciones del alumno:", error);
                alert("No se pudieron cargar tus evaluaciones.");
            } finally {
                setLoading(false);
            }
        };

        getSession();

    }, [navigate]);

    const handleIniciarIntento = (evaluacionId) => {
        // Navegar a la pantalla del examen
         navigate(`/alumno/examen/${evaluacionId}`);
    };

    // --- MODIFICAR handleRevisarIntento ---
     const handleRevisarIntento = (intentoId) => {
         // Navegar a la pantalla de revisión
         navigate(`/alumno/revision/${intentoId}`);
     };
     // --- FIN MODIFICACIÓN ---

    const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleString('es-MX') : 'N/A';

    if (loading) return <div className="container">Cargando tus evaluaciones...</div>;

    return (
        <div className="container alumno-dashboard-container" style={{paddingTop: '2rem'}}>
            <h2>Mis Evaluaciones</h2>
            <p>Bienvenido, {alumnoInfo?.matricula || user?.email}</p>
            {evaluaciones.length === 0 ? (
                <p>No tienes evaluaciones disponibles en este momento.</p>
            ) : (
                <ul className="evaluaciones-list" style={{ listStyle: 'none', padding: 0 }}>
                    {evaluaciones.map(ev => {
                        const ahora = new Date();
                        const apertura = ev.fecha_apertura ? new Date(ev.fecha_apertura) : null;
                        const cierre = ev.fecha_cierre ? new Date(ev.fecha_cierre) : null;
                        const isActiva = ev.estado_evaluacion === 'publicado' &&
                                         (!apertura || ahora >= apertura) &&
                                         (!cierre || ahora <= cierre);
                        const puedeIniciar = isActiva && !ev.intento_id;

                        // --- LÓGICA PARA 'PUEDE REVISAR' ---
                        // Puede revisar si:
                        // 1. El intento está 'calificado' O ('completado'/'bloqueado' Y el cierre ya pasó O se permite ver respuestas antes)
                        // 2. La evaluación permite mostrar respuestas (e.mostrar_respuestas en SQL)
                        const intentoTerminado = ev.estado_intento === 'calificado' || ev.estado_intento === 'completado' || ev.estado_intento === 'bloqueado';
                        const periodoTerminado = cierre && ahora > cierre;
                        const puedeRevisar = intentoTerminado && ev.mostrar_respuestas && (ev.estado_intento === 'calificado' || periodoTerminado);
                        // --- FIN LÓGICA REVISAR ---


                        return (
                            <li key={ev.evaluacion_id} className="card evaluacion-list-item">
                                <div className="evaluacion-info">
                                    <h4>{ev.titulo}</h4>
                                    <p>Unidad: {ev.unidad || 'N/A'}</p>
                                    <p>Disponible: {formatDate(ev.fecha_apertura)} - {formatDate(ev.fecha_cierre)}</p>
                                    <p>Límite: {ev.tiempo_limite ? `${ev.tiempo_limite} min` : 'Sin límite'}</p>
                                    {ev.intento_id && <p>Estado Intento: {ev.estado_intento} {ev.calificacion_final !== null ? `(${ev.calificacion_final}/100)` : ''}</p>}
                                    {/* Mostrar si se pueden ver respuestas */}
                                    {intentoTerminado && <p style={{fontSize: '0.8em', color: ev.mostrar_respuestas ? 'green' : 'orange'}}>
                                        {ev.mostrar_respuestas ? 'Revisión habilitada' : 'Revisión deshabilitada por el docente'}
                                    </p>}
                                </div>
                                <div className="evaluacion-actions">
                                    {puedeIniciar && (
                                        <button onClick={() => handleIniciarIntento(ev.evaluacion_id)} className="btn-primary">Iniciar Evaluación</button>
                                    )}
                                    {ev.intento_id && ev.estado_intento === 'en_progreso' && (
                                         <button onClick={() => handleIniciarIntento(ev.evaluacion_id)} className="btn-secondary">Continuar Evaluación</button>
                                    )}
                                    {/* --- Botón Revisar (actualizado) --- */}
                                    {puedeRevisar && (
                                        <button onClick={() => handleRevisarIntento(ev.intento_id)} className="btn-secondary">Revisar Intento</button>
                                    )}
                                    {/* Mostrar mensaje si no puede revisar aún */}
                                    {intentoTerminado && !puedeRevisar && ev.mostrar_respuestas && (
                                        <span style={{color: 'grey', fontSize: '0.9em'}}>Revisión disponible después del {formatDate(ev.fecha_cierre)}</span>
                                    )}
                                    {intentoTerminado && !ev.mostrar_respuestas && (
                                         <span style={{color: 'grey', fontSize: '0.9em'}}>Revisión no habilitada</span>
                                    )}

                                     {!isActiva && !ev.intento_id && <span style={{color: 'grey'}}>No disponible</span>}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default AlumnoDashboard;