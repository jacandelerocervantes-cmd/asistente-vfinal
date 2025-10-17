// src/components/materia_panel/Alumnos.jsx
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import AlumnoForm from './AlumnoForm';
import GrupoForm from './GrupoForm';
import CSVUploader from './CSVUploader';
import GrupoCard from './GrupoCard';
import './Alumnos.css';

const Alumnos = () => {
  const { id: materia_id } = useParams();
  const [alumnos, setAlumnos] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlumnos, setSelectedAlumnos] = useState(new Set());
  const [view, setView] = useState('list'); // 'list', 'alumno_form', 'grupo_form', 'csv_upload'
  const [alumnoToEdit, setAlumnoToEdit] = useState(null);
  const [showAlumnosList, setShowAlumnosList] = useState(true);
  const [showGruposList, setShowGruposList] = useState(true);

  useEffect(() => {
    if (view === 'list') {
      fetchData();
    }
  }, [materia_id, view]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: alumnosData, error: alumnosError } = await supabase
        .from('alumnos')
        .select('*')
        .eq('materia_id', materia_id)
        .order('apellido', { ascending: true });
      if (alumnosError) throw alumnosError;
      setAlumnos(alumnosData);

      const { data: gruposData, error: gruposError } = await supabase
        .from('grupos')
        .select('id, nombre, alumnos_grupos(alumnos(id, nombre, apellido))')
        .eq('materia_id', materia_id);
      if (gruposError) throw gruposError;
      setGrupos(gruposData);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    setAlumnoToEdit(null);
    setSelectedAlumnos(new Set());
    setView('list');
  };

  const handleDeleteAlumno = async (alumno) => {
    if (window.confirm(`¿Estás seguro de que quieres eliminar a ${alumno.nombre} ${alumno.apellido}?`)) {
      try {
        const { error } = await supabase.from('alumnos').delete().eq('id', alumno.id);
        if (error) throw error;
        alert('Alumno eliminado con éxito.');
        fetchData();
      } catch (error) {
        alert(error.message);
      }
    }
  };

  const handleEditGrupo = (grupo) => {
    const nuevoNombre = prompt("Introduce el nuevo nombre para el grupo:", grupo.nombre);
    if (nuevoNombre && nuevoNombre.trim() !== "") {
      const updateGroupName = async () => {
        const { error } = await supabase.from('grupos').update({ nombre: nuevoNombre.trim() }).eq('id', grupo.id);
        if (error) {
          alert("Error al actualizar el nombre: " + error.message);
        } else {
          alert("Nombre del grupo actualizado.");
          fetchData();
        }
      };
      updateGroupName();
    }
  };

  const handleDeleteGrupo = async (grupo) => {
    if (window.confirm(`¿Estás seguro de que quieres eliminar el grupo "${grupo.nombre}"? Esta acción no se puede deshacer.`)) {
      try {
        const { error } = await supabase.from('grupos').delete().eq('id', grupo.id);
        if (error) throw error;
        alert("Grupo eliminado exitosamente.");
        fetchData();
      } catch (error) {
        alert("Error al eliminar el grupo: " + error.message);
      }
    }
  };

  const handleSelectAlumno = (alumnoId) => {
    const newSelection = new Set(selectedAlumnos);
    if (newSelection.has(alumnoId)) {
      newSelection.delete(alumnoId);
    } else {
      newSelection.add(alumnoId);
    }
    setSelectedAlumnos(newSelection);
  };

  if (loading && view === 'list') return <p>Cargando alumnos y grupos...</p>;

  switch (view) {
    case 'alumno_form':
      return <AlumnoForm materia_id={materia_id} alumnoToEdit={alumnoToEdit} onSave={handleSave} onCancel={() => setView('list')} />;
    case 'grupo_form':
      return <GrupoForm materia_id={materia_id} alumnosSeleccionados={Array.from(selectedAlumnos)} onSave={handleSave} onCancel={() => setView('list')} />;
    case 'csv_upload':
      return <CSVUploader materia_id={materia_id} onFinish={handleSave} />;
    default:
      return (
        <div className="alumnos-panel">
          <div className="panel-actions">
            <button onClick={() => { setAlumnoToEdit(null); setView('alumno_form'); }} className="btn-primary">＋ Añadir Alumno</button>
            <button onClick={() => setView('csv_upload')} className="btn-primary">↑ Subir CSV</button>
            {selectedAlumnos.size > 0 && (
              <button onClick={() => setView('grupo_form')} className="btn-secondary">＋ Crear Grupo ({selectedAlumnos.size})</button>
            )}
          </div>

          <div className="collapsible-section">
            <h3 onClick={() => setShowAlumnosList(!showAlumnosList)}>
              Lista de Alumnos ({alumnos.length}) {showAlumnosList ? '▲' : '▼'}
            </h3>
            {showAlumnosList && (
              <ul className="alumnos-list">
                {alumnos.length === 0 ? <p>No hay alumnos registrados en esta materia.</p> : alumnos.map(alumno => (
                  <li key={alumno.id}>
                    <input
                      type="checkbox"
                      checked={selectedAlumnos.has(alumno.id)}
                      onChange={() => handleSelectAlumno(alumno.id)}
                    />
                    {alumno.apellido}, {alumno.nombre} ({alumno.matricula})
                    <div className="alumno-actions">
                      <button onClick={() => { setAlumnoToEdit(alumno); setView('alumno_form'); }} className="btn-edit">Editar</button>
                      <button onClick={() => handleDeleteAlumno(alumno)} className="btn-delete">Eliminar</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="collapsible-section">
            <h3 onClick={() => setShowGruposList(!showGruposList)}>
              Grupos / Equipos ({grupos.length}) {showGruposList ? '▲' : '▼'}
            </h3>
            {showGruposList && (
              <div className="grupos-grid">
                {grupos.length === 0 ? <p>No hay grupos creados.</p> : grupos.map(grupo => (
                  <GrupoCard
                    key={grupo.id}
                    grupo={grupo}
                    onEdit={handleEditGrupo}
                    onDelete={handleDeleteGrupo}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      );
  }
};

export default Alumnos;