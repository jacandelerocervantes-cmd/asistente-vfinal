// src/components/materia_panel/EvaluacionCard.jsx
import React, { useState } from 'react'; // <-- Importar useState
import { Link } from 'react-router-dom'; // <-- Importar Link
import { supabase } from '../../supabaseClient'; // <-- Importar supabase
import EstadisticasModal from './EstadisticasModal'; // <-- Importar el nuevo modal
import { FaEdit, FaTrash, FaSync, FaChartBar, FaWpforms, FaSpinner } from 'react-icons/fa'; // <-- Añadir FaSync, FaChartBar, FaWpforms

// Estilos similares a ActividadCard.css o MateriaCard.css pueden aplicarse
import './EvaluacionCard.css'; // Si creas un CSS específico

const EvaluacionCard = ({ evaluacion, onEdit, onDelete }) => {
    const [syncing, setSyncing] = useState(false); // <-- Estado para el botón de sincronizar
    const [showStatsModal, setShowStatsModal] = useState(false); // Estado para el modal

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            return new Date(dateString).toLocaleString('es-MX');
        } catch (e) { return 'Fecha inválida'; }
    };

    // --- Nueva función para sincronizar ---
    const handleSyncSheets = async (e) => {
        e.stopPropagation(); // Evitar que el clic active el Link principal
        e.preventDefault();

        if (!window.confirm(`¿Sincronizar las calificaciones finales de "${evaluacion.titulo}" con Google Sheets? Solo se enviarán los intentos ya calificados.`)) {
            return;
        }
        setSyncing(true);
        try {
            const { data, error } = await supabase.functions.invoke('sincronizar-evaluacion-sheets', {
                body: { evaluacion_id: evaluacion.id }
            });
            if (error) throw error;
            alert(data.message || "Sincronización iniciada/completada."); // Mostrar mensaje de la función
        } catch (error) {
            console.error("Error al sincronizar con Sheets:", error);
            alert("Error al sincronizar: " + error.message);
        } finally {
            setSyncing(false);
        }
    };
    // --- Fin nueva función ---

    // --- NUEVO: Manejador para Ver Estadísticas ---
    const handleVerEstadisticas = (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Mostrar el modal de estadísticas
        setShowStatsModal(true);
    };
    // --- FIN NUEVO ---

    // Determinar si hay preguntas abiertas para mostrar el botón de calificar
    // (Esto requeriría cargar las preguntas aquí o pasar la info como prop,
    // por simplicidad, lo enlazaremos siempre si no está en 'borrador')
    const puedeCalificar = evaluacion.estado !== 'borrador';

    return (
        // Quitar Link si las acciones se hacen con botones dentro
        // <Link to={`/evaluacion/${evaluacion.id}/editar`} className="materia-card-link">
        <>
            {showStatsModal && (
                <EstadisticasModal
                    evaluacion={evaluacion}
                    onClose={() => setShowStatsModal(false)}
                />
            )}

        <div className="materia-card evaluacion-card" > {/* Añadir clase específica si se creó EvaluacionCard.css */}
            <div className="card-header">
                <h3 className="materia-nombre">{evaluacion.titulo}</h3>
                <div className="card-actions">
                    {/* Botón Sincronizar */}
                    <button
                        onClick={handleSyncSheets}
                        className="icon-btn"
                        title="Sincronizar Calificaciones Finales con Google Sheets"
                        disabled={syncing || evaluacion.estado === 'borrador'} // Deshabilitado si está sincronizando o es borrador
                    >
                        {syncing ? <FaSpinner className="spin" /> : <FaSync />} {/* Podrías añadir una clase 'spin' en CSS para animación */}
                    </button>
                    {/* Botón Editar */}
                    <button onClick={(e) => { e.stopPropagation(); onEdit(evaluacion); }} className="icon-btn" title="Editar Configuración y Preguntas"><FaEdit /></button>
                    {/* Botón Eliminar */}
                    <button onClick={(e) => { e.stopPropagation(); onDelete(evaluacion); }} className="icon-btn icon-btn-delete" title="Eliminar"><FaTrash /></button>
                </div>
            </div>
            <div className="card-body">
                 <p>Unidad: {evaluacion.unidad || 'N/A'}</p>
                 <p>Estado: <span className={`status-pill ${evaluacion.estado}`}>{evaluacion.estado}</span></p> {/* Usar pills de estado */}
                 <p>Apertura: {formatDate(evaluacion.fecha_apertura)}</p>
                 <p>Cierre: {formatDate(evaluacion.fecha_cierre)}</p>
                 <p>Límite: {evaluacion.tiempo_limite ? `${evaluacion.tiempo_limite} min` : 'Sin límite'}</p>
            </div>
             <div className="card-footer-actions"> {/* Nueva clase para el pie de página con botones */}
               {/* Botón para ir a Calificar Preguntas Abiertas */}
               {puedeCalificar && (
                    <Link to={`/evaluacion/${evaluacion.id}/calificar`} className="btn-footer">
                        <FaWpforms /> Calificar Manualmente
                    </Link>
               )}
               {/* Botón Ver Estadísticas (Futuro) */}
               {evaluacion.estado !== 'borrador' && (
                    <button
                        onClick={handleVerEstadisticas} // <-- Llama al nuevo manejador
                        className="btn-footer"
                        // disabled // <-- Quita el disabled si quieres probar el alert
                        title="Ver estadísticas de rendimiento del grupo"
                    >
                         <FaChartBar /> Ver Estadísticas
                    </button>
               )}
            </div>
        </div>
        </>
        // </Link>
    );
};

export default EvaluacionCard;