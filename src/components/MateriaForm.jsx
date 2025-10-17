// src/components/MateriaForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const MateriaForm = ({ materiaToEdit, onSave, onCancel }) => {
  const [nombre, setNombre] = useState('');
  const [semestre, setSemestre] = useState('');
  const [unidades, setUnidades] = useState('');
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    // Si recibimos una materia para editar, llenamos el formulario
    if (materiaToEdit) {
      setIsEditing(true);
      setNombre(materiaToEdit.nombre);
      setSemestre(materiaToEdit.semestre);
      setUnidades(materiaToEdit.unidades);
    } else {
      // Si no, lo reseteamos para crear una nueva
      setIsEditing(false);
      setNombre('');
      setSemestre('2025-2');
      setUnidades('');
    }
  }, [materiaToEdit]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nombre || !semestre || !unidades) {
      alert('Por favor, completa todos los campos.');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let error;

      if (isEditing) {
        // Lógica de Actualización (UPDATE)
        const { error: updateError } = await supabase
          .from('materias')
          .update({ nombre, semestre, unidades })
          .eq('id', materiaToEdit.id)
          .eq('user_id', user.id);
        error = updateError;
      } else {
        // Lógica de Creación (INSERT)
        const { error: insertError } = await supabase
          .from('materias')
          .insert([{ nombre, semestre, unidades, user_id: user.id }]);
        error = insertError;
      }

      if (error) throw error;
      alert(`¡Materia ${isEditing ? 'actualizada' : 'creada'} exitosamente!`);
      onSave(); // Llama a la función del padre para cerrar y recargar
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`¿Estás seguro de que quieres eliminar la materia "${nombre}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('materias')
        .delete()
        .eq('id', materiaToEdit.id);

      if (error) throw error;
      alert('¡Materia eliminada exitosamente!');
      onSave(); // Cierra el form y recarga
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="materia-form">
      <h3>{isEditing ? 'Editar Materia' : 'Nueva Materia'}</h3>
      {/* ... inputs de nombre, semestre y unidades (sin cambios) ... */}
      <div className="form-group">
        <label htmlFor="nombre">Nombre de la materia</label>
        <input id="nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </div>
      <div className="form-group">
        <label htmlFor="semestre">Semestre</label>
        <input id="semestre" type="text" value={semestre} onChange={(e) => setSemestre(e.target.value)} required />
      </div>
      <div className="form-group">
        <label htmlFor="unidades">Número de unidades</label>
        <input id="unidades" type="number" min="1" value={unidades} onChange={(e) => setUnidades(e.target.value)} required />
      </div>
      <div className="form-actions">
        <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>
          Cancelar
        </button>
        {isEditing && (
          <button type="button" onClick={handleDelete} className="btn-danger" disabled={loading}>
            Eliminar
          </button>
        )}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Guardando...' : (isEditing ? 'Actualizar Materia' : 'Guardar Materia')}
        </button>
      </div>
    </form>
  );
};

export default MateriaForm;