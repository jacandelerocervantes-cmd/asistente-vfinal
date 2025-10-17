// src/components/materia_panel/GrupoCard.jsx
import React from 'react';
import { FaEdit, FaTrash } from 'react-icons/fa';

const GrupoCard = ({ grupo, onEdit, onDelete }) => {
  return (
    <div className="grupo-card">
      <div className="card-header">
        <h4>{grupo.nombre}</h4>
        <div className="card-actions">
          <button onClick={() => onEdit(grupo)} className="icon-btn" title="Editar grupo"><FaEdit /></button>
          <button onClick={() => onDelete(grupo)} className="icon-btn icon-btn-delete" title="Eliminar grupo"><FaTrash /></button>
        </div>
      </div>
      <ul>
        {grupo.alumnos_grupos.length > 0 ? (
          grupo.alumnos_grupos.map(item => (
            <li key={item.alumnos.id}>{item.alumnos.apellido}, {item.alumnos.nombre}</li>
          ))
        ) : (
          <li className="empty-group"><i>Grupo vacío</i></li>
        )}
      </ul>
    </div>
  );
};

export default GrupoCard;