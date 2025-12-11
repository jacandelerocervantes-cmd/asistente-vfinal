import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNotification } from '../../context/NotificationContext';
import './ActividadForm.css';
import { FaMagic, FaSave, FaTimes, FaSpinner, FaPlus, FaTrash, FaInfoCircle } from 'react-icons/fa';

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

    // --- HELPER: GENERAR NOMBRE DE ARCHIVO SUGERIDO ---
    const generarNombreSugerido = (nombreAct) => {
        if (!nombreAct) return "[Matricula]_NombreActividad.pdf";
        // Limpia espacios y caracteres especiales
        const limpio = nombreAct.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        return `[Matricula]_${limpio}.pdf`;
    };

    // --- SAFE HANDLERS ---
    const handleClose = () => {
        if (typeof onClose === 'function') onClose();
    };

    const handleSuccessCallback = () => {
        if (typeof onActivityCreated === 'function') onActivityCreated();
    };

    // --- CARGAR DATOS SI ESTAMOS EDITANDO ---
    useEffect(() => {
        if (isEditing && actividadToEdit) {
            setLoading(true);
            
            // 1. Prioridad: Cargar datos que ya tenemos en memoria (es más rápido)
            setNombre(actividadToEdit.nombre || actividadToEdit.nombre_actividad || '');
            setUnidad(actividadToEdit.unidad || (materia?.initialUnidad || 1));
            setTipoEntrega(actividadToEdit.tipo_entrega || 'individual');
            setDescripcion(actividadToEdit.descripcion || '');
            
            // Parseo seguro de Criterios (ESTA ES LA CORRECCIÓN CLAVE)
            if (actividadToEdit.criterios) {
                let criteriosLimpio = [];
                if (typeof actividadToEdit.criterios === 'string') {
                    try {
                        criteriosLimpio = JSON.parse(actividadToEdit.criterios);
                    } catch (e) {
                        console.error("Error parseando criterios:", e);
                        criteriosLimpio = [{ descripcion: '', puntos: 50 }, { descripcion: '', puntos: 50 }];
                    }
                } else {
                    criteriosLimpio = actividadToEdit.criterios;
                }
                setCriterios(Array.isArray(criteriosLimpio) ? criteriosLimpio : [{ descripcion: '', puntos: '' }]);
            }

            // 2. Segundo plano: Confirmar detalles frescos del servidor (opcional)
            supabase.functions.invoke('get-activity-details', {
                body: { actividad_id: actividadToEdit.id }
            }).then(({ data, error }) => {
                if (!error && data) {
                    // Si el servidor trae datos más nuevos, actualizamos
                    if (data.descripcion) setDescripcion(data.descripcion);
                    if (data.criterios) {
                         // Misma lógica de seguridad aquí
                         const crit = typeof data.criterios === 'string' ? JSON.parse(data.criterios) : data.criterios;
                         setCriterios(Array.isArray(crit) ? crit : [{ descripcion: '', puntos: '' }]);
                    }
                }
            }).catch(e => console.log("Usando datos cacheados"));
            
            setLoading(false);
        } else if (!isEditing) {
            // Valores por defecto para nueva actividad
            if (materia?.initialUnidad) setUnidad(materia.initialUnidad);
        }
    }, [actividadToEdit, isEditing, materia]);

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

    const totalPuntos = criterios.reduce((sum, item) => sum + (parseInt(item.puntos) || 0), 0);

    // --- IA: SUGERIR RÚBRICA ---
    const handleSuggestRubric = async () => {
        if (!descripcion || descripcion.length < 5) {
            showNotification('Escribe una descripción primero.', 'warning');
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
                showNotification('Rúbrica generada por IA.', 'success');
            }
        } catch (error) {
            showNotification('Error IA: ' + (error.message || 'Desconocido'), 'error');
        } finally {
            setGeneratingIA(false);
        }
    };

    // --- ENVIAR FORMULARIO (CREAR O ACTUALIZAR) ---
    const handleSubmit = async (e) => {
        e.preventDefault();

        // 1. Validaciones
        if (!materia || !materia.id || !materia.drive_url) {
            showNotification("Error crítico: No se ha cargado la información de la materia.", 'error');
            console.error("Materia faltante:", materia);
            return;
        }
        if (totalPuntos !== 100) {
            showNotification(`Los criterios deben sumar 100. Actual: ${totalPuntos}`, 'error');
            return;
        }

        setLoading(true);
        try {
            // 2. Construcción del Payload (CORREGIDO)
            const payload = {
                materia_id: materia.id,
                drive_url_materia: materia.drive_url,
                // Backend 'crear-actividad' pide 'nombre_actividad'
                nombre_actividad: nombre, 
                // Backend 'actualizar-actividad' a veces pide 'nombre'
                nombre: nombre,
                unidad: parseInt(unidad, 10),
                tipo_entrega: tipoEntrega,
                criterios: criterios,
                descripcion: descripcion,
                rubricas_spreadsheet_id: materia.rubricas_spreadsheet_id 
            };

            let endpoint = 'crear-actividad';

            if (isEditing) {
                endpoint = 'actualizar-actividad';
                payload.id = actividadToEdit.id; 
            }

            // 3. Llamada al Backend
            const { error } = await supabase.functions.invoke(endpoint, { body: payload });

            if (error) throw new Error(error.message || 'Error desconocido');

            showNotification(isEditing ? 'Actividad actualizada.' : 'Actividad creada.', 'success');
            handleSuccessCallback();
            handleClose();

        } catch (error) {
            console.error('Error:', error);
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
                            {/* --- SUGERENCIA DE NOMBRE DE ARCHIVO --- */}
                            {nombre && (
                                <div className="file-name-hint">
                                    <FaInfoCircle className="hint-icon"/>
                                    <span>
                                        Sugerencia para alumnos: <br/>
                                        <code className="code-hint">{generarNombreSugerido(nombre)}</code>
                                    </span>
                                </div>
                            )}
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
                            <label>Instrucciones</label>
                            <button 
                                type="button" 
                                className="btn-ia-suggest"
                                onClick={handleSuggestRubric}
                                disabled={generatingIA}
                                title="Generar criterios de evaluación basados en la descripción"
                            >
                                {generatingIA ? <FaSpinner className="spin"/> : <FaMagic />} IA Sugerir Rúbrica
                            </button>
                        </div>
                        <textarea 
                            value={descripcion} 
                            onChange={(e) => setDescripcion(e.target.value)} 
                            placeholder="Describe la actividad..."
                            rows="4"
                        />
                    </div>

                    {/* Editor de Rúbrica */}
                    <div className="rubrica-section">
                        <div className="rubrica-header">
                            <h4>Rúbrica ({totalPuntos}/100)</h4>
                        </div>
                        
                        <div className="criterios-list">
                            {criterios.map((item, index) => (
                                <div key={index} className="criterio-row">
                                    <input 
                                        type="text" 
                                        placeholder="Criterio"
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
                                        <button type="button" onClick={() => removeCriterio(index)} className="btn-remove"><FaTrash /></button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <button type="button" onClick={addCriterio} className="btn-add-criterio"><FaPlus /> Agregar Criterio</button>
                    </div>

                    {/* Botones Finales */}
                    <div className="form-actions">
                        <button type="button" onClick={handleClose} className="btn-cancel">Cancelar</button>
                        <button type="submit" className="btn-save" disabled={loading || totalPuntos !== 100}>
                            {loading ? <FaSpinner className="spin"/> : <FaSave />} Guardar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ActividadForm;