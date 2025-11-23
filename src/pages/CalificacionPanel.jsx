// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom'; 
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';
import './CalificacionPanel.css';
import { FaSync, FaArrowLeft, FaCheckCircle, FaClock, FaExclamationCircle, FaRobot, FaCheckSquare, FaSquare } from 'react-icons/fa';

const CalificacionPanel = () => {
    const { id: actividadId } = useParams();
    const [actividad, setActividad] = useState(null);
    const [loadingData, setLoadingData] = useState(true); // Estado para carga inicial de DB
    const [isSyncing, setIsSyncing] = useState(false);    // Estado para la sincronización en 2do plano
    const [calificaciones, setCalificaciones] = useState([]);
    
    // --- NUEVO: Estado para selección múltiple ---
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isStartingBulk, setIsStartingBulk] = useState(false);

    const { showNotification } = useNotification();

    const fetchLocalData = useCallback(async () => {
        if (!actividadId) return;
        try {
            const { data: actData, error: actError } = await supabase
                .from('actividades').select('*').eq('id', actividadId).single();
            if (actError) throw actError;
            setActividad(actData);

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

    const syncWithDrive = useCallback(async (silent = false) => {
        if (!actividadId) return;
        setIsSyncing(true);
        if (!silent) showNotification('Buscando entregas nuevas en Drive...', 'info');

        try {
            const { data, error } = await supabase.functions.invoke('sync-activity-deliveries', {
                body: { actividad_id: actividadId }
            });

            if (error) throw error;

            if (data.nuevos > 0) {
                showNotification(`Se encontraron ${data.nuevos} entregas nuevas.`, 'success');
                await fetchLocalData();
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

    useEffect(() => {
        if (actividadId) {
            fetchLocalData();
            syncWithDrive(true);
        }
    }, [actividadId, fetchLocalData, syncWithDrive]);

    // --- NUEVO: Lógica de Selección ---

    // Filtrar solo los que se pueden calificar (Entregado o Calificado, que tengan ID)
    const itemsSelectable = useMemo(() => {
        return calificaciones.filter(c => c.estado === 'entregado' || c.estado === 'calificado');
    }, [calificaciones]);

    const handleSelectOne = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const allIds = itemsSelectable.map(c => c.id);
            setSelectedIds(new Set(allIds));
        } else {
            setSelectedIds(new Set());
        }
    };

    // --- NUEVO: Lógica de Evaluación Masiva ---
    const handleEvaluacionMasiva = async () => {
        const idsArray = Array.from(selectedIds);
        if (idsArray.length === 0) return;

        if (!window.confirm(`¿Iniciar evaluación automática para ${idsArray.length} alumnos? Esto se procesará en segundo plano.`)) {
            return;
        }

        setIsStartingBulk(true);
        try {
            const { data, error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', {
                body: { calificaciones_ids: idsArray }
            });

            if (error) throw error;

            showNotification(`Proceso iniciado: ${data.message}`, 'success');
            setSelectedIds(new Set()); // Limpiar selección
            fetchLocalData(); // Recargar para ver cambios de estado (a 'pendiente' o 'procesando')

        } catch (error) {
            console.error("Error evaluacion masiva:", error);
            showNotification("Error al iniciar evaluación masiva: " + error.message, 'error');
        } finally {
            setIsStartingBulk(false);
        }
    };

    const getStatusIcon = (estado) => {
        switch (estado) {
            case 'calificado': return <FaCheckCircle className="icon-success" />;
            case 'entregado': return <FaClock className="icon-info" />;
            default: return <FaExclamationCircle className="icon-warning" />;
        }
    };

    // Checkbox "Todos" state
    const isAllSelected = itemsSelectable.length > 0 && selectedIds.size === itemsSelectable.length;

    return (
        <div className="calificacion-panel-container">
            <div className="calificacion-header">
                <div>
                    <Link 
                        to={actividad ? `/materia/${actividad.materia_id}?tab=actividades` : '#'} 
                        className="back-link"
                    >
                        <FaArrowLeft /> Volver a Actividades
                    </Link>
                    <h2>{actividad ? actividad.nombre : 'Cargando actividad...'}</h2>
                    <p className="subtitle">Panel de Evaluación</p>
                </div>
                <div className="header-actions">
                    <button 
                        onClick={() => syncWithDrive(false)} 
                        disabled={isSyncing} 
                        className="btn-secondary btn-small icon-button"
                    >
                        <FaSync className={isSyncing ? 'spin' : ''} /> 
                        {isSyncing ? ' Buscando...' : ' Actualizar Lista'}
                    </button>
                </div>
            </div>

            {/* --- NUEVO: Barra de Acciones Masivas --- */}
            {selectedIds.size > 0 && (
                <div className="bulk-actions-bar fade-in">
                    <span>{selectedIds.size} seleccionados</span>
                    <button 
                        onClick={handleEvaluacionMasiva} 
                        disabled={isStartingBulk}
                        className="btn-primary icon-button"
                    >
                        {isStartingBulk ? <FaSync className="spin"/> : <FaRobot />}
                        {isStartingBulk ? 'Iniciando...' : 'Evaluar Seleccionados con IA'}
                    </button>
                </div>
            )}

            <div className="alumnos-list-container">
                <div className="list-header">
                    {/* --- NUEVO: Checkbox Seleccionar Todos --- */}
                    <div style={{width: '40px', display: 'flex', justifyContent: 'center'}}>
                        <input 
                            type="checkbox" 
                            onChange={handleSelectAll} 
                            checked={isAllSelected}
                            disabled={itemsSelectable.length === 0}
                        />
                    </div>
                    <span style={{flex: 2}}>Alumno / Equipo</span>
                    <span style={{flex: 1}}>Estado</span>
                    <span style={{flex: 1, textAlign: 'center'}}>Calificación</span>
                    <span style={{flex: 1, textAlign: 'right'}}>Acciones</span>
                </div>

                {loadingData ? (
                    <div className="loading-state">Cargando lista de alumnos...</div>
                ) : (
                    <ul className="alumnos-list">
                        {calificaciones.length > 0 ? calificaciones.map(cal => {
                            const canSelect = cal.estado === 'entregado' || cal.estado === 'calificado';
                            return (
                                <li key={cal.id} className={cal.estado === 'calificado' ? 'calificado-row' : ''}>
                                    
                                    {/* --- NUEVO: Checkbox Individual --- */}
                                    <div style={{width: '40px', display: 'flex', justifyContent: 'center'}}>
                                        {canSelect && (
                                            <input 
                                                type="checkbox"
                                                checked={selectedIds.has(cal.id)}
                                                onChange={() => handleSelectOne(cal.id)}
                                            />
                                        )}
                                    </div>

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
                                             cal.estado === 'calificado' ? 'Calificado' : 
                                             cal.estado === 'procesando' ? 'Evaluando IA...' :
                                             'Pendiente'}
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
                                        {/* Mantenemos el botón individual por si acaso */}
                                        {(cal.estado === 'entregado' || cal.estado === 'calificado') && (
                                            <Link 
                                                to={`/evaluacion/${cal.id}/calificar`} 
                                                className="btn-secondary btn-small btn-icon-only"
                                                title="Ver detalle / Evaluar individual"
                                            >
                                                <FaRobot />
                                            </Link>
                                        )}
                                    </div>
                                </li>
                            );
                        }) : (
                            <div className="empty-state">
                                <p>No se encontraron entregas todavía.</p>
                            </div>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default CalificacionPanel;