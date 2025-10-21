// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import PlagioReportModal from '../components/materia_panel/PlagioReportModal';
import JustificacionModal from '../components/materia_panel/JustificacionModal';
import './CalificacionPanel.css';

// Se eliminaron las declaraciones 'interface'

const CalificacionPanel = () => {
    const { id: actividad_id_str } = useParams();
    const actividad_id = parseInt(actividad_id_str || '0', 10);

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
        // setLoading(true); // Evitar setLoading en cada re-fetch
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuario no autenticado.");

            const { data: actData, error: actError } = await supabase.from('actividades').select('*, materias(*)').eq('id', actividad_id).single();
            if (actError) throw actError;
            if (!actData) throw new Error("Actividad no encontrada.");
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
            } else {
                 listaFinalDeEntregables = posiblesEntregables;
            }


            const { data: calificacionesExistentes, error: califError } = await supabase.from('calificaciones').select('*').eq('actividad_id', actividad_id);
            if(califError) throw califError;
            
            const entregasMap = new Map();
            const procesandoSet = new Set();
            calificacionesExistentes.forEach(cal => {
                const entregableId = cal.alumno_id || cal.grupo_id;
                 if(entregableId === null || entregableId === undefined) return;

                entregasMap.set(entregableId, {
                    calificacion_id: cal.id,
                    estado: cal.estado,
                    calificacion_obtenida: cal.calificacion_obtenida,
                    justificacion_sheet_cell: cal.justificacion_sheet_cell,
                    drive_file_id: cal.evidencia_drive_file_id,
                    progreso_evaluacion: cal.progreso_evaluacion,
                    alumno_id: cal.alumno_id,
                    grupo_id: cal.grupo_id
                });
                if (cal.estado === 'procesando') {
                    procesandoSet.add(entregableId);
                }
            });
             setItemsSiendoProcesados(procesandoSet);

            let shouldRefresh = false;
            if (actData.drive_folder_entregas_id) {
                let driveFilesData = null;
                try {
                    const { data, error: driveError } = await supabase.functions.invoke('obtener-entregas-drive', { body: { drive_folder_id: actData.drive_folder_entregas_id } });
                    if (driveError) throw driveError;
                    driveFilesData = data;
                } catch (driveError) {
                     console.warn("Error al obtener archivos de Drive:", driveError);
                }

                const calificacionesParaUpsert = [];
                const entregablesConArchivo = new Set();

                 if (driveFilesData && driveFilesData.archivos) {
                    for (const archivo of driveFilesData.archivos) {
                        const entregable = posiblesEntregables.find(e => archivo.nombre.toUpperCase().startsWith(e.identificador));
                        if (entregable) {
                            entregablesConArchivo.add(entregable.id);
                            if (!entregasMap.has(entregable.id)) {
                                calificacionesParaUpsert.push({
                                    actividad_id: actividad_id,
                                    alumno_id: entregable.tipo === 'alumno' ? entregable.id : null,
                                    grupo_id: entregable.tipo === 'grupo' ? entregable.id : null,
                                    evidencia_drive_file_id: archivo.id,
                                    estado: 'entregado',
                                    user_id: user.id
                                });
                                shouldRefresh = true;
                            } else {
                                const existingCal = entregasMap.get(entregable.id);
                                if (existingCal && !existingCal.drive_file_id && existingCal.estado !== 'procesando') {
                                    await supabase.from('calificaciones').update({ evidencia_drive_file_id: archivo.id }).eq('id', existingCal.calificacion_id);
                                    entregasMap.set(entregable.id, { ...existingCal, drive_file_id: archivo.id });
                                }
                            }
                        }
                    }
                 }

                if (actData.tipo_entrega === 'mixta') {
                    listaFinalDeEntregables = posiblesEntregables.filter(p => entregablesConArchivo.has(p.id));
                }
                
                if (calificacionesParaUpsert.length > 0) {
                    const { error: upsertError } = await supabase.from('calificaciones').upsert(calificacionesParaUpsert, { onConflict: 'actividad_id, alumno_id, grupo_id' });
                    if (upsertError) throw upsertError;
                }
            } else {
                 if (actData.tipo_entrega === 'mixta') {
                    listaFinalDeEntregables = [];
                 }
            }

            setEntregables(listaFinalDeEntregables);
            setEntregas(entregasMap);

            if (shouldRefresh) {
                 setTimeout(fetchData, 1000);
                 return;
            }

        } catch (error) {
            console.error("Error cargando datos:", error);
            alert("Error al cargar los datos: " + (error instanceof Error ? error.message : String(error)));
        } finally {
            setLoading(false);
        }
    }, [actividad_id]); 
    
    useEffect(() => {
        fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [actividad_id]); 
    
    useEffect(() => {
        const handleRealtimeUpdate = (payload) => {
            const calificacionActualizada = payload.new || payload.old;
            if (!calificacionActualizada) return;
    
            const entregableId = calificacionActualizada.alumno_id || calificacionActualizada.grupo_id;
            if (entregableId === null || entregableId === undefined) return;

            setEntregas(prevEntregas => {
                const nuevasEntregas = new Map(prevEntregas);
                const entrega = nuevasEntregas.get(entregableId) || { calificacion_id: calificacionActualizada.id }; 
                
                entrega.estado = calificacionActualizada.estado;
                entrega.calificacion_obtenida = calificacionActualizada.calificacion_obtenida;
                entrega.justificacion_sheet_cell = calificacionActualizada.justificacion_sheet_cell;
                entrega.progreso_evaluacion = calificacionActualizada.progreso_evaluacion;
                if (!entrega.drive_file_id && calificacionActualizada.evidencia_drive_file_id) {
                    entrega.drive_file_id = calificacionActualizada.evidencia_drive_file_id;
                }
                 if (!entrega.alumno_id && calificacionActualizada.alumno_id) entrega.alumno_id = calificacionActualizada.alumno_id;
                 if (!entrega.grupo_id && calificacionActualizada.grupo_id) entrega.grupo_id = calificacionActualizada.grupo_id;


                nuevasEntregas.set(entregableId, entrega); 
                return nuevasEntregas;
            });
    
            if (calificacionActualizada.estado === 'calificado' || calificacionActualizada.estado === 'fallido') {
                setItemsSiendoProcesados(prev => {
                    const newSet = new Set(prev);
                    if (newSet.has(entregableId)) { 
                        newSet.delete(entregableId);
                    }
                    return newSet;
                });
            } else if (calificacionActualizada.estado === 'procesando') {
                 setItemsSiendoProcesados(prev => {
                     if (!prev.has(entregableId)) {
                        return new Set([...prev, entregableId]);
                     }
                     return prev;
                 });
            }
        };

        const channel = supabase.channel(`calificaciones-actividad-${actividad_id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'calificaciones', filter: `actividad_id=eq.${actividad_id}` }, 
            handleRealtimeUpdate
          ).subscribe((status, err) => {
             if (err) console.error("Error en Realtime:", err);
          });

        return () => { supabase.removeChannel(channel); };
    }, [actividad_id]);
    
     useEffect(() => {
         setIsActionRunning(itemsSiendoProcesados.size > 0);
     }, [itemsSiendoProcesados]);

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

    const handleSelectAll = (e) => { // No usar : React.ChangeEvent<HTMLInputElement> en JS
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

    const handleSelectOne = (itemId) => { // No usar : number en JS
        setSelectedItems(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(itemId)) {
                newSelection.delete(itemId);
            } else {
                newSelection.add(itemId);
            }
            return newSelection;
        });
    };

    const handlePlagioCheck = async () => {
        if (selectedItems.size < 2 || isActionRunning) return;
        
        setIsActionRunning(true);
        try {
            const driveFileIds = Array.from(selectedItems).map(id => entregas.get(id)?.drive_file_id).filter(Boolean);
            if (driveFileIds.length < 2) throw new Error("No se encontraron suficientes archivos válidos para comparar.");

            const { data, error } = await supabase.functions.invoke('comprobar-plagio-gemini', {
                body: { 
                    drive_file_ids: driveFileIds,
                    materia_id: actividad?.materia_id 
                }
            });
            if (error) throw error;
            setPlagioReportData(data.reporte_plagio || []);
            setShowPlagioReport(true);
        } catch (error) {
            console.error("Error en handlePlagioCheck:", error);
            alert("Error al comprobar el plagio: " + (error instanceof Error ? error.message : String(error)));
        } finally {
            setIsActionRunning(false);
        }
    };

    const handleEvaluarConIA = async () => {
        if (selectedItems.size === 0 || isActionRunning) return;
        
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
            
            // alert(data.message); // No mostrar alerta, la UI se actualiza
        } catch (error) {
            console.error("Error en handleEvaluarConIA:", error);
            alert("Error al iniciar la evaluación con IA: " + (error instanceof Error ? error.message : String(error)));
            setItemsSiendoProcesados(prev => {
                const newSet = new Set(prev);
                selectedEntregableIds.forEach(id => newSet.delete(id));
                // Solo si ya no queda nada, desbloquea
                if (newSet.size === 0) setIsActionRunning(false); 
                return newSet;
            });
            setEntregas(prevEntregas => {
                 const nuevasEntregas = new Map(prevEntregas);
                 selectedEntregableIds.forEach(id => {
                    const entrega = nuevasEntregas.get(id);
                    if(entrega && entrega.estado === 'procesando') {
                        entrega.estado = 'entregado';
                        entrega.progreso_evaluacion = null;
                    }
                 });
                 return nuevasEntregas;
            });
        } 
    };

    const handleOpenJustificacion = async (entrega, entregable) => { // No usar tipos : Entrega, : Entregable
        if (!entrega || !actividad?.materias?.calificaciones_spreadsheet_id) {
             alert("Faltan datos de la materia o la entrega.");
             return;
         }
         if (!entrega.justificacion_sheet_cell) {
             alert("No se encontró referencia a la justificación.");
             return;
         }
        
        setSelectedCalificacion({ ...entrega, entregable });
        setShowJustificacion(true);
        setLoadingJustificacion(true);

        try {
            const spreadsheetId = actividad.materias.calificaciones_spreadsheet_id; 
            const { data, error } = await supabase.functions.invoke('get-justification-text', {
                body: {
                    spreadsheet_id: spreadsheetId,
                    justificacion_sheet_cell: entrega.justificacion_sheet_cell,
                }
            });

            if (error) throw error;
            
            setSelectedCalificacion(prev => prev ? ({ ...prev, justificacion_texto: data.justificacion_texto }) : null);

        } catch (error) {
            console.error("Error en handleOpenJustificacion:", error);
            alert("Error al cargar la retroalimentación: " + (error instanceof Error ? error.message : String(error)));
            setShowJustificacion(false);
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
            alert("No se encontró el enlace al archivo de rúbricas.");
        }
    };
    
    if (loading) return <p className="container">Cargando panel de calificación...</p>;
    if (!actividad) return <p className="container">Actividad no encontrada.</p>;

    const pendientesCount = entregables.filter(item => {
        const entrega = entregas.get(item.id);
        return entrega && entrega.estado === 'entregado' && !itemsSiendoProcesados.has(item.id);
    }).length;


    return (
        <div className="calificacion-panel-container container">
            <div className="calificacion-header">
                <div>
                    <Link to={actividad.materias ? `/materia/${actividad.materias.id}` : '/dashboard'} className="back-link">&larr; Volver a Actividades</Link>
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
                    <input type="checkbox" onChange={handleSelectAll} checked={selectedItems.size === pendientesCount && pendientesCount > 0} />
                    <span>Seleccionar Pendientes ({pendientesCount})</span>
                    <span className="header-calificacion">Calificación</span>
                </div>
                <ul className="alumnos-list">
                    {entregables.map((item) => { 
                        const entrega = entregas.get(item.id);
                        const status = entrega?.estado || 'pendiente';
                        const calificacion = entrega?.calificacion_obtenida;
                        const progreso = entrega?.progreso_evaluacion;
                        const isProcessing = itemsSiendoProcesados.has(item.id);

                        return (
                            <li key={item.id} 
                                className={`${status === 'calificado' ? 'calificado-row' : ''} ${isProcessing ? 'processing-row' : ''}`}
                                onClick={() => status === 'calificado' ? handleOpenJustificacion(entrega, item) : undefined}
                                style={{ cursor: status === 'calificado' ? 'pointer' : 'default' }} 
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
            
            {showJustificacion && selectedCalificacion && ( 
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