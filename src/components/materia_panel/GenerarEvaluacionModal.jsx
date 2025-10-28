// src/components/materia_panel/GenerarEvaluacionModal.jsx
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import './GenerarEvaluacionModal.css'; // Asegúrate de crear este archivo CSS

// --- INICIO CORRECCIÓN: Añadir todos los tipos de pregunta ---
const TIPOS_PREGUNTA = [
    { value: 'opcion_multiple_unica', label: 'Opción Múltiple (Única)' },
    { value: 'opcion_multiple_multiple', label: 'Opción Múltiple (Varias)' }, // Añadido
    { value: 'abierta', label: 'Pregunta Abierta' },
    { value: 'sopa_letras', label: 'Sopa de Letras' }, // Añadido
    { value: 'crucigrama', label: 'Crucigrama' }, // Añadido
    { value: 'relacionar_columnas', label: 'Relacionar Columnas' }, // Añadido
];
// --- FIN CORRECCIÓN ---

const GenerarEvaluacionModal = ({ show, onClose, onGenerar }) => {
    const [tema, setTema] = useState('');
    const [numPreguntas, setNumPreguntas] = useState(10);
    // --- CORRECCIÓN: Incluir todos los tipos por defecto (o los que prefieras) ---
    const [tiposSeleccionados, setTiposSeleccionados] = useState([
        'opcion_multiple_unica',
        'opcion_multiple_multiple',
        'abierta',
        'sopa_letras',
        'crucigrama',
        'relacionar_columnas'
    ]);
    // --- FIN CORRECCIÓN ---
    const [instrucciones, setInstrucciones] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (!show) return null;

    const handleTipoChange = (tipoValue) => {
        setTiposSeleccionados(prev =>
            prev.includes(tipoValue)
                ? prev.filter(t => t !== tipoValue)
                : [...prev, tipoValue]
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!tema || numPreguntas <= 0 || tiposSeleccionados.length === 0) {
            setError('Completa el tema, número de preguntas (>0) y selecciona al menos un tipo.');
            return;
        }
        setError('');
        setLoading(true);

        try {
            // Asegúrate de que numPreguntas sea un número
            const numPreguntasInt = parseInt(numPreguntas, 10);
            if (isNaN(numPreguntasInt) || numPreguntasInt <= 0) {
                 throw new Error("El número de preguntas debe ser un entero positivo.");
            }


            // Llamada a la función Edge (sin cambios aquí)
            const { data, error: invokeError } = await supabase.functions.invoke('generar-evaluacion-gemini', {
                body: {
                    tema,
                    num_preguntas: numPreguntasInt,
                    tipos_preguntas: tiposSeleccionados, // Ya incluye todos los seleccionados
                    instrucciones_adicionales: instrucciones
                }
            });

            if (invokeError) {
                 const detail = invokeError.context?.details || invokeError.message;
                 throw new Error(`Error al invocar la función: ${detail}`);
            }
            if (!data || !Array.isArray(data.preguntas)) {
                 console.error("Respuesta inesperada:", data);
                 throw new Error("La respuesta de la IA no tuvo el formato esperado.");
            }

            console.log("Preguntas generadas:", data.preguntas);
            onGenerar(data.preguntas);
            onClose();

        } catch (err) {
            console.error("Error generando evaluación:", err);
            setError(err.message || 'Ocurrió un error desconocido.');
        } finally {
            setLoading(false);
        }
    };

    // Resetea el formulario al cerrar (opcional pero buena UX)
    const handleClose = () => {
        // Resetear estado al cerrar (sin cambios)
        setTema('');
        setNumPreguntas(10);
        setTiposSeleccionados(['opcion_multiple_unica', 'opcion_multiple_multiple', 'abierta', 'sopa_letras', 'crucigrama', 'relacionar_columnas']); // Resetear a todos
        setInstrucciones('');
        setError('');
        setLoading(false);
        onClose();
    };


    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>✨ Generar Evaluación con IA</h3>
                    <button onClick={handleClose} className="close-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="modal-body materia-form">
                    {error && <p className="error-message">{error}</p>}

                    {/* Campos Tema, Num Preguntas (sin cambios) */}
                    <div className="form-group">
                        <label htmlFor="temaIA">Tema Principal del Examen</label>
                        <input
                            id="temaIA" type="text" value={tema}
                            onChange={(e) => setTema(e.target.value)}
                            placeholder="Ej: Fundamentos de React, Derivadas, La Célula" required
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="numPreguntasIA">Número de Preguntas</label>
                        <input
                            id="numPreguntasIA" type="number" value={numPreguntas}
                            onChange={(e) => setNumPreguntas(e.target.value)}
                            min="1" max="50" required
                        />
                    </div>

                    {/* Tipos de Pregunta (ahora mostrará todos los definidos en TIPOS_PREGUNTA) */}
                    <div className="form-group">
                        <label>Tipos de Pregunta a Incluir</label>
                        <div className="checkbox-group">
                            {TIPOS_PREGUNTA.map(tipo => (
                                <label key={tipo.value}>
                                    <input
                                        type="checkbox"
                                        value={tipo.value}
                                        checked={tiposSeleccionados.includes(tipo.value)}
                                        onChange={() => handleTipoChange(tipo.value)}
                                    />
                                    {tipo.label}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Campo Instrucciones Adicionales (sin cambios) */}
                    <div className="form-group">
                        <label htmlFor="instruccionesIA">Instrucciones Adicionales (Opcional)</label>
                        <textarea
                            id="instruccionesIA" value={instrucciones}
                            onChange={(e) => setInstrucciones(e.target.value)}
                            rows="3"
                            placeholder="Ej: Enfócate en la sintaxis de hooks, Nivel: Introductorio"
                        />
                    </div>

                    {/* Botones de Acción (sin cambios) */}
                    <div className="form-actions">
                        <button type="button" onClick={handleClose} className="btn-tertiary" disabled={loading}>Cancelar</button>
                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? 'Generando...' : 'Generar Examen'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default GenerarEvaluacionModal;