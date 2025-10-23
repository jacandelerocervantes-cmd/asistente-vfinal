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
    const [alumnoInfo, setAlumnoInfo] = useState(null);
    const [cambiosFoco, setCambiosFoco] = useState(0); // Estado para contar cambios de foco
    const [mostrarAdvertencia, setMostrarAdvertencia] = useState(false); // Estado para mostrar advertencia
    const [examenBloqueado, setExamenBloqueado] = useState(false); // Estado para bloquear examen
    const advertenciaTimeoutRef = useRef(null); // Ref para el timeout de la advertencia

    // --- LÓGICA ANTI-TRAMPA ---

    // 1. Bloqueo de Copiar, Pegar y Menú Contextual
    useEffect(() => {
        const preventActions = (e) => {
             // Solo bloquear si el examen no está bloqueado
             if (!examenBloqueado) {
                e.preventDefault();
             }
        };

        // Seleccionar el contenedor principal del examen si existe, o el documento
        // Es mejor adjuntar al documento para asegurar la captura global
        const target = document;

        target.addEventListener('copy', preventActions);
        target.addEventListener('paste', preventActions);
        target.addEventListener('contextmenu', preventActions);

        // Limpieza al desmontar
        return () => {
            target.removeEventListener('copy', preventActions);
            target.removeEventListener('paste', preventActions);
            target.removeEventListener('contextmenu', preventActions);
        };
    }, [examenBloqueado]); // Depende de examenBloqueado


    // 2. Detección de Cambio de Foco
    useEffect(() => {
        // Ignorar si el examen ya está bloqueado, si no está cargado o no hay intento
        if (examenBloqueado || loading || !intento) return;

        let focusChangeCount = cambiosFoco; // Usar variable local para el contador inmediato

        const handleVisibilityChange = () => {
             // Solo actuar si el examen aún no está bloqueado
            if (document.hidden && !examenBloqueado) {
                console.log("Cambio de foco detectado (visibilitychange)");
                focusChangeCount += 1;
                setCambiosFoco(focusChangeCount); // Actualiza el estado de React
                handleFocusChangeAction(focusChangeCount); // Ejecuta la acción (advertencia/bloqueo)
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
     const handleFocusChangeAction = (count) => {
         // Ya está bloqueado, no hacer nada más
         if (examenBloqueado) return;

         // Limpiar timeout de advertencia anterior si existe
         if (advertenciaTimeoutRef.current) {
            clearTimeout(advertenciaTimeoutRef.current);
         }

         if (count === 1) {
            // Primer cambio: Mostrar advertencia
            setMostrarAdvertencia(true);
            // Ocultarla después de 5 segundos
            advertenciaTimeoutRef.current = setTimeout(() => {
                setMostrarAdvertencia(false);
                advertenciaTimeoutRef.current = null; // Limpiar ref
            }, 5000);
         } else if (count >= 2) {
             // Segundo cambio o más: Bloquear examen
             setMostrarAdvertencia(false); // Ocultar advertencia si estaba visible
             advertenciaTimeoutRef.current = null; // Limpiar ref del timeout
             setExamenBloqueado(true); // Bloquea la UI
             alert("Has salido de la ventana del examen múltiples veces. El examen se ha bloqueado y será enviado.");
             // Llamar a finalizarIntento indicando la razón
             finalizarIntento('bloqueado_por_foco');
             // Aquí podrías añadir una llamada a Supabase para notificar al docente (requiere función/tabla adicional)
             // supabase.rpc('notificar_cambio_foco', { p_intento_id: intento.id, p_motivo: 'Bloqueado por foco múltiple' });
         }
     };

    // --- FIN LÓGICA ANTI-TRAMPA ---


    // --- useEffects para Carga de Datos y Temporizador ---

    // Cargar info del alumno y verificar/crear intento al montar
    useEffect(() => {
        const authData = sessionStorage.getItem('alumnoAuth');
        if (!authData) {
            navigate('/alumno/portal'); // Redirigir si no hay sesión de alumno
            return;
        }
        const parsedAuth = JSON.parse(authData);
        setAlumnoInfo(parsedAuth);

        const iniciarOContinuarIntento = async () => {
            setLoading(true);
            setError('');
            try {
                // 1. Buscar intento existente en progreso
                const { data: intentoExistente, error: errIntento } = await supabase
                    .from('intentos_evaluacion')
                    .select('*')
                    .eq('evaluacion_id', evaluacionId)
                    .eq('alumno_id', parsedAuth.alumnoId)
                    // .eq('estado', 'en_progreso') // Podríamos filtrar aquí o verificar después
                    .maybeSingle(); // Puede no existir o haber uno finalizado

                if (errIntento) throw errIntento;

                let intentoActual = intentoExistente;

                // 2. Si no existe en progreso, crear uno nuevo (si la evaluación lo permite)
                if (!intentoActual || intentoActual.estado !== 'en_progreso') {
                    // Antes de crear, verificar si ya existe uno finalizado (para evitar múltiples intentos si no se permite)
                    if (intentoActual && intentoActual.estado !== 'en_progreso') {
                        throw new Error("Ya has completado o finalizado un intento para esta evaluación.");
                    }

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
                const preguntasMezcladas = (evData.preguntas || [])
                    // .sort(() => Math.random() - 0.5) // Descomentar para mezclar preguntas
                    .map(p => {
                        if (p.opciones && p.opciones.length > 0) {
                            // Mezclar opciones dentro de cada pregunta
                            return { ...p, opciones: [...p.opciones].sort(() => Math.random() - 0.5) };
                        }
                        return p;
                    });
                setPreguntas(preguntasMezcladas);

                // 4. Cargar respuestas guardadas previamente para ESTE intento
                const { data: respuestasGuardadas, error: errResp } = await supabase
                    .from('respuestas_alumno')
                    .select('*') // Selecciona todas las columnas de la respuesta
                    .eq('intento_id', intentoActual.id); // Filtra por el ID del intento actual

                if (errResp) throw errResp;

                // Crear un mapa para acceder fácilmente a la respuesta de cada pregunta
                const respuestasMap = {};
                (respuestasGuardadas || []).forEach(r => {
                    // Determinar qué valor guardar basado en qué campo tiene datos
                    let respuestaGuardada = null;
                    if (r.respuesta_texto !== null) {
                        respuestaGuardada = r.respuesta_texto;
                    } else if (r.respuesta_opciones !== null && Array.isArray(r.respuesta_opciones)) {
                        respuestaGuardada = r.respuesta_opciones;
                    } else if (r.respuesta_json !== null) {
                        respuestaGuardada = r.respuesta_json;
                    }
                    if (respuestaGuardada !== null) {
                        respuestasMap[r.pregunta_id] = respuestaGuardada;
                    }
                });
                setRespuestas(respuestasMap); // Actualiza el estado con las respuestas cargadas

                // 5. Iniciar temporizador si la evaluación tiene límite de tiempo
                if (evData.tiempo_limite && evData.tiempo_limite > 0) {
                    const inicio = new Date(intentoActual.fecha_inicio);
                    const ahora = new Date();
                    const transcurridoSeg = Math.floor((ahora.getTime() - inicio.getTime()) / 1000); // Segundos transcurridos
                    const limiteTotalSeg = evData.tiempo_limite * 60; // Límite total en segundos
                    const restanteSeg = limiteTotalSeg - transcurridoSeg;
                    // Asegurar que el tiempo restante no sea negativo
                    setTiempoRestante(restanteSeg > 0 ? restanteSeg : 0);
                    if (restanteSeg <= 0) {
                        // Si el tiempo ya se agotó al cargar, bloquear y finalizar inmediatamente
                        console.warn("Tiempo agotado al cargar el intento.");
                        setExamenBloqueado(true);
                        finalizarIntento('tiempo_agotado');
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
    }, [evaluacionId, navigate]); // Dependencias: ID de evaluación y navegación


     // Efecto para manejar el temporizador
     useEffect(() => {
        // No iniciar si no hay tiempo, si es 0 o menos, o si el examen está bloqueado
        if (tiempoRestante === null || tiempoRestante <= 0 || examenBloqueado) return;

        // Iniciar intervalo que decrementa el tiempo cada segundo
        const timerId = setInterval(() => {
            setTiempoRestante(prev => {
                // Si el tiempo llega a 1 o menos
                if (prev <= 1) {
                    clearInterval(timerId); // Detener el intervalo
                    finalizarIntento('tiempo_agotado'); // Finalizar automáticamente
                    return 0; // Establecer tiempo a 0
                }
                return prev - 1; // Decrementar tiempo restante
            });
        }, 1000); // Ejecutar cada 1000ms (1 segundo)

        // Limpieza: detener el intervalo si el componente se desmonta o las dependencias cambian
        return () => clearInterval(timerId);
    // Añadimos finalizarIntento a las dependencias porque es una función definida con useCallback
    }, [tiempoRestante, examenBloqueado, finalizarIntento]);


    // --- Funciones de Manejo de Respuestas y Navegación ---

    // Función para guardar la respuesta actual en Supabase (debounced/throttled opcional)
    const guardarRespuesta = useCallback(async (preguntaId, respuesta) => {
        // No guardar si no hay intento o si el examen está bloqueado
        if (!intento || examenBloqueado) return;

        // Actualiza el estado local inmediatamente para UI reactiva
        setRespuestas(prev => ({ ...prev, [preguntaId]: respuesta }));

        console.log(`Intentando guardar respuesta para Pregunta ID ${preguntaId}...`); // Log
        try {
             // Determinar qué campo de la BD usar según el tipo de 'respuesta'
            let updateData = {
                 respuesta_texto: null,
                 respuesta_opciones: null,
                 respuesta_json: null // Campo por defecto para objetos
            };

            if (typeof respuesta === 'string') { // Respuesta abierta
                 updateData.respuesta_texto = respuesta;
            } else if (Array.isArray(respuesta)) { // Opción múltiple (array de IDs)
                 updateData.respuesta_opciones = respuesta;
            } else if (typeof respuesta === 'object' && respuesta !== null) { // Sopa, Crucigrama (objeto JSON)
                 updateData.respuesta_json = respuesta;
            } else {
                 console.warn(`Tipo de respuesta no reconocido para guardar: ${typeof respuesta}`, respuesta);
                 // Opcional: Podrías guardar como JSON stringificado como fallback
                 // updateData.respuesta_json = JSON.stringify(respuesta);
            }

            // Realizar Upsert: inserta si no existe, actualiza si existe (basado en la clave única)
            const { error } = await supabase
                .from('respuestas_alumno')
                .upsert({
                    intento_id: intento.id,       // Parte de la clave única
                    pregunta_id: preguntaId,      // Parte de la clave única
                    ...updateData                // Los campos de la respuesta a guardar/actualizar
                }, {
                     onConflict: 'intento_id, pregunta_id' // Especifica las columnas de la clave única
                     // ignoreDuplicates: false // (default) Asegura que actualice si existe
                 });

            if (error) throw error; // Lanza error si Supabase falla
            console.log(`Respuesta guardada exitosamente para Pregunta ID ${preguntaId}`); // Log éxito

        } catch (err) {
            console.error(`Error guardando respuesta para Pregunta ID ${preguntaId}:`, err);
            // Mostrar un indicador de error al usuario sería ideal aquí
            // alert(`Error al guardar tu respuesta para la pregunta ${preguntaId}. Intenta de nuevo.`);
        }
    // Dependencias: el objeto 'intento' y el estado 'examenBloqueado'
    }, [intento, examenBloqueado]);


    // Manejador llamado cuando el valor de una respuesta cambia en la UI
    const handleRespuestaChange = (preguntaId, tipo, value, opcionId = null) => {
        // No hacer nada si el examen está bloqueado
        if (examenBloqueado) return;

        let nuevaRespuesta; // Variable para almacenar la respuesta formateada

        // Determinar cómo formatear la respuesta según el tipo de pregunta
        switch (tipo) {
            case 'abierta':
                nuevaRespuesta = value; // Es el texto directamente
                break;
            case 'opcion_multiple_unica':
                nuevaRespuesta = [opcionId]; // Guardamos el ID de la opción seleccionada en un array
                break;
            // --- NUEVO CASE: opcion_multiple_multiple ---
            case 'opcion_multiple_multiple':
                // Obtener el array actual de respuestas seleccionadas (o un array vacío)
                const respuestaAnteriorMultiple = (respuestas[preguntaId] || []);
                if (value === true) { // Si el checkbox se marcó (value es 'checked' status)
                    nuevaRespuesta = [...respuestaAnteriorMultiple, opcionId].sort((a, b) => a - b);
                } else { // Si se desmarcó
                    // Quitar el opcionId del array
                    nuevaRespuesta = respuestaAnteriorMultiple.filter(id => id !== opcionId);
                }
                if(respuestaAnteriorMultiple.length === 0 && nuevaRespuesta.length === 0) return;
                break;
            // --- FIN NUEVO CASE ---
            case 'sopa_letras': // Recibe el objeto { encontradas: [...] }
            case 'crucigrama':  // Recibe el objeto { grid: {...} }
                nuevaRespuesta = value; // El valor ya es el objeto JSON correcto
                break;
            // --- NUEVO CASE ---
            case 'relacionar_columnas': nuevaRespuesta = value; break; // value será { pares_seleccionados: [...] }
            // --- FIN NUEVO CASE ---
            default:
                console.warn("Tipo de pregunta no manejado en handleRespuestaChange:", tipo);
                return; // Salir si el tipo no se reconoce
        }

        // Llamar a la función que guarda en la base de datos
        guardarRespuesta(preguntaId, nuevaRespuesta);
    };

    // Navega a la pregunta anterior/siguiente
    const irAPregunta = (index) => {
        // No permitir navegación si está bloqueado
        if (examenBloqueado) return;
        // Validar que el índice esté dentro de los límites del array de preguntas
        if (index >= 0 && index < preguntas.length) {
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
        if (razon === 'manual' && !examenBloqueado) {
            if (!window.confirm("¿Estás seguro de finalizar y enviar tu examen? No podrás cambiar tus respuestas después.")) {
                return; // El usuario canceló
            }
        }

        console.log(`Iniciando finalización de intento ${intento.id} por razón: ${razon}`);
        setLoading(true); // Mostrar indicador de carga/bloqueo
        setExamenBloqueado(true); // Asegurar que la UI quede bloqueada visualmente

        try {
            // 3. Doble chequeo del estado en BD (evita envíos múltiples si algo falló antes)
             const { data: currentIntento, error: checkError } = await supabase
               .from('intentos_evaluacion')
               .select('estado')
               .eq('id', intento.id)
               .single();

             if (checkError){
                 console.error("Error al verificar estado actual del intento:", checkError);
                 throw new Error(`Error al verificar estado del intento: ${checkError.message}`); // Lanza para el catch
             }
             // Si ya no está 'en_progreso' (ej. se finalizó en otra pestaña o por un error previo)
             if (currentIntento.estado !== 'en_progreso') {
                 console.warn(`Intento ${intento.id} ya no estaba 'en_progreso' (estado actual: ${currentIntento.estado}). Finalización redundante omitida.`);
                 // Redirigir igualmente por si acaso
                 navigate('/alumno/evaluaciones');
                 setLoading(false); // Quitar carga
                 return;
             }

            // 4. Actualizar estado del intento en Supabase
             const estadoFinal = (razon === 'bloqueado_por_foco') ? 'bloqueado' : 'completado'; // 'bloqueado' o 'completado'
            const { error: updateError } = await supabase
                .from('intentos_evaluacion')
                .update({
                    estado: estadoFinal,
                    fecha_fin: new Date().toISOString() // Marcar fecha/hora de finalización
                 })
                .eq('id', intento.id); // Asegurar que solo actualice el intento correcto

            if (updateError) {
                 console.error("Error al actualizar estado final del intento:", updateError);
                 throw new Error(`Error al guardar estado final: ${updateError.message}`);
            }
            console.log(`Intento ${intento.id} marcado como '${estadoFinal}' en BD.`);


             // 5. Invocar función de autocalificación (Edge Function 'calificar-intento')
             console.log(`Invocando función 'calificar-intento' para intento ${intento.id}...`);
             const { error: gradeError } = await supabase.functions.invoke('calificar-intento', {
                 body: { intento_id: intento.id }
             });
             // No lanzar error si la calificación falla, pero sí registrarlo
             if (gradeError) {
                 console.error("Error al invocar la función de calificación (puede continuar, pero la nota no se calculará automáticamente):", gradeError);
                 // Podrías mostrar un mensaje específico al usuario aquí si falla la calificación
                 // alert("Tu examen fue enviado, pero hubo un problema al calcular tu calificación automática. El docente la revisará.");
             } else {
                 console.log(`Función 'calificar-intento' invocada exitosamente.`);
             }

            // 6. Notificación al usuario y Redirección
            let alertMessage = "Examen finalizado y enviado correctamente.";
            if (razon === 'tiempo_agotado') alertMessage = "El tiempo ha terminado. Tu examen ha sido enviado.";
            // No mostramos alert si ya se mostró el de bloqueo por foco
            if (razon !== 'bloqueado_por_foco') {
                 alert(alertMessage);
            }

            navigate('/alumno/evaluaciones'); // Redirigir al dashboard del alumno

        } catch (err) {
             console.error("Error GRAVE durante finalizarIntento:", err);
             // Mostrar error genérico o específico al usuario
             alert("Ocurrió un error al finalizar el examen. Por favor, contacta a tu docente. Detalles: " + (err instanceof Error ? err.message : String(err)));
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
                <p>Error al cargar el examen: {error}</p>
                <Link to="/alumno/evaluaciones">Volver al listado de evaluaciones</Link>
            </div>
        );
    }

    // Estado si no se encontró la evaluación o no tiene preguntas
    if (!evaluacion || preguntas.length === 0) {
        return (
            <div className="examen-container">
                <p>No se encontró la evaluación solicitada o no tiene preguntas asignadas.</p>
                 <Link to="/alumno/evaluaciones">Volver al listado de evaluaciones</Link>
            </div>
        );
    }

    // Si todo está bien, obtener la pregunta y respuesta actuales
    const preguntaActual = preguntas[preguntaActualIndex];
    // Obtener la respuesta guardada para la pregunta actual desde el estado 'respuestas'
    const respuestaActual = respuestas[preguntaActual.id];
    let respuestaValor; // Variable para pasar el valor formateado al componente/input

    // Formatear 'respuestaValor' según el tipo de pregunta
    switch (preguntaActual.tipo_pregunta) {
        case 'abierta':
            // Si es string, úsalo; si no, string vacío
            respuestaValor = typeof respuestaActual === 'string' ? respuestaActual : '';
            break;
        case 'opcion_multiple_unica':
            // Si es array, úsalo; si no, array vacío
            respuestaValor = Array.isArray(respuestaActual) ? respuestaActual : [];
            break;
        case 'opcion_multiple_multiple':
            respuestaValor = Array.isArray(respuestaActual) ? respuestaActual : [];
            break;
        case 'sopa_letras':
        case 'crucigrama':
            // Si es objeto, úsalo; si no, objeto vacío
            respuestaValor = typeof respuestaActual === 'object' && respuestaActual !== null ? respuestaActual : {};
            break;
        // --- NUEVO CASE ---
        case 'relacionar_columnas': respuestaValor = typeof respuestaActual === 'object' && respuestaActual !== null ? respuestaActual : {}; break; // { pares_seleccionados: [...] }
        // --- FIN NUEVO CASE ---
        default:
            respuestaValor = null; // Para tipos no reconocidos
    }

    // Función auxiliar para formatear el tiempo restante
    const formatTiempo = (segundos) => {
        if (segundos === null) return ''; // No mostrar nada si no hay límite
        if (segundos <= 0) return 'Tiempo agotado';
        const mins = Math.floor(segundos / 60);
        const secs = segundos % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`; // Formato MM:SS
    };

    // JSX principal
    return (
        // Contenedor principal con clase condicional si está bloqueado
        <div className={`examen-container ${examenBloqueado ? 'examen-bloqueado' : ''}`}>

            {/* Overlay semitransparente que se muestra cuando examenBloqueado es true */}
            {examenBloqueado && <div className="examen-bloqueado-overlay">Examen Bloqueado</div>}

            {/* Mensaje de advertencia por cambio de foco */}
            {mostrarAdvertencia && (
                <div style={warningStyles}>
                    ⚠️ Advertencia: Has salido de la ventana del examen. Al siguiente cambio, el examen se bloqueará.
                </div>
            )}

            {/* Encabezado del examen */}
            <div className="examen-header">
                <h2>{evaluacion.titulo}</h2>
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

                {/* Pregunta Abierta */}
                {preguntaActual.tipo_pregunta === 'abierta' && (
                    <textarea
                        className="respuesta-abierta"
                        rows="5"
                        value={respuestaValor} // Valor del estado
                        onChange={(e) => handleRespuestaChange(preguntaActual.id, 'abierta', e.target.value)}
                        placeholder="Escribe tu respuesta aquí..."
                        disabled={examenBloqueado} // Deshabilitar si está bloqueado
                    />
                )}

                {/* Opción Múltiple Única */}
                {preguntaActual.tipo_pregunta === 'opcion_multiple_unica' && (
                    <ul className="opciones-list">
                        {(preguntaActual.opciones || []).map(op => ( // Mapear opciones (asegurarse que existan)
                            <li key={op.id} className="opcion-item">
                                <label>
                                    <input
                                        type="radio"
                                        name={`pregunta-${preguntaActual.id}`} // Name compartido para radios
                                        // Marcar si el ID de esta opción está en el array respuestaValor
                                        checked={respuestaValor.includes(op.id)}
                                        // Llamar al manejador al cambiar
                                        onChange={() => handleRespuestaChange(preguntaActual.id, 'opcion_multiple_unica', null, op.id)}
                                        disabled={examenBloqueado} // Deshabilitar si está bloqueado
                                    />
                                    {' '} {op.texto_opcion} {/* Mostrar texto de la opción */}
                                </label>
                            </li>
                        ))}
                    </ul>
                )}

                {/* --- NUEVO: opcion_multiple_multiple --- */}
                {preguntaActual.tipo_pregunta === 'opcion_multiple_multiple' && (
                    <ul className="opciones-list">
                        {(preguntaActual.opciones || []).map(opt => (
                            <li key={opt.id} className="opcion-item">
                                <label>
                                    <input
                                        type="checkbox" // <-- Input tipo CHECKBOX
                                        name={`pregunta-${preguntaActual.id}`} // Name puede ser compartido
                                        // Marcar si el ID de esta opción está INCLUIDO en el array respuestaValor
                                        checked={respuestaValor.includes(opt.id)}
                                        // Pasar 'e.target.checked' como 'value' al manejador
                                        onChange={(e) => handleRespuestaChange(preguntaActual.id, 'opcion_multiple_multiple', e.target.checked, opt.id)}
                                        disabled={examenBloqueado}
                                    />
                                    {' '} {opt.texto_opcion}
                                </label>
                            </li>
                        ))}
                    </ul>
                )}
                {/* --- FIN NUEVO --- */}

                {/* --- NUEVO: Relacionar Columnas --- */}
                {preguntaActual.tipo_pregunta === 'relacionar_columnas' && (
                    <RelacionarColumnasPlayer
                        pregunta={preguntaActual}
                        respuestaActual={respuestaValor} // Pasar { pares_seleccionados: [...] }
                        onRespuestaChange={handleRespuestaChange}
                        // disabled={examenBloqueado} // Pasar si el componente lo soporta
                    />
                )}
                {/* --- FIN NUEVO --- */}

                {/* Sopa de Letras */}
                {preguntaActual.tipo_pregunta === 'sopa_letras' && (
                    <SopaLetrasPlayer
                        pregunta={preguntaActual} // Pasar la configuración completa de la pregunta
                        respuestaActual={respuestaValor} // Pasar el estado guardado { encontradas: [...] }
                        onRespuestaChange={handleRespuestaChange} // Pasar la función callback para guardar
                        // disabled={examenBloqueado} // Pasar 'disabled' si el componente lo soporta
                    />
                )}

                {/* Crucigrama */}
                {preguntaActual.tipo_pregunta === 'crucigrama' && (
                     <CrucigramaPlayer
                        pregunta={preguntaActual} // Pasar la configuración completa de la pregunta
                        respuestaActual={respuestaValor} // Pasar el estado guardado { grid: {...} }
                        onRespuestaChange={handleRespuestaChange} // Pasar la función callback para guardar
                        // disabled={examenBloqueado} // Pasar 'disabled' si el componente lo soporta
                    />
                )}

                 {/* Aquí podrías añadir más 'else if' para otros tipos de pregunta */}

                 {/* === FIN RENDERIZADO CONDICIONAL === */}

            </div> {/* Fin de .pregunta-container */}

            {/* Navegación entre preguntas */}
            <div className="examen-navigation">
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