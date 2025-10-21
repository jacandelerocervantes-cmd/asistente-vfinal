// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import PlagioReportModal from '../components/materia_panel/PlagioReportModal';
import JustificacionModal from '../components/materia_panel/JustificacionModal';
import './CalificacionPanel.css';

const CalificacionPanel = () => {
    const { id: actividad_id } = useParams();
    const [actividad, setActividad] = useState(null);
    const [entregables, setEntregables] = useState([]);
    const [entregas, setEntregas] = useState(new Map());
    const [loading, setLoading] = useState(true);
    const [selectedItems, setSelectedItems] = useState(new Set());
    const [isActionRunning, setIsActionRunning] = useState(false);
    const [showPlagioReport, setShowPlagioReport] = useState(false);
    const [plagioReportData, setPlagioReportData] = useState(null);
    const [showJustificacion, setShowJustificacion] = useState(false);
    const [selectedCalificacion, setSelectedCalificacion] = useState(null);
    const [loadingJustificacion, setLoadingJustificacion] = useState(false);
    const [fileIdToNameMap, setFileIdToNameMap] = useState(new Map());
    const [itemsSiendoProcesados, setItemsSiendoProcesados] = useState(new Set());

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuario no autenticado.");

            const { data: actData, error: actError } = await supabase.from('actividades').select('*, materias(*)').eq('id', actividad_id).single();
            if (actError) throw actError;
            setActividad(actData);

            const { data: alumnosData, error: alumnosError } = await supabase.from('alumnos').select('*').eq('materia_id', actData.materia_id).order('apellido');
            if (alumnosError) throw alumnosError;
            
            const { data: gruposData, error: gruposError } = await supabase.from('grupos').select('*').eq('materia_id', actData.materia_id);
            if (gruposError) throw gruposError;

            let posiblesEntregables = [];
            if (actData.tipo_entrega === 'individual' || actData.tipo_entrega === 'mixta') {
                posiblesEntregables.push(...alumnosData.map(a => ({ id: a.id, tipo: 'alumno', nombre: `${a.apellido}, ${a.nombre}`, identificador: a.matricula.toUpperCase() })));
            }
            if (actData.tipo_entrega === 'grupal' || actData.tipo_entrega === 'mixta') {
                posiblesEntregables.push(...gruposData.map(g => ({ id: g.id, tipo: 'grupo', nombre: g.nombre, identificador: g.nombre.toUpperCase().replace(/\s/g, '') })));
            }

            let listaFinalDeEntregables = [];
            if (actData.tipo_entrega === 'individual') {
                listaFinalDeEntregables = posiblesEntregables.filter(p => p.tipo === 'alumno');
            } else if (actData.tipo_entrega === 'grupal') {
                listaFinalDeEntregables = posiblesEntregables.filter(p => p.tipo === 'grupo');
            }

            const { data: calificacionesExistentes, error: califError } = await supabase.from('calificaciones').select('*').eq('actividad_id', actividad_id);
            if(califError) throw califError;
            
            const entregasMap = new Map();
            calificacionesExistentes.forEach(cal => {
                const entregableId = cal.alumno_id || cal.grupo_id;
                entregasMap.set(entregableId, {
                    calificacion_id: cal.id,
                    estado: cal.estado,
                    calificacion_obtenida: cal.calificacion_obtenida,
                    justificacion_sheet_cell: cal.justificacion_sheet_cell,
                    drive_file_id: cal.evidencia_drive_file_id,
                    progreso_evaluacion: cal.progreso_evaluacion
                });
            });

            if (actData.drive_folder_entregas_id) {
                const { data: driveFilesData, error: driveError } = await supabase.functions.invoke('obtener-entregas-drive', { body: { drive_folder_id: actData.drive_folder_entregas_id } });
                if (driveError) throw driveError;

                const calificacionesParaUpsert = [];
                const entregablesConArchivo = new Set();

                for (const archivo of driveFilesData.archivos) {
                    const entregable = posiblesEntregables.find(e => archivo.nombre.toUpperCase().startsWith(e.identificador));
                    if (entregable) {
                        entregablesConArchivo.add(entregable.id);
                        if (!entregasMap.has(entregable.id)) {
                            calificacionesParaUpsert.push({
                                actividad_id: parseInt(actividad_id, 10),
                                alumno_id: entregable.tipo === 'alumno' ? entregable.id : null,
                                grupo_id: entregable.tipo === 'grupo' ? entregable.id : null,
                                evidencia_drive_file_id: archivo.id,
                                estado: 'entregado',
                                user_id: user.id
                            });
                        }
                    }
                }

                if (actData.tipo_entrega === 'mixta') {
                    listaFinalDeEntregables = posiblesEntregables.filter(p => entregablesConArchivo.has(p.id));
                }
                
                if (calificacionesParaUpsert.length > 0) {
                    const { error: upsertError } = await supabase.from('calificaciones').upsert(calificacionesParaUpsert, { onConflict: 'actividad_id, alumno_id, grupo_id' });
                    if (upsertError) throw upsertError;
                    fetchData();
                    return;
                }
            }

            setEntregables(listaFinalDeEntregables);
            setEntregas(entregasMap);

        } catch (error) {
            console.error("Error cargando datos:", error);
            alert("Error al cargar los datos: " + error.message);
        } finally {
            setLoading(false);
        }
    }, [actividad_id]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    useEffect(() => {
        const handleRealtimeUpdate = (payload) => {
            const calificacionActualizada = payload.new || payload.old;
            if (!calificacionActualizada) return;
    
            const entregableId = calificacionActualizada.alumno_id || calificacionActualizada.grupo_id;
    
            setEntregas(prevEntregas => {
                const nuevasEntregas = new Map(prevEntregas);
                const entrega = nuevasEntregas.get(entregableId);
                if (entrega) {
                    entrega.estado = calificacionActualizada.estado;
                    entrega.calificacion_obtenida = calificacionActualizada.calificacion_obtenida;
                    entrega.justificacion_sheet_cell = calificacionActualizada.justificacion_sheet_cell;
                    entrega.progreso_evaluacion = calificacionActualizada.progreso_evaluacion;
                }
                return nuevasEntregas;
            });
    
            if (calificacionActualizada.estado === 'calificado' || calificacionActualizada.estado === 'fallido') {
                setItemsSiendoProcesados(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(entregableId);
                    return newSet;
                });
            }
        };

        const channel = supabase.channel(`calificaciones-actividad-${actividad_id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'calificaciones', filter: `actividad_id=eq.${actividad_id}` }, 
            handleRealtimeUpdate
          ).subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [actividad_id]);
    
    useEffect(() => {
        const newMap = new Map();
        if (entregables.length > 0 && entregas.size > 0) {
            for (const entregable of entregables) {
                const entrega = entregas.get(entregable.id);
                if (entrega && entrega.drive_file_id) {
                    newMap.set(entrega.drive_file_id, entregable.nombre);
                }
            }
        }
        setFileIdToNameMap(newMap);
    }, [entregables, entregas]);

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const allIds = new Set(entregables.filter(item => {
                const entrega = entregas.get(item.id);
                return entrega && entrega.estado === 'entregado' && !itemsSiendoProcesados.has(item.id);
            }).map(item => item.id));
            setSelectedItems(allIds);
        } else {
            setSelectedItems(new Set());
        }
    };

    const handleSelectOne = (itemId) => {
        const newSelection = new Set(selectedItems);
        if (newSelection.has(itemId)) {
            newSelection.delete(itemId);
        } else {
            newSelection.add(itemId);
        }
        setSelectedItems(newSelection);
    };

    const handlePlagioCheck = async () => {
        if (selectedItems.size < 2) return;
        
        setIsActionRunning(true);
        try {
            const driveFileIds = Array.from(selectedItems).map(id => entregas.get(id)?.drive_file_id).filter(Boolean);
            const { data, error } = await supabase.functions.invoke('comprobar-plagio-gemini', {
                body: { 
                    drive_file_ids: driveFileIds,
                    materia_id: actividad.materia_id
                }
            });
            if (error) throw error;
            setPlagioReportData(data.reporte_plagio || []);
            setShowPlagioReport(true);
        } catch (error) {
            alert("Error al comprobar el plagio: " + error.message);
        } finally {
            setIsActionRunning(false);
        }
    };

    const handleEvaluarConIA = async () => {
        if (selectedItems.size === 0) return;
        
        setIsActionRunning(true);
        setItemsSiendoProcesados(prev => new Set([...prev, ...selectedItems]));

        setEntregas(prevEntregas => {
            const nuevasEntregas = new Map(prevEntregas);
            selectedItems.forEach(id => {
                const entrega = nuevasEntregas.get(id);
                if (entrega) {
                    entrega.estado = 'procesando';
                    entrega.progreso_evaluacion = 'Enviado a la cola...';
                }
            });
            return nuevasEntregas;
        });

        const calificacionesIds = Array.from(selectedItems).map(id => entregas.get(id)?.calificacion_id).filter(Boolean);
        const selectedEntregableIds = Array.from(selectedItems);
        setSelectedItems(new Set());

        try {
            if (calificacionesIds.length === 0) throw new Error("No se encontraron registros de calificación para los trabajos seleccionados.");
            
            const { data, error } = await supabase.functions.invoke('iniciar-evaluacion-masiva', { body: { calificaciones_ids: calificacionesIds } });
            if (error) throw error;
            
            alert(data.message);
        } catch (error) {
            alert("Error al iniciar la evaluación con IA: " + error.message);
            setItemsSiendoProcesados(prev => {
                const newSet = new Set(prev);
                selectedEntregableIds.forEach(id => newSet.delete(id));
                return newSet;
            });
        } finally {
            // No reseteamos isActionRunning aquí, esperamos al listener de realtime
        }
    };

    const handleOpenJustificacion = async (entrega, entregable) => {
        if (!entrega?.justificacion_sheet_cell) return;
        
        setSelectedCalificacion({ ...entrega, entregable });
        setShowJustificacion(true);
        setLoadingJustificacion(true);

        try {
            const { data, error } = await supabase.functions.invoke('get-justification-text', {
                body: {
                    spreadsheet_id: actividad.materias.calificaciones_spreadsheet_id,
                    justificacion_sheet_cell: entrega.justificacion_sheet_cell,
                }
            });

            if (error) throw error;
            
            setSelectedCalificacion(prev => ({ ...prev, justificacion_texto: data.justificacion_texto }));

        } catch (error) {
            alert("Error al cargar la retroalimentación: " + error.message);
        } finally {
            setLoadingJustificacion(false);
        }
    };

    const handleOpenRubric = () => {
        const spreadsheetId = actividad?.rubrica_spreadsheet_id;
        if (spreadsheetId) {
            const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
            window.open(url, '_blank', 'noopener,noreferrer');
        } else {
            alert("No se encontró el enlace al archivo de rúbricas de esta materia.");
        }
    };
    
    if (loading) return <p className="container">Cargando panel de calificación...</p>;
    if (!actividad) return <p className="container">Actividad no encontrada.</p>;

    return (
        <div className="calificacion-panel-container container">
            <div className="calificacion-header">
                <div>
                    <Link to={`/materia/${actividad.materias.id}`} className="back-link">&larr; Volver a Actividades</Link>
                    <h2>{actividad.nombre}</h2>
                    <p>Unidad {actividad.unidad} | Tipo de Entrega: {actividad.tipo_entrega}</p>
                </div>
                <button 
                    onClick={handleOpenRubric} 
                    className="btn-secondary" 
                    title="Abrir el archivo maestro de rúbricas"
                    disabled={!actividad?.rubrica_spreadsheet_id}
                >
                    📄 Ver Rúbrica
                </button>
            </div>

            <div className="panel-actions">
                <button disabled={selectedItems.size < 2 || isActionRunning} onClick={handlePlagioCheck} className="btn-secondary">
                    {isActionRunning ? 'Procesando...' : `🔍 Comprobar Plagio (${selectedItems.size})`}
                </button>
                <button disabled={selectedItems.size === 0 || isActionRunning} onClick={handleEvaluarConIA} className="btn-primary">
                    {isActionRunning ? 'Procesando...' : `🤖 Evaluar con IA (${selectedItems.size})`}
                </button>
            </div>

            <div className="alumnos-list-container">
                <div className="list-header">
                    <input type="checkbox" onChange={handleSelectAll} />
                    <span>Seleccionar Pendientes ({entregables.length})</span>
                    <span className="header-calificacion">Calificación</span>
                </div>
                <ul className="alumnos-list">
                    {entregables.map(item => {
                        const entrega = entregas.get(item.id);
                        const status = entrega?.estado || 'pendiente';
                        const calificacion = entrega?.calificacion_obtenida;
                        const progreso = entrega?.progreso_evaluacion;
                        const isProcessing = itemsSiendoProcesados.has(item.id);

                        return (
                            <li key={item.id} 
                                className={status === 'calificado' ? 'calificado-row' : ''}
                                onClick={() => status === 'calificado' && handleOpenJustificacion(entrega, item)}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedItems.has(item.id)}
                                    onChange={() => handleSelectOne(item.id)}
                                    disabled={!entrega || status !== 'entregado' || isProcessing}
                                />
                                <span className="entregable-nombre">{item.nombre}</span>

                                {isProcessing || status === 'procesando' ? (
                                    <span className="status-pill procesando" title={progreso}>{progreso || 'Procesando...'}</span>
                                ) : (
                                    <span className={`status-pill ${status}`}>{status}</span>
                                )}
                                
                                <div className="calificacion-display">
                                    {calificacion !== null && calificacion !== undefined ? (
                                        <span className={calificacion >= 70 ? 'aprobado' : 'reprobado'}>
                                            {calificacion}
                                        </span>
                                    ) : ( <span>-</span> )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>

            {showPlagioReport && ( <PlagioReportModal reporte={plagioReportData} fileIdToNameMap={fileIdToNameMap} onClose={() => setShowPlagioReport(false)} /> )}
            
            {showJustificacion && (
                <JustificacionModal 
                    calificacion={selectedCalificacion}
                    entregable={entregables.find(e => e.id === (selectedCalificacion.alumno_id || selectedCalificacion.grupo_id))}
                    loading={loadingJustificacion}
                    onClose={() => setShowJustificacion(false)}
                />
            )}
        </div>
    );
};

export default CalificacionPanel;