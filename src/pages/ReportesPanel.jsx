// src/pages/ReportesPanel.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useNotification } from '../context/NotificationContext';
import { FaSpinner, FaUsers, FaExclamationTriangle } from 'react-icons/fa'; // Importar iconos
import './ReportesPanel.css'; 

// --- Función para procesar los datos para el histograma ---
const processGradesForHistogram = (grades) => {
    // ... (sin cambios)
    const buckets = {
        '0-59 (Rep.)': 0, '60-69': 0, '70-79': 0, '80-89': 0, '90-100': 0,
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

// --- NUEVO COMPONENTE: Tabla de Alumnos en Riesgo ---
const AtRiskTable = ({ students }) => {
    if (students.length === 0) {
        return <p>¡Buenas noticias! No se detectaron alumnos en riesgo por el momento.</p>;
    }

    // Función para formatear el valor de riesgo
    const formatRiskValue = (reason, value) => {
        const roundedValue = parseFloat(value).toFixed(1);
        if (reason === 'Asistencia') {
            return `${roundedValue}%`;
        }
        return `${roundedValue} pts`;
    };

    return (
        <div className="table-responsive">
            <table className="alumnos-table">
                <thead>
                    <tr>
                        <th>Alumno</th>
                        <th>Razón Principal</th>
                        <th>Valor</th>
                    </tr>
                </thead>
                <tbody>
                    {students.map((student) => (
                        <tr key={student.alumno_id}>
                            <td>{student.nombre_completo}</td>
                            <td>
                                <span className={`risk-reason ${student.razon_riesgo.toLowerCase()}`}>
                                    {student.razon_riesgo}
                                </span>
                            </td>
                            <td>{formatRiskValue(student.razon_riesgo, student.valor_riesgo)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};


const ReportesPanel = ({ materia }) => {
    const [view, setView] = useState('curso'); // 'curso' o 'U1', 'U2', ...
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [gradeData, setGradeData] = useState([]); // Array de notas [95, 88, 72]
    const { showNotification } = useNotification();

    // --- NUEVOS ESTADOS PARA FASE 4 ---
    const [atRiskStudents, setAtRiskStudents] = useState([]);
    const [loadingRisk, setLoadingRisk] = useState(false);
    const [riskError, setRiskError] = useState('');
    const [riskReportFetched, setRiskReportFetched] = useState(false); // Para saber si ya se buscó

    useEffect(() => {
        // ... (Este useEffect para las gráficas de resumen no cambia)
        const fetchReportData = async () => {
            if (!materia) return;
            if (!materia.calificaciones_spreadsheet_id) {
                const errorMsg = "Esta materia no tiene un 'calificaciones_spreadsheet_id' para leer los reportes de resumen.";
                setError(errorMsg);
                showNotification(errorMsg, 'error');
                return;
            }
            setLoading(true);
            setError('');
            setGradeData([]);
            try {
                let functionName = '';
                let body = { 
                    sheets_ids: {
                        calificaciones_spreadsheet_id: materia.calificaciones_spreadsheet_id,
                    }
                };

                if (view === 'curso') {
                    functionName = 'get-course-statistics';
                } else {
                    functionName = 'get-unit-statistics';
                    body.unidad = parseInt(view.replace('U', ''), 10);
                }
                const { data, error: invokeError } = await supabase.functions.invoke(functionName, { body });
                if (invokeError) throw invokeError;
                if (!data.grades) throw new Error("La función no devolvió un array de calificaciones.");
                
                setGradeData(data.grades || []);

            } catch (err) {
                const errorMessage = err.context?.details || err.message || "Error al cargar estadísticas.";
                setError(errorMessage);
                showNotification(errorMessage, 'error');
            } finally {
                setLoading(false);
            }
        };

        fetchReportData();
    }, [view, materia, showNotification]);

    // --- NUEVO HANDLER: Para buscar alumnos en riesgo ---
    const handleFetchAtRiskStudents = async () => {
        setLoadingRisk(true);
        setRiskError('');
        setRiskReportFetched(true); // Marcamos que ya se intentó buscar
        try {
            const { data, error: invokeError } = await supabase.functions.invoke('get-at-risk-students', {
                body: { materia_id: materia.id }
            });
            if (invokeError) throw invokeError;
            
            setAtRiskStudents(data.at_risk_students || []);
            showNotification(`Análisis completado. Se encontraron ${data.at_risk_students.length} alumnos en riesgo.`, 'info');

        } catch (err) {
            const errorMessage = err.context?.details || err.message || "Error al analizar alumnos en riesgo.";
            setRiskError(errorMessage);
            showNotification(errorMessage, 'error');
        } finally {
            setLoadingRisk(false);
        }
    };

    // --- (useMemo para average, passRate y histogramData no cambian) ---
    const histogramData = useMemo(() => processGradesForHistogram(gradeData), [gradeData]);
    const average = useMemo(() => gradeData.length ? (gradeData.reduce((a, b) => a + b, 0) / gradeData.length).toFixed(1) : 0, [gradeData]);
    const passRate = useMemo(() => gradeData.length ? ((gradeData.filter(g => g >= 60).length / gradeData.length) * 100).toFixed(0) : 0, [gradeData]);

    return (
        <div className="reportes-panel">
            {/* --- SECCIÓN 1: Reporte de Resumen (Gráficas) --- */}
            <div className="reportes-header card">
                <h3>Reporte de Resumen (Finales)</h3>
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

            {loading && <p>Cargando estadísticas de resumen...</p>}
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

            {/* --- SECCIÓN 2: Panel de Alumnos en Riesgo (Nuevo) --- */}
            <div className="at-risk-panel card">
                <div className="at-risk-header">
                    <h3><FaExclamationTriangle /> Panel de Alumnos en Riesgo (Datos Actuales)</h3>
                    <button 
                        className="btn-primary" 
                        onClick={handleFetchAtRiskStudents} 
                        disabled={loadingRisk}
                    >
                        {loadingRisk ? <FaSpinner className="spinner" /> : '🔍 Analizar Grupo Ahora'}
                    </button>
                </div>
                <p className='at-risk-description'>
                    Esta herramienta analiza los promedios actuales de actividades, evaluaciones y el porcentaje de asistencia de todos los alumnos
                    para identificar proactivamente a aquellos con riesgo de reprobar (Asistencia &lt; 80% o Promedios &lt; 70).
                </p>

                {riskError && <p className="error-message">{riskError}</p>}

                {riskReportFetched && !loadingRisk && !riskError && (
                    <AtRiskTable students={atRiskStudents} />
                )}
            </div>
        </div>
    );
};

export default ReportesPanel;