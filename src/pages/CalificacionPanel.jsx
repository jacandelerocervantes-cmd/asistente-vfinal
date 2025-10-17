// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import PlagioReportModal from '../components/materia_panel/PlagioReportModal';
import './CalificacionPanel.css';

const CalificacionPanel = () => {
    const { id: actividad_id } = useParams();
    const [actividad, setActividad] = useState(null);
    const [entregables, setEntregables] = useState([]); // Lista de alumnos o grupos
    const [entregasDrive, setEntregasDrive] = useState(new Map()); // Mapa para vincular entregas
    const [loading, setLoading] = useState(true);
    const [selectedItems, setSelectedItems] = useState(new Set());
    const [loadingPlagio, setLoadingPlagio] = useState(false);
    const [showPlagioReport, setShowPlagioReport] = useState(false);
    const [plagioReportData, setPlagioReportData] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // 1. Obtener datos de la actividad, incluyendo el ID de su carpeta de Drive
                const { data: actData, error: actError } = await supabase
                    .from('actividades')
                    .select('*, materias(*), drive_folder_id') // Asumimos que guardamos el ID de la carpeta de la actividad
                    .eq('id', actividad_id)
                    .single();
                if (actError) throw actError;
                setActividad(actData);

                // 2. Obtener las "entidades" a calificar (alumnos y/o grupos)
                let listaDeEntregables = [];
                const { data: alumnosData, error: alumnosError } = await supabase.from('alumnos').select('*').eq('materia_id', actData.materia_id).order('apellido');
                if (alumnosError) throw alumnosError;
                
                // Lógica para mostrar alumnos, grupos o mixto (ampliar en el futuro)
                if (actData.tipo_entrega === 'individual' || actData.tipo_entrega === 'mixta') {
                    listaDeEntregables = alumnosData.map(a => ({ id: a.id, tipo: 'alumno', nombre: `${a.apellido}, ${a.nombre}`, identificador: a.matricula.toUpperCase() }));
                }
                setEntregables(listaDeEntregables);

                // 3. --- VINCULACIÓN AUTOMÁTICA DE ENTREGAS ---
                if (actData.drive_folder_id) {
                    const { data: driveFilesData, error: driveError } = await supabase.functions.invoke('obtener-entregas-drive', {
                        body: { drive_folder_id: actData.drive_folder_id }
                    });
                    if (driveError) throw driveError;

                    const entregasMap = new Map();
                    // Para cada archivo en la carpeta de Drive...
                    driveFilesData.archivos.forEach(archivo => {
                        // ...buscamos un alumno/grupo cuyo identificador (matrícula) coincida con el inicio del nombre del archivo.
                        const entregable = listaDeEntregables.find(e => archivo.nombre.toUpperCase().startsWith(e.identificador));
                        if (entregable) {
                            // Si hay match, vinculamos el ID del archivo de Drive con el ID del alumno/grupo
                            entregasMap.set(entregable.id, { drive_file_id: archivo.id, nombre_archivo: archivo.nombre });
                        }
                    });
                    setEntregasDrive(entregasMap);
                }
                 // --- FIN VINCULACIÓN ---

            } catch (error) {
                console.error("Error cargando datos para calificar:", error);
                alert("Error al cargar los datos del panel de calificación.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [actividad_id]);

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const allIds = new Set(entregables.filter(item => entregasDrive.has(item.id)).map(item => item.id));
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

    const handlePlagioCheck = async () => { /* ... Lógica existente ... */ };
    const handleEvaluarConIA = async () => { /* ... Lógica existente ... */ };

    if (loading) return <p className="container">Cargando panel de calificación...</p>;
    if (!actividad) return <p className="container">Actividad no encontrada.</p>;

    return (
        <div className="calificacion-panel-container container">
            <Link to={`/materia/${actividad.materia_id}`} className="back-link">&larr; Volver a Actividades</Link>
            <h2>{actividad.nombre}</h2>
            <p>Unidad {actividad.unidad} | Tipo de Entrega: {actividad.tipo_entrega}</p>

            <div className="panel-actions">
                <button disabled={selectedItems.size < 2 || loadingPlagio} onClick={handlePlagioCheck} className="btn-secondary">
                    {loadingPlagio ? 'Analizando...' : `🔍 Comprobar Plagio (${selectedItems.size})`}
                </button>
                <button disabled={selectedItems.size === 0} onClick={handleEvaluarConIA} className="btn-primary">
                    🤖 Evaluar con IA ({selectedItems.size})
                </button>
            </div>

            <div className="alumnos-list-container">
                <div className="list-header">
                    <input type="checkbox" onChange={handleSelectAll} />
                    <span>Seleccionar Todos ({entregables.length})</span>
                </div>
                <ul className="alumnos-list">
                    {entregables.map(item => {
                        const entrega = entregasDrive.get(item.id);
                        const status = entrega ? 'entregado' : 'pendiente';

                        return (
                            <li key={item.id}>
                                <input
                                    type="checkbox"
                                    checked={selectedItems.has(item.id)}
                                    onChange={() => handleSelectOne(item.id)}
                                    disabled={!entrega} // El checkbox se activa solo si hay una entrega vinculada
                                />
                                <span>{item.nombre}</span>
                                <span className={`status-pill ${status}`}>{status}</span>
                            </li>
                        );
                    })}
                </ul>
            </div>

            {showPlagioReport && (
                <PlagioReportModal 
                    reporte={plagioReportData}
                    alumnos={alumnos} // Necesitaremos la lista de alumnos para buscar nombres
                    onClose={() => setShowPlagioReport(false)}
                />
            )}
        </div>
    );
};

export default CalificacionPanel;