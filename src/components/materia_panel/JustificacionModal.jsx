// src/components/materia_panel/JustificacionModal.jsx
import React from 'react';
import './JustificacionModal.css'; // Crearemos este archivo a continuación

const JustificacionModal = ({ calificacion, entregable, onClose, loading }) => {
    if (!calificacion) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Retroalimentación para {entregable?.nombre}</h3>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <div className="modal-body">
                    {loading ? (
                        <p>Cargando retroalimentación...</p>
                    ) : (
                        <>
                            <div className="calificacion-info">
                                <strong>Calificación Obtenida: </strong>
                                <span className={calificacion.calificacion_obtenida >= 60 ? 'aprobado' : 'reprobado'}>
                                    {calificacion.calificacion_obtenida} / 100
                                </span>
                            </div>
                            <div className="justificacion-texto">
                                <h4>Justificación de la IA:</h4>
                                <p>{calificacion.justificacion_texto || "No se encontró una justificación detallada."}</p>
                            </div>
                        </>
                    )}
                </div>
                 <div className="modal-footer">
                    <button onClick={onClose} className="btn-tertiary">Cerrar</button>
                </div>
            </div>
        </div>
    );
};

export default JustificacionModal;