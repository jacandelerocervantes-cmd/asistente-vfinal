// src/components/materia_panel/ActividadForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNotification } from '../../context/NotificationContext';
import { FaSpinner, FaInfoCircle } from 'react-icons/fa'; 
import './ActividadForm.css';

const ActividadForm = ({ materia, actividadToEdit, onSave, onCancel, initialUnidad }) => {
    const [nombre, setNombre] = useState('');
    const [unidad, setUnidad] = useState(initialUnidad || 1);
    const [descripcion, setDescripcion] = useState('');
    const [tipoEntrega, setTipoEntrega] = useState('individual');
    const [criterios, setCriterios] = useState([{ descripcion: '', puntos: 50 }, { descripcion: '', puntos: 50 }]);
    const [loading, setLoading] = useState(false);
    const [loadingRubric, setLoadingRubric] = useState(false);
    const isEditing = Boolean(actividadToEdit);
    
    const { showNotification } = useNotification();

    // Cargar datos si es edición
    useEffect(() => {
        if (isEditing && actividadToEdit) {
            setLoading(true);
            supabase.functions.invoke('get-activity-details', {
                body: { actividad_id: actividadToEdit.id }
            }).then(({ data, error }) => {
                if (error) throw error;
                setNombre(data.nombre);
                setUnidad(data.unidad);
                setTipoEntrega(data.tipo_entrega);
                setDescripcion(data.descripcion || ''); 
                if (data.criterios && data.criterios.length > 0) {
                    setCriterios(data.criterios);
                }
            }).catch(error => {
                const errorMessage = error.context?.details || error.message || "Error al cargar detalles.";
                showNotification(errorMessage, 'error');
            }).finally(() => {
                setLoading(false);
            });
        }
    }, [actividadToEdit, isEditing, showNotification]);

    const handleCriterioChange = (index, field, value) => {
        const nuevosCriterios = [...criterios];
        if (field === 'puntos') {
            nuevosCriterios[index][field] = value === '' ? '' : parseInt(value, 10);
        } else {
            nuevosCriterios[index][field] = value;
        }
        setCriterios(nuevosCriterios);
    };

    const handleAddCriterio = () => {
        setCriterios([...criterios, { descripcion: '', puntos: 0 }]);
    };

    const handleRemoveCriterio = (index) => {
        const nuevosCriterios = criterios.filter((_, i) => i !== index);
        setCriterios(nuevosCriterios);
    };

    const handleSuggestRubric = async () => {
        if (!descripcion) {
            showNotification("Escribe una descripción para generar la rúbrica.", 'warning');
            return;
        }
        setLoadingRubric(true);
        try {
            const { data, error } = await supabase.functions.invoke('generar-rubrica-gemini', {
                body: { descripcion_actividad: descripcion },
            });

            if (error) throw error;

            if (data.criterios && data.criterios.length > 0) {
                setCriterios(data.criterios);
                showNotification("Rúbrica generada con éxito.", 'success');
            } else {
                showNotification("La IA no pudo generar una rúbrica válida.", 'warning');
            }
        } catch (error) {
            const errorMessage = error.context?.details || error.message || "Error al generar la rúbrica.";
            showNotification(errorMessage, 'error');
        } finally {
            setLoadingRubric(false);
        }
    };

    const totalPuntos = criterios.reduce((sum, crit) => sum + (Number(crit.puntos) || 0), 0);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (totalPuntos !== 100) {
            showNotification(`La suma debe ser 100. Actualmente es: ${totalPuntos}.`, 'error');
            return;
        }
        setLoading(true);
        try {
            const functionName = isEditing ? 'actualizar-actividad' : 'crear-actividad';
            
            const payload = {
                materia_id: materia.id,
                drive_url_materia: materia.drive_url,
                nombre_actividad: nombre,
                unidad: parseInt(unidad, 10),
                tipo_entrega: tipoEntrega,
                criterios: criterios,
                descripcion: descripcion,
            };

            if (isEditing) {
                payload.actividad_id = actividadToEdit.id;
            }

            const { data, error } = await supabase.functions.invoke(functionName, {
                body: payload,
            });

            if (error) throw error;

            showNotification(data.message, 'success');
            onSave(data.actividad);

        } catch (error) {
            const errorMessage = error.context?.details || error.message || "Error al guardar la actividad.";
            showNotification(errorMessage, 'error');
        } finally {
            setLoading(false);
        }
    };

    // --- Función corregida para renderizar la instrucción de nomenclatura ---
    const renderNamingInstruction = () => {
        let instruction = "";
        let detail = "";
        let exampleFile = "";

        if (tipoEntrega === 'individual') {
            instruction = "[MATRICULA]_[NombreArchivo]";
            detail = "Cada alumno debe subir su propio archivo. El sistema detecta la matrícula al inicio del nombre.";
            exampleFile = "H001_EnsayoJuan.pdf";
        } else if (tipoEntrega === 'grupal') {
            instruction = "[MATRICULA_LIDER]_[NombreArchivo]";
            detail = "Solo un integrante (el líder) sube el archivo. El sistema buscará su equipo y asignará la entrega a todos.";
            exampleFile = "H001_ProyectoEquipoAlfa.pdf";
        } else {
            instruction = "Igual que Grupal o Individual";
            detail = "Si el alumno tiene equipo, se asigna a todos. Si no tiene equipo, se asigna solo a él.";
            exampleFile = "H001_Actividad.pdf";
        }

        return (
            <div className={`instruction-box ${tipoEntrega}`}>
                <div className="icon-area">
                    <FaInfoCircle />
                </div>
                <div className="text-area">
                    <strong>Instrucción para Alumnos ({tipoEntrega}):</strong>
                    <p>{detail}</p>
                    <div className="filename-example">
                        Formato: <span className="code">{instruction}</span>
                        <br/>
                        Ejemplo: <span className="code">{exampleFile}</span>
                    </div>
                </div>
            </div>
        );
    };

    if (loading && isEditing) {
        return <p>Cargando datos de la actividad...</p>;
    }

    return (
        <div className="form-wrapper fade-in">
            <div className="form-header">
                <h3>{isEditing ? 'Editar Actividad' : 'Nueva Actividad'}</h3>
            </div>
            
            <form onSubmit={handleSubmit} className="materia-form">
                <div className="form-group">
                    <label htmlFor="nombre_actividad">Nombre de la Actividad</label>
                    <input id="nombre_actividad" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
                </div>
    
                <div className="form-group-horizontal">
                    <div className="form-group">
                        <label htmlFor="unidad_actividad">Unidad</label>
                        <select id="unidad_actividad" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
                            {Array.from({ length: materia?.unidades || 1 }, (_, i) => i + 1).map(u => (
                                <option key={u} value={u}>Unidad {u}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="tipo_entrega">Tipo de Entrega</label>
                        <select
                            id="tipo_entrega"
                            value={tipoEntrega}
                            onChange={(e) => setTipoEntrega(e.target.value)}
                            disabled={isEditing}
                        >
                            <option value="individual">Individual</option>
                            <option value="grupal">Grupal</option>
                            <option value="mixta">Mixta</option>
                        </select>
                        {isEditing && <small>El tipo de entrega no se puede modificar después de crear la actividad.</small>}
                    </div>
                </div>

                {/* --- CAJA DE INSTRUCCIONES --- */}
                {renderNamingInstruction()}
    
                <div className="form-group">
                    <label htmlFor="descripcion_actividad">Descripción de la Actividad</label>
                    <textarea
                        id="descripcion_actividad"
                        rows="4"
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                        placeholder="Describe detalladamente qué deben hacer los alumnos..."
                    ></textarea>
                </div>
    
                <div className="rubrica-section">
                    <div className="rubrica-header">
                        <h4 style={{margin:0}}>Rúbrica de Evaluación ({totalPuntos}/100)</h4>
                        <button type="button" onClick={handleSuggestRubric} className="btn-secondary btn-small">
                            {loadingRubric ? <FaSpinner className="spin"/> : '✨ IA'} Sugerir
                        </button>
                    </div>
    
                    <div className="criterios-list">
                        {criterios.map((criterio, index) => (
                            <div key={index} className="criterio-row">
                                <input
                                    type="text"
                                    placeholder="Descripción del criterio..."
                                    value={criterio.descripcion || ''}
                                    onChange={(e) => handleCriterioChange(index, 'descripcion', e.target.value)}
                                />
                                <input
                                    type="number"
                                    placeholder="Pts"
                                    value={criterio.puntos}
                                    onChange={(e) => handleCriterioChange(index, 'puntos', e.target.value)}
                                />
                                <button type="button" onClick={() => handleRemoveCriterio(index)} className="btn-danger btn-small">
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                    <button type="button" onClick={handleAddCriterio} className="btn-tertiary" style={{width:'100%', marginTop:'10px'}}>
                        + Añadir Criterio
                    </button>
                </div>
    
                <div className="form-actions">
                    <button type="button" onClick={onCancel} className="btn-tertiary">Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={loading}>
                        {loading ? <FaSpinner className="spin"/> : (isEditing ? 'Guardar Cambios' : 'Crear Actividad')}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ActividadForm;