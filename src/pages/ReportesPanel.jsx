// src/pages/ReportesPanel.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useNotification } from '../context/NotificationContext';
import './ReportesPanel.css'; // Crearemos este CSS

// --- Función para procesar los datos para el histograma ---
const processGradesForHistogram = (grades) => {
    const buckets = {
        '0-59 (Rep.)': 0,
        '60-69': 0,
        '70-79': 0,
        '80-89': 0,
        '90-100': 0,
    };
    grades.forEach(grade => {
        if (grade < 60) buckets['0-59 (Rep.)']++;
        else if (grade < 70) buckets['60-69']++;
        else if (grade < 80) buckets['70-79']++;
        else if (grade < 90) buckets['80-89']++;
        else buckets['90-100']++;
    });
    return [
        { name: '0-59 (Rep.)', 'Alumnos': buckets['0-59 (Rep.)'] },
        { name: '60-69', 'Alumnos': buckets['60-69'] },
        { name: '70-79', 'Alumnos': buckets['70-79'] },
        { name: '80-89', 'Alumnos': buckets['80-89'] },
        { name: '90-100', 'Alumnos': buckets['90-100'] },
    ];
};

// Colores para las gráficas
const COLORS = ['#e53e3e', '#f6e05e', '#48bb78', '#38a169', '#2f855a'];

const ReportesPanel = ({ materia }) => {
    const [view, setView] = useState('curso'); // 'curso' o 'U1', 'U2', ...
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [gradeData, setGradeData] = useState([]); // Array de notas [95, 88, 72]
    const { showNotification } = useNotification();

    useEffect(() => {
        const fetchReportData = async () => {
            if (!materia) return;
            setLoading(true);
            setError('');
            setGradeData([]);
            try {
                let functionName = '';
                let body = { 
                    materia_id: materia.id,
                    sheets_ids: {
                        calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id,
                    }
                };

                if (view === 'curso') {
                    functionName = 'get-course-statistics'; // <-- Próxima función a crear
                } else {
                    functionName = 'get-unit-statistics'; // <-- Próxima función a crear
                    body.unidad = parseInt(view.replace('U', ''), 10);
                }

                // --- SIMULACIÓN MIENTRAS CREAS EL BACKEND ---
                // Simular que estamos llamando a la función
                await new Promise(res => setTimeout(res, 600)); 
                // Simular fallo si no tenemos el ID de sheets (necesario para la real)
                if (!materia.calificaciones_spreadsheet_id) {
                    throw new Error("La materia no tiene un 'calificaciones_spreadsheet_id' para leer los reportes.");
                }
                // Simular datos aleatorios
                const data = { grades: Array.from({ length: 30 }, () => Math.floor(Math.random() * 50) + 50) }; 
                showNotification(`Datos de simulación cargados para ${view}. Total: ${data.grades.length} alumnos.`, 'info');
                // --- FIN SIMULACIÓN ---

                /* --- CÓDIGO REAL (cuando las funciones existan) ---
                const { data, error: invokeError } = await supabase.functions.invoke(functionName, { body });
                if (invokeError) throw invokeError;
                if (!data.grades) throw new Error("La función no devolvió un array de calificaciones.");
                
                setGradeData(data.grades || []);
                */

                setGradeData(data.grades); // <-- Mantener esto de la simulación por ahora

            } catch (err) {
                const errorMessage = err.context?.details || err.message || "Error al cargar estadísticas.";
                setError(errorMessage);
                showNotification(errorMessage, 'error');
            } finally {
                setLoading(false);
            }
        };

        fetchReportData();
    }, [view, materia, showNotification]); // Añadir showNotification

    // Procesamos los datos para la gráfica cada vez que cambian
    const histogramData = useMemo(() => processGradesForHistogram(gradeData), [gradeData]);
    const average = useMemo(() => gradeData.length ? (gradeData.reduce((a, b) => a + b, 0) / gradeData.length).toFixed(1) : 0, [gradeData]);
    const passRate = useMemo(() => gradeData.length ? ((gradeData.filter(g => g >= 60).length / gradeData.length) * 100).toFixed(0) : 0, [gradeData]);

    return (
        <div className="reportes-panel">
            <div className="reportes-header card">
                <h3>Reportes de Rendimiento</h3>
                <div className="form-group">
                    <label htmlFor="reporte-view">Seleccionar Vista:</label>
                    <select id="reporte-view" value={view} onChange={(e) => setView(e.target.value)}>
                        <option value="curso">Resumen del Curso</option>
                        {Array.from({ length: materia.unidades || 1 }, (_, i) => i + 1).map(u => (
                            <option key={u} value={`U${u}`}>Unidad {u}</option>
                        ))}
                    </select>
                </div>
            </div>

            {loading && <p>Cargando estadísticas...</p>}
            {error && <p className="error-message">{error}</p>}
            
            {!loading && !error && gradeData.length > 0 && (
                <div className="reportes-grid">
                    {/* KPIs */}
                    <div className="report-kpi card">
                        <h4>Promedio Grupal</h4>
                        <span className="kpi-value">{average}</span>
                    </div>
                    <div className="report-kpi card">
                        <h4>Alumnos Calificados</h4>
                        <span className="kpi-value">{gradeData.length}</span>
                    </div>
                     <div className="report-kpi card">
                        <h4>Tasa de Aprobación</h4>
                        <span className="kpi-value">{passRate}%</span>
                    </div>

                    {/* Gráfica de Barras */}
                    <div className="report-chart card">
                        <h4>Distribución de Calificaciones ({view === 'curso' ? 'Curso' : view})</h4>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={histogramData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis allowDecimals={false} />
                                <Tooltip />
                                <Bar dataKey="Alumnos" fill="var(--color-primary)">
                                    {histogramData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
            
            {!loading && !error && gradeData.length === 0 && (
                <div className="card">
                    <p>No se encontraron datos de calificaciones para {view === 'curso' ? 'el curso' : `la ${view}`}.</p>
                    <p>Asegúrate de haber generado el reporte final en la pestaña "Calificaciones" primero.</p>
                </div>
            )}
        </div>
    );
};

export default ReportesPanel;