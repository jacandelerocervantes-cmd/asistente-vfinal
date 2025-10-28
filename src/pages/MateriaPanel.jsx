// src/pages/MateriaPanel.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import Asistencia from '../components/materia_panel/Asistencia';
import Alumnos from '../components/materia_panel/Alumnos';
import Actividades from '../components/materia_panel/Actividades';
import Evaluaciones from '../components/materia_panel/Evaluaciones';
import BancoPreguntasPanel from '../components/banco_preguntas/BancoPreguntasPanel';
import { FaArrowLeft } from 'react-icons/fa';
import './MateriaPanel.css';

const MateriaPanel = ({ session }) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [materia, setMateria] = useState(null);
    const [activeTab, setActiveTab] = useState('alumnos'); // Iniciar en Alumnos
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // --- CORRECCIÓN: Convertir id de la URL a número ---
    const materiaIdNumerico = id ? parseInt(id, 10) : null;

    useEffect(() => {
        const fetchMateria = async () => {
            // Validar el ID numérico
            if (!materiaIdNumerico || isNaN(materiaIdNumerico)) {
                 setError("ID de materia inválido.");
                 setLoading(false);
                 return;
            }
            
            setLoading(true);
            setError('');
            try {
                const { data, error: fetchError } = await supabase
                    .from('materias')
                    .select('*')
                    .eq('id', materiaIdNumerico) // Usar el ID numérico
                    .maybeSingle();

                if (fetchError) throw fetchError;
                if (!data) throw new Error("Materia no encontrada.");
                setMateria(data);

            } catch (err) {
                console.error("Error cargando materia:", err);
                setError("No se pudo cargar la info de la materia: " + err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchMateria();
    }, [materiaIdNumerico]); // Depender del ID numérico

    // (Función handleDeleteMateria si la necesitas)

    if (loading) return <div className="container">Cargando...</div>;
    if (error) return <div className="container error-message">{error} <Link to="/dashboard">Volver</Link></div>;
    if (!materia) return <div className="container">Materia no encontrada. <Link to="/dashboard">Volver</Link></div>;

    return (
        <div className="container materia-panel-container">
            {/* --- CORRECCIÓN: Botón Volver con clase CSS --- */}
            <button
                onClick={() => navigate('/dashboard')}
                className="back-button btn-secondary icon-button materia-panel-back-button"
            >
                <FaArrowLeft /> Volver al Dashboard
            </button>
            {/* --- FIN CORRECCIÓN --- */}

            <h2 style={{marginTop: '0.5rem'}}>{materia.nombre} <span className="materia-semestre">({materia.semestre})</span></h2>

            <div className="tabs">
                <button className={`tab-button ${activeTab === 'asistencia' ? 'active' : ''}`} onClick={() => setActiveTab('asistencia')}>Asistencia</button>
                <button className={`tab-button ${activeTab === 'alumnos' ? 'active' : ''}`} onClick={() => setActiveTab('alumnos')}>Alumnos y Grupos</button>
                <button className={`tab-button ${activeTab === 'actividades' ? 'active' : ''}`} onClick={() => setActiveTab('actividades')}>Actividades</button>
                <button className={`tab-button ${activeTab === 'evaluaciones' ? 'active' : ''}`} onClick={() => setActiveTab('evaluaciones')}>Evaluaciones</button>
                <button className={`tab-button ${activeTab === 'banco' ? 'active' : ''}`} onClick={() => setActiveTab('banco')}>Banco Preguntas</button>
            </div>

            <div className="tab-content">
                {/* --- CORRECCIÓN: Pasar ID numérico a todas las pestañas --- */}
                {activeTab === 'asistencia' && <Asistencia materiaId={materiaIdNumerico} nombreMateria={materia.nombre} materia={materia} />}
                {activeTab === 'alumnos' && <Alumnos materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />}
                {activeTab === 'actividades' && <Actividades materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />}
                {activeTab === 'evaluaciones' && <Evaluaciones materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />}
                {activeTab === 'banco' && <BancoPreguntasPanel materiaId={materiaIdNumerico} isModal={false} />}
                {/* --- FIN CORRECCIÓN --- */}
            </div>
        </div>
    );
};

export default MateriaPanel;