// src/pages/MateriaPanel.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './MateriaPanel.css';

// Importa los componentes de las pestañas
import Alumnos from '../components/materia_panel/Alumnos';
import Asistencia from '../components/materia_panel/Asistencia';
import Actividades from '../components/materia_panel/Actividades';
import Evaluaciones from '../components/materia_panel/Evaluaciones'; // <-- IMPORTA EL NUEVO COMPONENTE
import { FaArrowLeft } from 'react-icons/fa';

const TABS = {
  ALUMNOS: 'Alumnos',
  ASISTENCIA: 'Asistencia',
  ACTIVIDADES: 'Actividades',
  EVALUACIONES: 'Evaluaciones', // <-- AÑADE LA NUEVA PESTAÑA
  // CALIFICACIONES: 'Calificaciones', // Quizás renombrar o quitar si 'Evaluaciones' lo cubre
  // MATERIAL: 'Material Didáctico',
};

const MateriaPanel = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [materia, setMateria] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(TABS.ALUMNOS);
  const [error, setError] = useState('');

    // --- CORRECCIÓN: Convertir id de la URL a número ---
    const materiaIdNumerico = id ? parseInt(id, 10) : null;
    // --- FIN CORRECCIÓN ---

  useEffect(() => {
    const fetchMateria = async () => {
            // --- CORRECCIÓN: Usar materiaIdNumerico ---
            if (!materiaIdNumerico) {
                 setError("ID de materia inválido.");
                 setLoading(false);
                 return;
            }
            // --- FIN CORRECCIÓN ---

      setLoading(true);
      setError('');
      try {
        const { data, error: fetchError } = await supabase
            .from('materias')
            .select('*')
            .eq('id', materiaIdNumerico) // Usar el ID numérico
            .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error("Materia no encontrada.");
        setMateria(data);

      } catch (err) {
        console.error("Error cargando materia:", err);
        setError("No se pudo cargar la información de la materia.");
      } finally {
        setLoading(false);
      }
    };
    fetchMateria();
  }, [materiaIdNumerico]); // Depender del ID numérico

  const renderContent = () => {
    switch (activeTab) {
      case TABS.ALUMNOS:
        // --- CORRECCIÓN: Pasar el ID numérico directamente ---
        return <Alumnos materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />;
      case TABS.ASISTENCIA:
        return <Asistencia materiaId={materia.id} nombreMateria={materia.nombre} materia={materia} />;
      
      // --- 2. USA EL COMPONENTE CORRECTO AQUÍ ---
      case TABS.ACTIVIDADES:
        return <Actividades materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />;
      case TABS.EVALUACIONES: // <-- AÑADE EL CASO PARA RENDERIZAR
        return <Evaluaciones materiaId={materiaIdNumerico} nombreMateria={materia.nombre} />;
      default:
        return <div style={{padding: '20px', textAlign: 'center'}}>Selecciona una pestaña.</div>;
    }
  };

  if (loading) {
    return <div className="container">Cargando...</div>;
  }

  if (error) return <div className="container error-message">{error} <Link to="/dashboard">Volver</Link></div>;
  if (!materia) {
    return <div className="container">Materia no encontrada. <Link to="/dashboard">Volver</Link></div>;
  }

  return (
    <div className="materia-panel-container container">
      <button onClick={() => navigate('/dashboard')} className="back-button btn-secondary icon-button" style={{marginBottom: '1rem'}}>
          <FaArrowLeft /> Volver al Dashboard
      </button>
      <h2>{materia.nombre} <span className="materia-semestre">({materia.semestre})</span></h2>

      <nav className="materia-tabs">
        {Object.values(TABS).map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div className="tab-content card">
        {renderContent()}
      </div>
    </div>
  );
};

export default MateriaPanel;