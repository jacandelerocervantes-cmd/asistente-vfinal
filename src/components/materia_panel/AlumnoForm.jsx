// src/components/materia_panel/AlumnoForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';

const AlumnoForm = ({ materia_id, alumnoToEdit, onSave, onCancel }) => {
  const [matricula, setMatricula] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [correo, setCorreo] = useState('');
  const [loading, setLoading] = useState(false);
  const isEditing = Boolean(alumnoToEdit);

  useEffect(() => {
    if (isEditing) {
      setMatricula(alumnoToEdit.matricula);
      setNombre(alumnoToEdit.nombre);
      setApellido(alumnoToEdit.apellido);
      setCorreo(alumnoToEdit.correo || '');
    } else {
      // Resetea el formulario si no estamos editando
      setMatricula('');
      setNombre('');
      setApellido('');
      setCorreo('');
    }
  }, [alumnoToEdit, isEditing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!matricula || !nombre || !apellido) {
      alert('Matrícula, Nombre y Apellido son campos obligatorios.');
      return;
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const alumnoData = { matricula, nombre, apellido, correo, materia_id, user_id: user.id };
      let error;

      if (isEditing) {
        // Lógica de Actualización
        const { error: updateError } = await supabase
          .from('alumnos')
          .update(alumnoData)
          .eq('id', alumnoToEdit.id);
        error = updateError;
      } else {
        // Lógica de Creación
        const { error: insertError } = await supabase
          .from('alumnos')
          .insert([alumnoData]);
        error = insertError;
      }

      if (error) throw error;
      alert(`Alumno ${isEditing ? 'actualizado' : 'creado'} con éxito.`);
      onSave(); // Llama a la función del padre para cerrar y recargar
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container card">
      <form onSubmit={handleSubmit} className="materia-form">
        <h3>{isEditing ? 'Editar Alumno' : 'Añadir Nuevo Alumno'}</h3>
        <div className="form-group">
          <label htmlFor="matricula">Matrícula</label>
          <input id="matricula" type="text" value={matricula} onChange={(e) => setMatricula(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="nombre">Nombre(s)</label>
          <input id="nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="apellido">Apellido(s)</label>
          <input id="apellido" type="text" value={apellido} onChange={(e) => setApellido(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="correo">Correo (Opcional)</label>
          <input id="correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Guardando...' : (isEditing ? 'Actualizar Alumno' : 'Guardar Alumno')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AlumnoForm;