// src/components/materia_panel/EstadisticasModal.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import './EstadisticasModal.css'; // Asegúrate de crear este archivo CSS

const fetchEstadisticasEvaluacion = async (evaluacionId) => {
    try {
        const { data, error } = await supabase
            .from('intentos_evaluacion')
            .select('calificacion_final')
            .eq('evaluacion_id', evaluacionId)
            .not('calificacion_final', 'is', null);

        if (error) throw error;

        if (!data || data.length === 0) {
            return { promedio: 0, mediana: 0, numIntentos: 0, calificaciones: [] };
        }

        const calificaciones = data.map(d => d.calificacion_final).sort((a, b) => a - b);
        const numIntentos = calificaciones.length;
        const suma = calificaciones.reduce((acc, cal) => acc + cal, 0);
        const promedio = numIntentos > 0 ? suma / numIntentos : 0;

        let mediana;
        const mid = Math.floor(numIntentos / 2);
        if (numIntentos % 2 === 0) {
            mediana = (calificaciones[mid - 1] + calificaciones[mid]) / 2;
        } else {
            mediana = calificaciones[mid];
        }

        return {
            promedio: promedio.toFixed(2),
            mediana: mediana.toFixed(2),
            numIntentos,
            calificaciones
        };
    } catch (error) {
        console.error("Error al calcular estadísticas:", error);
        return { promedio: 'Error', mediana: 'Error', numIntentos: 0, calificaciones: [] };
    }
};

const EstadisticasModal = ({ evaluacion, onClose }) => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (evaluacion?.id) {
            setLoading(true);
            fetchEstadisticasEvaluacion(evaluacion.id)
                .then(setStats)
                .finally(() => setLoading(false));
        }
    }, [evaluacion]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Estadísticas de "{evaluacion?.titulo}"</h3>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <div className="modal-body">
                    {loading ? (
                        <p>Cargando estadísticas...</p>
                    ) : stats && stats.numIntentos > 0 ? (
                        <div className="stats-grid">
                            <div className="stat-item"><span>Promedio:</span><strong>{stats.promedio}</strong></div>
                            <div className="stat-item"><span>Mediana:</span><strong>{stats.mediana}</strong></div>
                            <div className="stat-item"><span>Intentos Calificados:</span><strong>{stats.numIntentos}</strong></div>
                            {/* Aquí podrías añadir un gráfico de barras simple con stats.calificaciones */}
                        </div>
                    ) : (
                        <p>No hay suficientes datos para mostrar estadísticas.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EstadisticasModal;