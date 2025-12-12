import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import EvaluacionForm from './EvaluacionForm';
import EvaluacionCard from './EvaluacionCard';
import './Evaluaciones.css';

const Evaluaciones = ({ materia }) => {
    const [evaluaciones, setEvaluaciones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
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
        setErrorMsg('');
        
        // Timeout de seguridad: Si Supabase tarda más de 5s, lanzamos error manual
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Tiempo de espera agotado al conectar con Supabase")), 5000)
        );

        try {
            console.log("Iniciando carga de evaluaciones...");
            
            // Usamos Promise.race para competir entre la carga y el timeout
            const { data, error } = await Promise.race([
                supabase
                    .from('evaluaciones')
                    .select('*, esta_activo, revision_activa')
                    .eq('materia_id', materia.id)
                    .order('created_at', { ascending: false }),
                timeoutPromise
            ]);

            if (error) throw error;
            
            console.log("Evaluaciones cargadas:", data);
            setEvaluaciones(data || []);

        } catch (error) {
            console.error("Error crítico:", error);
            setErrorMsg(error.message || "Error desconocido de conexión");
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (ev) => { setEvaluacionToEdit(ev); setView('form'); };
    const handleSave = () => { setEvaluacionToEdit(null); setView('list'); };
    const handleCancel = () => { setEvaluacionToEdit(null); setView('list'); };
    
    const handleDelete = async (ev) => {
        if (!window.confirm("¿Eliminar evaluación?")) return;
        try {
            const { error } = await supabase.from('evaluaciones').delete().eq('id', ev.id);
            if (error) throw error;
            fetchEvaluaciones();
        } catch(e) { alert(e.message); }
    };

    if (loading && view === 'list') return <div className="loading-state">Cargando evaluaciones...</div>;

    if (errorMsg && view === 'list') {
        return (
            <div className="error-state" style={{padding: '20px', textAlign: 'center'}}>
                <p style={{color: 'red'}}>⚠️ {errorMsg}</p>
                <button onClick={fetchEvaluaciones} className="btn-secondary">Reintentar Conexión</button>
            </div>
        );
    }

    if (view === 'form') {
        return <EvaluacionForm materia={materia} evaluacionToEdit={evaluacionToEdit} onSave={handleSave} onCancel={handleCancel} />;
    }

    return (
        <div className="evaluaciones-panel">
            <div className="panel-actions">
                <button onClick={() => { setEvaluacionToEdit(null); setView('form'); }} className="btn-primary">
                    ＋ Crear Evaluación
                </button>
            </div>

            <div className="evaluaciones-grid">
                {evaluaciones.length === 0 ? (
                    <p className="empty-state">No hay evaluaciones registradas.</p>
                ) : (
                    evaluaciones.map(ev => (
                        <EvaluacionCard key={ev.id} evaluacion={ev} onEdit={handleEdit} onDelete={handleDelete} />
                    ))
                )}
            </div>
        </div>
    );
};

export default Evaluaciones;