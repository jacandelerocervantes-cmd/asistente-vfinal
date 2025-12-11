import React from 'react';
import './JustificacionModal.css'; // Asegúrate de que este CSS exista (te lo doy abajo)
import { FaTimes, FaRobot, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';

const JustificacionModal = ({ calificacion, onClose }) => {
    if (!calificacion) return null;

    // Determinar si fue aprobado para el color del encabezado
    const isAprobado = (calificacion.calificacion_final || calificacion.calificacion_obtenida) >= 70;
    const nota = calificacion.calificacion_final || calificacion.calificacion_obtenida || '-';

    return (
        <div className="modal-overlay">
            <div className="modal-content justificacion-modal">
                <div className={`modal-header ${isAprobado ? 'header-success' : 'header-warning'}`}>
                    <div className="header-title">
                        <FaRobot className="ia-icon" />
                        <h3>Evaluación de IA</h3>
                    </div>
                    <button onClick={onClose} className="close-button">
                        <FaTimes />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="score-summary">
                        <div className="student-name">
                            <small>Alumno:</small>
                            <strong>{calificacion.alumnos?.nombre} {calificacion.alumnos?.apellido}</strong>
                        </div>
                        <div className={`score-badge ${isAprobado ? 'pass' : 'fail'}`}>
                            <span>Calificación:</span>
                            <strong>{nota} / 100</strong>
                        </div>
                    </div>

                    <div className="justification-content">
                        <h4>Retroalimentación y Análisis:</h4>
                        <div className="text-scroll-area">
                            {/* Aquí es donde se muestra el texto. Usamos white-space: pre-wrap en CSS */}
                            {calificacion.retroalimentacion ? (
                                calificacion.retroalimentacion
                            ) : (
                                <p className="empty-text">
                                    <FaExclamationTriangle /> No hay justificación de texto disponible para esta evaluación.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
                    <button onClick={onClose} className="btn-primary">Entendido</button>
                </div>
            </div>
        </div>
    );
};

export default JustificacionModal;