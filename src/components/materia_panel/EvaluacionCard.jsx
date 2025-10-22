// src/components/materia_panel/EvaluacionCard.jsx
import React from 'react';
import { FaEdit, FaTrash, FaEye, FaPlayCircle, FaStopCircle, FaCopy, FaArrowRight } from 'react-icons/fa'; // Importa iconos relevantes

// Estilos similares a ActividadCard.css o MateriaCard.css pueden aplicarse
import './EvaluacionCard.css'; // Si creas un CSS específico

const EvaluacionCard = ({ evaluacion, onEdit, onDelete /*, onPublish, onSeeResults */ }) => {
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            return new Date(dateString).toLocaleString('es-MX');
        } catch (e) { return 'Fecha inválida'; }
    };

    return (
        <div className="materia-card" style={{ borderLeftColor: 'var(--color-accent)'}}> {/* Cambia el color del borde */}
            <div className="card-header">
                <h3 className="materia-nombre">{evaluacion.titulo}</h3>
                <div className="card-actions">
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(evaluacion); }} className="icon-btn" title="Editar Evaluación"><FaEdit /></button>
                    {/* Botón Publicar/Cerrar (Lógica futura)
                    {evaluacion.estado === 'borrador' && <button className="icon-btn" title="Publicar"><FaPlayCircle /></button>}
                    {evaluacion.estado === 'publicado' && <button className="icon-btn" title="Cerrar"><FaStopCircle /></button>}
                    */}
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(evaluacion); }} className="icon-btn icon-btn-delete" title="Eliminar"><FaTrash /></button>
                </div>
            </div>
            <div className="card-body">
                <p className="materia-semestre">Unidad: {evaluacion.unidad || 'N/A'}</p>
                <p style={{fontSize: '0.9em', color: '#555'}}>Estado: {evaluacion.estado}</p>
                <p style={{fontSize: '0.9em', color: '#555'}}>Apertura: {formatDate(evaluacion.fecha_apertura)}</p>
                <p style={{fontSize: '0.9em', color: '#555'}}>Cierre: {formatDate(evaluacion.fecha_cierre)}</p>
                <p style={{fontSize: '0.9em', color: '#555'}}>Límite: {evaluacion.tiempo_limite ? `${evaluacion.tiempo_limite} min` : 'Sin límite'}</p>
            </div>
             <div className="card-footer" style={{ justifyContent: 'space-between' }}> {/* Ajuste para espacio */}
               {/* <button className='btn-secondary' style={{padding: '5px 10px', fontSize: '0.8rem'}}>Ver Resultados</button> */}
               <span>Editar Preguntas <FaArrowRight /></span>
            </div>
        </div>
    );
};

export default EvaluacionCard;