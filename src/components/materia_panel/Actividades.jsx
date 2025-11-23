// src/components/materia_panel/Actividades.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import ActividadForm from './ActividadForm';
import ActividadCard from './ActividadCard';
import { FaPlus, FaTasks, FaSpinner, FaFilter } from 'react-icons/fa';
import './Actividades.css';

const Actividades = () => {
    const { id: materia_id } = useParams();
    const [actividades, setActividades] = useState([]);
    const [materia, setMateria] = useState(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('list'); // 'list' | 'form'
    const [actividadToEdit, setActividadToEdit] = useState(null);
    
    // Estado para el filtro de unidad (por defecto Unidad 1)
    const [selectedUnidad, setSelectedUnidad] = useState(1);

    useEffect(() => {
        fetchInitialData();
    }, [materia_id]);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            // Cargar Materia
            const { data: materiaData, error: materiaError } = await supabase
                .from('materias')
                .select('id, unidades, drive_url')
                .eq('id', materia_id)
                .single();
            if (materiaError) throw materiaError;
            setMateria(materiaData);

            // Cargar Actividades
            const { data: actividadesData, error: actividadesError } = await supabase
                .from('actividades')
                .select('*')
                .eq('materia_id', materia_id)
                .order('created_at', { ascending: false });
            if (actividadesError) throw actividadesError;
            setActividades(actividadesData || []);

        } catch (error) {
            console.error("Error:", error);
        } finally {
            setLoading(false);
        }
    };

    // Filtrar actividades por la unidad seleccionada
    const actividadesFiltradas = useMemo(() => {
        return actividades.filter(act => parseInt(act.unidad) === parseInt(selectedUnidad));
    }, [actividades, selectedUnidad]);

    const handleCreate = () => {
        setActividadToEdit(null);
        setView('form');
    };

    const handleEdit = (actividad) => {
        setActividadToEdit(actividad);
        setView('form');
    };

    const handleDelete = async (actividad) => {
        if (!window.confirm(`¿Eliminar "${actividad.nombre}"? Se borrará de Drive y BD.`)) return;
        try {
            const { error } = await supabase.functions.invoke('eliminar-recurso', {
                body: { recurso_id: actividad.id, tipo_recurso: 'actividad' }
            });
            if (error) throw error;
            setActividades(prev => prev.filter(a => a.id !== actividad.id));
        } catch (err) {
            alert("Error al eliminar: " + err.message);
        }
    };

    const handleFormSave = (actividadGuardada) => {
        setActividades(prev => {
            const exists = prev.find(a => a.id === actividadGuardada.id);
            if (exists) return prev.map(a => a.id === actividadGuardada.id ? actividadGuardada : a);
            return [actividadGuardada, ...prev];
        });
        // Si guardamos una actividad, cambiamos el filtro para verla si es necesario
        if (actividadGuardada.unidad) {
            setSelectedUnidad(parseInt(actividadGuardada.unidad));
        }
        setView('list');
    };

    if (loading) return <div style={{padding:'2rem', textAlign:'center'}}><FaSpinner className="spinner"/> Cargando...</div>;

    // Renderizado Condicional de Vistas
    if (view === 'form') {
        return (
            <div className="actividades-container fade-in">
                <ActividadForm
                    materia={materia}
                    actividadToEdit={actividadToEdit}
                    initialUnidad={selectedUnidad} // Pasamos la unidad actual como default
                    onSave={handleFormSave}
                    onCancel={() => setView('list')}
                />
            </div>
        );
    }

    return (
        <div className="actividades-container fade-in">
            {/* Cabecera Armonizada con Filtro */}
            <div className="section-header-actions">
                <h3 className="section-title">
                    <FaTasks style={{marginRight:'10px'}}/> 
                    Actividades
                </h3>
                
                <div className="header-controls">
                    <div className="unidad-selector-wrapper">
                        <FaFilter className="filter-icon" />
                        <select 
                            value={selectedUnidad} 
                            onChange={(e) => setSelectedUnidad(Number(e.target.value))}
                            className="unidad-select"
                        >
                            {materia && Array.from({ length: materia.unidades }, (_, i) => i + 1).map(num => (
                                <option key={num} value={num}>Unidad {num}</option>
                            ))}
                        </select>
                    </div>

                    <button onClick={handleCreate} className="btn-primary icon-button">
                        <FaPlus /> Nueva Actividad
                    </button>
                </div>
            </div>

            {/* Grid de Tarjetas Filtradas */}
            {actividadesFiltradas.length === 0 ? (
                <div className="empty-state-activities">
                    <p>No hay actividades registradas en la <strong>Unidad {selectedUnidad}</strong>.</p>
                    <button onClick={handleCreate} className="btn-secondary">Crear actividad en esta unidad</button>
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