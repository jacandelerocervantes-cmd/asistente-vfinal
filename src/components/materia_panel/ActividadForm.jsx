import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNotification } from '../../context/NotificationContext';
import './ActividadForm.css';
import { FaMagic, FaSave, FaTimes, FaSpinner, FaPlus, FaTrash } from 'react-icons/fa';

const ActividadForm = ({ materia, onClose, onActivityCreated, actividadToEdit }) => {
    const { showNotification } = useNotification();
    const isEditing = !!actividadToEdit;

    // --- ESTADOS DEL FORMULARIO ---
    const [nombre, setNombre] = useState('');
    const [unidad, setUnidad] = useState(1);
    const [tipoEntrega, setTipoEntrega] = useState('individual');
    const [descripcion, setDescripcion] = useState('');
    
    // Estado de la rúbrica (array de objetos)
    const [criterios, setCriterios] = useState([{ descripcion: '', puntos: '' }]);
    
    // Estados de carga
    const [loading, setLoading] = useState(false);
    const [generatingIA, setGeneratingIA] = useState(false);

    // --- SAFE HANDLERS (Evitan el error "r is not a function") ---
    const handleClose = () => {
        if (typeof onClose === 'function') {
            onClose();
        } else {
            console.warn('onClose prop missing in ActividadForm');
        }
    };

    const handleSuccessCallback = () => {
        if (typeof onActivityCreated === 'function') {
            onActivityCreated();
        }
    };

    // --- CARGAR DATOS SI ESTAMOS EDITANDO ---
    useEffect(() => {
        if (actividadToEdit) {
            setNombre(actividadToEdit.nombre || '');
            setUnidad(actividadToEdit.unidad || 1);
            setTipoEntrega(actividadToEdit.tipo_entrega || 'individual');
            setDescripcion(actividadToEdit.descripcion || '');
            
            // Lógica robusta para cargar criterios (pueden venir como JSON Object o JSON String)
            if (actividadToEdit.criterios) {
                if (Array.isArray(actividadToEdit.criterios)) {
                    setCriterios(actividadToEdit.criterios);
                } else if (typeof actividadToEdit.criterios === 'string') {
                    try {
                        const parsed = JSON.parse(actividadToEdit.criterios);
                        if (Array.isArray(parsed)) {
                            setCriterios(parsed);
                        } else {
                            setCriterios([{ descripcion: '', puntos: '' }]);
                        }
                    } catch (e) {
                        console.error("Error parseando criterios:", e);
                        setCriterios([{ descripcion: '', puntos: '' }]);
                    }
                }
            }
        }
    }, [actividadToEdit]);

    // --- GESTIÓN DE CRITERIOS (RÚBRICA) ---
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

    // Calcular suma total de puntos en tiempo real
    const totalPuntos = criterios.reduce((sum, item) => sum + (parseInt(item.puntos) || 0), 0);

    // --- IA: SUGERIR RÚBRICA ---
    const handleSuggestRubric = async () => {
        if (!descripcion || descripcion.length < 5) {
            showNotification('Escribe una descripción de la actividad primero para que la IA tenga contexto.', 'warning');
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

            if (data.criterios && Array.isArray(data.criterios)) {
                setCriterios(data.criterios);
                showNotification('¡Rúbrica generada por IA!', 'success');
            } else {
                showNotification('La IA respondió, pero no devolvió criterios válidos.', 'warning');
            }
        } catch (error) {
            console.error('Error IA:', error);
            showNotification('Error al conectar con la IA: ' + (error.message || 'Desconocido'), 'error');
        } finally {
            setGeneratingIA(false);
        }
    };

    // --- ENVIAR FORMULARIO (CREAR O ACTUALIZAR) ---
    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validación de puntos
        if (totalPuntos !== 100) {
            showNotification(`Los criterios deben sumar exactamente 100 puntos. Suma actual: ${totalPuntos}`, 'error');
            return;
        }

        setLoading(true);
        try {
            // Construcción del Payload
            const payload = {
                materia_id: materia?.id,
                drive_url_materia: materia?.drive_url,
                nombre: nombre, 
                unidad: parseInt(unidad, 10),
                tipo_entrega: tipoEntrega,
                criterios: criterios,
                descripcion: descripcion,
                rubricas_spreadsheet_id: materia?.rubricas_spreadsheet_id 
            };

            let endpoint = 'crear-actividad'; // Endpoint por defecto

            if (isEditing) {
                endpoint = 'actualizar-actividad';
                payload.id = actividadToEdit.id; // IMPORTANTE: Enviar el ID para actualizar
            }

            // Llamada al Backend
            const { error } = await supabase.functions.invoke(endpoint, { body: payload });

            if (error) {
                const errorMsg = error.message || 'Error desconocido en el servidor';
                throw new Error(errorMsg);
            }

            // Éxito
            showNotification(isEditing ? 'Actividad actualizada correctamente.' : 'Actividad creada correctamente.', 'success');
            
            // Llamadas seguras a los callbacks del padre
            handleSuccessCallback();
            handleClose();

        } catch (error) {
            console.error('Error submit:', error);
            showNotification(`Error al guardar: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content actividad-form-modal">
                <div className="modal-header">
                    <h2>{isEditing ? 'Editar Actividad' : 'Nueva Actividad'}</h2>
                    {/* IMPORTANTE: type="button" para evitar submit accidental */}
                    <button type="button" onClick={handleClose} className="close-btn">
                        <FaTimes />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="form-body">
                    {/* Fila 1: Nombre y Unidad */}
                    <div className="form-row">
                        <div className="form-group flex-grow">
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

                    {/* Fila 2: Tipo de Entrega */}
                    <div className="form-group">
                        <label>Tipo de Entrega</label>
                        <select value={tipoEntrega} onChange={(e) => setTipoEntrega(e.target.value)}>
                            <option value="individual">Individual (Cada alumno sube su archivo)</option>
                            <option value="grupal">Grupal (Un archivo por equipo)</option>
                            <option value="mixta">Mixta (Individual + Grupal)</option>
                        </select>
                    </div>

                    {/* Descripción y Botón IA */}
                    <div className="form-group">
                        <div className="label-with-action">
                            <label>Descripción / Instrucciones</label>
                            <button 
                                type="button" // IMPORTANTE: type="button"
                                className="btn-ia-suggest"
                                onClick={handleSuggestRubric}
                                disabled={generatingIA}
                                title="Generar criterios de evaluación basados en la descripción"
                            >
                                {generatingIA ? <FaSpinner className="spin" /> : <FaMagic />} 
                                {generatingIA ? ' Generando...' : ' IA Sugerir Rúbrica'}
                            </button>
                        </div>
                        <textarea 
                            value={descripcion} 
                            onChange={(e) => setDescripcion(e.target.value)} 
                            placeholder="Describe detalladamente qué deben hacer los alumnos. La IA usará esto para crear la rúbrica."
                            rows="4"
                        />
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
                                        required
                                    />
                                    <input 
                                        type="number" 
                                        placeholder="Pts"
                                        value={item.puntos}
                                        onChange={(e) => handleCriterioChange(index, 'puntos', e.target.value)}
                                        className="input-pts"
                                        required
                                    />
                                    {criterios.length > 1 && (
                                        <button 
                                            type="button" // IMPORTANTE: type="button"
                                            onClick={() => removeCriterio(index)} 
                                            className="btn-remove"
                                            title="Eliminar criterio"
                                        >
                                            <FaTrash />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <button 
                            type="button" // IMPORTANTE: type="button"
                            onClick={addCriterio} 
                            className="btn-add-criterio"
                        >
                            <FaPlus /> Agregar Criterio
                        </button>
                    </div>

                    {/* Botones Finales */}
                    <div className="form-actions">
                        <button 
                            type="button" // IMPORTANTE: type="button"
                            onClick={handleClose} 
                            className="btn-cancel"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="submit" 
                            className="btn-save" 
                            disabled={loading || totalPuntos !== 100}
                        >
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