// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';
import JustificacionModal from '../components/materia_panel/JustificacionModal'; // 1. IMPORTAR MODAL
import './CalificacionPanel.css';
import { 
    FaSync, FaArrowLeft, FaCheckCircle, FaClock, FaExclamationCircle,
    FaRobot, FaSearch, FaSpinner, FaUsers, FaUser, FaEdit, FaFileAlt, FaExternalLinkAlt,
    FaExclamationTriangle, FaEye // 2. IMPORTAR ICONO OJO
} from 'react-icons/fa';

// Función auxiliar para mensajes amigables
const traducirError = (errorMsg) => {
    if (!errorMsg) return "Error desconocido";
    const msg = String(errorMsg).toLowerCase();
    
    if (msg.includes("timeout")) return "El proceso tardó demasiado. Intenta de nuevo.";
    if (msg.includes("network") || msg.includes("fetch")) return "Error de conexión. Verifica tu internet.";
    if (msg.includes("json")) return "Error inesperado en la respuesta del servidor.";
    if (msg.includes("gemini") || msg.includes("ia")) return "La IA tuvo un problema temporal.";
    if (msg.includes("drive") || msg.includes("google")) return "Error de conexión con Google Drive.";
    if (msg.includes("rate limit") || msg.includes("429")) return "Demasiadas peticiones. Espera unos segundos.";
    
    return errorMsg; 
};

