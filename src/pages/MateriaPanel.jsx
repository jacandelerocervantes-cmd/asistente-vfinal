// src/pages/MateriaPanel.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'; // <-- Se importa useSearchParams
import { supabase } from '../supabaseClient';
import Asistencia from '../components/materia_panel/Asistencia';
import Alumnos from '../components/materia_panel/Alumnos';
import Actividades from '../components/materia_panel/Actividades';
import Evaluaciones from '../components/materia_panel/Evaluaciones';
import MaterialDidactico from '../components/materia_panel/MaterialDidactico'; // <-- Importado
import CalificacionesUnidad from './CalificacionesUnidad'; // <-- RUTA CORREGIDA
import BancoPreguntasPanel from '../components/banco_preguntas/BancoPreguntasPanel';
import { FaArrowLeft } from 'react-icons/fa';
import './MateriaPanel.css';

const MateriaPanel = ({ session }) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams(); // <-- Añadido
    const [materia, setMateria] = useState(null);
    
    // Leer la pestaña de la URL o usar 'alumnos' por defecto
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'alumnos'); // <-- Modificado
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // --- CORRECCIÓN: Convertir id de la URL a número ---
    const materiaIdNumerico = id ? parseInt(id, 10) : null;

    useEffect(() => {
        const fetchMateria = async () => {
            // Validar el ID numérico
            if (!materiaIdNumerico || isNaN(materiaIdNumerico)) {
                 setError("ID de materia inválido en la URL.");
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
                if (!data) throw new Error("Materia no encontrada o no tienes permiso para verla.");
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

    // Función para cambiar de pestaña y actualizar la URL
    const handleSetTab = (tabName) => {
        setActiveTab(tabName);
        setSearchParams({ tab: tabName }); // Actualizar el parámetro 'tab' en la URL
    };

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

            {/* --- Pestañas Actualizadas --- */}
            <div className="tabs">
                <button className={`tab-button ${activeTab === 'alumnos' ? 'active' : ''}`} onClick={() => handleSetTab('alumnos')}>Alumnos</button>
                <button className={`tab-button ${activeTab === 'asistencia' ? 'active' : ''}`} onClick={() => handleSetTab('asistencia')}>Asistencia</button>
                <button className={`tab-button ${activeTab === 'actividades' ? 'active' : ''}`} onClick={() => handleSetTab('actividades')}>Actividades</button>
                <button className={`tab-button ${activeTab === 'evaluaciones' ? 'active' : ''}`} onClick={() => handleSetTab('evaluaciones')}>Evaluaciones</button>
                <button className={`tab-button ${activeTab === 'material' ? 'active' : ''}`} onClick={() => handleSetTab('material')}>Material Didáctico</button>
                <button className={`tab-button ${activeTab === 'calificaciones' ? 'active' : ''}`} onClick={() => handleSetTab('calificaciones')}>Calificaciones</button>
            </div>

            {/* --- Contenido de Pestañas Actualizado --- */}
            <div className="tab-content">
                {activeTab === 'alumnos' && <Alumnos materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />}
                {activeTab === 'asistencia' && <Asistencia materiaId={materiaIdNumerico} nombreMateria={materia.nombre} materia={materia} />}
                {activeTab === 'actividades' && <Actividades materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />}
                {activeTab === 'evaluaciones' && <Evaluaciones materia={materia} />}
                {activeTab === 'material' && <MaterialDidactico materia={materia} />}
                {activeTab === 'calificaciones' && <CalificacionesUnidad materia={materia} />}
            </div>
        </div>
    );
};

export default MateriaPanel;