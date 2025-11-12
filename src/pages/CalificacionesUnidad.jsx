// src/components/materia_panel/CalificacionesUnidad.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useNotification } from '../../context/NotificationContext';
import './CalificacionesUnidad.css'; // Crearemos este CSS

const CalificacionesUnidad = ({ materia }) => {
    const [selectedUnit, setSelectedUnit] = useState('');
    const [counts, setCounts] = useState({ actividades: 0, evaluaciones: 0 });
    const [weights, setWeights] = useState({ asistencia: 10, actividades: 60, evaluaciones: 30 });
    const [totalPoints, setTotalPoints] = useState(100);
    const [isLoadingCounts, setIsLoadingCounts] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    const [isCalculatingFinalGrade, setIsCalculatingFinalGrade] = useState(false); // <-- AÑADIDO
    const [error, setError] = useState('');
    
    const { showNotification } = useNotification();

    // Efecto para recalcular el total cuando los pesos cambian
    useEffect(() => {
        const total = (Number(weights.asistencia) || 0) + 
                      (Number(weights.actividades) || 0) + 
                      (Number(weights.evaluaciones) || 0);
        setTotalPoints(total);
    }, [weights]);

    // Efecto para buscar los conteos cuando se selecciona una unidad
    useEffect(() => {
        if (!selectedUnit || !materia.id) {
            setCounts({ actividades: 0, evaluaciones: 0 });
            return;
        }

        const fetchCounts = async () => {
            setIsLoadingCounts(true);
            setError('');
            try {
                // --- AHORA ES UNA LLAMADA REAL ---
                const { data, error } = await supabase.functions.invoke('get-unit-component-counts', {
                    body: {
                        materia_id: materia.id,
                        unidad: parseInt(selectedUnit, 10),
                        sheets_ids: {
                            calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id,
                            actividades_drive_url: materia.drive_url // Para encontrar el resumen de actividades
                        }
                    }
                });
                if (error) throw error;

                setCounts(data.counts);
                showNotification(`Se encontraron ${data.counts.actividades} actividades y ${data.counts.evaluaciones} evaluaciones para la Unidad ${selectedUnit}.`, 'info');

            } catch (err) {
                const errorMessage = err.context?.details || err.message || "Error al buscar componentes de la unidad.";
                setError(errorMessage);
                showNotification(errorMessage, 'error');
                setCounts({ actividades: 0, evaluaciones: 0 });
            } finally {
                setIsLoadingCounts(false);
            }
        };

        fetchCounts();
    }, [selectedUnit, materia.id, materia.calificaciones_spreadsheet_id, materia.drive_url, showNotification]);

    const handleWeightChange = (e) => {
        const { name, value } = e.target;
        setWeights(prev => ({
            ...prev,
            [name]: value === '' ? '' : Number(value) // Guardar como número o string vacío
        }));
    };

    const handleCalculateFinalGrades = async () => {
        if (totalPoints !== 100) {
            showNotification("El total de puntos debe ser exactamente 100.", 'error');
            return;
        }
        if (!window.confirm(`¿Estás seguro de que quieres calcular y guardar las calificaciones finales para la Unidad ${selectedUnit}?\n\nAsistencia: ${weights.asistencia} pts\nActividades: ${weights.actividades} pts\nEvaluaciones: ${weights.evaluaciones} pts\n\nEsta acción creará una nueva hoja en Google Sheets con los resultados.`)) {
            return;
        }

        setIsCalculating(true);
        setError('');
        try {
            // --- AHORA ES UNA LLAMADA REAL ---
            const { data, error } = await supabase.functions.invoke('calculate-final-unit-grade', {
                body: {
                    materia_id: materia.id,
                    unidad: parseInt(selectedUnit, 10),
                    weights: weights,
                    sheets_ids: {
                        calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id,
                        actividades_drive_url: materia.drive_url
                    }
                }
            });
            if (error) throw error;

            showNotification(data.message, 'success');

        } catch (err) {
            const errorMessage = err.context?.details || err.message || "Error al calcular las calificaciones finales.";
            setError(errorMessage);
            showNotification(errorMessage, 'error');
        } finally {
            setIsCalculating(false);
        }
    };

    // --- FUNCIÓN AÑADIDA PARA FASE 6 ---
    const handleCalculateFinalCourseGrade = async () => {
        const pesoPorUnidad = (100 / materia.unidades).toFixed(2);
        if (!window.confirm(`¿Generar el Reporte Final del Curso?\n\nEsta materia tiene ${materia.unidades} unidades.\nCada unidad valdrá ${pesoPorUnidad} puntos para el promedio final.\n\nSe leerán todas las hojas "Calificación Final - U..." generadas previamente. ¿Continuar?`)) {
            return;
        }

        setIsCalculatingFinalGrade(true);
        setError('');
        try {
            const { data, error } = await supabase.functions.invoke('calculate-final-course-grade', {
                body: {
                    materia_id: materia.id,
                    num_unidades: materia.unidades,
                    sheets_ids: {
                        calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id
                    }
                }
            });
            if (error) throw error;
            
            showNotification(data.message, 'success');

        } catch (err) {
            const errorMessage = err.context?.details || err.message || "Error al calcular la calificación final del curso.";
            setError(errorMessage);
            showNotification(errorMessage, 'error');
        } finally {
            setIsCalculatingFinalGrade(false);
        }

    };

    return (
        <div className="calificaciones-unidad-panel">
            <h3>Calificación Final de Unidad</h3>
            <p>Selecciona una unidad para definir la ponderación de sus componentes y generar el reporte final de calificaciones.</p>

            <div className="calif-selector-container card">
                <div className="form-group">
                    <label htmlFor="unidad_calificacion">Seleccionar Unidad</label>
                    <select id="unidad_calificacion" value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)}>
                        <option value="">-- Elige una unidad --</option>
                        {Array.from({ length: materia?.unidades || 1 }, (_, i) => i + 1).map(u => (
                            <option key={u} value={u}>Unidad {u}</option>
                        ))}
                    </select>
                </div>
            </div>

            {selectedUnit && (
                <div className="calif-ponderacion-container card">
                    <h4>Ponderación para la Unidad {selectedUnit}</h4>
                    {isLoadingCounts && <p>Buscando componentes...</p>}
                    {error && <p className="error-message">{error}</p>}

                    {!isLoadingCounts && (
                        <div className="ponderacion-form">
                            <div className="ponderacion-item">
                                <label htmlFor="weights.asistencia">Asistencia</label>
                                <span className="item-info">(% final de asistencia de la unidad)</span>
                                <input 
                                    type="number" 
                                    id="weights.asistencia"
                                    name="asistencia"
                                    min="0" max="100"
                                    value={weights.asistencia}
                                    onChange={handleWeightChange}
                                    disabled={isCalculating}
                                />
                                <span className="item-percent">({weights.asistencia || 0}%)</span>
                            </div>
                            
                            <div className="ponderacion-item">
                                <label htmlFor="weights.actividades">Actividades</label>
                                <span className="item-info">(Promedio de {counts.actividades} actividades encontradas)</span>
                                <input 
                                    type="number" 
                                    id="weights.actividades"
                                    name="actividades"
                                    min="0" max="100"
                                    value={weights.actividades}
                                    onChange={handleWeightChange}
                                    disabled={isCalculating}
                                />
                                <span className="item-percent">({weights.actividades || 0}%)</span>
                            </div>

                            <div className="ponderacion-item">
                                <label htmlFor="weights.evaluaciones">Evaluaciones</label>
                                <span className="item-info">(Promedio de {counts.evaluaciones} evaluaciones encontradas)</span>
                                <input 
                                    type="number" 
                                    id="weights.evaluaciones"
                                    name="evaluaciones"
                                    min="0" max="100"
                                    value={weights.evaluaciones}
                                    onChange={handleWeightChange}
                                    disabled={isCalculating}
                                />
                                <span className="item-percent">({weights.evaluaciones || 0}%)</span>
                            </div>

                            <div className={`ponderacion-total ${totalPoints !== 100 ? 'total-error' : ''}`}>
                                Total: {totalPoints} / 100 Puntos
                            </div>

                            <div className="form-actions">
                                <button 
                                    className="btn-primary"
                                    onClick={handleCalculateFinalGrades}
                                    disabled={isCalculating || isLoadingCounts || totalPoints !== 100}
                                >
                                    {isCalculating ? 'Calculando...' : `Calcular y Guardar Calificación (Unidad ${selectedUnit})`}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* --- SECCIÓN AÑADIDA FASE 5 --- */}
            <div className="calif-final-curso-container card">
                <h4>Calificación Final del Curso</h4>
                <p>
                    Esta materia tiene <strong>{materia.unidades} unidades</strong>. Al generar el reporte final, cada unidad tendrá un valor ponderado de <strong>{(100 / materia.unidades).toFixed(2)} puntos</strong>.
                </p>
                <p>
                    Asegúrate de haber calculado primero la calificación de cada unidad individual usando el panel de arriba.
                </p>
                <div className="form-actions">
                    <button 
                        className="btn-primary"
                        onClick={handleCalculateFinalCourseGrade}
                        disabled={isCalculating || isCalculatingFinalGrade}
                    >
                        {isCalculatingFinalGrade ? 'Generando Reporte Final...' : 'Generar Reporte Final del Curso'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CalificacionesUnidad;