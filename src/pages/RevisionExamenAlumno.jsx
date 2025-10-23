// src/pages/RevisionExamenAlumno.jsx
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './RevisionExamenAlumno.css'; // <-- Crear este CSS

// Componente auxiliar para mostrar una pregunta específica en modo revisión
const PreguntaRevision = ({ pregunta, respuestaAlumno, opcionesPregunta }) => {
    const { texto_pregunta, tipo_pregunta, puntos, datos_extra } = pregunta;
    const { respuesta_texto, respuesta_opciones, respuesta_json, puntos_obtenidos, es_correcta, comentario_docente } = respuestaAlumno || {};

    // Determinar estilo visual (correcto, incorrecto, parcial)
    let cardClass = 'pregunta-revision-card';
    if (es_correcta === true) cardClass += ' correcta';
    else if (es_correcta === false) cardClass += ' incorrecta';
    else if (puntos_obtenidos > 0) cardClass += ' parcial'; // Para abiertas o juegos con puntaje parcial

    return (
        <div className={cardClass}>
            <div className="pregunta-header">
                <p><strong>{texto_pregunta}</strong></p>
                <span>{puntos_obtenidos ?? '-'}/{puntos} pts</span>
            </div>
            <div className="respuesta-area">
                {tipo_pregunta === 'abierta' && (
                    <div className="respuesta-revision">
                        <strong>Tu Respuesta:</strong>
                        <p className="texto-respuesta">{respuesta_texto || <i>No respondida</i>}</p>
                    </div>
                )}
                {tipo_pregunta === 'opcion_multiple_unica' && (
                    <ul className="opciones-revision">
                        <strong>Opciones:</strong>
                        {(opcionesPregunta || []).map(opt => {
                             const isSelected = respuesta_opciones?.includes(opt.id);
                             const isCorrect = opt.es_correcta;
                             let className = '';
                             if (isSelected && isCorrect) className = 'seleccion-correcta';
                             else if (isSelected && !isCorrect) className = 'seleccion-incorrecta';
                             else if (!isSelected && isCorrect) className = 'era-correcta';
                             return (
                                <li key={opt.id} className={className}>
                                    {isSelected ? '●' : '○'} {opt.texto_opcion} {isCorrect ? '(Correcta)' : ''}
                                </li>
                             );
                        })}
                    </ul>
                )}
                 {/* --- NUEVO: Mostrar Sopa de Letras (Simplificado) --- */}
                 {tipo_pregunta === 'sopa_letras' && datos_extra?.palabras && (
                     <div className="respuesta-revision">
                         <strong>Palabras a encontrar:</strong> {datos_extra.palabras.join(', ')} <br/>
                         <strong>Encontraste:</strong> {(respuesta_json?.encontradas || []).join(', ')}
                         {/* Podríamos mostrar la cuadrícula con las palabras marcadas, pero es más complejo */}
                     </div>
                 )}
                 {/* --- NUEVO: Mostrar Crucigrama (Simplificado) --- */}
                 {tipo_pregunta === 'crucigrama' && datos_extra?.entradas && (
                     <div className="respuesta-revision">
                         <strong>Pistas:</strong>
                         <ul>
                             {(datos_extra.entradas || []).map((e, i) => <li key={i}>{i+1}. {e.pista} <i>({e.palabra})</i></li>)}
                         </ul>
                         {/* Podríamos mostrar la cuadrícula completa, pero es más complejo */}
                         <p><i>(Visualización de la cuadrícula completa pendiente)</i></p>
                     </div>
                 )}
                {/* Añadir más tipos si es necesario */}

                 {/* Mostrar comentario del docente si existe */}
                 {comentario_docente && (
                    <div className="comentario-docente">
                        <strong>Retroalimentación:</strong>
                        <p>{comentario_docente}</p>
                    </div>
                 )}
            </div>
        </div>
    );
};


