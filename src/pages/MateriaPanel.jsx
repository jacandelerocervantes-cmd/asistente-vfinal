import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import Asistencia from '../components/materia_panel/Asistencia';
import Alumnos from '../components/materia_panel/Alumnos';
import Actividades from '../components/materia_panel/Actividades';
import Evaluaciones from '../components/materia_panel/Evaluaciones';
import MaterialDidactico from '../components/materia_panel/MaterialDidactico';
import CalificacionesUnidad from './CalificacionesUnidad';
import ReportesPanel from './ReportesPanel';
import { FaArrowLeft } from 'react-icons/fa';
import './MateriaPanel.css';

const MateriaPanel = ({ session }) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [materia, setMateria] = useState(null);
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'alumnos');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const materiaIdNumerico = id ? parseInt(id, 10) : null;

    useEffect(() => {
        const fetchMateria = async () => {
            if (!materiaIdNumerico || isNaN(materiaIdNumerico)) {
                 setError("ID de materia inválido.");
                 setLoading(false);
                 return;
            }
            
            setLoading(true);
            
            // --- FIX: TIMEOUT DE SEGURIDAD (3 segundos) ---
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Tiempo de espera agotado cargando Materia")), 3000)
            );

            try {
                // Competencia: O cargan los datos o salta el timeout
                const { data, error: fetchError } = await Promise.race([
                    supabase
                        .from('materias')
                        .select('*')
                        .eq('id', materiaIdNumerico)
                        .maybeSingle(),
                    timeoutPromise
                ]);

                if (fetchError) throw fetchError;
                
                if (!data) {
                    throw new Error("Materia no encontrada.");
                }
                setMateria(data);

            } catch (err) {
                console.error("Error cargando materia:", err);
                // Si falla por timeout o red, mostramos el error pero NO dejamos la pantalla blanca
                setError("No se pudo cargar la materia: " + err.message);
                
                // OPCIONAL: Cargar una materia "ficticia" para que puedas ver el panel si la BD falla
                // setMateria({ id: materiaIdNumerico, nombre: "Materia (Modo Offline)", semestre: "-" });
            } finally {
                setLoading(false);
            }
        };

        fetchMateria();
    }, [materiaIdNumerico]);

    const handleSetTab = (tabName) => {
        setActiveTab(tabName);
        setSearchParams({ tab: tabName });
    };

    if (loading) return <div className="container" style={{padding:'20px'}}><h3>Cargando panel de materia...</h3></div>;
    
    // Si hay error, lo mostramos con un botón de volver
    if (error && !materia) return (
        <div className="container error-message" style={{padding:'20px', color:'red'}}>
            <h3>⚠️ Error</h3>
            <p>{error}</p>
            <Link to="/dashboard" className="btn-secondary">Volver al Dashboard</Link>
        </div>
    );

    if (!materia) return <div className="container">Materia no encontrada. <Link to="/dashboard">Volver</Link></div>;

    return (
        <div className="container materia-panel-container">
            <button
                onClick={() => navigate('/dashboard')}
                className="back-button btn-secondary icon-button materia-panel-back-button"
            >
                <FaArrowLeft /> Volver
            </button>

            <h2 style={{marginTop: '0.5rem'}}>{materia.nombre} <span className="materia-semestre">({materia.semestre})</span></h2>

            <div className="tabs">
                <button className={`tab-button ${activeTab === 'alumnos' ? 'active' : ''}`} onClick={() => handleSetTab('alumnos')}>Alumnos</button>
                <button className={`tab-button ${activeTab === 'asistencia' ? 'active' : ''}`} onClick={() => handleSetTab('asistencia')}>Asistencia</button>
                <button className={`tab-button ${activeTab === 'actividades' ? 'active' : ''}`} onClick={() => handleSetTab('actividades')}>Actividades</button>
                <button className={`tab-button ${activeTab === 'evaluaciones' ? 'active' : ''}`} onClick={() => handleSetTab('evaluaciones')}>Evaluaciones</button>
                <button className={`tab-button ${activeTab === 'material' ? 'active' : ''}`} onClick={() => handleSetTab('material')}>Material</button>
                <button className={`tab-button ${activeTab === 'calificaciones' ? 'active' : ''}`} onClick={() => handleSetTab('calificaciones')}>Calificaciones</button>
                <button className={`tab-button ${activeTab === 'reportes' ? 'active' : ''}`} onClick={() => handleSetTab('reportes')}>Reportes</button>
            </div>

            <div className="tab-content">
                {activeTab === 'alumnos' && <Alumnos materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />}
                {activeTab === 'asistencia' && <Asistencia materiaId={materiaIdNumerico} nombreMateria={materia.nombre} materia={materia} />}
                {activeTab === 'actividades' && <Actividades materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />}
                {activeTab === 'evaluaciones' && <Evaluaciones materia={materia} />}
                {activeTab === 'material' && <MaterialDidactico materia={materia} />}
                {activeTab === 'calificaciones' && <CalificacionesUnidad materia={materia} />}
                {activeTab === 'reportes' && <ReportesPanel materia={materia} />}
            </div>
        </div>
    );
};

export default MateriaPanel;