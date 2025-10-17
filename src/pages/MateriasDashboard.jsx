// src/pages/MateriasDashboard.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import MateriaForm from '../components/MateriaForm';
import MateriaCard from '../components/MateriaCard';
import './MateriasDashboard.css';

const MateriasDashboard = ({ session }) => {
  const [materias, setMaterias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [materiaToEdit, setMateriaToEdit] = useState(null);

  useEffect(() => {
    fetchMaterias();
  }, []);

  const fetchMaterias = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('materias')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMaterias(data);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (materia) => {
    setMateriaToEdit(materia);
    setShowForm(true);
  };

  const handleAddNew = () => {
    setMateriaToEdit(null);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setMateriaToEdit(null);
  };

  const handleSave = () => {
    handleCloseForm();
    fetchMaterias();
  };

  const handleDriveClick = (materia) => {
    if (materia.drive_url) {
      // Abre la URL de la carpeta de Drive en una nueva pestaña.
      window.open(materia.drive_url, '_blank', 'noopener,noreferrer');
    } else {
      // Informa al usuario si la materia aún no está sincronizada.
      alert('Esta materia aún no ha sido sincronizada con Google Drive. La sincronización ocurre automáticamente la primera vez que inicias sesión.');
    }
  };

  return (
    <div className="dashboard-container container">
      <div className="dashboard-header">
        <h2>Mis Materias</h2>
        <div>
          {!showForm && (
            <button onClick={handleAddNew} className="btn-primary">
              ＋ Crear Materia
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="form-container card">
          <MateriaForm
            materiaToEdit={materiaToEdit}
            onSave={handleSave}
            onCancel={handleCloseForm}
          />
        </div>
      )}

      {loading ? (
        <p>Cargando materias...</p>
      ) : (
        <div className="materias-grid">
          {materias.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', gridColumn: '1 / -1' }}>
                <p>Aún no has creado ninguna materia. ¡Haz clic en "Crear Materia" para empezar!</p>
            </div>
          ) : (
            materias.map((materia) => (
              <MateriaCard
                key={materia.id}
                materia={materia}
                onEdit={handleEdit}
                onDriveClick={handleDriveClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default MateriasDashboard;