// --- Componente Principal ---
const RevisionExamenAlumno = () => {
    const { intentoId } = useParams();
    const [intento, setIntento] = useState(null);
    const [evaluacion, setEvaluacion] = useState(null);
    const [preguntas, setPreguntas] = useState([]);
    const [respuestas, setRespuestas] = useState({}); // { preguntaId: respuestaData }
    const [opcionesMap, setOpcionesMap] = useState({}); // { preguntaId: [opciones] }
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [alumnoInfo, setAlumnoInfo] = useState(null); // Para verificar permiso

    useEffect(() => {
        // Verificar sesión de alumno
        const authData = sessionStorage.getItem('alumnoAuth');
        if (!authData) {
            setError("Acceso denegado. Inicia sesión en el portal.");
            setLoading(false);
            return;
        }
        const parsedAuth = JSON.parse(authData);
        setAlumnoInfo(parsedAuth);

        const cargarRevision = async () => {
            setLoading(true);
            setError('');
            try {
                // 1. Cargar el intento y verificar que pertenece al alumno logueado
                const { data: intentoData, error: intentoError } = await supabase
                    .from('intentos_evaluacion')
                    .select(`
                        *,
                        evaluaciones ( *, materias (id) ),
                        alumnos ( id, correo )
                    `)
                    .eq('id', intentoId)
                    .single();

                if (intentoError) throw intentoError;
                if (!intentoData) throw new Error("Intento no encontrado.");
                // --- VERIFICACIÓN DE PERMISO ---
                if (!intentoData.alumnos || intentoData.alumnos.correo !== parsedAuth.correo) {
                     throw new Error("No tienes permiso para ver esta revisión.");
                }
                // --- FIN VERIFICACIÓN ---
                // Verificar si se permite la revisión
                if (intentoData.estado === 'en_progreso' || !intentoData.evaluaciones?.mostrar_respuestas) {
                    throw new Error("La revisión para este examen no está disponible todavía o no está permitida.");
                }

                setIntento(intentoData);
                setEvaluacion(intentoData.evaluaciones);

                // 2. Cargar todas las preguntas de esa evaluación (con sus opciones)
                const evaluacionId = intentoData.evaluacion_id;
                const { data: preguntasData, error: preguntasError } = await supabase
                    .from('preguntas')
                    .select('*, opciones(*)') // Cargar opciones anidadas
                    .eq('evaluacion_id', evaluacionId)
                    .order('orden', { ascending: true }); // Ordenar preguntas

                if (preguntasError) throw preguntasError;
                setPreguntas(preguntasData || []);

                 // Crear mapa de opciones para pasarlo a PreguntaRevision
                 const optsMap = {};
                 (preguntasData || []).forEach(p => {
                     if (p.opciones) {
                         optsMap[p.id] = p.opciones.sort((a,b)=> a.orden - b.orden); // Ordenar opciones si tienen 'orden'
                     }
                 });
                 setOpcionesMap(optsMap);


                // 3. Cargar las respuestas del alumno para este intento
                const { data: respData, error: respError } = await supabase
                    .from('respuestas_alumno')
                    .select('*')
                    .eq('intento_id', intentoId);

                if (respError) throw respError;

                // Organizar respuestas por preguntaId
                const respMap = {};
                (respData || []).forEach(r => {
                    respMap[r.pregunta_id] = r;
                });
                setRespuestas(respMap);

            } catch (err) {
                console.error("Error cargando revisión:", err);
                setError(err.message || "No se pudo cargar la revisión.");
            } finally {
                setLoading(false);
            }
        };

        cargarRevision();

    }, [intentoId]); // Dependencia principal


    // --- Renderizado ---
    if (loading) return <div className="container">Cargando revisión...</div>;
    if (error) return <div className="container error-message">{error} <Link to="/alumno/evaluaciones">Volver</Link></div>;
    if (!intento || !evaluacion) return <div className="container">No se encontraron datos.</div>;


    return (
        <div className="revision-examen-container container">
            <Link to="/alumno/evaluaciones" className="back-link">&larr; Volver a Mis Evaluaciones</Link>
            <h2>Revisión: {evaluacion.titulo}</h2>
            <div className="resumen-intento card">
                <h3>Resumen de tu Intento</h3>
                <p>Calificación Final: <strong>{intento.calificacion_final ?? 'N/A'} / 100</strong></p>
                <p>Estado: {intento.estado}</p>
                <p>Iniciado: {new Date(intento.fecha_inicio).toLocaleString('es-MX')}</p>
                <p>Finalizado: {intento.fecha_fin ? new Date(intento.fecha_fin).toLocaleString('es-MX') : '-'}</p>
            </div>

            <h3>Detalle de Preguntas:</h3>
            <div className="preguntas-revision-list">
                {preguntas.map((pregunta, index) => (
                    <PreguntaRevision
                        key={pregunta.id}
                        pregunta={pregunta}
                        respuestaAlumno={respuestas[pregunta.id]} // Pasar la respuesta específica
                        opcionesPregunta={opcionesMap[pregunta.id]} // Pasar opciones para esa pregunta
                    />
                ))}
            </div>
        </div>
    );
};

export default RevisionExamenAlumno;