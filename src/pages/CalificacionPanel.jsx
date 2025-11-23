// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom'; // Agregué Link para el botón de volver
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';
import './CalificacionPanel.css';
import { FaSync, FaArrowLeft, FaCheckCircle, FaClock, FaExclamationCircle } from 'react-icons/fa';

const CalificacionPanel = () => {
    const { actividadId } = useParams();
    const [actividad, setActividad] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [calificaciones, setCalificaciones] = useState([]);
    const { showNotification } = useNotification();

    // Cargar datos de la actividad
    useEffect(() => {
        const fetchActividad = async () => {
            const { data } = await supabase.from('actividades').select('*').eq('id', actividadId).single();
            setActividad(data);
        };
        fetchActividad();
    }, [actividadId]);

    // Función para obtener las calificaciones
    const fetchCalificaciones = useCallback(async () => {
        setIsLoading(true);
        const { data, error } = await supabase
            .from('calificaciones')
            .select('*, alumnos(id, nombre, apellido, matricula)')
            .eq('actividad_id', actividadId)
            .order('created_at', { ascending: false });

        if (error) {
            showNotification('Error al cargar lista: ' + error.message, 'error');
        } else {
            setCalificaciones(data || []);
        }
        setIsLoading(false);
    }, [actividadId, showNotification]);

    // Sincronizar con Drive (Llamada a la Edge Function)
    const handleSync = useCallback(async () => {
        setIsLoading(true);
        showNotification('Buscando nuevas entregas en Drive...', 'info');
        try {
            // Llamamos a la función con el nombre correcto
            const { data, error } = await supabase.functions.invoke('sync-activity-deliveries', {
                body: { actividad_id: actividadId }
            });

            if (error) throw error;

            showNotification(`Sincronización completa. ${data.nuevos || 0} nuevos archivos.`, 'success');
            await fetchCalificaciones();

        } catch (error) {
            console.error(error);
            showNotification('Error de sincronización: ' + (error.message || "Error de red"), 'error');
        } finally {
            setIsLoading(false);
        }
    }, [actividadId, showNotification, fetchCalificaciones]);

    // Cargar al inicio
    useEffect(() => {
        fetchCalificaciones();
    }, [fetchCalificaciones]);

    // Helper para iconos de estado
    const getStatusIcon = (estado) => {
        switch (estado) {
            case 'calificado': return <FaCheckCircle />;
            case 'entregado': return <FaClock />;
            default: return <FaExclamationCircle />;
        }
    };

    return (
        <div className="calificacion-panel-container">
            <div className="calificacion-header">
                <div>
                    <Link to={`/materia/${actividad?.materia_id}/actividades`} className="back-link">
                        <FaArrowLeft /> Volver a Actividades
                    </Link>
                    <h2>{actividad ? actividad.nombre : 'Cargando...'}</h2>
                    <p>Panel de Evaluación y Retroalimentación</p>
                </div>
                
                <button 
                    onClick={handleSync} 
                    disabled={isLoading} 
                    className="btn-primary icon-button"
                >
                    <FaSync className={isLoading ? 'spin' : ''} />
                    {isLoading ? 'Sincronizando...' : 'Sincronizar Entregas'}
                </button>
            </div>

            <div className="alumnos-list-container">
                <div className="list-header">
                    <span style={{width: '30px'}}></span> {/* Espacio para checkbox/icono */}
                    <span style={{flex: 2}}>Alumno</span>
                    <span style={{flex: 1}}>Estado</span>
                    <span style={{flex: 1, textAlign: 'center'}}>Calificación</span>
                    <span style={{flex: 1, textAlign: 'right'}}>Acciones</span>
                </div>

                <ul className="alumnos-list">
                    {calificaciones.length > 0 ? calificaciones.map(cal => (
                        <li key={cal.id} className={cal.estado === 'calificado' ? 'calificado-row' : ''}>
                            <div className="status-icon-col" style={{color: '#666'}}>
                                {getStatusIcon(cal.estado)}
                            </div>
                            
                            <div className="alumno-info">
                                <span className="entregable-nombre">
                                    {cal.alumnos?.nombre} {cal.alumnos?.apellido}
                                </span>
                                <div style={{fontSize: '0.85em', color: '#888'}}>
                                    {cal.alumnos?.matricula}
                                </div>
                            </div>

                            <div>
                                <span className={`status-pill ${cal.estado || 'pendiente'}`}>
                                    {cal.estado || 'Pendiente'}
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
                                <button className="btn-secondary btn-small">
                                    Evaluar con IA
                                </button>
                            </div>
                        </li>
                    )) : (
                        <div style={{padding: '2rem', textAlign: 'center', color: '#666'}}>
                            No hay entregas registradas. Pulsa "Sincronizar" para buscar archivos en Drive.
                        </div>
                    )}
                </ul>
            </div>
        </div>
    );
};

export default CalificacionPanel;