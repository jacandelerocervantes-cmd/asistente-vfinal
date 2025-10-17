// src/components/materia_panel/ActividadCard.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { FaEdit, FaTrash, FaArrowRight } from 'react-icons/fa';

const ActividadCard = ({ actividad, onEdit, onDelete }) => {
    return (
        <Link to={`/actividad/${actividad.id}`} className="materia-card-link">
            <div className="materia-card">
                <div className="card-header">
                    <h3 className="materia-nombre">{actividad.nombre}</h3>
                    <div className="card-actions">
                        <button
                            onClick={(e) => { e.preventDefault(); onEdit(actividad); }}
                            className="icon-btn"
                            title="Editar Actividad"
                        >
                            <FaEdit />
                        </button>
                        <button
                            onClick={(e) => { e.preventDefault(); onDelete(actividad); }}
                            className="icon-btn icon-btn-delete"
                            title="Eliminar Actividad"
                        >
                            <FaTrash />
                        </button>
                    </div>
                </div>
                <div className="card-body">
                    <p className="materia-semestre">Unidad: {actividad.unidad}</p>
                </div>
                <div className="card-footer">
                    <span>Evaluar Entregas</span>
                    <FaArrowRight />
                </div>
            </div>
        </Link>
    );
};

export default ActividadCard;