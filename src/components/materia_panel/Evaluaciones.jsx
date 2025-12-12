// src/components/materia_panel/Evaluaciones.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import EvaluacionForm from './EvaluacionForm'; // Componente para crear/editar
import EvaluacionCard from './EvaluacionCard'; // Componente para mostrar cada evaluación en lista
import './Evaluaciones.css';

const Evaluaciones = ({ materia }) => {
    const [evaluaciones, setEvaluaciones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(''); // Estado para mostrar error en pantalla
    const [view, setView] = useState('list');
    const [evaluacionToEdit, setEvaluacionToEdit] = useState(null);

    useEffect(() => {
        if (view === 'list') {
            fetchEvaluaciones();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [materia.id, view]);

    const fetchEvaluaciones = async () => {
        setLoading(true);
        setErrorMsg(''); // Limpiar errores previos
        try {
            console.log("Intentando cargar evaluaciones...");
            
            // INTENTO 1: Carga "segura" (sin columnas nuevas para probar)
            // Si esto falla, el problema es de conexión básica o permisos.
            /* const { data, error } = await supabase
                .from('evaluaciones')
                .select('*') 
                .eq('materia_id', materia.id);
            */

            // INTENTO 2: Carga completa (Lo que tú quieres)
            const { data, error } = await supabase
                .from('evaluaciones')
                // Intentamos seleccionar todo. Si 'esta_activo' no existe en la BD, esto dará error.
                .select('*, esta_activo, revision_activa')
                .eq('materia_id', materia.id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error("ERROR DE SUPABASE:", error);
                throw error;
            }

            console.log("Evaluaciones cargadas:", data);
            setEvaluaciones(data || []);

        } catch (error) {
            console.error("Error capturado:", error);
            // Mostrar el error en la pantalla para que lo veas
            setErrorMsg("Error al cargar: " + (error.message || JSON.stringify(error)));
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (evaluacion) => {
        setEvaluacionToEdit(evaluacion);
        setView('form');
    };

    const handleDelete = async (evaluacion) => {
        if (window.confirm(`¿Estás seguro de eliminar "${evaluacion.titulo}"?`)) {
            try {
                setLoading(true);
                const { error } = await supabase.from('evaluaciones').delete().eq('id', evaluacion.id);
                if (error) throw error;
                alert("Evaluación eliminada.");
                fetchEvaluaciones();
            } catch (error) {
                alert("Error: " + error.message);
                setLoading(false);
            }
        }
    };

    const handleSave = () => {
        setEvaluacionToEdit(null);
        setView('list');
    };

    const handleCancel = () => {
        setEvaluacionToEdit(null);
        setView('list');
    };

    // --- RENDERIZADO DE DEPURACIÓN ---
    if (loading && view === 'list') return <p>Cargando evaluaciones... (Por favor espera)</p>;
    
    // Si hay error, lo mostramos en rojo grande
    if (errorMsg && view === 'list') {
        return (
            <div style={{ padding: '20px', color: 'red', border: '1px solid red' }}>
                <h3>Ocurrió un error:</h3>
                <p>{errorMsg}</p>
                <button onClick={fetchEvaluaciones}>Reintentar</button>
            </div>
        );
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

            <div className="evaluaciones-grid">
                {evaluaciones.length === 0 ? (
                    <p>No hay evaluaciones registradas (Lista vacía).</p>
                ) : (
                    evaluaciones.map(ev => (
                        <EvaluacionCard
                            key={ev.id}
                            evaluacion={ev}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default Evaluaciones;