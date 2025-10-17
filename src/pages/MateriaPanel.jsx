// src/pages/MateriaPanel.jsx
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './MateriaPanel.css';

// Importa los componentes de las pestañas
import Alumnos from '../components/materia_panel/Alumnos';
import Asistencia from '../components/materia_panel/Asistencia';
import Actividades from '../components/materia_panel/Actividades'; // <-- 1. IMPORTA EL NUEVO COMPONENTE

const TABS = {
  ALUMNOS: 'Alumnos',
  ASISTENCIA: 'Asistencia',
  ACTIVIDADES: 'Actividades',
  EVALUACIONES: 'Evaluaciones',
  CALIFICACIONES: 'Calificaciones',
  MATERIAL: 'Material Didáctico',
};

const MateriaPanel = () => {
  const { id } = useParams();
  const [materia, setMateria] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(TABS.ALUMNOS);

  useEffect(() => {
    const fetchMateria = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.from('materias').select('*').eq('id', id).single();
        if (error) throw error;
        setMateria(data);
      } catch (error) {
        console.error('Error fetching materia:', error);
        alert('No se pudo cargar la materia.');
      } finally {
        setLoading(false);
      }
    };
    fetchMateria();
  }, [id]);

  const renderContent = () => {
    switch (activeTab) {
      case TABS.ALUMNOS:
        return <Alumnos />;
      case TABS.ASISTENCIA:
        return <Asistencia />;
      
      // --- 2. USA EL COMPONENTE CORRECTO AQUÍ ---
      case TABS.ACTIVIDADES:
        return <Actividades />;
      
      case TABS.EVALUACIONES:
        return <div style={{padding: '20px', textAlign: 'center'}}>Módulo de <strong>{TABS.EVALUACIONES}</strong> pendiente de desarrollo.</div>;
      case TABS.CALIFICACIONES:
        return <div style={{padding: '20px', textAlign: 'center'}}>Módulo de <strong>{TABS.CALIFICACIONES}</strong> pendiente de desarrollo.</div>;
      case TABS.MATERIAL:
        return <div style={{padding: '20px', textAlign: 'center'}}>Módulo de <strong>{TABS.MATERIAL}</strong> pendiente de desarrollo.</div>;
      default:
        return <div style={{padding: '20px', textAlign: 'center'}}>Selecciona una pestaña.</div>;
    }
  };

  if (loading) {
    return <div className="container">Cargando información de la materia...</div>;
  }

  if (!materia) {
    return <div className="container">Materia no encontrada.</div>;
  }

  return (
    <div className="materia-panel-container container">
      <Link to="/dashboard" className="back-link">&larr; Volver a Mis Materias</Link>
      <h2 className="materia-panel-title">{materia.nombre}</h2>
      <p className="materia-panel-subtitle">Semestre: {materia.semestre}</p>

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