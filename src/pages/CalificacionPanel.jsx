// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom'; 
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';
import JustificacionModal from '../components/materia_panel/JustificacionModal'; // <-- 1. IMPORTAR MODAL
import './CalificacionPanel.css';
import { 
    FaSync, FaArrowLeft, FaCheckCircle, FaClock, FaExclamationCircle,
    FaRobot, FaSearch, FaSpinner, FaUsers, FaUser, FaEdit, FaFileAlt, FaExternalLinkAlt,
    FaExclamationTriangle, FaEye // <-- 2. AÑADIR FaEye
} from 'react-icons/fa';

// --- AÑADE ESTA FUNCIÓN AQUÍ ---
const traducirError = (errorMsg) => {
    if (!errorMsg) return "Error desconocido";
    const msg = String(errorMsg).toLowerCase();
    
    if (msg.includes("timeout")) return "El proceso tardó demasiado. Intenta de nuevo.";
    if (msg.includes("network") || msg.includes("fetch")) return "Error de conexión. Verifica tu internet.";
    if (msg.includes("json")) return "Error inesperado en la respuesta del servidor.";
    if (msg.includes("gemini") || msg.includes("ia")) return "La IA tuvo un problema temporal.";
    if (msg.includes("drive") || msg.includes("google")) return "Error de conexión con Google Drive.";
    if (msg.includes("rate limit") || msg.includes("429")) return "Demasiadas peticiones. Espera unos segundos.";
    
    return errorMsg; // Si no coincide, devuelve el mensaje técnico original
};
// --------------------------------

