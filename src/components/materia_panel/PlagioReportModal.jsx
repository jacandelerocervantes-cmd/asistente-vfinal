// src/components/materia_panel/PlagioReportModal.jsx
import React from 'react';
import './PlagioReportModal.css';

const PlagioReportModal = ({ reporte, alumnos, onClose }) => {
    // Función para obtener el nombre del alumno a partir de su ID
    const getAlumnoNombre = (alumnoId) => {
        const alumno = alumnos.find(a => a.id === alumnoId);
        return alumno ? `${alumno.nombre} ${alumno.apellido}` : `ID ${alumnoId}`;
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Reporte de Similitud</h3>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <div className="modal-body">
                    {reporte.length === 0 ? (
                        <p>No se encontraron similitudes significativas entre los trabajos seleccionados.</p>
                    ) : (
                        <ul className="report-list">
                            {reporte.map((item, index) => {
                                // Buscamos los IDs de alumno correspondientes a los file IDs
                                const alumnoAId = item.trabajo_A_id;
                                const alumnoBId = item.trabajo_B_id;

                                return (
                                    <li key={index} className="report-item">
                                        <div className="report-pair">
                                            <strong>{getAlumnoNombre(alumnoAId)}</strong> y <strong>{getAlumnoNombre(alumnoBId)}</strong>
                                            <span className="similarity-badge">{item.porcentaje_similitud}% de similitud</span>
                                        </div>
                                        <div className="report-fragments">
                                            <p><strong>Fragmentos similares encontrados:</strong></p>
                                            <ul>
                                                {item.fragmentos_similares.map((frag, i) => (
                                                    <li key={i}>"{frag}"</li>
                                                ))}
                                            </ul>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PlagioReportModal;