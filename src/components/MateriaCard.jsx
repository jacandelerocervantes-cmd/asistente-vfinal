// src/components/MateriaCard.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import './MateriaCard.css';
import { FaFolderOpen, FaEdit, FaArrowRight } from 'react-icons/fa';

const MateriaCard = ({ materia, onEdit, onDriveClick }) => {
  const handleDriveClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (materia.drive_url) {
      window.open(materia.drive_url, '_blank', 'noopener,noreferrer');
    } else {
      onDriveClick(materia);
    }
  };

  const handleEditClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    onEdit(materia);
  };

  return (
    <Link to={`/materia/${materia.id}`} className="materia-card-link">
      <div className="materia-card">
        <div className="card-header">
          <h3 className="materia-nombre">{materia.nombre}</h3>
          <div className="card-actions">
            <button
              onClick={handleDriveClick}
              className="icon-btn drive-icon"
              title={materia.drive_url ? 'Abrir carpeta de Drive' : 'Añadir enlace de Drive'}
            >
              <FaFolderOpen />
            </button>
            <button
              onClick={handleEditClick}
              className="icon-btn edit-icon"
              title="Editar materia"
            >
              <FaEdit />
            </button>
          </div>
        </div>
        <div className="card-body">
          <p className="materia-semestre">Semestre: {materia.semestre}</p>
          <p className="materia-unidades">Unidades: {materia.unidades}</p>
        </div>
        {/* --- CAMBIO AQUÍ --- */}
        <div className="card-footer">
          {/* Ya no tenemos el texto "Gestionar Materia" */}
          <FaArrowRight title="Gestionar materia"/>
        </div>
      </div>
    </Link>
  );
};

export default MateriaCard;