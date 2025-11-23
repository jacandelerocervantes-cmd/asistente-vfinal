// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom'; 
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';
import './CalificacionPanel.css';
import { 
    FaSync, FaArrowLeft, FaCheckCircle, FaClock, FaExclamationCircle, 
    FaRobot, FaSearch, FaSpinner 
} from 'react-icons/fa';

const CalificacionPanel = () => {
    const { id: actividadId } = useParams();
    const [actividad, setActividad] = useState(null);
    const [loadingData, setLoadingData] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [calificaciones, setCalificaciones] = useState([]);
    
    // Selección múltiple
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isStartingBulk, setIsStartingBulk] = useState(false);
    const [isCheckingPlagio, setIsCheckingPlagio] = useState(false);

    const { showNotification } = useNotification();

    // 1. Cargar Datos
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

    // 2. Sincronizar con Drive
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

    // --- Lógica de Selección ---
    const itemsSelectable = useMemo(() => {
        // Solo permitir seleccionar si hay entrega o ya está calificado (implica que hay archivo)
        return calificaciones.filter(c => c.estado === 'entregado' || c.estado === 'calificado' || c.estado === 'procesando');
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

    // --- Lógica de Evaluación Masiva ---
    const handleEvaluacionMasiva = async () => {
        const idsArray = Array.from(selectedIds);
        if (idsArray.length === 0) return;

        if (!window.confirm(`¿Iniciar evaluación automática para ${idsArray.length} alumnos?`)) return;

        setIsStartingBulk(true);
        try {
            const { data, error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', {
                body: { calificaciones_ids: idsArray }
            });

            if (error) throw error;

            showNotification(`Proceso iniciado: ${data.message}`, 'success');
            setSelectedIds(new Set());
            fetchLocalData();

        } catch (error) {
            console.error("Error evaluación masiva:", error);
            showNotification("Error al iniciar evaluación: " + error.message, 'error');
        } finally {
            setIsStartingBulk(false);
        }
    };

    // --- NUEVO: Lógica de Comprobación de Plagio ---
    const handleCheckPlagio = async () => {
        const idsArray = Array.from(selectedIds);
        
        // Obtener los file_ids de Drive correspondientes a las calificaciones seleccionadas
        const selectedCalifs = calificaciones.filter(c => idsArray.includes(c.id));
        const driveFileIds = selectedCalifs
            .map(c => c.evidencia_drive_file_id)
            .filter(id => id); // Eliminar nulos

        if (driveFileIds.length < 2) {
            showNotification("Selecciona al menos 2 trabajos con archivo para comprobar plagio.", 'warning');
            return;
        }

        if (!window.confirm(`¿Analizar plagio entre los ${driveFileIds.length} trabajos seleccionados?`)) return;

        setIsCheckingPlagio(true);
        try {
            const { data, error } = await supabase.functions.invoke('encolar-comprobacion-plagio', {
                body: { 
                    drive_file_ids: driveFileIds,
                    materia_id: actividad?.materia_id // Necesario para guardar el reporte
                }
            });

            if (error) throw error;

            showNotification("Análisis de plagio iniciado. Se generará un reporte en la pestaña 'Reportes' pronto.", 'success');
            setSelectedIds(new Set()); // Limpiar selección

        } catch (error) {
            console.error("Error plagio:", error);
            showNotification("Error al iniciar comprobación de plagio: " + error.message, 'error');
        } finally {
            setIsCheckingPlagio(false);
        }
    };

    const getStatusIcon = (estado) => {
        switch (estado) {
            case 'calificado': return <FaCheckCircle className="icon-success" style={{color: '#16a34a', fontSize:'1.2rem'}} />;
            case 'entregado': return <FaClock className="icon-info" style={{color: '#2563eb', fontSize:'1.2rem'}} />;
            case 'procesando': return <FaSpinner className="spin" style={{color: '#ca8a04', fontSize:'1.2rem'}} />;
            default: return <FaExclamationCircle style={{color: '#cbd5e1', fontSize:'1.2rem'}} />;
        }
    };

    const isAllSelected = itemsSelectable.length > 0 && selectedIds.size === itemsSelectable.length;

    return (
        <div className="calificacion-panel-container">
            {/* Header */}
            <div className="calificacion-header">
                <div>
                    <Link to={actividad ? `/materia/${actividad.materia_id}?tab=actividades` : '#'} className="back-link">
                        <FaArrowLeft /> Volver a Actividades
                    </Link>
                    <h2>{actividad ? actividad.nombre : 'Cargando...'}</h2>
                    <p className="subtitle">Panel de Evaluación</p>
                </div>
                <div>
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

            {/* Barra Flotante de Acciones Masivas */}
            {selectedIds.size > 0 && (
                <div className="bulk-actions-bar">
                    <div className="bulk-actions-left">
                        <span className="selected-count">{selectedIds.size} seleccionados</span>
                    </div>
                    <div className="bulk-actions-right">
                        {/* BOTÓN PLAGIO */}
                        <button 
                            onClick={handleCheckPlagio} 
                            disabled={isCheckingPlagio}
                            className="btn-secondary btn-small icon-button"
                            title="Comparar trabajos seleccionados"
                        >
                            {isCheckingPlagio ? <FaSpinner className="spin"/> : <FaSearch />}
                            {isCheckingPlagio ? 'Enviando...' : 'Comprobar Plagio'}
                        </button>

                        {/* BOTÓN EVALUAR IA */}
                        <button 
                            onClick={handleEvaluacionMasiva} 
                            disabled={isStartingBulk}
                            className="btn-primary btn-small icon-button"
                            title="Calificar con IA"
                        >
                            {isStartingBulk ? <FaSpinner className="spin"/> : <FaRobot />}
                            {isStartingBulk ? 'Iniciando...' : 'Evaluar con IA'}
                        </button>
                    </div>
                </div>
            )}

            {/* Tabla Grid Alineada */}
            <div className="alumnos-list-container">
                {/* Encabezado de Tabla (Grid) */}
                <div className="calificacion-grid-row list-header">
                    <div className="col-center">
                        <input 
                            type="checkbox" 
                            onChange={handleSelectAll} 
                            checked={isAllSelected}
                            disabled={itemsSelectable.length === 0}
                        />
                    </div>
                    <div className="col-center"></div> {/* Columna para icono */}
                    <div>Alumno / Equipo</div>
                    <div>Estado</div>
                    <div className="col-center">Nota</div>
                    <div className="col-right">Acciones</div>
                </div>

                {loadingData ? (
                    <div style={{padding: '2rem', textAlign: 'center', color: '#666'}}>
                        <FaSpinner className="spin" /> Cargando alumnos...
                    </div>
                ) : (
                    <ul className="alumnos-list">
                        {calificaciones.length > 0 ? calificaciones.map(cal => {
                            const isSelected = selectedIds.has(cal.id);
                            const canSelect = !!cal.evidencia_drive_file_id; // Solo si tiene archivo

                            return (
                                <li key={cal.id} className={isSelected ? 'selected-bg' : ''}>
                                    <div className="calificacion-grid-row">
                                        
                                        {/* 1. Checkbox */}
                                        <div className="col-center">
                                            {canSelect && (
                                                <input 
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => handleSelectOne(cal.id)}
                                                />
                                            )}
                                        </div>

                                        {/* 2. Icono Estado */}
                                        <div className="col-center">
                                            {getStatusIcon(cal.estado)}
                                        </div>
                                        
                                        {/* 3. Info Alumno */}
                                        <div className="alumno-info">
                                            <span className="entregable-nombre">
                                                {cal.alumnos?.nombre} {cal.alumnos?.apellido}
                                            </span>
                                            <span className="matricula-text">
                                                {cal.alumnos?.matricula}
                                            </span>
                                        </div>

                                        {/* 4. Estado Texto */}
                                        <div>
                                            <span className={`status-pill ${cal.estado || 'pendiente'}`}>
                                                {cal.estado === 'procesando' ? cal.progreso_evaluacion || 'Procesando...' : 
                                                 cal.estado || 'Pendiente'}
                                            </span>
                                        </div>

                                        {/* 5. Nota */}
                                        <div className="col-center">
                                            {cal.calificacion_obtenida !== null ? (
                                                <span className={`calificacion-badge ${cal.calificacion_obtenida >= 70 ? 'aprobado' : 'reprobado'}`}>
                                                    {cal.calificacion_obtenida}
                                                </span>
                                            ) : '-'}
                                        </div>

                                        {/* 6. Acciones */}
                                        <div className="col-right">
                                            {(cal.estado === 'entregado' || cal.estado === 'calificado') && (
                                                <Link 
                                                    to={`/evaluacion/${cal.id}/calificar`} 
                                                    className="btn-tertiary btn-small icon-button"
                                                    title="Ver detalle / Evaluar manualmente"
                                                    style={{padding: '6px 8px'}}
                                                >
                                                    <FaRobot />
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        }) : (
                            <div style={{padding: '2rem', textAlign: 'center', color: '#888'}}>
                                No se encontraron entregas todavía.
                            </div>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default CalificacionPanel;