// src/components/materia_panel/Actividades.jsx
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import ActividadForm from './ActividadForm';
import ActividadCard from './ActividadCard'; // Se importa la nueva tarjeta
import './Actividades.css';

const Actividades = () => {
    const { id: materia_id } = useParams();
    const [actividades, setActividades] = useState([]);
    const [materia, setMateria] = useState(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('list');
    const [actividadToEdit, setActividadToEdit] = useState(null);

    useEffect(() => {
        const fetchInitialData = async () => {
            setLoading(true);
            try {
                const { data: materiaData, error: materiaError } = await supabase
                    .from('materias')
                    .select('id, unidades, drive_url')
                    .eq('id', materia_id)
                    .single();
                if (materiaError) throw materiaError;
                setMateria(materiaData);

                const { data: actividadesData, error: actividadesError } = await supabase
                    .from('actividades')
                    .select('*')
                    .eq('materia_id', materia_id)
                    .order('created_at', { ascending: false });
                if (actividadesError) throw actividadesError;
                setActividades(actividadesData);

            } catch (error) {
                console.error("Error cargando datos de actividades:", error);
                alert("No se pudieron cargar los datos de las actividades.");
            } finally {
                setLoading(false);
            }
        };

        if (view === 'list') {
            fetchInitialData();
        }
    }, [materia_id, view]);

    const handleSave = (nuevaActividad) => {
        if (nuevaActividad) {
            setActividades(currentActividades => [nuevaActividad, ...currentActividades]);
        }
        setView('list');
    };

    const handleEdit = (actividad) => {
        setActividadToEdit(actividad);
        setView('form');
    };

    const handleDelete = async (actividad) => {
        if (window.confirm(`¿Estás seguro de eliminar la actividad "${actividad.nombre}"?`)) {
            try {
                const { error } = await supabase.from('actividades').delete().eq('id', actividad.id);
                if (error) throw error;
                // Actualización optimista para eliminar de la UI
                setActividades(current => current.filter(a => a.id !== actividad.id));
                alert("Actividad eliminada.");
            } catch (error) {
                alert("Error al eliminar la actividad: " + error.message);
            }
        }
    };

    if (loading) {
        return <p>Cargando panel de actividades...</p>;
    }

    if (view === 'form') {
        return (
            <ActividadForm
                materia={materia}
                actividadToEdit={actividadToEdit}
                onSave={handleSave}
                onCancel={() => setView('list')}
            />
        );
    }

    return (
        <div className="actividades-panel">
            <div className="panel-actions">
                <button onClick={() => { setActividadToEdit(null); setView('form'); }} className="btn-primary">
                    ＋ Crear Actividad
                </button>
            </div>

            <div className="actividades-grid">
                {actividades.length === 0 ? (
                    <p>Aún no has creado ninguna actividad para esta materia.</p>
                ) : (
                    actividades.map(act => (
                        <ActividadCard 
                            key={act.id}
                            actividad={act}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default Actividades;