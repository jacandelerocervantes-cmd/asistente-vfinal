// src/components/materia_panel/Evaluaciones.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import EvaluacionForm from './EvaluacionForm'; // Componente para crear/editar
import EvaluacionCard from './EvaluacionCard'; // Componente para mostrar cada evaluación en lista
import './Evaluaciones.css'; // <--- AÑADIR ESTA LÍNEA

const Evaluaciones = ({ materia }) => {
    const [evaluaciones, setEvaluaciones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('list'); // 'list' o 'form'
    const [evaluacionToEdit, setEvaluacionToEdit] = useState(null);

    useEffect(() => {
        if (view === 'list') {
            fetchEvaluaciones();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [materia.id, view]);

    const fetchEvaluaciones = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('evaluaciones')
                // --- 1. Pedir las dos columnas de activación ---
                .select('*, esta_activo, revision_activa')
                .eq('materia_id', materia.id)
                .order('created_at', { ascending: false });
            if (error) throw error;
            setEvaluaciones(data);
        } catch (error) {
            console.error("Error cargando evaluaciones:", error);
            alert("No se pudieron cargar las evaluaciones.");
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (evaluacion) => {
        setEvaluacionToEdit(evaluacion);
        setView('form');
    };

    const handleDelete = async (evaluacion) => {
        if (window.confirm(`¿Estás seguro de eliminar la evaluación "${evaluacion.titulo}"? Esto borrará también todas sus preguntas y respuestas.`)) {
            try {
                setLoading(true); // O un loading específico para borrado
                const { error } = await supabase.from('evaluaciones').delete().eq('id', evaluacion.id);
                if (error) throw error;
                alert("Evaluación eliminada.");
                fetchEvaluaciones(); // Recarga la lista
            } catch (error) {
                alert("Error al eliminar la evaluación: " + error.message);
                setLoading(false);
            }
        }
    };

    const handleSave = () => {
        setEvaluacionToEdit(null);
        setView('list'); // Vuelve a la lista después de guardar
        // fetchEvaluaciones() se llamará automáticamente por el useEffect
    };

    const handleCancel = () => {
        setEvaluacionToEdit(null);
        setView('list');
    };

    if (loading && view === 'list') {
        return <p>Cargando evaluaciones...</p>;
    }

    if (view === 'form') {
        return (
            <EvaluacionForm
                materia={materia}
                evaluacionToEdit={evaluacionToEdit}
                onSave={handleSave}
                onCancel={handleCancel}
            />
        );
    }

    // Vista de Lista
    return (
        <div className="evaluaciones-panel">
            <div className="panel-actions">
                <button onClick={() => { setEvaluacionToEdit(null); setView('form'); }} className="btn-primary">
                    ＋ Crear Evaluación
                </button>
            </div>

            <div className="evaluaciones-grid" style={{ /* Puedes usar estilos similares a actividades-grid */ }}>
                {evaluaciones.length === 0 ? (
                    <p>Aún no has creado ninguna evaluación para esta materia.</p>
                ) : (
                    evaluaciones.map(ev => (
                        <EvaluacionCard
                            key={ev.id}
                            evaluacion={ev}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            // Puedes añadir más props como onPublish, onSeeResults, etc.
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default Evaluaciones;