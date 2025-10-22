// src/components/materia_panel/PreguntaForm.jsx
import React from 'react';
import './PreguntaForm.css'; // <--- AÑADIR ESTA LÍNEA

// Estilos pueden ir en un CSS compartido o específico
const PreguntaForm = ({ pregunta, index, onUpdate, onDelete }) => {

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        onUpdate({ ...pregunta, [name]: value });
    };

    const handlePuntosChange = (e) => {
        const value = e.target.value === '' ? '' : parseInt(e.target.value, 10);
         onUpdate({ ...pregunta, puntos: isNaN(value) ? 0 : value });
    };

    const handleTipoChange = (e) => {
        const newType = e.target.value;
        const updatedPregunta = { ...pregunta, tipo_pregunta: newType };
        // Resetear opciones si cambiamos a/desde tipo 'abierta'
        if (newType === 'abierta') {
            updatedPregunta.opciones = [];
        } else if (!pregunta.tipo_pregunta.startsWith('opcion_multiple') && newType.startsWith('opcion_multiple')) {
             updatedPregunta.opciones = [{ id: `temp-opt-${Date.now()}`, texto_opcion: '', es_correcta: true }];
        }
        onUpdate(updatedPregunta);
    };

    // --- Manejadores para Opciones ---
    const handleOptionChange = (optIndex, field, value) => {
        const nuevasOpciones = [...(pregunta.opciones || [])];
        if (field === 'es_correcta') {
            // Si es opción única, desmarcar las demás
            if (pregunta.tipo_pregunta === 'opcion_multiple_unica') {
                 nuevasOpciones.forEach((opt, i) => opt.es_correcta = (i === optIndex));
            } else {
                 nuevasOpciones[optIndex].es_correcta = value; // Checkbox, simplemente cambia el valor
            }
        } else {
            nuevasOpciones[optIndex][field] = value;
        }
        onUpdate({ ...pregunta, opciones: nuevasOpciones });
    };

     const handleAddOption = () => {
        const nuevasOpciones = [...(pregunta.opciones || []), {
            id: `temp-opt-${Date.now()}`, // ID temporal
            texto_opcion: '',
            es_correcta: false // Por defecto no es correcta
        }];
        onUpdate({ ...pregunta, opciones: nuevasOpciones });
    };

    const handleRemoveOption = (optIndex) => {
        const nuevasOpciones = (pregunta.opciones || []).filter((_, i) => i !== optIndex);
        // Asegurarse de que quede al menos una opción y una correcta (si aplica)
        if (nuevasOpciones.length === 0 && pregunta.tipo_pregunta !== 'abierta') {
             alert("Debe haber al menos una opción.");
             return;
         }
         if (!nuevasOpciones.some(opt => opt.es_correcta) && pregunta.tipo_pregunta.startsWith('opcion_multiple')) {
            nuevasOpciones[0].es_correcta = true; // Marca la primera como correcta si ninguna lo es
         }
        onUpdate({ ...pregunta, opciones: nuevasOpciones });
    };


    return (
        <div className="pregunta-form-item card" style={{ marginBottom: '20px', border: '1px solid #eee'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                <strong>Pregunta {index + 1}</strong>
                <button type="button" onClick={() => onDelete(pregunta.id)} className="btn-danger" style={{padding: '3px 8px', fontSize: '0.8rem'}}>Eliminar Pregunta</button>
            </div>

            <div className="form-group">
                <label>Texto de la Pregunta</label>
                <textarea
                    name="texto_pregunta"
                    value={pregunta.texto_pregunta}
                    onChange={handleInputChange}
                    rows={3}
                    required
                />
            </div>

            <div className="form-group-horizontal">
                <div className="form-group">
                    <label>Tipo de Pregunta</label>
                    <select name="tipo_pregunta" value={pregunta.tipo_pregunta} onChange={handleTipoChange}>
                        <option value="opcion_multiple_unica">Opción Múltiple (Única Respuesta)</option>
                        {/* <option value="opcion_multiple_multiple">Opción Múltiple (Varias Respuestas)</option> */}
                        <option value="abierta">Abierta (Respuesta Manual)</option>
                        {/* Futuros tipos: 'relacionar_columnas', 'sopa_letras', 'crucigrama' */}
                    </select>
                </div>
                 <div className="form-group">
                    <label>Puntos</label>
                    <input
                        type="number"
                        name="puntos"
                        value={pregunta.puntos}
                        onChange={handlePuntosChange}
                        min="0"
                        required
                        style={{width: '80px'}}
                    />
                </div>
            </div>

            {/* Opciones (si aplica) */}
            {pregunta.tipo_pregunta.startsWith('opcion_multiple') && (
                <div className="opciones-section" style={{marginTop: '15px'}}>
                    <label>Opciones de Respuesta:</label>
                    {(pregunta.opciones || []).map((opcion, optIndex) => (
                        <div key={opcion.id || `new-opt-${optIndex}`} style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px'}}>
                            <input
                                type={pregunta.tipo_pregunta === 'opcion_multiple_unica' ? 'radio' : 'checkbox'}
                                name={`correcta-${pregunta.id}`} // Radio necesita name compartido
                                checked={opcion.es_correcta || false}
                                onChange={(e) => handleOptionChange(optIndex, 'es_correcta', e.target.checked)}
                            />
                            <input
                                type="text"
                                placeholder={`Opción ${optIndex + 1}`}
                                value={opcion.texto_opcion}
                                onChange={(e) => handleOptionChange(optIndex, 'texto_opcion', e.target.value)}
                                required
                                style={{flexGrow: 1}}
                            />
                            <button type="button" onClick={() => handleRemoveOption(optIndex)} className="btn-danger" style={{padding: '2px 6px', fontSize: '0.7rem'}}>X</button>
                        </div>
                    ))}
                    <button type="button" onClick={handleAddOption} className="btn-secondary" style={{fontSize: '0.9rem', padding: '5px 10px', marginTop: '5px'}}>＋ Añadir Opción</button>
                </div>
            )}

            {/* Espacio para configuración extra (Fase 3) */}
            {/* {pregunta.tipo_pregunta === 'sopa_letras' && <div>Config Sopa...</div>} */}

        </div>
    );
};

export default PreguntaForm;