// src/pages/AlumnoDashboard.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './AlumnoDashboard.css'; // <--- AÑADIR ESTA LÍNEA

const AlumnoDashboard = () => {
    const [evaluaciones, setEvaluaciones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [alumnoInfo, setAlumnoInfo] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        const authData = sessionStorage.getItem('alumnoAuth');
        if (!authData) {
            navigate('/alumno/portal'); // Redirigir si no hay sesión de alumno
            return;
        }
        const parsedAuth = JSON.parse(authData);
        setAlumnoInfo(parsedAuth);

        const fetchEvaluaciones = async () => {
            setLoading(true);
            try {
                // Usamos la función RPC creada en SQL
                const { data, error } = await supabase.rpc('obtener_evaluaciones_alumno', {
                    p_matricula: parsedAuth.matricula,
                    p_correo: parsedAuth.correo
                });

                if (error) throw error;
                setEvaluaciones(data || []);
            } catch (error) {
                console.error("Error cargando evaluaciones del alumno:", error);
                alert("No se pudieron cargar tus evaluaciones.");
                // Podrías intentar limpiar sessionStorage y redirigir al portal aquí
            } finally {
                setLoading(false);
            }
        };

        fetchEvaluaciones();

    }, [navigate]);

    const handleIniciarIntento = (evaluacionId) => {
        // Navegar a la pantalla del examen
         navigate(`/alumno/examen/${evaluacionId}`);
    };

     const handleRevisarIntento = (intentoId) => {
         // Navegar a la pantalla de revisión (Fase 3)
         // navigate(`/alumno/revision/${intentoId}`);
         alert("Modo de revisión aún no implementado.");
     };

    const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleString('es-MX') : 'N/A';

    if (loading) return <div className="container">Cargando tus evaluaciones...</div>;

    return (
        <div className="alumno-dashboard-container container">
            <h2>Mis Evaluaciones</h2>
            <p>Bienvenido, <strong>{alumnoInfo?.matricula}</strong></p>
            {evaluaciones.length === 0 ? (
                <p>No tienes evaluaciones disponibles en este momento.</p>
            ) : (
                <ul className="evaluaciones-list">
                    {evaluaciones.map(ev => {
                        const ahora = new Date();
                        const apertura = ev.fecha_apertura ? new Date(ev.fecha_apertura) : null;
                        const cierre = ev.fecha_cierre ? new Date(ev.fecha_cierre) : null;
                        const isActiva = ev.estado_evaluacion === 'publicado' &&
                                         (!apertura || ahora >= apertura) &&
                                         (!cierre || ahora <= cierre);
                        const puedeIniciar = isActiva && !ev.intento_id; // Activa y sin intento previo
                        const puedeRevisar = ev.estado_intento === 'calificado'; // O 'completado' si muestras antes de calificar

                        return (
                            <li key={ev.evaluacion_id} className="evaluacion-list-item card">
                                <div className="evaluacion-info">
                                    <h4>{ev.titulo}</h4>
                                    <p>Unidad: {ev.unidad || 'N/A'}</p>
                                    <p>Disponible: {formatDate(ev.fecha_apertura)} - {formatDate(ev.fecha_cierre)}</p>
                                    <p>Límite: {ev.tiempo_limite ? `${ev.tiempo_limite} min` : 'Sin límite'}</p>
                                    {ev.intento_id && <p>Estado: <strong>{ev.estado_intento}</strong> {ev.calificacion_final !== null ? `(${ev.calificacion_final}/100)` : ''}</p>}
                                </div>
                                <div className="evaluacion-actions">
                                    {puedeIniciar && (
                                        <button onClick={() => handleIniciarIntento(ev.evaluacion_id)} className="btn-primary">Iniciar Evaluación</button>
                                    )}
                                    {ev.intento_id && ev.estado_intento === 'en_progreso' && (
                                         <button onClick={() => handleIniciarIntento(ev.evaluacion_id)} className="btn-secondary">Continuar Evaluación</button>
                                    )}
                                    {puedeRevisar && (
                                        <button onClick={() => handleRevisarIntento(ev.intento_id)} className="btn-tertiary">Revisar Intento</button>
                                    )}
                                     {!isActiva && !ev.intento_id && <span>No disponible</span>}
                                     {isActiva && ev.intento_id && ev.estado_intento !== 'en_progreso' && !puedeRevisar && <span>Intento finalizado</span>}
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