const CalificacionPanel = () => {
    const { id: actividadId } = useParams();
    const [actividad, setActividad] = useState(null);
    const [loadingData, setLoadingData] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [calificaciones, setCalificaciones] = useState([]);
    
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isStartingBulk, setIsStartingBulk] = useState(false);
    const [isCheckingPlagio, setIsCheckingPlagio] = useState(false);
    const [selectedJustificacion, setSelectedJustificacion] = useState(null); // <-- 3. ESTADO PARA MODAL
    // const [isRetrying, setIsRetrying] = useState(false); // No se usa si el reintento es masivo

    const { showNotification } = useNotification();

    const isGlobalProcessing = useMemo(() => {
        return calificaciones.some(c => c.estado === 'procesando') || isStartingBulk || isCheckingPlagio;
    }, [calificaciones, isStartingBulk, isCheckingPlagio]);

    const fetchLocalData = useCallback(async () => {
        if (!actividadId) return;
        try {
            const { data: actData, error: actError } = await supabase
                .from('actividades').select('*').eq('id', actividadId).single();
            if (actError) throw actError;
            setActividad(actData);

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
                            cal.id === payload.new.id 
                                ? { ...cal, ...payload.new } 
                                : cal
                        )
                    );
                }
            )
            .subscribe();

        // Limpieza al desmontar
        return () => { supabase.removeChannel(channel); };
    }, [actividadId]);

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
            // CORRECCIÓN: No seleccionar los que ya se están procesando
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
        
        setIsStartingBulk(true); // Bloqueo inicial UI
        try {
            const { data, error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', {
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
        
        // No usamos el bloqueo global 'isStartingBulk' para permitir otras acciones.
        // El bloqueo de fila individual se encargará de la UI.
        try {
            const { error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', {
                body: { calificaciones_ids: [calificacionId] }
            });
            if (error) throw error;
            
            showNotification(`Reintento iniciado para la entrega.`, 'info');
        } catch (error) {
            showNotification("No se pudo reintentar la evaluación: " + error.message, 'error');
        }
    };

    const handleCheckPlagio = async () => {
        const idsArray = Array.from(selectedIds);
        const selectedItems = itemsToDisplay.filter(i => idsArray.includes(i.id));
        const driveFileIds = selectedItems.map(c => c.evidencia_drive_file_id).filter(id => id);
        const uniqueFiles = [...new Set(driveFileIds)];

        if (uniqueFiles.length < 2) {
            showNotification("Selecciona al menos 2 trabajos diferentes.", 'warning');
            return;
        }
        if (!window.confirm(`¿Analizar plagio entre ${uniqueFiles.length} trabajos?`)) return;

        setIsCheckingPlagio(true);
        try {
            const { data, error } = await supabase.functions.invoke('encolar-comprobacion-plagio', {
                body: { drive_file_ids: uniqueFiles, materia_id: actividad?.materia_id }
            });
            if (error) throw error;
            showNotification("Análisis de plagio iniciado.", 'success');
            setSelectedIds(new Set()); 
        } catch (error) {
            showNotification("Error: " + error.message, 'error');
        } finally {
            setIsCheckingPlagio(false);
        }
    };

    // Renderizado de Iconos de Estado
    const getStatusBadge = (item) => {
        switch (item.estado) {
            case 'calificado': 
                return (
                    <div className="status-badge success" title="Evaluación completada">
                        <FaCheckCircle /> <span>Calificado</span>
                    </div>
                );
            case 'entregado': 
                return (
                    <div className="status-badge info" title="Listo para evaluar">
                        <FaClock /> <span>Entregado</span>
                    </div>
                );
            case 'procesando': 
                return (
                    <div className="status-badge warning pulsate" title="La IA está trabajando...">
                        <FaSpinner className="spin" /> 
                        <span>{item.progreso_evaluacion || 'Procesando...'}</span>
                    </div>
                );
            case 'requiere_revision_manual':
                return (
                    <div className="status-badge danger" title="Requiere tu atención">
                        <FaExclamationCircle /> <span>Revisión Manual</span>
                    </div>
                );
            case 'fallido':
                // Aquí mostramos el error traducido en el título (hover)
                return (
                    <div className="status-badge error" title={traducirError(item.progreso_evaluacion || item.ultimo_error)}>
                        <FaExclamationTriangle /> 
                        <span>Falló: Ver motivo</span>
                    </div>
                );
            default: 
                return <span className="status-pill pendiente">Pendiente</span>;
        }
    };

    return (
        <div className="calificacion-panel-container">
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

            {selectedIds.size > 0 && (
                <div className="bulk-actions-bar">
                    <span style={{fontWeight:'bold'}}>{selectedIds.size} seleccionados</span>
                    <div style={{display:'flex', gap:'10px'}}> {/* Se eliminó el botón de plagio */}
                        <button onClick={handleEvaluacionMasiva} disabled={isStartingBulk} className="btn-primary btn-small icon-button">
                            {isStartingBulk ? <FaSpinner className="spin"/> : <FaRobot />} 
                            {isStartingBulk ? ' Iniciando...' : ' Evaluar con IA'}
                        </button>
                    </div>
                </div>
            )}

            {/* 4. RENDERIZAR EL MODAL SI HAY SELECCIÓN */}
            {selectedJustificacion && (
                <JustificacionModal 
                    calificacion={selectedJustificacion}
                    entregable={selectedJustificacion} // Pasamos el objeto completo como entregable
                    onClose={() => setSelectedJustificacion(null)}
                    loading={false}
                />
            )}

            <div className="alumnos-list-container">
                <div className="list-header tabla-grid-layout">
                    <div className="col-center">
                        <input 
                            type="checkbox" 
                            onChange={handleSelectAll} 
                            // BLOQUEO TOTAL DE SELECCIÓN
                            disabled={itemsToDisplay.length === 0 || isGlobalProcessing}
                        />
                    </div>
                    <div></div> 
                    <div>Alumno / Equipo</div>
                    <div>Estado y Progreso</div>
                    <div className="col-center">Nota</div>
                    <div className="col-right">Acciones</div>
                </div>

                {loadingData ? (
                    <div style={{padding: '3rem', textAlign: 'center', color: '#64748b'}}>
                        <FaSpinner className="spin" style={{fontSize:'1.5rem'}}/> <br/>Cargando datos...
                    </div>
                ) : (
                    <ul className="alumnos-list">
                        {itemsToDisplay.length > 0 ? itemsToDisplay.map(item => {
                            const isSelected = selectedIds.has(item.id);
                            const hasFile = !!item.evidencia_drive_file_id;
                            const isLocked = item.estado === 'procesando' || isStartingBulk;
                            // NUEVO: También está bloqueado si ya fue calificado exitosamente
                            const isFinished = item.estado === 'calificado';

                            return (
                                <li key={item.id} className={`${isSelected ? 'selected-bg' : ''} ${isLocked ? 'row-processing' : ''} ${isFinished ? 'row-finished' : ''}`}>
                                    <div className="tabla-grid-layout">
                                        
                                        <div className="col-center">
                                            {hasFile && (
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected} 
                                                    onChange={() => handleSelectOne(item)}
                                                    // BLOQUEO: Si hay proceso global, si esta fila procesa, O SI YA ESTÁ CALIFICADO
                                                    disabled={isLocked || isFinished} 
                                                />
                                            )}
                                        </div>

                                        <div className="col-center" title={item.isGroup ? "Grupal" : "Individual"}>
                                            {item.isGroup ? <FaUsers style={{color:'#6366f1'}}/> : <FaUser style={{color:'#94a3b8'}}/>}
                                        </div>
                                        
                                        <div className="alumno-info">
                                            {item.drive_url_entrega ? (
                                                <a 
                                                    href={item.drive_url_entrega} 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    className="alumno-link-archivo"
                                                    title="Clic para ver el archivo entregado"
                                                >
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

                                        <div style={{display:'flex', alignItems:'center'}}>
                                            {getStatusBadge(item)}
                                        </div>

                                        {/* 5. Nota (CORREGIDO) */}
                                        <div className="col-center">
                                            {/* Verificamos estrictamente que no sea null ni undefined */}
                                            {item.calificacion_obtenida !== null && item.calificacion_obtenida !== undefined ? (
                                                <span className={`calificacion-badge ${item.calificacion_obtenida >= 70 ? 'aprobado' : 'reprobado'}`}>
                                                    {item.calificacion_obtenida}
                                                </span>
                                            ) : (
                                                <span className="calificacion-badge pendiente">-</span>
                                            )}
                                        </div>

                                        {/* 6. Acciones */}
                                        <div className="col-right actions-group">
                                            {/* Botón Ver Retroalimentación (Solo si ya está calificado) */}
                                            {isFinished && (
                                                <button 
                                                    onClick={() => setSelectedJustificacion(item)}
                                                    className="btn-secondary btn-small icon-button"
                                                    title="Ver Justificación de la IA"
                                                >
                                                    <FaEye /> Ver Retro
                                                </button>
                                            )}

                                            {/* Botón Manual: Siempre disponible para correcciones */}
                                            {hasFile && (
                                                <Link 
                                                    to={`/evaluacion/${item.id}/calificar`} 
                                                    className="btn-tertiary btn-small"
                                                    title="Editar calificación manualmente"
                                                >
                                                    <FaEdit /> Manual
                                                </Link>
                                            )}
                                            {/* Botón IA: Solo si falló o si quieres forzar (opcional) */}
                                            {item.estado === 'fallido' && (
                                                <button onClick={() => handleReintentar(item.id)} className="btn-error-retry btn-small">
                                                    <FaSync /> Reintentar IA
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        }) : (
                            <li style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                                No se encontraron entregas.
                            </li>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default CalificacionPanel;