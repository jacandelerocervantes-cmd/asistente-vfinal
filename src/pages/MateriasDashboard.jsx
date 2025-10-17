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

  const handleDriveClick = async (materia) => {
    const url = prompt("Por favor, ingresa la URL de la carpeta de Google Drive:", materia.drive_url || "https://");
    if (url && url.startsWith("http")) {
      const { error } = await supabase
        .from('materias')
        .update({ drive_url: url })
        .eq('id', materia.id);
      
      if (error) {
        alert("Error al guardar la URL: " + error.message);
      } else {
        alert("URL guardada exitosamente.");
        fetchMaterias();
      }
    } else if (url) {
      alert("URL no válida. Asegúrate de que comience con http:// o https://");
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