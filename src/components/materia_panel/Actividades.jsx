import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useNotification } from '../../context/NotificationContext';
import ActividadForm from './ActividadForm';
import ActividadCard from './ActividadCard'; // Asegúrate de que este componente exista
import { FaPlus, FaTasks, FaSpinner, FaFilter } from 'react-icons/fa';
import './Actividades.css';

const Actividades = () => {
    const { id: materia_id } = useParams();
    const { showNotification } = useNotification();
    
    // Estados de Datos
    const [actividades, setActividades] = useState([]);
    const [materia, setMateria] = useState(null);
    const [loading, setLoading] = useState(true);
    
    // Estados de UI
    const [showModal, setShowModal] = useState(false);
    const [actividadToEdit, setActividadToEdit] = useState(null);
    const [selectedUnidad, setSelectedUnidad] = useState(1);

    // --- CARGA DE DATOS ---
    const fetchInitialData = useCallback(async () => {
        if (!materia_id) return;
        setLoading(true);
        try {
            // 1. Cargar Materia (necesitamos URLs y config)
            const { data: materiaData, error: materiaError } = await supabase
                .from('materias')
                .select('id, nombre, unidades, drive_url, rubricas_spreadsheet_id')
                .eq('id', materia_id)
                .single();
            
            if (materiaError) throw materiaError;
            setMateria(materiaData);

            // 2. Cargar Actividades
            const { data: actividadesData, error: actividadesError } = await supabase
                .from('actividades')
                .select('*')
                .eq('materia_id', materia_id)
                .order('created_at', { ascending: false }); // Las más nuevas primero
            
            if (actividadesError) throw actividadesError;
            setActividades(actividadesData || []);

        } catch (error) {
            console.error("Error cargando actividades:", error);
            showNotification("Error al cargar las actividades", "error");
        } finally {
            setLoading(false);
        }
    }, [materia_id, showNotification]);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    // --- FILTRADO ---
    const actividadesFiltradas = useMemo(() => {
        // Filtramos por unidad seleccionada
        return actividades.filter(act => parseInt(act.unidad) === parseInt(selectedUnidad));
    }, [actividades, selectedUnidad]);

    // --- HANDLERS ---
    
    // Abrir modal para CREAR
    const handleCreate = () => {
        setActividadToEdit(null); // Limpiamos edición
        setShowModal(true);
    };

    // Abrir modal para EDITAR
    const handleEdit = (actividad) => {
        setActividadToEdit(actividad);
        setShowModal(true);
    };

    // Cerrar modal
    const handleCloseModal = () => {
        setShowModal(false);
        setActividadToEdit(null);
    };

    // Callback de éxito del formulario
    const handleActivityCreated = () => {
        fetchInitialData(); // Recargamos la lista completa
        setShowModal(false); // Cerramos el modal
    };

    // Eliminar Actividad
    const handleDelete = async (actividad) => {
        if (!window.confirm(`¿Estás seguro de eliminar "${actividad.nombre}"?\nEsta acción borrará la carpeta de Drive y todos los datos asociados.`)) {
            return;
        }

        try {
            const { error } = await supabase.functions.invoke('eliminar-recurso', {
                body: { recurso_id: actividad.id, tipo_recurso: 'actividad' }
            });

            if (error) throw error;

            showNotification('Actividad eliminada correctamente', 'success');
            // Actualización optimista local
            setActividades(prev => prev.filter(a => a.id !== actividad.id));
            
        } catch (err) {
            console.error('Error eliminando:', err);
            showNotification("No se pudo eliminar la actividad: " + err.message, 'error');
        }
    };

    if (loading && !materia) {
        return <div className="loading-container"><FaSpinner className="spin" /> Cargando panel...</div>;
    }

    return (
        <div className="actividades-container fade-in">
            {/* --- CABECERA --- */}
            <div className="section-header-actions">
                <div className="title-group">
                    <h3 className="section-title">
                        <FaTasks style={{ marginRight: '10px', color: '#475569' }}/> 
                        Actividades
                    </h3>
                    <span className="counter-badge">{actividadesFiltradas.length} en Unidad {selectedUnidad}</span>
                </div>
                
                <div className="header-controls">
                    {/* Selector de Unidad */}
                    <div className="unidad-selector-wrapper">
                        <FaFilter className="filter-icon" />
                        <select 
                            value={selectedUnidad} 
                            onChange={(e) => setSelectedUnidad(Number(e.target.value))}
                            className="unidad-select"
                        >
                            {materia && Array.from({ length: materia.unidades || 5 }, (_, i) => i + 1).map(num => (
                                <option key={num} value={num}>Unidad {num}</option>
                            ))}
                        </select>
                    </div>

                    {/* Botón Crear */}
                    <button onClick={handleCreate} className="btn-primary icon-button">
                        <FaPlus /> Nueva Actividad
                    </button>
                </div>
            </div>

            {/* --- RENDERIZADO DEL MODAL (FORMULARIO) --- */}
            {/* Se renderiza condicionalmente sobre la lista */}
            {showModal && (
                <ActividadForm
                    materia={materia}
                    actividadToEdit={actividadToEdit}
                    onClose={handleCloseModal}           // Prop correcta: onClose
                    onActivityCreated={handleActivityCreated} // Prop correcta: onActivityCreated
                />
            )}

            {/* --- GRID DE ACTIVIDADES --- */}
            {actividadesFiltradas.length === 0 ? (
                <div className="empty-state-activities">
                    <div className="empty-icon-circle">
                        <FaTasks />
                    </div>
                    <p>No hay actividades registradas en la <strong>Unidad {selectedUnidad}</strong>.</p>
                    <button onClick={handleCreate} className="btn-secondary">
                        Crear la primera actividad
                    </button>
                </div>
            ) : (
                <div className="actividades-grid">
                    {actividadesFiltradas.map(act => (
                        <ActividadCard 
                            key={act.id}
                            actividad={act}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default Actividades;