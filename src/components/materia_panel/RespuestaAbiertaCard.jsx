// src/components/materia_panel/RespuestaAbiertaCard.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import './RespuestaAbiertaCard.css'; // <-- Nuevo CSS

const RespuestaAbiertaCard = ({ pregunta, respuesta, intentoId, onSave, onFinalizarIntento }) => {
    const [puntos, setPuntos] = useState('');
    const [comentario, setComentario] = useState('');
    const [sugiriendo, setSugiriendo] = useState(false);
    const [sugerencia, setSugerencia] = useState(null); // { puntos_sugeridos: number, comentario_sugerido: string }
    const [guardando, setGuardando] = useState(false);
    const [errorIA, setErrorIA] = useState('');

    useEffect(() => {
        // Cargar datos guardados si existen
        if (respuesta) {
            setPuntos(respuesta.puntos_obtenidos !== null && respuesta.puntos_obtenidos !== undefined ? String(respuesta.puntos_obtenidos) : '');
            setComentario(respuesta.comentario_docente || '');
        } else {
             // Si no hay objeto respuesta (alumno no contestó), resetear
             setPuntos('0'); // Opcional: Poner 0 si no contestó
             setComentario('No respondió'); // Opcional
        }
         setSugerencia(null); // Limpiar sugerencia al cambiar de respuesta
         setErrorIA('');
    }, [respuesta]); // Se ejecuta cuando cambia la 'respuesta' prop

    const handleSugerirClick = async () => {
        if (!respuesta || !respuesta.respuesta_texto) {
            alert("No hay respuesta del alumno para enviar a la IA.");
            return;
        }
        setSugiriendo(true);
        setErrorIA('');
        setSugerencia(null);

        try {
            const { data, error } = await supabase.functions.invoke('sugerir-calificacion-gemini', {
                body: {
                    texto_pregunta: pregunta.texto_pregunta,
                    respuesta_alumno: respuesta.respuesta_texto,
                    puntos_maximos: pregunta.puntos
                }
            });

            if (error) throw error;
            if (!data || typeof data.puntos_sugeridos !== 'number' || typeof data.comentario_sugerido !== 'string') {
                 throw new Error("Respuesta inesperada de la IA.");
            }

            setSugerencia(data);
            // Opcional: Rellenar campos con la sugerencia automáticamente
            setPuntos(String(data.puntos_sugeridos));
            setComentario(data.comentario_sugerido);

        } catch (err) {
            console.error("Error al sugerir calificación:", err);
            setErrorIA(err.message || "Error al obtener sugerencia.");
        } finally {
            setSugiriendo(false);
        }
    };

    const handleGuardarClick = async () => {
         // Validar puntos
         const puntosNum = parseFloat(puntos);
         if (isNaN(puntosNum) || puntosNum < 0 || puntosNum > pregunta.puntos) {
             alert(`Los puntos deben ser un número entre 0 y ${pregunta.puntos}.`);
             return;
         }
        setGuardando(true);
        try {
             // Si el alumno no respondió (no hay objeto 'respuesta'), no podemos hacer upsert normal
             // Necesitaríamos crear un registro vacío primero o manejarlo en la función que llama a esta.
             // Asumimos que 'respuesta' existe si se muestra este card (ajustar en CalificacionManualPanel si no es así)
             if (!respuesta) {
                 // Crear el registro de respuesta si no existe (alumno no respondió pero queremos poner 0)
                 const { data: newRespuesta, error: createError } = await supabase
                    .from('respuestas_alumno')
                    .insert({
                        intento_id: intentoId,
                        pregunta_id: pregunta.id,
                        puntos_obtenidos: puntosNum,
                        comentario_docente: comentario,
                        respuesta_texto: null, // Indicar que no hubo respuesta de texto
                        es_correcta: puntosNum === pregunta.puntos // O alguna lógica para 'es_correcta' en abiertas
                    })
                    .select()
                    .single();
                 if(createError) throw createError;
                 onSave(intentoId, pregunta.id, newRespuesta); // Notificar al padre con la nueva respuesta creada
             } else {
                 // Actualizar registro existente
                 const { data: updatedRespuesta, error: updateError } = await supabase
                    .from('respuestas_alumno')
                    .update({
                        puntos_obtenidos: puntosNum,
                        comentario_docente: comentario,
                        // Podríamos marcar 'es_correcta' basado en los puntos
                        es_correcta: puntosNum === pregunta.puntos ? true : (puntosNum > 0 ? null : false) // Ejemplo: true si max, false si 0, null si parcial
                    })
                    .eq('id', respuesta.id)
                    .select()
                    .single(); // Pedir que devuelva el registro actualizado
                 if (updateError) throw updateError;
                 onSave(intentoId, pregunta.id, updatedRespuesta); // Notificar al padre la actualización
             }

             // Opcional: Verificar si era la última pregunta abierta sin calificar de este intento
             // Si es así, llamar a onFinalizarIntento(intentoId) para recalcular total y marcar como 'calificado'
             // (Esta lógica requiere consultar el estado de otras respuestas abiertas del mismo intento)


        } catch (error) {
             console.error("Error al guardar calificación manual:", error);
             alert("Error al guardar: " + error.message);
        } finally {
             setGuardando(false);
        }
    };


    return (
        <div className="respuesta-abierta-card">
            <p><strong>Pregunta ({pregunta.puntos} pts):</strong> {pregunta.texto_pregunta}</p>
            <div className="respuesta-alumno">
                <strong>Respuesta del Alumno:</strong>
                <p>{respuesta?.respuesta_texto || <i style={{color: '#888'}}>No respondió</i>}</p>
            </div>

             {/* Mostrar sugerencia si existe */}
             {/* {sugerencia && !sugiriendo && (
                <div className="sugerencia-ia">
                    <strong>Sugerencia IA:</strong> {sugerencia.puntos_sugeridos} pts. "{sugerencia.comentario_sugerido}"
                </div>
             )} */}

            <div className="calificacion-controles">
                <div className="form-group">
                    <label>Puntos Asignados (0-{pregunta.puntos})</label>
                    <input
                        type="number"
                        min="0"
                        max={pregunta.puntos}
                        step="0.5" // Permitir decimales si se desea
                        value={puntos}
                        onChange={(e) => setPuntos(e.target.value)}
                        disabled={guardando || sugiriendo}
                    />
                </div>
                <div className="form-group">
                    <label>Comentario / Retroalimentación</label>
                    <textarea
                        rows="3"
                        value={comentario}
                        onChange={(e) => setComentario(e.target.value)}
                        disabled={guardando || sugiriendo}
                    />
                </div>
            </div>

            {errorIA && <p className="error-message">{errorIA}</p>}

            <div className="card-actions">
                <button
                    onClick={handleSugerirClick}
                    className="btn-secondary"
                    disabled={sugiriendo || guardando || !respuesta?.respuesta_texto} // Deshabilitar si no hay respuesta
                    title="Obtener una calificación y comentario sugeridos por IA"
                >
                    {sugiriendo ? 'Analizando...' : '✨ Sugerir Calificación'}
                </button>
                <button
                    onClick={handleGuardarClick}
                    className="btn-primary"
                    disabled={guardando || sugiriendo || puntos === ''} // Deshabilitar si no se han puesto puntos
                >
                    {guardando ? 'Guardando...' : 'Guardar Calificación'}
                </button>
            </div>
        </div>
    );
};

export default RespuestaAbiertaCard;