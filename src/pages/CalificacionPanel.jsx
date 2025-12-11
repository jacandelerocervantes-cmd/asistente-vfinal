// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';
import JustificacionModal from '../components/materia_panel/JustificacionModal';
import './CalificacionPanel.css';
import { 
    FaSync, FaArrowLeft, FaCheckCircle, FaClock, FaExclamationCircle,
    FaRobot, FaSpinner, FaUsers, FaUser, FaEdit, FaFileAlt, FaExternalLinkAlt,
    FaExclamationTriangle, FaEye
} from 'react-icons/fa';

const traducirError = (errorMsg) => {
    if (!errorMsg) return "Error desconocido";
    const msg = String(errorMsg).toLowerCase();
    if (msg.includes("timeout")) return "El proceso tardó demasiado. Intenta de nuevo.";
    if (msg.includes("network") || msg.includes("fetch")) return "Error de conexión.";
    if (msg.includes("rate limit") || msg.includes("429")) return "Demasiadas peticiones.";
    return errorMsg; 
};

const CalificacionPanel = () => {
    const { id: actividadId } = useParams();
    const { showNotification } = useNotification();

    // Estados de Datos
    const [actividad, setActividad] = useState(null);
    const [calificaciones, setCalificaciones] = useState([]);
    const [loadingData, setLoadingData] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isStartingBulk, setIsStartingBulk] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [selectedJustificacion, setSelectedJustificacion] = useState(null);

    // Ref para evitar bucles infinitos de auto-sync
    const hasAutoSynced = useRef(false);

    const isGlobalProcessing = useMemo(() => {
        return calificaciones.some(c => c.estado === 'procesando') || isStartingBulk;
    }, [calificaciones, isStartingBulk]);

    // -------------------------------------------------------------------------
    // 1. CARGA DE DATOS + AUTO-REPARACIÓN (Auto-Sync)
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
                .select(`*, alumnos(id, nombre, apellido, matricula), grupos(id, nombre)`)
                .eq('actividad_id', actividadId)
                .order('created_at', { ascending: false });

            if (calError) throw calError;
            const data = calData || [];
            setCalificaciones(data);

            // --- LÓGICA DE AUTO-RECUPERACIÓN ---
            // Detectar si hay calificaciones "huérfanas" (Calificado pero sin texto)
            const faltanJustificaciones = data.some(c => 
                c.estado === 'calificado' && 
                (!c.retroalimentacion || c.retroalimentacion.trim() === "")
            );

            // Solo ejecutamos auto-sync una vez por montaje para no saturar
            if (faltanJustificaciones && !hasAutoSynced.current) {
                console.log("Detectadas calificaciones sin justificación. Iniciando auto-reparación...");
                hasAutoSynced.current = true; // Marcar como ejecutado
                
                // Ejecutar en segundo plano sin bloquear la UI
                handleAutoSyncSheets(); 
            }

        } catch (error) {
            console.error("Error fetch:", error);
            showNotification("Error cargando datos", "error");
        } finally {
            setLoadingData(false);
        }
    }, [actividadId, showNotification]);

    // -------------------------------------------------------------------------
    // 2. FUNCIÓN DE SINCRONIZACIÓN AUTOMÁTICA (Sheets -> DB)
    // -------------------------------------------------------------------------
    const handleAutoSyncSheets = async () => {
        try {
            // No ponemos loading global para no interrumpir al usuario, 
            // pero mostramos una notificación discreta
            // showNotification('Sincronizando textos desde Excel...', 'info'); 

            const { data, error } = await supabase.functions.invoke('sincronizar-evaluacion-sheets', {
                body: { actividad_id: actividadId }
            });

            if (error) throw error;

            console.log("Auto-sync completado:", data.message);
            
            // Recargamos los datos silenciosamente para mostrar los textos recuperados
            const { data: newData } = await supabase
                .from('calificaciones')
                .select(`*, alumnos(id, nombre, apellido, matricula), grupos(id, nombre)`)
                .eq('actividad_id', actividadId)
                .order('created_at', { ascending: false });
            
            if (newData) setCalificaciones(newData);

        } catch (error) {
            console.error("Error en auto-sync:", error);
            // No mostramos error al usuario para no alarmar, se reintentará en la próxima carga
        }
    };

    // -------------------------------------------------------------------------
    // 3. SINCRONIZACIÓN CON DRIVE (Archivos)
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
            console.error("Error sync drive:", error);
            if (!silent) showNotification('Error conectando con Drive.', 'error');
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
            .channel(`calificaciones-${actividadId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calificaciones', filter: `actividad_id=eq.${actividadId}` }, 
            (payload) => {
                setCalificaciones(current => current.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c));
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [actividadId]);

    // -------------------------------------------------------------------------
    // 4. LÓGICA DE VISUALIZACIÓN
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
        return [...Object.values(groups), ...individuals].sort((a, b) => (a.isGroup === b.isGroup ? 0 : a.isGroup ? -1 : 1));
    }, [calificaciones]);

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const validIds = itemsToDisplay.filter(i => ['entregado', 'calificado', 'fallido'].includes(i.estado)).map(i => i.id);
            setSelectedIds(new Set(validIds));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectOne = (item) => {
        setSelectedIds(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; });
    };

    const handleEvaluacionMasiva = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        setIsStartingBulk(true);
        try {
            const { error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', { body: { calificaciones_ids: ids } });
            if (error) throw error;
            showNotification(`Evaluación iniciada.`, 'success');
            setSelectedIds(new Set());
        } catch (e) { showNotification("Error: " + e.message, 'error'); } 
        finally {
            setIsStartingBulk(false);
        }
    };

    const handleReintentar = async (id) => {
        try {
            const { error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', { body: { calificaciones_ids: [id] } });
            if (error) throw error;
            showNotification(`Reintentando...`, 'info');
        } catch (e) { showNotification("Error: " + e.message, 'error'); }
    };

    // Helper para badges
    const getStatusBadge = (item) => {
        switch (item.estado) {
            case 'calificado': return <div className="status-badge success"><FaCheckCircle /> <span>Calificado</span></div>;
            case 'entregado': return <div className="status-badge info"><FaClock /> <span>Entregado</span></div>;
            case 'procesando': return <div className="status-badge warning pulsate"><FaSpinner className="spin"/> <span>Procesando...</span></div>;
            case 'fallido': return <div className="status-badge error" title={traducirError(item.ultimo_error)}><FaExclamationTriangle /> <span>Falló</span></div>;
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
                    <p className="subtitle">Panel de Evaluación</p>
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

            {/* Bulk Actions */}
            {selectedIds.size > 0 && (
                <div className="bulk-actions-bar">
                    <span style={{fontWeight:'bold'}}>{selectedIds.size} seleccionados</span>
                    <button onClick={handleEvaluacionMasiva} disabled={isStartingBulk} className="btn-primary btn-small icon-button">
                        {isStartingBulk ? <FaSpinner className="spin"/> : <FaRobot />} 
                        {isStartingBulk ? ' Iniciando...' : ' Evaluar con IA'}
                    </button>
                </div>
            )}

            {/* Modal */}
            {selectedJustificacion && (
                <JustificacionModal 
                    calificacion={selectedJustificacion}
                    entregable={selectedJustificacion} 
                    onClose={() => setSelectedJustificacion(null)}
                />
            )}

            {/* Table */}
            <div className="alumnos-list-container">
                <div className="list-header tabla-grid-layout">
                    <div className="col-center"><input type="checkbox" onChange={handleSelectAll} disabled={isGlobalProcessing}/></div>
                    <div></div><div>Alumno</div><div>Estado</div><div className="col-center">Nota</div><div className="col-right">Acciones</div>
                </div>

                {loadingData ? <div className="loading-state"><FaSpinner className="spin"/> Cargando...</div> : (
                    <ul className="alumnos-list">
                        {itemsToDisplay.map(item => {
                            const isSel = selectedIds.has(item.id);
                            const isFinished = item.estado === 'calificado';
                            const isLocked = item.estado === 'procesando' || isStartingBulk;
                            const hasFile = !!item.evidencia_drive_file_id;

                            return (
                                <li key={item.id} className={`${isSel ? 'selected-bg' : ''} ${isLocked ? 'row-processing' : ''} ${isFinished ? 'row-finished' : ''}`}>
                                    <div className="tabla-grid-layout">
                                        <div className="col-center">
                                            {hasFile && (
                                                <input type="checkbox" checked={isSel} onChange={() => handleSelectOne(item)} disabled={isLocked || isFinished} />
                                            )}
                                        </div>
                                        <div className="col-center">{item.isGroup ? <FaUsers color="#6366f1"/> : <FaUser color="#94a3b8"/>}</div>
                                        <div className="alumno-info">
                                            {item.drive_url_entrega ? (
                                                <a href={item.drive_url_entrega} target="_blank" rel="noreferrer" className="alumno-link-archivo">
                                                    <span className="entregable-nombre">{item.displayName}</span>
                                                    <FaExternalLinkAlt style={{fontSize:'0.7rem', marginLeft:'5px', opacity:0.5}}/>
                                                </a>
                                            ) : (
                                                <span className="entregable-nombre">{item.displayName}</span>
                                            )}
                                            <span className="matricula-text">{item.isGroup ? 'Equipo' : item.displayMatricula}</span>
                                        </div>
                                        <div>{getStatusBadge(item)}</div>
                                        <div className="col-center">
                                            {item.calificacion_obtenida != null ? (
                                                <span className={`calificacion-badge ${item.calificacion_obtenida >= 70 ? 'aprobado' : 'reprobado'}`}>
                                                    {item.calificacion_obtenida}
                                                </span>
                                            ) : '-'}
                                        </div>
                                        <div className="col-right actions-group">
                                            {isFinished && (
                                                <button onClick={() => setSelectedJustificacion(item)} className="btn-secondary btn-small icon-button" title="Ver Retro">
                                                    <FaEye /> Ver Retro
                                                </button>
                                            )}
                                            {item.estado === 'fallido' && (
                                                <button onClick={() => handleReintentar(item.id)} className="btn-error-retry btn-small"><FaSync /> Reintentar</button>
                                            )}
                                            {hasFile && (
                                                <Link to={`/evaluacion/${item.id}/calificar`} className="btn-tertiary btn-small"><FaEdit/></Link>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                        {itemsToDisplay.length === 0 && <li className="empty-state">No hay entregas aún.</li>}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default CalificacionPanel;