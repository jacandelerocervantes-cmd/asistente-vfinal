// src/components/materia_panel/StudentReportModal.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useNotification } from '../../context/NotificationContext';
import { FaSpinner, FaExclamationTriangle } from 'react-icons/fa';
import './StudentReportModal.css'; // Crearemos este CSS

// Componente pequeño para las "tarjetas" de KPIs
const KpiCard = ({ title, value, unit, risk = false }) => (
  <div className={`report-kpi-card ${risk ? 'risk' : ''}`}>
    <h4>{title}</h4>
    <span className="kpi-value">
      {value}
      <span className="kpi-unit">{unit}</span>
    </span>
  </div>
);

// Componente de Gráfica simple
const SimpleBarChart = ({ data, dataKey, name }) => (
  <ResponsiveContainer width="100%" height={250}>
    <BarChart data={data} margin={{ top: 20, right: 10, left: -20, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis domain={[0, 100]} />
      <Tooltip />
      <Bar dataKey="grade" fill="var(--color-primary)" name={name} />
    </BarChart>
  </ResponsiveContainer>
);

const StudentReportModal = ({ alumno, materiaId, onClose }) => {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { showNotification } = useNotification();

  // FASE 3 (Pendiente)
  const [loadingIA, setLoadingIA] = useState(false);
  const [iaSummary, setIaSummary] = useState('');

  useEffect(() => {
    if (!alumno) return;

    const fetchReport = async () => {
      setLoading(true);
      setError('');
      setIaSummary(''); // Limpiar resumen de IA al cambiar de alumno
      try {
        const { data, error: invokeError } = await supabase.functions.invoke('get-student-holistic-report', {
          body: { alumno_id: alumno.id, materia_id: materiaId }
        });

        if (invokeError) throw invokeError;
        setReportData(data);
      } catch (err) {
        const errorMessage = err.context?.details || err.message || "Error al cargar el reporte del alumno.";
        setError(errorMessage);
        showNotification(errorMessage, 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [alumno, materiaId, showNotification]);

  // Identificar el riesgo de asistencia
  const attendanceRisk = reportData?.attendance?.percentage < 80;

  // FASE 3: Handler para el botón de IA (aún no implementado)
  const handleGenerateIASummary = async () => {
    if (!reportData) {
      showNotification("No hay datos del reporte para analizar.", 'warning');
      return;
    }

    setLoadingIA(true);
    setIaSummary(''); // Limpiar resumen anterior
    try {
      
      // Llamamos a la nueva Edge Function con los datos del reporte
      const { data, error: invokeError } = await supabase.functions.invoke('get-student-ia-summary', {
        body: reportData // Pasamos el objeto reportData completo
      });

      if (invokeError) throw invokeError;

      if (!data.summary) {
        throw new Error("La IA no devolvió un resumen.");
      }

      setIaSummary(data.summary);

    } catch (err) {
      const errorMessage = err.context?.details || err.message || "Error al generar el resumen de IA.";
      showNotification(errorMessage, 'error');
    } finally {
      setLoadingIA(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Reporte Integral del Alumno</h3>
          <button onClick={onClose} className="close-btn" disabled={loading}>&times;</button>
        </div>
        <div className="modal-body">
          {loading && (
            <div className="report-loading">
              <FaSpinner className="spinner" />
              <p>Cargando reporte de {alumno?.nombre}...</p>
            </div>
          )}
          {error && <p className="error-message">{error}</p>}

          {reportData && !loading && (
            <div className="report-content">
              <h4 className="student-name">{reportData.student_name}</h4>

              {/* --- Alerta de Riesgo --- */}
              {attendanceRisk && (
                <div className="report-alert-risk">
                  <FaExclamationTriangle />
                  <strong>Riesgo por Faltas:</strong> El alumno tiene {reportData.attendance.percentage}% de asistencia (requerido: 80%).
                </div>
              )}

              {/* --- KPIs --- */}
              <div className="report-kpi-grid">
                <KpiCard
                  title="Asistencia"
                  value={reportData.attendance.percentage}
                  unit="%"
                  risk={attendanceRisk}
                />
                <KpiCard
                  title="Prom. Actividades"
                  value={reportData.activities.average}
                  unit="pts"
                />
                <KpiCard
                  title="Prom. Evaluaciones"
                  value={reportData.evaluations.average}
                  unit="pts"
                />
              </div>

              {/* --- Gráficas --- */}
              <div className="report-charts-grid">
                <div className="report-chart-container card">
                  <h5>Desglose de Actividades ({reportData.activities.list.length})</h5>
                  {reportData.activities.list.length > 0 ? (
                    <SimpleBarChart data={reportData.activities.list} dataKey="grade" name="Calificación" />
                  ) : <p>Sin actividades calificadas.</p>}
                </div>
                <div className="report-chart-container card">
                  <h5>Desglose de Evaluaciones ({reportData.evaluations.list.length})</h5>
                  {reportData.evaluations.list.length > 0 ? (
                    <SimpleBarChart data={reportData.evaluations.list} dataKey="grade" name="Calificación" />
                  ) : <p>Sin evaluaciones calificadas.</p>}
                </div>
              </div>

              {/* --- Resumen IA (Fase 3) --- */}
              <div className="report-ia-summary">
                <button onClick={handleGenerateIASummary} disabled={loadingIA || !reportData} className="btn-secondary">
                  {loadingIA ? <FaSpinner className="spinner" /> : '✨'} Generar Resumen IA
                </button>
                {iaSummary && (
                  <div className="ia-recommendations">
                    <h4>Recomendaciones de la IA:</h4>
                    {/* Usamos <pre> para respetar los saltos de línea de la simulación */}
                    <pre>{iaSummary}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentReportModal;