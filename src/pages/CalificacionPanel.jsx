// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom'; 
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';
import './CalificacionPanel.css';
import { FaSync, FaArrowLeft, FaCheckCircle, FaClock, FaExclamationCircle, FaRobot } from 'react-icons/fa';

const CalificacionPanel = () => {
    const { id: actividadId } = useParams(); // Corregido: leemos 'id' de la URL
    const [actividad, setActividad] = useState(null);
    const [loadingData, setLoadingData] = useState(true); // Estado para carga inicial de DB
    const [isSyncing, setIsSyncing] = useState(false);    // Estado para la sincronización en 2do plano
    const [calificaciones, setCalificaciones] = useState([]);
    const { showNotification } = useNotification();

    // 1. Cargar Información de la Actividad y Alumnos (Lo rápido)
    const fetchLocalData = useCallback(async () => {
        if (!actividadId) return;
        try {
            // Cargar detalles de la actividad
            const { data: actData, error: actError } = await supabase
                .from('actividades').select('*').eq('id', actividadId).single();
            if (actError) throw actError;
            setActividad(actData);

            // Cargar lista de entregas/alumnos desde la BD
            const { data: calData, error: calError } = await supabase
                .from('calificaciones')
                .select('*, alumnos(id, nombre, apellido, matricula)')
                .eq('actividad_id', actividadId)
                .order('created_at', { ascending: false });

            if (calError) throw calError;
            setCalificaciones(calData || []);

        } catch (error) {
            console.error("Error cargando datos locales:", error);
            showNotification('Error al cargar datos: ' + error.message, 'error');
        } finally {
            setLoadingData(false);
        }
    }, [actividadId, showNotification]);

    // 2. Sincronizar con Drive (Lo lento, va en segundo plano)
    const syncWithDrive = useCallback(async (silent = false) => {
        if (!actividadId) return;
        setIsSyncing(true);
        if (!silent) showNotification('Buscando entregas nuevas en Drive...', 'info');

        try {
            const { data, error } = await supabase.functions.invoke('sync-activity-deliveries', {
                body: { actividad_id: actividadId }
            });

            if (error) throw error;

            // Si hubo cambios, recargamos la lista local
            if (data.nuevos > 0) {
                showNotification(`Se encontraron ${data.nuevos} entregas nuevas.`, 'success');
                await fetchLocalData(); // Recargar lista para mostrar lo nuevo
            } else if (!silent) {
                showNotification('Todo actualizado. No hay archivos nuevos.', 'success');
            }

        } catch (error) {
            console.error("Error de sincronización:", error);
            if (!silent) showNotification('No se pudo conectar con Drive: ' + error.message, 'error');
        } finally {
            setIsSyncing(false);
        }
    }, [actividadId, showNotification, fetchLocalData]);

    // Efecto de Montaje: Carga datos Y dispara sincronización
    useEffect(() => {
        if (actividadId) {
            fetchLocalData();      // 1. Muestra lo que hay rápido
            syncWithDrive(true);   // 2. Busca novedades en silencio
        }
    }, [actividadId, fetchLocalData, syncWithDrive]);

    // Helper para iconos
    const getStatusIcon = (estado) => {
        switch (estado) {
            case 'calificado': return <FaCheckCircle className="icon-success" />;
            case 'entregado': return <FaClock className="icon-info" />;
            default: return <FaExclamationCircle className="icon-warning" />;
        }
    };

    return (
        <div className="calificacion-panel-container">
            {/* Header */}
            <div className="calificacion-header">
                <div>
                    {/* --- CORRECCIÓN DEL LINK DE RETORNO --- */}
                    <Link 
                        // Usamos query param '?tab=actividades'
                        to={actividad ? `/materia/${actividad.materia_id}?tab=actividades` : '#'} 
                        className="back-link"
                    >
                        <FaArrowLeft /> Volver a Actividades
                    </Link>
                    
                    <h2>{actividad ? actividad.nombre : 'Cargando actividad...'}</h2>
                    <p className="subtitle">Panel de Evaluación</p>
                </div>
                
                <div className="header-actions">
                    {/* Botón discreto para refrescar manualmente si hace falta */}
                    <button 
                        onClick={() => syncWithDrive(false)} 
                        disabled={isSyncing} 
                        className="btn-secondary btn-small icon-button"
                        title="Buscar archivos nuevos en Drive ahora"
                    >
                        <FaSync className={isSyncing ? 'spin' : ''} /> 
                        {isSyncing ? ' Buscando...' : ' Actualizar Lista'}
                    </button>
                </div>
            </div>

            {/* Tabla de Alumnos */}
            <div className="alumnos-list-container">
                <div className="list-header">
                    <span style={{width: '40px'}}></span>
                    <span style={{flex: 2}}>Alumno / Equipo</span>
                    <span style={{flex: 1}}>Estado</span>
                    <span style={{flex: 1, textAlign: 'center'}}>Calificación</span>
                    <span style={{flex: 1, textAlign: 'right'}}>Acciones</span>
                </div>

                {loadingData ? (
                    <div className="loading-state">Cargando lista de alumnos...</div>
                ) : (
                    <ul className="alumnos-list">
                        {calificaciones.length > 0 ? calificaciones.map(cal => (
                            <li key={cal.id} className={cal.estado === 'calificado' ? 'calificado-row' : ''}>
                                <div className="status-icon-col">
                                    {getStatusIcon(cal.estado)}
                                </div>
                                
                                <div className="alumno-info">
                                    <span className="entregable-nombre">
                                        {cal.alumnos?.nombre} {cal.alumnos?.apellido}
                                    </span>
                                    <div className="matricula-text">
                                        {cal.alumnos?.matricula}
                                    </div>
                                </div>

                                <div>
                                    <span className={`status-pill ${cal.estado || 'pendiente'}`}>
                                        {cal.estado === 'entregado' ? 'Entregado' : 
                                         cal.estado === 'calificado' ? 'Calificado' : 'Pendiente'}
                                    </span>
                                </div>

                                <div className="calificacion-display">
                                    {cal.calificacion_obtenida ? (
                                        <span className={cal.calificacion_obtenida >= 70 ? 'aprobado' : 'reprobado'}>
                                            {cal.calificacion_obtenida}
                                        </span>
                                    ) : '-'}
                                </div>

                                <div style={{textAlign: 'right'}}>
                                    {cal.estado === 'entregado' || cal.estado === 'calificado' ? (
                                        <Link 
                                            to={`/evaluacion/${cal.id}/calificar`} 
                                            className="btn-primary btn-small"
                                        >
                                            <FaRobot /> Evaluar con IA
                                        </Link>
                                    ) : (
                                        <span className="no-file-text">Sin archivo</span>
                                    )}
                                </div>
                            </li>
                        )) : (
                            <div className="empty-state">
                                <p>No se encontraron entregas todavía.</p>
                                {isSyncing && <p><small>Buscando en Drive...</small></p>}
                            </div>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default CalificacionPanel;