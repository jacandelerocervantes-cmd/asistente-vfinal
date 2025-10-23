// src/components/materia_panel/GenerarEvaluacionModal.jsx
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import './GenerarEvaluacionModal.css'; // Asegúrate de crear este archivo CSS

const TIPOS_PREGUNTA = [
    { value: 'opcion_multiple_unica', label: 'Opción Múltiple (Única)' },
    { value: 'abierta', label: 'Pregunta Abierta' },
    // Añadir más tipos si la función los soporta
];

const GenerarEvaluacionModal = ({ show, onClose, onGenerar }) => {
    const [tema, setTema] = useState('');
    const [numPreguntas, setNumPreguntas] = useState(10);
    const [tiposSeleccionados, setTiposSeleccionados] = useState(['opcion_multiple_unica', 'abierta']);
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


            const { data, error: invokeError } = await supabase.functions.invoke('generar-evaluacion-gemini', {
                body: {
                    tema,
                    num_preguntas: numPreguntasInt, // Enviar como número
                    tipos_preguntas: tiposSeleccionados,
                    instrucciones_adicionales: instrucciones
                }
            });

            // Manejo de errores de la función Edge
            if (invokeError) {
                 // Intenta obtener un mensaje más útil del error
                 const detail = invokeError.context?.details || invokeError.message;
                 throw new Error(`Error al invocar la función: ${detail}`);
            }
             // Validar la respuesta de la función
            if (!data || !Array.isArray(data.preguntas)) {
                 console.error("Respuesta inesperada de la función Edge:", data);
                 throw new Error("La respuesta de la IA no tuvo el formato esperado (faltan 'preguntas' o no es array).");
            }

            console.log("Preguntas generadas recibidas:", data.preguntas);
            onGenerar(data.preguntas); // Llama al callback con las preguntas generadas
            onClose(); // Cierra el modal

        } catch (err) {
            console.error("Error generando evaluación con IA:", err);
            // Mostrar el mensaje de error específico
            setError(err.message || 'Ocurrió un error desconocido al generar el examen.');
        } finally {
            setLoading(false);
        }
    };

    // Resetea el formulario al cerrar (opcional pero buena UX)
    const handleClose = () => {
        setTema('');
        setNumPreguntas(10);
        setTiposSeleccionados(['opcion_multiple_unica', 'abierta']);
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
                <form onSubmit={handleSubmit} className="modal-body materia-form"> {/* Reutiliza clase materia-form */}
                    {error && <p className="error-message">{error}</p>}

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
                            min="1" max="50" required // Limitar para evitar prompts muy largos
                        />
                    </div>

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

                    <div className="form-group">
                        <label htmlFor="instruccionesIA">Instrucciones Adicionales (Opcional)</label>
                        <textarea
                            id="instruccionesIA" value={instrucciones}
                            onChange={(e) => setInstrucciones(e.target.value)}
                            rows="3"
                            placeholder="Ej: Enfócate en la sintaxis de hooks, Incluye preguntas sobre la historia de México, Nivel de dificultad: Introductorio"
                        />
                    </div>

                    <div className="form-actions"> {/* Reutiliza clase form-actions */}
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