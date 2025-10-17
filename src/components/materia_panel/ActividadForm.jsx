// src/components/materia_panel/ActividadForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';

const ActividadForm = ({ materia, actividadToEdit, onSave, onCancel }) => {
    const [nombre, setNombre] = useState('');
    const [unidad, setUnidad] = useState(1);
    const [descripcion, setDescripcion] = useState('');
    const [tipoEntrega, setTipoEntrega] = useState('individual');
    const [criterios, setCriterios] = useState([{ descripcion: '', puntos: 50 }, { descripcion: '', puntos: 50 }]);
    const [loading, setLoading] = useState(false);
    const [loadingRubric, setLoadingRubric] = useState(false);
    const isEditing = Boolean(actividadToEdit);

    // useEffect para cargar todos los datos de la actividad en modo edición
    useEffect(() => {
        if (isEditing && actividadToEdit) {
            setLoading(true); // Muestra un indicador de carga
            supabase.functions.invoke('get-activity-details', {
                body: { actividad_id: actividadToEdit.id }
            }).then(({ data, error }) => {
                if (error) {
                    throw error;
                }
                // Llena el formulario con los datos obtenidos
                setNombre(data.nombre);
                setUnidad(data.unidad);
                setTipoEntrega(data.tipo_entrega);
                setDescripcion(data.descripcion || ''); // Usa un string vacío si la descripción es nula
                if (data.criterios && data.criterios.length > 0) {
                    setCriterios(data.criterios);
                }
            }).catch(error => {
                alert("Error al cargar los detalles de la actividad: " + error.message);
            }).finally(() => {
                setLoading(false);
            });
        }
    }, [actividadToEdit, isEditing]);


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
            alert("Por favor, escribe una descripción de la actividad para que la IA pueda generar una rúbrica.");
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
            } else {
                alert("La IA no pudo generar una rúbrica válida. Inténtalo de nuevo.");
            }

        } catch (error) {
            alert("Error al generar la rúbrica con IA: " + error.message);
        } finally {
            setLoadingRubric(false);
        }
    };

    const totalPuntos = criterios.reduce((sum, crit) => sum + (Number(crit.puntos) || 0), 0);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (totalPuntos !== 100) {
            alert(`La suma de los puntos de la rúbrica debe ser exactamente 100. Actualmente suma: ${totalPuntos}.`);
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
                descripcion: descripcion, // Guardamos también la descripción
            };

            if (isEditing) {
                payload.actividad_id = actividadToEdit.id;
            }

            const { data, error } = await supabase.functions.invoke(functionName, {
                body: payload,
            });

            if (error) throw error;

            alert(data.message);
            onSave(data.actividad);

        } catch (error) {
            alert(`Error al ${isEditing ? 'actualizar' : 'crear'} la actividad: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // Muestra un mensaje de carga específico mientras se obtienen los datos para editar
    if (loading && isEditing) {
        return <p>Cargando datos de la actividad...</p>;
    }

    return (
        <div className="actividad-form-container card">
            <form onSubmit={handleSubmit} className="materia-form">
                <h3>{isEditing ? 'Editar Actividad' : 'Nueva Actividad'}</h3>
                
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
                        <select id="tipo_entrega" value={tipoEntrega} onChange={(e) => setTipoEntrega(e.target.value)}>
                            <option value="individual">Individual</option>
                            <option value="grupal">Grupal</option>
                            <option value="mixta">Mixta</option>
                        </select>
                    </div>
                </div>

                <div className="form-group">
                    <label htmlFor="descripcion_actividad">Descripción de la Actividad</label>
                    <textarea 
                        id="descripcion_actividad" 
                        rows="4" 
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                        placeholder="Describe detalladamente qué deben hacer los alumnos. Esto servirá de contexto para la IA."
                    ></textarea>
                </div>

                <h4 style={{ color: totalPuntos !== 100 ? '#e53e3e' : 'inherit' }}>
                    Rúbrica de Evaluación (Total: {totalPuntos} / 100 pts)
                </h4>
                
                <button type="button" onClick={handleSuggestRubric} disabled={loadingRubric || loading} className="btn-secondary">
                    {loadingRubric ? 'Generando...' : '✨ Sugerir Rúbrica con IA'}
                </button>

                <ul className="criterios-list">
                    {criterios.map((criterio, index) => (
                        <li key={index} className="criterio-item">
                            <input
                                type="text"
                                placeholder={`Criterio de evaluación ${index + 1}`}
                                value={criterio.descripcion}
                                onChange={(e) => handleCriterioChange(index, 'descripcion', e.target.value)}
                                required
                            />
                            <input
                                type="number"
                                min="0"
                                className="puntos-input"
                                placeholder="Puntos"
                                value={criterio.puntos}
                                onChange={(e) => handleCriterioChange(index, 'puntos', e.target.value)}
                                required
                            />
                            <button type="button" onClick={() => handleRemoveCriterio(index)} className="btn-danger">X</button>
                        </li>
                    ))}
                </ul>
                <button type="button" onClick={handleAddCriterio} className="btn-secondary">＋ Añadir Criterio</button>

                <div className="form-actions">
                    <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={loading}>
                        {loading ? 'Guardando...' : (isEditing ? 'Actualizar Actividad' : 'Guardar Actividad')}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ActividadForm;