const CalificacionPanel = () => {
    const { id: actividadId } = useParams();
    const { showNotification } = useNotification();

    // Estados de Datos
    const [actividad, setActividad] = useState(null);
    const [calificaciones, setCalificaciones] = useState([]);
    
    // Estados de UI/Carga
    const [loadingData, setLoadingData] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isStartingBulk, setIsStartingBulk] = useState(false);
    const [isCheckingPlagio, setIsCheckingPlagio] = useState(false); // Por si decides usarlo luego
    
    // Estados de Selección y Modal
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [selectedJustificacion, setSelectedJustificacion] = useState(null); // 3. ESTADO DEL MODAL

    // Memo para saber si hay algún proceso masivo corriendo
    const isGlobalProcessing = useMemo(() => {
        return calificaciones.some(c => c.estado === 'procesando') || isStartingBulk || isCheckingPlagio;
    }, [calificaciones, isStartingBulk, isCheckingPlagio]);

    // -------------------------------------------------------------------------
    // 1. CARGA DE DATOS
    // -------------------------------------------------------------------------
    const fetchLocalData = useCallback(async () => {
        if (!actividadId) return;
        try {
            // A. Datos Actividad
            const { data: actData, error: actError } = await supabase
                .from('actividades').select('*').eq('id', actividadId).single();
            if (actError) throw actError;
            setActividad(actData);

            // B. Calificaciones (Incluye retroalimentación implícitamente en *)
            const { data: calData, error: calError } = await supabase
                .from('calificaciones')
                .select(`
                    *, 
                    alumnos(id, nombre, apellido, matricula),
                    grupos(id, nombre) 
                `)
                .eq('actividad_id', actividadId)
                .order('created_at', { ascending: false });

            if (calError) throw calError;
            setCalificaciones(calData || []);

        } catch (error) {
            console.error("Error fetch:", error);
            showNotification("Error cargando datos", "error");
        } finally {
            setLoadingData(false);
        }
    }, [actividadId, showNotification]);

    // -------------------------------------------------------------------------
    // 2. SINCRONIZACIÓN CON DRIVE
    // -------------------------------------------------------------------------
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

    // Carga inicial y Suscripción Realtime
    useEffect(() => {
        if (actividadId) {
            fetchLocalData();
            syncWithDrive(true); // Sincronización silenciosa al entrar
        }
    }, [actividadId]);

    useEffect(() => {
        if (!actividadId) return;
        const channel = supabase
            .channel(`calificaciones-actividad-${actividadId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'calificaciones', filter: `actividad_id=eq.${actividadId}` },
                (payload) => {
                    setCalificaciones(current => 
                        current.map(cal => 
                            cal.id === payload.new.id ? { ...cal, ...payload.new } : cal
                        )
                    );
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [actividadId]);

    // -------------------------------------------------------------------------
    // 3. LÓGICA DE VISUALIZACIÓN (Agrupación)
    // -------------------------------------------------------------------------
    const itemsToDisplay = useMemo(() => {
        const groups = {};
        const individuals = [];

        calificaciones.forEach(cal => {
            if (cal.grupo_id && cal.grupos) {
                if (!groups[cal.grupo_id]) {
                    groups[cal.grupo_id] = {
                        ...cal, 
                        isGroup: true,
                        displayName: cal.grupos.nombre,
                        members: [cal],
                        displayCount: 1
                    };
                } else {
                    groups[cal.grupo_id].members.push(cal);
                    groups[cal.grupo_id].displayCount++;
                }
            } else {
                individuals.push({
                    ...cal,
                    isGroup: false,
                    displayName: `${cal.alumnos?.nombre || ''} ${cal.alumnos?.apellido || ''}`,
                    displayMatricula: cal.alumnos?.matricula
                });
            }
        });

        return [...Object.values(groups), ...individuals].sort((a, b) => {
            if (a.isGroup && !b.isGroup) return -1;
            if (!a.isGroup && b.isGroup) return 1;
            return 0;
        });
    }, [calificaciones]);

    // -------------------------------------------------------------------------
    // 4. HANDLERS DE ACCIÓN
    // -------------------------------------------------------------------------
    const handleSelectOne = (item) => {
        const id = item.id;
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const validIds = itemsToDisplay
                .filter(item => ['entregado', 'calificado', 'requiere_revision_manual', 'fallido'].includes(item.estado))
                .map(item => item.id);
            setSelectedIds(new Set(validIds));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleEvaluacionMasiva = async () => {
        const idsArray = Array.from(selectedIds);
        if (idsArray.length === 0) return;
        
        setIsStartingBulk(true);
        try {
            const { error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', {
                body: { calificaciones_ids: idsArray }
            });
            if (error) throw error;
            
            showNotification(`Evaluación iniciada. El estado se actualizará automáticamente.`, 'success');
            setSelectedIds(new Set());
            
        } catch (error) {
            console.error("Error evaluación masiva:", error);
            showNotification("Error: " + error.message, 'error');
        } finally {
            setIsStartingBulk(false);
        }
    };

    const handleReintentar = async (calificacionId) => {
        if (!calificacionId) return;
        try {
            const { error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', {
                body: { calificaciones_ids: [calificacionId] }
            });
            if (error) throw error;
            showNotification(`Reintento iniciado.`, 'info');
        } catch (error) {
            showNotification("No se pudo reintentar: " + error.message, 'error');
        }
    };

    // Helper para badges
    const getStatusBadge = (item) => {
        switch (item.estado) {
            case 'calificado': 
                return <div className="status-badge success" title="Evaluación completada"><FaCheckCircle /> <span>Calificado</span></div>;
            case 'entregado': 
                return <div className="status-badge info" title="Listo para evaluar"><FaClock /> <span>Entregado</span></div>;
            case 'procesando': 
                return <div className="status-badge warning pulsate"><FaSpinner className="spin" /> <span>Procesando...</span></div>;
            case 'requiere_revision_manual':
                return <div className="status-badge danger"><FaExclamationCircle /> <span>Revisión Manual</span></div>;
            case 'fallido':
                return <div className="status-badge error" title={traducirError(item.ultimo_error)}><FaExclamationTriangle /> <span>Falló</span></div>;
            default: 
                return <span className="status-pill pendiente">Pendiente</span>;
        }
    };

    // -------------------------------------------------------------------------
    // RENDERIZADO
    // -------------------------------------------------------------------------
    return (
        <div className="calificacion-panel-container">
            {/* Header */}
            <div className="calificacion-header">
                <div>
                    <Link to={actividad ? `/materia/${actividad.materia_id}?tab=actividades` : '#'} className="back-link">
                        <FaArrowLeft /> Volver a Actividades
                    </Link>
                    <h2>{actividad ? actividad.nombre : 'Cargando...'}</h2>
                    <p className="subtitle">Panel de Evaluación {actividad?.tipo_entrega === 'grupal' ? '(Vista Grupal)' : ''}</p>
                </div>
                <div>
                    <button 
                        onClick={() => syncWithDrive(false)}
                        disabled={isSyncing || isGlobalProcessing} 
                        className="btn-secondary btn-small icon-button"
                    >
                        <FaSync className={isSyncing ? 'spin' : ''} />
                        {isSyncing ? ' Buscando...' : ' Actualizar Lista'}
                    </button>
                </div>
            </div>

            {/* Barra de Acciones Masivas */}
            {selectedIds.size > 0 && (
                <div className="bulk-actions-bar">
                    <span style={{fontWeight:'bold'}}>{selectedIds.size} seleccionados</span>
                    <button onClick={handleEvaluacionMasiva} disabled={isStartingBulk} className="btn-primary btn-small icon-button">
                        {isStartingBulk ? <FaSpinner className="spin"/> : <FaRobot />} 
                        {isStartingBulk ? ' Iniciando...' : ' Evaluar con IA'}
                    </button>
                </div>
            )}

            {/* 4. MODAL DE JUSTIFICACIÓN (Se muestra condicionalmente) */}
            {selectedJustificacion && (
                <JustificacionModal 
                    calificacion={selectedJustificacion}
                    entregable={selectedJustificacion} 
                    onClose={() => setSelectedJustificacion(null)}
                    loading={false}
                />
            )}

            {/* Tabla de Alumnos */}
            <div className="alumnos-list-container">
                <div className="list-header tabla-grid-layout">
                    <div className="col-center">
                        <input 
                            type="checkbox" 
                            onChange={handleSelectAll} 
                            disabled={itemsToDisplay.length === 0 || isGlobalProcessing}
                        />
                    </div>
                    <div></div> 
                    <div>Alumno / Equipo</div>
                    <div>Estado</div>
                    <div className="col-center">Nota</div>
                    <div className="col-right">Acciones</div>
                </div>

                {loadingData ? (
                    <div className="loading-state"><FaSpinner className="spin" /> Cargando datos...</div>
                ) : (
                    <ul className="alumnos-list">
                        {itemsToDisplay.length > 0 ? itemsToDisplay.map(item => {
                            const isSelected = selectedIds.has(item.id);
                            const hasFile = !!item.evidencia_drive_file_id;
                            const isLocked = item.estado === 'procesando' || isStartingBulk;
                            const isFinished = item.estado === 'calificado';

                            return (
                                <li key={item.id} className={`${isSelected ? 'selected-bg' : ''} ${isLocked ? 'row-processing' : ''} ${isFinished ? 'row-finished' : ''}`}>
                                    <div className="tabla-grid-layout">
                                        
                                        {/* Checkbox */}
                                        <div className="col-center">
                                            {hasFile && (
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected} 
                                                    onChange={() => handleSelectOne(item)}
                                                    disabled={isLocked || isFinished} 
                                                />
                                            )}
                                        </div>

                                        {/* Icono Tipo */}
                                        <div className="col-center">
                                            {item.isGroup ? <FaUsers style={{color:'#6366f1'}}/> : <FaUser style={{color:'#94a3b8'}}/>}
                                        </div>
                                        
                                        {/* Nombre y Enlace */}
                                        <div className="alumno-info">
                                            {item.drive_url_entrega ? (
                                                <a href={item.drive_url_entrega} target="_blank" rel="noreferrer" className="alumno-link-archivo">
                                                    <span className="entregable-nombre">{item.displayName}</span>
                                                    <FaExternalLinkAlt style={{fontSize:'0.7rem', marginLeft:'5px', opacity:0.5}}/>
                                                </a>
                                            ) : (
                                                <span className="entregable-nombre">{item.displayName}</span>
                                            )}
                                            <span className="matricula-text">
                                                {item.isGroup ? `${item.displayCount} Integrantes` : item.displayMatricula}
                                            </span>
                                        </div>

                                        {/* Estado */}
                                        <div>{getStatusBadge(item)}</div>

                                        {/* Nota */}
                                        <div className="col-center">
                                            {item.calificacion_obtenida != null ? (
                                                <span className={`calificacion-badge ${item.calificacion_obtenida >= 70 ? 'aprobado' : 'reprobado'}`}>
                                                    {item.calificacion_obtenida}
                                                </span>
                                            ) : <span className="calificacion-badge pendiente">-</span>}
                                        </div>

                                        {/* ACCIONES */}
                                        <div className="col-right actions-group">
                                            {/* BOTÓN OJO: Ver Retro (Solo si calificado) */}
                                            {isFinished && (
                                                <button 
                                                    onClick={() => setSelectedJustificacion(item)}
                                                    className="btn-secondary btn-small icon-button"
                                                    title="Ver Justificación de la IA"
                                                >
                                                    <FaEye /> Ver Retro
                                                </button>
                                            )}

                                            {/* Botón Manual */}
                                            {hasFile && (
                                                <Link 
                                                    to={`/evaluacion/${item.id}/calificar`} 
                                                    className="btn-tertiary btn-small"
                                                    title="Editar manualmente"
                                                >
                                                    <FaEdit />
                                                </Link>
                                            )}
                                            
                                            {/* Botón Reintentar */}
                                            {item.estado === 'fallido' && (
                                                <button onClick={() => handleReintentar(item.id)} className="btn-error-retry btn-small">
                                                    <FaSync /> Reintentar
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        }) : (
                            <li className="empty-state">No se encontraron entregas.</li>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default CalificacionPanel;