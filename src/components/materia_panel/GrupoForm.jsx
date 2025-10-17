// src/components/materia_panel/GrupoForm.jsx
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';

const GrupoForm = ({ materia_id, alumnosSeleccionados, onSave, onCancel }) => {
  const [nombreGrupo, setNombreGrupo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nombreGrupo) {
      alert('Por favor, asigna un nombre al grupo.');
      return;
    }
    if (alumnosSeleccionados.length === 0) {
      alert('No hay alumnos seleccionados para este grupo.');
      return;
    }
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Insertar el nuevo grupo y obtener su ID
      const { data: grupoData, error: grupoError } = await supabase
        .from('grupos')
        .insert({
          nombre: nombreGrupo,
          materia_id,
          user_id: user.id,
        })
        .select('id')
        .single();

      if (grupoError) throw grupoError;
      if (!grupoData) throw new Error('No se pudo crear el grupo.');

      const grupoId = grupoData.id;

      // 2. Preparar las asignaciones para la tabla 'alumnos_grupos'
      const asignaciones = alumnosSeleccionados.map(alumnoId => ({
        grupo_id: grupoId,
        alumno_id: alumnoId,
        user_id: user.id,
      }));

      // 3. Insertar todas las asignaciones
      const { error: asignacionError } = await supabase
        .from('alumnos_grupos')
        .insert(asignaciones);

      if (asignacionError) throw asignacionError;

      alert(`¡Grupo "${nombreGrupo}" creado con éxito!`);
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
        <h3>Crear Nuevo Grupo</h3>
        <div className="form-group">
          <label htmlFor="nombreGrupo">Nombre del Grupo</label>
          <input
            id="nombreGrupo"
            type="text"
            value={nombreGrupo}
            onChange={(e) => setNombreGrupo(e.target.value)}
            placeholder="Ej. Equipo Alfa"
            required
          />
        </div>
        <div>
          <p><strong>Alumnos a incluir:</strong> {alumnosSeleccionados.length}</p>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Guardando...' : 'Crear Grupo'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GrupoForm;