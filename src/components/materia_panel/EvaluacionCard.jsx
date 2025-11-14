// src/components/materia_panel/EvaluacionCard.jsx
import React, { useState } from 'react'; // <-- Importar useState
import { Link } from 'react-router-dom'; // <-- Importar Link
import { supabase } from '../../supabaseClient'; // <-- Importar supabase
import EstadisticasModal from './EstadisticasModal'; // <-- Importar el nuevo modal
import { FaEdit, FaTrash, FaSync, FaChartBar, FaWpforms, FaSpinner } from 'react-icons/fa';
import ToggleSwitch from '../common/ToggleSwitch';

// Estilos similares a ActividadCard.css o MateriaCard.css pueden aplicarse
import './EvaluacionCard.css'; // Si creas un CSS específico

const EvaluacionCard = ({ evaluacion, onEdit, onDelete }) => {
    // --- 1. Obtener la nueva prop ---
    const { id, titulo, unidad, estado, fecha_apertura, fecha_cierre, tiempo_limite, esta_activo, revision_activa } = evaluacion;
    const [syncing, setSyncing] = useState(false); // <-- Estado para el botón de sincronizar
    const [showStatsModal, setShowStatsModal] = useState(false); // Estado para el modal
    
    // --- 2. Estados para AMBOS interruptores ---
    const [isActive, setIsActive] = useState(esta_activo);
    const [isTogglingActive, setIsTogglingActive] = useState(false);
    
    const [isRevisionActive, setIsRevisionActive] = useState(revision_activa); // <-- NUEVO ESTADO
    const [isTogglingRevision, setIsTogglingRevision] = useState(false); // <-- NUEVO ESTADO
    
    // --- 3. Handler para el primer interruptor (sin cambios) ---
    const handleToggleActivo = async (e) => {
        const nuevoEstado = e.target.checked;
        setIsTogglingActive(true);
        setIsActive(nuevoEstado); // Actualización optimista

        try {
            const { error } = await supabase
                .from('evaluaciones')
                .update({ esta_activo: nuevoEstado })
                .eq('id', id);

            if (error) throw error;
            alert(`'${titulo}' ${nuevoEstado ? 'está ahora ACTIVA' : 'está ahora OCULTA'}.`);

        } catch (error) {
            console.error("Error al actualizar estado:", error);
            alert("Error al cambiar el estado.");
            setIsActive(!nuevoEstado); // Revertir en caso de error
        } finally {
            setIsTogglingActive(false);
        }
    };

    // --- 4. NUEVO HANDLER para el interruptor de revisión ---
    const handleToggleRevision = async (e) => {
        const nuevoEstado = e.target.checked;
        setIsTogglingRevision(true);
        setIsRevisionActive(nuevoEstado); // Actualización optimista

        try {
            const { error } = await supabase
                .from('evaluaciones')
                .update({ revision_activa: nuevoEstado })
                .eq('id', id);
            
            if (error) throw error;
            alert(`Revisión para '${titulo}' ${nuevoEstado ? 'está ahora VISIBLE' : 'está ahora OCULTA'}.`);

        } catch (error){
            console.error("Error al actualizar revisión:", error);
            alert("Error al cambiar estado de revisión.");
            setIsRevisionActive(!nuevoEstado); // Revertir
        } finally {
            setIsTogglingRevision(false);
        }
    };

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

        <div className={`materia-card evaluacion-card ${!isActive ? 'desactivada' : ''}`}>
            <div className="card-header">
                <h3 className="materia-nombre">{titulo}</h3>
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
                 <p>Unidad: {unidad || 'N/A'}</p>
                 <p>Estado: <span className={`status-pill ${estado}`}>{estado}</span></p> {/* Usar pills de estado */}
                 <p>Apertura: {formatDate(fecha_apertura)}</p>
                 <p>Cierre: {formatDate(fecha_cierre)}</p>
                 <p>Límite: {tiempo_limite ? `${tiempo_limite} min` : 'Sin límite'}</p>
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
            {/* --- 6. Footer del Card MODIFICADO --- */}
            <div className="evaluacion-card-footer">
                <div className="footer-toggle">
                    <span>{isActive ? 'Activo' : 'Oculto'}</span>
                    <ToggleSwitch 
                        id={`eval-act-${id}`}
                        isChecked={isActive}
                        onChange={handleToggleActivo}
                        disabled={isTogglingActive}
                    />
                </div>
                <div className="footer-toggle">
                    <span>{isRevisionActive ? 'Revisión ON' : 'Revisión OFF'}</span>
                    <ToggleSwitch 
                        id={`eval-rev-${id}`}
                        isChecked={isRevisionActive}
                        onChange={handleToggleRevision} // <-- NUEVO HANDLER
                        disabled={isTogglingRevision}
                    />
                </div>
            </div>
        </div>
        </>
        // </Link>
    );
};

export default EvaluacionCard;