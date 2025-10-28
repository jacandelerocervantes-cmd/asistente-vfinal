// src/pages/ExamenAlumno.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import SopaLetrasPlayer from '../components/examen/SopaLetrasPlayer'; // Importar Sopa
import CrucigramaPlayer from '../components/examen/CrucigramaPlayer'; // Importar Crucigrama
import RelacionarColumnasPlayer from '../components/examen/RelacionarColumnasPlayer'; // <-- Importar Relacionar
import './ExamenAlumno.css'; // Asegúrate de importar el CSS

// Estilos para la advertencia (puedes moverlos a ExamenAlumno.css si prefieres)
const warningStyles = {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(255, 239, 196, 0.9)', // Amarillo pálido
    color: '#92400e', // Naranja oscuro
    padding: '15px 25px',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 2000, // Por encima de todo
    fontSize: '1rem',
    fontWeight: 'bold',
    textAlign: 'center',
    border: '1px solid #ecc94b',
    maxWidth: '80%',
};

const ExamenAlumno = () => {
    const { evaluacionId } = useParams();
    const navigate = useNavigate();
    const [evaluacion, setEvaluacion] = useState(null);
    const [preguntas, setPreguntas] = useState([]);
    const [respuestas, setRespuestas] = useState({}); // { preguntaId: respuesta }
    const [intento, setIntento] = useState(null);
    const [preguntaActualIndex, setPreguntaActualIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tiempoRestante, setTiempoRestante] = useState(null); // en segundos
    const [alumnoDbId, setAlumnoDbId] = useState(null); // Guardar el ID de la tabla 'alumnos'
    const [cambiosFoco, setCambiosFoco] = useState(0); // Estado para contar cambios de foco
    const [mostrarAdvertencia, setMostrarAdvertencia] = useState(false); // Estado para mostrar advertencia
    const [examenBloqueado, setExamenBloqueado] = useState(false); // Estado para bloquear examen
    const advertenciaTimeoutRef = useRef(null); // Ref para el timeout de la advertencia

    // --- LÓGICA ANTI-TRAMPA ---

    // 1. Bloqueo de Copiar, Pegar y Menú Contextual
    useEffect(() => {
        const handlePreventAndLog = (e) => {
             // Solo bloquear si el examen no está bloqueado
             if (!examenBloqueado) {
                e.preventDefault();
                // Enviar evento silencioso al backend
                if (intento?.id) {
                    supabase.functions.invoke('log-focus-change', {
                        body: { intento_id: intento.id, tipo_evento: `intento_${e.type}` } // ej. 'intento_copy'
                    }).catch(err => console.error("Error al loguear acción:", err));
                }
             }
        };
        
        // Seleccionar el contenedor principal del examen si existe, o el documento
        // Es mejor adjuntar al documento para asegurar la captura global
        const target = document;

        target.addEventListener('copy', handlePreventAndLog);
        target.addEventListener('paste', handlePreventAndLog);
        target.addEventListener('contextmenu', handlePreventAndLog);

        // Limpieza al desmontar
        return () => {
            target.removeEventListener('copy', handlePreventAndLog);
            target.removeEventListener('paste', handlePreventAndLog);
            target.removeEventListener('contextmenu', handlePreventAndLog);
        };
    }, [examenBloqueado, intento]); // Añadir intento como dependencia


    // 2. Detección de Cambio de Foco
    useEffect(() => {
        // Ignorar si el examen ya está bloqueado, si no está cargado o no hay intento
        if (examenBloqueado || loading || !intento) return;

        let focusChangeCount = cambiosFoco; // Usar variable local para el contador inmediato

        const handleVisibilityChange = () => {
             // Solo actuar si el examen aún no está bloqueado
            if (document.hidden && !examenBloqueado && intento?.id) { // Asegurar que intento.id exista
                console.log("Cambio de foco detectado (visibilitychange)");
                // Loguear el evento en el backend
                if (intento?.id) {
                    supabase.functions.invoke('log-focus-change', {
                        body: { intento_id: intento.id, tipo_evento: 'cambio_foco' }
                    }).catch(err => console.error("Error al loguear cambio de foco:", err));
                }
                focusChangeCount += 1;
                setCambiosFoco(focusChangeCount); // Actualiza el estado de React
                handleFocusChangeAction(focusChangeCount); // Llamar acción
            }
        };

        // No usaremos 'blur' por ahora para simplificar y evitar falsos positivos con alerts/prompts
        // const handleBlur = () => { ... };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        // window.addEventListener('blur', handleBlur);

        // Limpieza al desmontar o cuando cambian las dependencias
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            // window.removeEventListener('blur', handleBlur);
             if (advertenciaTimeoutRef.current) {
                clearTimeout(advertenciaTimeoutRef.current); // Limpiar timeout pendiente
            }
        };
    // Desactivamos la regla de exhaustive-deps porque 'cambiosFoco' se maneja localmente
    // y 'handleFocusChangeAction' depende implícitamente de 'examenBloqueado' y 'finalizarIntento'
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [examenBloqueado, loading, intento]); // Dependencias principales


     // 3. Acción a tomar por cambio de foco
     const handleFocusChangeAction = useCallback((count) => { // Usar useCallback aquí
         // Ya está bloqueado, no hacer nada másç
         if (examenBloqueado) return;

         // Limpiar timeout de advertencia anterior si existe
         if (advertenciaTimeoutRef.current) {
            clearTimeout(advertenciaTimeoutRef.current);
         }

         if (count === 1 || count === 2) {
            // Primer y segundo cambio: Mostrar advertencia
            setMostrarAdvertencia(true);
            // Ocultarla después de 5 segundos
            advertenciaTimeoutRef.current = setTimeout(() => {
                setMostrarAdvertencia(false);
                advertenciaTimeoutRef.current = null;
            }, 5000);
         } else if (count >= 3) {
             // Tercer cambio o más: Bloquear examen
             setMostrarAdvertencia(false); // Ocultar advertencia si estaba visible
             advertenciaTimeoutRef.current = null; // Limpiar ref del timeout
             setExamenBloqueado(true); // Bloquea la UI
             alert("Has salido de la ventana del examen múltiples veces. El examen se ha bloqueado y será enviado.");
             // Llamar a finalizarIntento indicando la razón
             finalizarIntento('bloqueado_por_foco');
             // Aquí podrías añadir una llamada a Supabase para notificar al docente (requiere función/tabla adicional)
             // supabase.rpc('notificar_cambio_foco', { p_intento_id: intento.id, p_motivo: 'Bloqueado por foco múltiple' });
         }
     }, [examenBloqueado, finalizarIntento]); // Añadir finalizarIntento

    // --- FIN LÓGICA ANTI-TRAMPA ---


    // --- useEffects para Carga de Datos y Temporizador ---

    // Cargar datos y gestionar intento
    useEffect(() => {
        let localAlumnoDbId = null; // Variable local para usar en la función async

        const iniciarOContinuarIntento = async () => {
            setLoading(true);
            setError('');
            try {
                // 1. Obtener sesión y user_id
                const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                if (sessionError || !session) {
                     navigate('/alumno/login'); return;
                }
                const userId = session.user.id;
                console.log("Alumno User ID:", userId);

                // 2. Buscar alumnos.id
                const { data: alumnoData, error: alumnoError } = await supabase
                    .from('alumnos')
                    .select('id')
                    .eq('user_id', userId)
                    .single();
                if (alumnoError || !alumnoData) throw new Error("Registro de alumno no vinculado.");
                localAlumnoDbId = alumnoData.id;
                setAlumnoDbId(localAlumnoDbId); // Guardar en estado
                console.log("Alumno DB ID:", localAlumnoDbId);

                // 3. Buscar/Crear intento
                const { data: intentoExistente, error: errIntento } = await supabase
                    .from('intentos_evaluacion')
                    .select('*')
                    .eq('evaluacion_id', evaluacionId)
                    .eq('alumno_id', localAlumnoDbId) // Usar ID de tabla alumnos
                    .order('fecha_inicio', { ascending: false })
                    .limit(1)
                    .maybeSingle(); // Puede no existir o haber uno finalizado

                if (errIntento) throw errIntento;

                let intentoActual = intentoExistente;

                // 2. Si no existe en progreso, crear uno nuevo (si la evaluación lo permite)
                if (!intentoActual || intentoActual.estado !== 'en_progreso') {
                    if (intentoActual) throw new Error("Ya has finalizado un intento.");
                    // Verificar evaluación (sin cambios)

                    // Verificar si la evaluación está activa (fechas, estado publicado) - ¡IMPORTANTE!
                    // Esta verificación debería hacerse idealmente antes de navegar aquí,
                    // pero la añadimos como doble chequeo.
                    const { data: evCheck, error: evCheckErr } = await supabase
                        .from('evaluaciones')
                        .select('estado, fecha_apertura, fecha_cierre')
                        .eq('id', evaluacionId)
                        .single();
                    if (evCheckErr) throw evCheckErr;
                    if (!evCheck || evCheck.estado !== 'publicado') throw new Error("La evaluación no está disponible.");
                    const ahora = new Date();
                    if (evCheck.fecha_apertura && ahora < new Date(evCheck.fecha_apertura)) throw new Error("La evaluación aún no ha comenzado.");
                    if (evCheck.fecha_cierre && ahora > new Date(evCheck.fecha_cierre)) throw new Error("La evaluación ya ha finalizado.");


                    // Crear nuevo intento
                    const { data: nuevoIntento, error: errNuevo } = await supabase
                        .from('intentos_evaluacion')
                        .insert({
                            evaluacion_id: evaluacionId,
                            alumno_id: parsedAuth.alumnoId,
                            estado: 'en_progreso' // Inicia en progreso
                        })
                        .select() // Devuelve el registro insertado
                        .single();
                    if (errNuevo) throw errNuevo;
                    intentoActual = nuevoIntento;
                }
                // Si llegamos aquí, intentoActual es un intento válido 'en_progreso'
                setIntento(intentoActual);

                // 3. Cargar datos de la Evaluación y sus Preguntas (con opciones)
                const { data: evData, error: errEv } = await supabase
                    .from('evaluaciones')
                    .select('*, preguntas(*, opciones(*))') // Carga anidada
                    .eq('id', evaluacionId)
                    .single(); // Solo debe haber una evaluación con ese ID

                if (errEv) throw errEv;
                if (!evData) throw new Error("Evaluación no encontrada.");
                setEvaluacion(evData);

                // --- Lógica de Aleatoriedad (Ejemplo simple) ---
                // Idealmente, esto se haría una vez al crear el intento y se guardaría en intento.respuestas_mezcladas (JSONB)
                // Aquí lo hacemos cada vez que carga, lo cual no es ideal para continuar intentos
                const preguntasMezcladas = (evData.preguntas || []).map(p => ({ ...p, opciones: p.opciones ? [...p.opciones].sort(() => Math.random() - 0.5) : [] }));
                setPreguntas(preguntasMezcladas);

                // 5. Cargar respuestas guardadas (sin cambios)
                const { data: respuestasGuardadas, error: errResp } = await supabase
                    .from('respuestas_alumno')
                    .select('*') // Selecciona todas las columnas de la respuesta
                    .eq('intento_id', intentoActual.id); // Filtra por el ID del intento actual

                if (errResp) throw errResp;
                const respuestasMap = {};
                (respuestasGuardadas || []).forEach(r => {
                    let respVal = null;
                    if (r.respuesta_texto !== null) respVal = r.respuesta_texto;
                    else if (r.respuesta_opciones !== null) respVal = r.respuesta_opciones;
                    else if (r.respuesta_json !== null) respVal = r.respuesta_json;
                    if (respVal !== null) respuestasMap[r.pregunta_id] = respVal;
                });
                setRespuestas(respuestasMap);


                // 6. Iniciar temporizador (sin cambios)
                if (evData.tiempo_limite && evData.tiempo_limite > 0) {
                    const inicio = new Date(intentoActual.fecha_inicio);
                    const ahora = new Date();
                    const transcurridoSeg = Math.floor((ahora.getTime() - inicio.getTime()) / 1000);
                    const limiteTotalSeg = evData.tiempo_limite * 60; // Límite total en segundos
                    const restanteSeg = limiteTotalSeg - transcurridoSeg;
                    // Asegurar que el tiempo restante no sea negativo
                    setTiempoRestante(restanteSeg > 0 ? restanteSeg : 0);
                    if (restanteSeg <= 0) {
                        // Si el tiempo ya se agotó al cargar, bloquear y finalizar inmediatamente
                        console.warn("Tiempo agotado al cargar el intento.");
                        setExamenBloqueado(true);
                        // Llamar a finalizarIntento después de que el estado se actualice
                        // Usaremos un useEffect dependiente de tiempoRestante para esto
                    }
                } else {
                    setTiempoRestante(null); // No hay límite de tiempo
                }

            } catch (err) {
                console.error("Error al iniciar/cargar examen:", err);
                setError(err.message || 'No se pudo cargar o iniciar el examen.');
                // Podríamos redirigir si el error es grave (ej. evaluación no disponible)
            } finally {
                setLoading(false); // Termina la carga
            }
        };

        iniciarOContinuarIntento(); // Llama a la función al montar o si evaluacionId cambia

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [evaluacionId, navigate]); // Solo depende del ID y navigate

    // Efecto para finalizar si el tiempo llega a 0
    useEffect(() => {
        if (tiempoRestante === 0 && !examenBloqueado) {
             finalizarIntento('tiempo_agotado');
        }
    }, [tiempoRestante, examenBloqueado, finalizarIntento]);


     // Efecto para manejar el temporizador (decremento)
     useEffect(() => {
        // No iniciar si no hay tiempo, si es 0 o menos, o si el examen está bloqueado
        if (tiempoRestante === null || tiempoRestante <= 0 || examenBloqueado) return;

        // Iniciar intervalo que decrementa el tiempo cada segundo
        const timerId = setInterval(() => {
            setTiempoRestante(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
        }, 1000); // Ejecutar cada 1000ms (1 segundo)

        // Limpieza: detener el intervalo si el componente se desmonta o las dependencias cambian
        return () => clearInterval(timerId);
    // Añadimos finalizarIntento a las dependencias porque es una función definida con useCallback
    }, [tiempoRestante, examenBloqueado]); // Depende del tiempo y el bloqueo


    // --- Funciones de Manejo de Respuestas y Navegación ---

    // Función para guardar la respuesta actual en Supabase (debounced/throttled opcional)
    const guardarRespuesta = useCallback(async (preguntaId, respuesta) => {
        // No guardar si no hay intento o si el examen está bloqueado
        if (!intento || examenBloqueado) return;

        // Actualiza el estado local inmediatamente para UI reactiva
        setRespuestas(prev => ({ ...prev, [preguntaId]: respuesta }));

         // ... (lógica upsert sin cambios)
        try {
            let updateData = { respuesta_texto: null, respuesta_opciones: null, respuesta_json: null };
            if (typeof respuesta === 'string') { updateData.respuesta_texto = respuesta; }
            else if (Array.isArray(respuesta)) { updateData.respuesta_opciones = respuesta; }
            else if (typeof respuesta === 'object' && respuesta !== null) { updateData.respuesta_json = respuesta; }
            const { error } = await supabase.from('respuestas_alumno').upsert({
                    intento_id: intento.id, pregunta_id: preguntaId, ...updateData
                }, { onConflict: 'intento_id, pregunta_id' });
            if (error) throw error;
        } catch (err) {
 console.error(`Error guardando resp ${preguntaId}:`, err); }
      }, [intento, examenBloqueado]);


    // Manejador llamado cuando el valor de una respuesta cambia en la UI
    const handleRespuestaChange = (preguntaId, tipo, value, opcionId = null) => {
        // No hacer nada si el examen está bloqueado
        if (examenBloqueado) return;
         // ... (lógica switch sin cambios)
        let nuevaRespuesta; // Variable para almacenar la respuesta formateada

        // Determinar cómo formatear la respuesta según el tipo de pregunta
        switch (tipo) {
            case 'abierta': nuevaRespuesta = value; break;
            case 'opcion_multiple_unica': nuevaRespuesta = [opcionId]; break;
            case 'opcion_multiple_multiple':
                const respAnt = (respuestas[preguntaId] || []);
                nuevaRespuesta = value ? [...respAnt, opcionId].sort((a,b)=>a-b) : respAnt.filter(id => id !== opcionId);
                if(respAnt.length === 0 && nuevaRespuesta.length === 0) return; // Evitar guardado innecesario
                break;
            case 'sopa_letras':
            case 'crucigrama':
            case 'relacionar_columnas': nuevaRespuesta = value; break;
            default: return;
        }

        // Llamar a la función que guarda en la base de datos
        guardarRespuesta(preguntaId, nuevaRespuesta);
    };

    // Navega a la pregunta anterior/siguiente
    const irAPregunta = (index) => {
        // No permitir navegación si está bloqueado
        // Validar que el índice esté dentro de los límites del array de preguntas
         if (!examenBloqueado && index >= 0 && index < preguntas.length) {
            setPreguntaActualIndex(index); // Actualiza el estado del índice
        }
    };

    // Función para finalizar el intento (manual, por tiempo o por foco)
    const finalizarIntento = useCallback(async (razon = 'manual') => {
        // 1. Validaciones iniciales:
        //    - No finalizar si no hay intento cargado.
        //    - Si está bloqueado, solo permitir finalización automática (tiempo, foco), no manual.
        if (!intento || (examenBloqueado && razon === 'manual')) {
             console.warn(`Finalización omitida: No hay intento (${!intento}) o está bloqueado y fue manual (${examenBloqueado && razon === 'manual'})`);
             return;
        }

        // 2. Confirmación (solo si es manual y no está bloqueado)
        if (razon === 'manual' && !examenBloqueado && !window.confirm("¿Finalizar y enviar examen?")) return;
        console.log(`Finalizando intento ${intento.id} por: ${razon}`);
        setLoading(true); // Mostrar indicador de carga/bloqueo
        setExamenBloqueado(true); // Asegurar que la UI quede bloqueada visualmente
        try {
            const { data: current, error: checkErr } = await supabase.from('intentos_evaluacion').select('estado').eq('id', intento.id).single();
            if (checkErr || !current || current.estado !== 'en_progreso') {
                 console.warn(`Intento ${intento.id} ya no estaba 'en_progreso'.`);
                 navigate('/alumno/evaluaciones');
 setLoading(false);
                 return;
            }
             const estadoFinal = (razon === 'bloqueado_por_foco') ? 'bloqueado' : 'completado'; // 'bloqueado' o 'completado'
            const { error: updateError } = await supabase
                .from('intentos_evaluacion')
                .update({ estado: estadoFinal, fecha_fin: new Date().toISOString() }).eq('id', intento.id);
            if (updateError) throw new Error(`Error guardando estado final: ${updateError.message}`);

            // Invocar calificar-intento (¡Requiere secreto!)
            // Asegúrate de tener INTERNAL_FUNCTIONS_SECRET en tus variables de entorno de Supabase
            // Esta es una forma de asegurar que la función solo se llame desde el backend.
            // En un entorno real, este secreto no debería estar hardcodeado.
            const internalSecret = "your-super-secret-key-that-matches-env"; // Reemplaza con una variable segura
             const { error: gradeError } = await supabase.functions.invoke('calificar-intento', {
                 body: { intento_id: intento.id },
                 headers: { 'X-Internal-Authorization': internalSecret } // Enviar secreto
             });
             if (gradeError) {
                 console.error("Error invocando calificación:", gradeError);
             }

            let msg = "Examen finalizado y enviado.";
            if (razon === 'tiempo_agotado') msg = "El tiempo ha terminado. Tu examen ha sido enviado.";
            // No mostramos alert si ya se mostró el de bloqueo por foco
            if (razon !== 'bloqueado_por_foco') alert(msg);

            navigate('/alumno/evaluaciones'); // Redirigir al dashboard del alumno

        } catch (err) {
             console.error("Error GRAVE finalizarIntento:", err);
             // Mostrar error genérico o específico al usuario
             alert("Error al finalizar el examen: " + (err.message || 'Error desconocido'));
             // Decidir si desbloquear la UI o mantenerla bloqueada
             // setLoading(false); // Podría permitir reintentar si fue error de red
             // setExamenBloqueado(false); // Considerar las implicaciones de permitir reintentar
        }
        // No hay finally setLoading(false) aquí porque la redirección desmontará el componente
    // Asegurar dependencias correctas para useCallback
    }, [intento, examenBloqueado, navigate]);


    // --- Renderizado del Componente ---

    // Estado de Carga Inicial
    if (loading) {
        return <div className="examen-container">Cargando examen...</div>;
    }

    // Estado de Error al Cargar
    if (error) {
        return (
            <div className="examen-container error-container">
                <p>{error}</p>
                <Link to="/alumno/evaluaciones">Volver al listado de evaluaciones</Link>
            </div>
        );
    }

    // Estado si no se encontró la evaluación o no tiene preguntas
    if (!evaluacion || preguntas.length === 0) {
        return (
            <div className="examen-container">
                <p>Evaluación no encontrada o sin preguntas.</p>
                 <Link to="/alumno/evaluaciones">Volver al listado de evaluaciones</Link>
            </div>
        );
    }

    // Si todo está bien, obtener la pregunta y respuesta actuales
    const preguntaActual = preguntas[preguntaActualIndex];
    // Obtener la respuesta guardada para la pregunta actual desde el estado 'respuestas'
    const respuestaActual = respuestas[preguntaActual.id];
    let respuestaValor; // Variable para pasar el valor formateado al componente/input

    // ... (switch para formatear respuestaValor sin cambios)
     switch (preguntaActual.tipo_pregunta) {
        case 'abierta': respuestaValor = typeof respuestaActual === 'string' ? respuestaActual : ''; break;
        case 'opcion_multiple_unica':
        case 'opcion_multiple_multiple': respuestaValor = Array.isArray(respuestaActual) ? respuestaActual : []; break;
        case 'sopa_letras':
        case 'crucigrama':
        case 'relacionar_columnas': respuestaValor = typeof respuestaActual === 'object' && respuestaActual !== null ? respuestaActual : {}; break;
        default:
            respuestaValor = null;
    }

    // Función auxiliar para formatear el tiempo restante
    const formatTiempo = (segundos) => {
        if (segundos === null) return ''; // No mostrar nada si no hay límite
        if (segundos <= 0) return 'Tiempo agotado';
        const mins = Math.floor(segundos / 60);
        const secs = segundos % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`; // Formato MM:SS
    }; // ...

    // JSX principal
    return (
        // Contenedor principal con clase condicional si está bloqueado
        <div className={`examen-container ${examenBloqueado ? 'examen-bloqueado' : ''}`}>

            {/* Overlay semitransparente que se muestra cuando examenBloqueado es true */}
            {examenBloqueado && <div className="examen-bloqueado-overlay">Examen Bloqueado</div>}

            {/* Mensaje de advertencia por cambio de foco */}
            {mostrarAdvertencia && (
                <div style={warningStyles} /* ... */ />
            )}

            {/* Encabezado del examen */}
            <div className="examen-header">
                <h2>{evaluacion.titulo}</h2> {/* ... */}
                {/* Mostrar temporizador si existe */}
                {tiempoRestante !== null && (
                    <p className="examen-timer">Tiempo Restante: {formatTiempo(tiempoRestante)}</p>
                )}
                <p className="examen-progreso">Pregunta {preguntaActualIndex + 1} de {preguntas.length}</p>
            </div>

            {/* Contenedor de la pregunta actual */}
            <div className="pregunta-container">
                 {/* Enunciado de la pregunta y puntos */}
                 <p className="pregunta-texto">
                    <span className="pregunta-puntos">({preguntaActual.puntos} pts)</span>
                    {' '} {preguntaActual.texto_pregunta}
                </p>

                {/* === Renderizado Condicional del Input/Componente de Respuesta === */}

                {/* === Renderizado Condicional (sin cambios) === */}
                {preguntaActual.tipo_pregunta === 'abierta' && ( <textarea value={respuestaValor} onChange={(e) => handleRespuestaChange(preguntaActual.id, 'abierta', e.target.value)} disabled={examenBloqueado} /* ... */ /> )}
                {preguntaActual.tipo_pregunta === 'opcion_multiple_unica' && ( <ul /* ... */ /> )}
                {preguntaActual.tipo_pregunta === 'opcion_multiple_multiple' && ( <ul /* ... */ /> )}
                {preguntaActual.tipo_pregunta === 'relacionar_columnas' && (
                    <RelacionarColumnasPlayer
                        pregunta={preguntaActual}
                        respuestaActual={respuestaValor} // Pasar { pares_seleccionados: [...] }
                        onRespuestaChange={handleRespuestaChange}
                        /* disabled={examenBloqueado} */
                    />
                )}
                {preguntaActual.tipo_pregunta === 'sopa_letras' && (
                    <SopaLetrasPlayer
                        pregunta={preguntaActual} // Pasar la configuración completa de la pregunta
                        respuestaActual={respuestaValor} // Pasar el estado guardado { encontradas: [...] }
                        onRespuestaChange={handleRespuestaChange} // Pasar la función callback para guardar
                        /* disabled={examenBloqueado} */
                    />
                )}

                {preguntaActual.tipo_pregunta === 'crucigrama' && (
                     <CrucigramaPlayer
                        pregunta={preguntaActual} // Pasar la configuración completa de la pregunta
                        respuestaActual={respuestaValor} // Pasar el estado guardado { grid: {...} }
                        onRespuestaChange={handleRespuestaChange} // Pasar la función callback para guardar
                        /* disabled={examenBloqueado} */
                    />
                )}

                 {/* Aquí podrías añadir más 'else if' para otros tipos de pregunta */}

                 {/* === FIN RENDERIZADO CONDICIONAL === */}

            </div> {/* Fin de .pregunta-container */}

            {/* Navegación entre preguntas */}
            <div className="examen-navigation"> {/* ... */}
                {/* Botón Anterior */}
                <button
                    onClick={() => irAPregunta(preguntaActualIndex - 1)}
                    // Deshabilitar si es la primera pregunta o si está bloqueado
                    disabled={preguntaActualIndex === 0 || examenBloqueado}
                >
                    &larr; Anterior
                </button>

                {/* Indicador de progreso */}
                <span>Pregunta {preguntaActualIndex + 1} / {preguntas.length}</span>

                {/* Botón Siguiente o Finalizar */}
                {preguntaActualIndex < preguntas.length - 1 ? (
                    // Botón Siguiente (si no es la última pregunta)
                    <button
                        onClick={() => irAPregunta(preguntaActualIndex + 1)}
                        disabled={examenBloqueado} // Deshabilitar si está bloqueado
                    >
                        Siguiente &rarr;
                    </button>
                ) : (
                    // Botón Finalizar (si es la última pregunta)
                    <button
                        onClick={() => finalizarIntento('manual')}
                        className="btn-primary" // Estilo diferente para finalizar
                        // Deshabilitar si está cargando o bloqueado
                        disabled={loading || examenBloqueado}
                    >
                        {loading ? 'Enviando...' : 'Finalizar Examen'}
                    </button>
                )}
            </div> {/* Fin de .examen-navigation */}

        </div> // Fin de .examen-container
    );
};

export default ExamenAlumno;