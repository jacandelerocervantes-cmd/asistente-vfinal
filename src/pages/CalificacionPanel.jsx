// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom'; 
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';
import './CalificacionPanel.css';
import { 
    FaSync, FaArrowLeft, FaCheckCircle, FaClock, FaExclamationCircle, 
    FaRobot, FaSearch, FaSpinner, FaUsers, FaUser
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

    // 1. Cargar Datos Iniciales
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
    }, [actividadId]);

    // --- 3. SUSCRIPCIÓN REALTIME (NUEVO) ---
    // Esto escucha cambios en la tabla 'calificaciones' y actualiza la UI en vivo
    useEffect(() => {
        if (!actividadId) return;

        console.log(`Suscribiendo a cambios en tiempo real para actividad ${actividadId}...`);
        const channel = supabase
            .channel(`calificaciones-actividad-${actividadId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'calificaciones',
                    filter: `actividad_id=eq.${actividadId}` // Filtramos solo esta actividad
                },
                (payload) => {
                    console.log("Actualización en tiempo real recibida:", payload.new);
                    // Actualizamos el estado local reemplazando el objeto modificado
                    setCalificaciones(currentCalificaciones => 
                        currentCalificaciones.map(cal => 
                            cal.id === payload.new.id 
                                ? { ...cal, ...payload.new } // Mantenemos relaciones, actualizamos campos base
                                : cal
                        )
                    );
                }
            )
            .subscribe();

        // Limpieza al desmontar
        return () => {
            supabase.removeChannel(channel);
        };
    }, [actividadId]);


    // --- Lógica de Agrupación Visual ---
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

    // --- Handlers ---
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
                .filter(item => ['entregado', 'calificado', 'procesando', 'requiere_revision_manual'].includes(item.estado))
                .map(item => item.id);
            setSelectedIds(new Set(validIds));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleEvaluacionMasiva = async () => {
        const idsArray = Array.from(selectedIds);
        if (idsArray.length === 0) return;
        if (!window.confirm(`¿Iniciar evaluación automática para ${idsArray.length} elementos seleccionados?`)) return;

        setIsStartingBulk(true);
        try {
            const { data, error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', {
                body: { calificaciones_ids: idsArray }
            });
            if (error) throw error;
            showNotification(`Proceso iniciado: ${data.message}`, 'success');
            setSelectedIds(new Set());
            // No necesitamos fetchLocalData() aquí porque el Realtime actualizará la UI
        } catch (error) {
            console.error("Error evaluación masiva:", error);
            showNotification("Error: " + error.message, 'error');
        } finally {
            setIsStartingBulk(false);
        }
    };

    const handleCheckPlagio = async () => {
        const idsArray = Array.from(selectedIds);
        const selectedItems = itemsToDisplay.filter(i => idsArray.includes(i.id));
        const driveFileIds = selectedItems.map(c => c.evidencia_drive_file_id).filter(id => id);
        const uniqueFiles = [...new Set(driveFileIds)];

        if (uniqueFiles.length < 2) {
            showNotification("Selecciona al menos 2 trabajos diferentes para comprobar plagio.", 'warning');
            return;
        }
        if (!window.confirm(`¿Analizar plagio entre los ${uniqueFiles.length} trabajos seleccionados?`)) return;

        setIsCheckingPlagio(true);
        try {
            const { data, error } = await supabase.functions.invoke('encolar-comprobacion-plagio', {
                body: { drive_file_ids: uniqueFiles, materia_id: actividad?.materia_id }
            });
            if (error) throw error;
            showNotification("Análisis de plagio iniciado.", 'success');
            setSelectedIds(new Set()); 
        } catch (error) {
            console.error("Error plagio:", error);
            showNotification("Error: " + error.message, 'error');
        } finally {
            setIsCheckingPlagio(false);
        }
    };

    const getStatusIcon = (estado) => {
        switch (estado) {
            case 'calificado': return <FaCheckCircle className="icon-success" style={{color: '#16a34a', fontSize:'1.2rem'}} />;
            case 'entregado': return <FaClock className="icon-info" style={{color: '#2563eb', fontSize:'1.2rem'}} />;
            case 'procesando': return <FaSpinner className="spin" style={{color: '#ca8a04', fontSize:'1.2rem'}} />;
            case 'requiere_revision_manual': return <FaExclamationCircle style={{color: '#dc2626', fontSize:'1.2rem'}} />; // Nuevo ícono para error manual
            default: return <FaExclamationCircle style={{color: '#cbd5e1', fontSize:'1.2rem'}} />;
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
                        disabled={isSyncing} 
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
                    <div style={{display:'flex', gap:'10px'}}>
                        <button onClick={handleCheckPlagio} disabled={isCheckingPlagio} className="btn-secondary btn-small icon-button">
                            {isCheckingPlagio ? <FaSpinner className="spin"/> : <FaSearch />} Comprobar Plagio
                        </button>
                        <button onClick={handleEvaluacionMasiva} disabled={isStartingBulk} className="btn-primary btn-small icon-button">
                            {isStartingBulk ? <FaSpinner className="spin"/> : <FaRobot />} Evaluar con IA
                        </button>
                    </div>
                </div>
            )}

            <div className="alumnos-list-container">
                <div className="list-header tabla-grid-layout">
                    <div className="col-center">
                        <input 
                            type="checkbox" 
                            onChange={handleSelectAll} 
                            disabled={itemsToDisplay.length === 0 || isStartingBulk || isCheckingPlagio}
                        />
                    </div>
                    <div></div> 
                    <div>Alumno / Equipo</div>
                    <div>Estado</div>
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

                            return (
                                <li key={item.id} className={isSelected ? 'selected-bg' : ''}>
                                    <div className="tabla-grid-layout">
                                        <div className="col-center">
                                            {hasFile && (
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected} 
                                                    onChange={() => handleSelectOne(item)} 
                                                    disabled={isStartingBulk || isCheckingPlagio}/>
                                            )}
                                        </div>

                                        <div className="col-center" title={item.isGroup ? "Entrega Grupal" : "Entrega Individual"}>
                                            {item.isGroup ? <FaUsers style={{color:'#6366f1'}}/> : <FaUser style={{color:'#94a3b8'}}/>}
                                        </div>
                                        
                                        <div className="alumno-info">
                                            <span className="entregable-nombre" style={{fontSize: item.isGroup ? '1.05rem' : '1rem'}}>
                                                {item.displayName}
                                            </span>
                                            {item.isGroup ? (
                                                <span className="matricula-text" style={{color: '#6366f1', fontSize: '0.8rem'}}>
                                                    {item.displayCount} Integrantes
                                                    <span style={{marginLeft:'5px', color:'#94a3b8'}}>(Calificación se aplicará a todos)</span>
                                                </span>
                                            ) : (
                                                <span className="matricula-text">
                                                    {item.displayMatricula}
                                                </span>
                                            )}
                                        </div>

                                        {/* --- CORRECCIÓN: MOSTRAR PROGRESO EN TIEMPO REAL --- */}
                                        <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                                            {getStatusIcon(item.estado)}
                                            <span className={`status-pill ${item.estado || 'pendiente'}`}>
                                                {item.estado === 'procesando' 
                                                    ? (item.progreso_evaluacion || 'Evaluando...') 
                                                    : (item.estado === 'requiere_revision_manual' ? 'Revisión Manual' : (item.estado || 'Pendiente'))}
                                            </span>
                                        </div>

                                        <div className="col-center">
                                            {item.calificacion_obtenida !== null ? (
                                                <span className={`calificacion-badge ${item.calificacion_obtenida >= 70 ? 'aprobado' : 'reprobado'}`}>
                                                    {item.calificacion_obtenida}
                                                </span>
                                            ) : '-'}
                                        </div>

                                        <div className="col-right">
                                            {(item.estado === 'entregado' || item.estado === 'calificado' || item.estado === 'requiere_revision_manual') && (
                                                <Link 
                                                    to={`/evaluacion/${item.id}/calificar`} 
                                                    className="btn-secondary btn-small btn-icon-only"
                                                    title="Ver Detalles / Evaluar Manualmente"
                                                >
                                                    <FaRobot />
                                                </Link>
                                            )}
                                            {item.drive_url_entrega && (
                                                <a 
                                                    href={item.drive_url_entrega} 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    className="btn-tertiary btn-small btn-icon-only"
                                                    style={{marginLeft: '5px'}}
                                                    title="Ver Archivo"
                                                >
                                                    Ver
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        }) : (
                            <div style={{padding: '3rem', textAlign: 'center', color: '#94a3b8'}}>
                                No se encontraron entregas.
                            </div>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default CalificacionPanel;