// src/components/materia_panel/ActividadForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNotification } from '../../context/NotificationContext';
import './ActividadForm.css';
import { FaMagic, FaSave, FaTimes, FaSpinner } from 'react-icons/fa';

const ActividadForm = ({ materia, onClose, onActivityCreated, actividadToEdit }) => {
    const { showNotification } = useNotification();
    const isEditing = !!actividadToEdit;

    // Estados del formulario
    const [nombre, setNombre] = useState('');
    const [unidad, setUnidad] = useState(1);
    const [tipoEntrega, setTipoEntrega] = useState('individual');
    const [descripcion, setDescripcion] = useState('');
    // Criterios es un array de objetos { descripcion, puntos }
    const [criterios, setCriterios] = useState([{ descripcion: '', puntos: '' }]);
    
    const [loading, setLoading] = useState(false);
    const [generatingIA, setGeneratingIA] = useState(false);

    // Cargar datos si es edición
    useEffect(() => {
        if (actividadToEdit) {
            setNombre(actividadToEdit.nombre || '');
            setUnidad(actividadToEdit.unidad || 1);
            setTipoEntrega(actividadToEdit.tipo_entrega || 'individual');
            setDescripcion(actividadToEdit.descripcion || '');
            
            // Si hay criterios guardados (jsonb), los cargamos
            if (actividadToEdit.criterios && Array.isArray(actividadToEdit.criterios)) {
                setCriterios(actividadToEdit.criterios);
            }
        }
    }, [actividadToEdit]);

    // Manejo de Criterios Dinámicos
    const handleCriterioChange = (index, field, value) => {
        const newCriterios = [...criterios];
        newCriterios[index][field] = value;
        setCriterios(newCriterios);
    };

    const addCriterio = () => {
        setCriterios([...criterios, { descripcion: '', puntos: '' }]);
    };

    const removeCriterio = (index) => {
        const newCriterios = criterios.filter((_, i) => i !== index);
        setCriterios(newCriterios);
    };

    // Calcular total de puntos en tiempo real
    const totalPuntos = criterios.reduce((sum, item) => sum + (parseInt(item.puntos) || 0), 0);

    // --- FUNCIÓN: GENERAR RÚBRICA CON IA ---
    const handleSuggestRubric = async () => {
        if (!descripcion || descripcion.length < 10) {
            showNotification('Escribe una descripción detallada primero.', 'warning');
            return;
        }

        setGeneratingIA(true);
        try {
            const { data, error } = await supabase.functions.invoke('generar-rubrica-gemini', {
                body: { 
                    descripcion_actividad: descripcion,
                    materia_nombre: materia?.nombre || 'General'
                }
            });

            if (error) throw error;

            if (data.criterios) {
                setCriterios(data.criterios);
                showNotification('Rúbrica generada por IA exitosamente.', 'success');
            }
        } catch (error) {
            console.error(error);
            showNotification('Error al generar con IA: ' + error.message, 'error');
        } finally {
            setGeneratingIA(false);
        }
    };

    // --- FUNCIÓN: GUARDAR (CREAR O EDITAR) ---
    const handleSubmit = async (e) => {
        e.preventDefault();

        if (totalPuntos !== 100) {
            showNotification(`Los puntos deben sumar 100. Actual: ${totalPuntos}`, 'error');
            return;
        }

        setLoading(true);
        try {
            // Construimos el Payload Base
            const payload = {
                materia_id: materia.id,
                drive_url_materia: materia.drive_url,
                nombre: nombre, // El backend espera 'nombre', no 'nombre_actividad'
                unidad: parseInt(unidad, 10),
                tipo_entrega: tipoEntrega,
                criterios: criterios,
                descripcion: descripcion,
                rubricas_spreadsheet_id: materia.rubricas_spreadsheet_id // Necesario para crear/actualizar sheet
            };

            let endpoint = 'crear-actividad'; // Por defecto crear

            if (isEditing) {
                endpoint = 'actualizar-actividad';
                // *** CORRECCIÓN CRÍTICA PARA EDICIÓN ***
                payload.id = actividadToEdit.id;
            }

            const { data, error } = await supabase.functions.invoke(endpoint, {
                body: payload
            });

            if (error) {
                // Parseamos el error si viene del backend
                const errorMsg = error.message || 'Error desconocido';
                throw new Error(errorMsg);
            }

            showNotification(isEditing ? 'Actividad actualizada' : 'Actividad creada correctamente', 'success');
            onActivityCreated(); // Recargar lista en el padre
            onClose(); // Cerrar modal

        } catch (error) {
            console.error('Error submit:', error);
            showNotification(`Error: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content actividad-form-modal">
                <div className="modal-header">
                    <h2>{isEditing ? 'Editar Actividad' : 'Nueva Actividad'}</h2>
                    <button onClick={onClose} className="close-btn"><FaTimes /></button>
                </div>

                <form onSubmit={handleSubmit} className="form-body">
                    {/* Campos Superiores */}
                    <div className="form-row">
                        <div className="form-group">
                            <label>Nombre de la Actividad</label>
                            <input 
                                type="text" 
                                value={nombre} 
                                onChange={(e) => setNombre(e.target.value)} 
                                required 
                                placeholder="Ej. Ensayo sobre Suelos"
                            />
                        </div>
                        <div className="form-group short">
                            <label>Unidad</label>
                            <input 
                                type="number" 
                                value={unidad} 
                                onChange={(e) => setUnidad(e.target.value)} 
                                min="1" max="10" 
                                required 
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Tipo de Entrega</label>
                        <select value={tipoEntrega} onChange={(e) => setTipoEntrega(e.target.value)}>
                            <option value="individual">Individual (Cada alumno sube archivo)</option>
                            <option value="grupal">Grupal (Un archivo por equipo)</option>
                            <option value="mixta">Mixta (Individual + Grupal)</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Descripción / Instrucciones</label>
                        <textarea 
                            value={descripcion} 
                            onChange={(e) => setDescripcion(e.target.value)} 
                            placeholder="Describe qué deben hacer los alumnos..."
                            rows="3"
                        />
                        <button 
                            type="button" 
                            className="btn-ia-suggest"
                            onClick={handleSuggestRubric}
                            disabled={generatingIA}
                        >
                            {generatingIA ? <FaSpinner className="spin" /> : <FaMagic />} 
                            {generatingIA ? ' Generando...' : ' IA Sugerir Rúbrica'}
                        </button>
                    </div>

                    {/* Editor de Rúbrica */}
                    <div className="rubrica-section">
                        <div className="rubrica-header">
                            <h4>Rúbrica de Evaluación</h4>
                            <span className={`puntos-counter ${totalPuntos === 100 ? 'ok' : 'error'}`}>
                                Total: {totalPuntos} / 100
                            </span>
                        </div>
                        
                        <div className="criterios-list">
                            {criterios.map((item, index) => (
                                <div key={index} className="criterio-row">
                                    <input 
                                        type="text" 
                                        placeholder="Descripción del criterio (ej. Ortografía)"
                                        value={item.descripcion}
                                        onChange={(e) => handleCriterioChange(index, 'descripcion', e.target.value)}
                                        className="input-desc"
                                    />
                                    <input 
                                        type="number" 
                                        placeholder="Pts"
                                        value={item.puntos}
                                        onChange={(e) => handleCriterioChange(index, 'puntos', e.target.value)}
                                        className="input-pts"
                                    />
                                    {criterios.length > 1 && (
                                        <button type="button" onClick={() => removeCriterio(index)} className="btn-remove">×</button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <button type="button" onClick={addCriterio} className="btn-add-criterio">+ Agregar Criterio</button>
                    </div>

                    <div className="form-actions">
                        <button type="button" onClick={onClose} className="btn-cancel">Cancelar</button>
                        <button type="submit" className="btn-save" disabled={loading || totalPuntos !== 100}>
                            {loading ? <FaSpinner className="spin" /> : <FaSave />}
                            {loading ? ' Guardando...' : ' Guardar Actividad'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ActividadForm;