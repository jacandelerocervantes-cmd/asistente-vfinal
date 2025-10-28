// supabase/functions/calificar-intento/index.ts
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // O el origen de tu app
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Interfaces Actualizadas ---
interface RespuestaAlumno {
    id: number;
    pregunta_id: number;
    respuesta_opciones?: number[] | null;
    respuesta_texto?: string | null; // Para Sopa, Crucigrama, etc.
    respuesta_json?: RespuestaSopa | RespuestaCrucigrama | RespuestaRelacionar | null;
    // Campos que podríamos actualizar o leer
    puntos_obtenidos?: number | null;
    es_correcta?: boolean | null;
}

interface Opcion {
    id: number;
    es_correcta: boolean;
}

// --- NUEVAS INTERFACES (O MODIFICACIONES) ---
interface ColumnaRelacionar {
    id: string; // ID único temporal o permanente para la columna
    texto: string;
    // Podríamos añadir grupo: 'A' | 'B' si queremos separarlas explícitamente
}
interface ParCorrectoRelacionar {
    id_columna_a: string; // ID de un elemento de la columna A
    id_columna_b: string; // ID del elemento correspondiente en la columna B
}
interface DatosExtraRelacionar {
    columnas: ColumnaRelacionar[]; // Array de todos los elementos (ambas columnas)
    pares_correctos: ParCorrectoRelacionar[]; // Definición de las relaciones correctas
}

// Interfaz para datos_extra (ajusta según tu estructura real)
interface DatosExtraSopa {
    palabras: string[];
    tamano?: number; // Opcional aquí, principal para generación
}
interface DatosExtraCrucigrama {
    entradas: {
        palabra: string;
        pista: string;
        fila: number;
        columna: number;
        direccion: 'horizontal' | 'vertical';
    }[];
    num_filas: number;
    num_columnas: number;
}

interface Pregunta {
    id: number;
    tipo_pregunta: string;
    puntos: number;
    opciones?: Opcion[] | null;
    datos_extra?: DatosExtraSopa | DatosExtraCrucigrama | DatosExtraRelacionar | null; // <-- Añadido
}

// Interfaz para la respuesta guardada de Sopa de Letras
interface RespuestaSopa {
    encontradas: string[];
}
// Interfaz para la respuesta guardada de Crucigrama
interface RespuestaCrucigrama {
    grid: { [key: string]: string }; // Ejemplo: { '1-1': 'R', '1-2': 'E', ... }
}

// Interfaz para la respuesta guardada de Relacionar Columnas
interface RespuestaRelacionar {
    pares_seleccionados: { id_a: string; id_b: string }[]; // Array de pares hechos por el alumno
}

serve(async (req: Request) => {
  // Manejo de la solicitud OPTIONS (pre-vuelo) para CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- VERIFICACIÓN DE SEGURIDAD ---
  // Esta función solo debe ser invocada por otra función del backend (como submit-attempt)
  // o por un trigger de base de datos, usando la SERVICE_ROLE_KEY.
  // Una forma simple de verificar es chequear un header secreto.
  const internalAuthHeader = req.headers.get('X-Internal-Authorization');
  if (internalAuthHeader !== Deno.env.get('INTERNAL_FUNCTIONS_SECRET')) {
    return new Response(JSON.stringify({ message: 'Acceso no autorizado.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    // 1. Obtener intento_id del cuerpo de la solicitud
    const { intento_id } = await req.json();
    if (!intento_id) {
      throw new Error("Se requiere el 'intento_id'.");
    }

    // 2. Crear cliente Supabase con rol de servicio (admin)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 3. Obtener el intento y verificar estado
    console.log(`Calificando Intento ID: ${intento_id}`);
    const { data: intentoData, error: intentoError } = await supabaseAdmin
        .from('intentos_evaluacion')
        .select('id, evaluacion_id, estado')
        .eq('id', intento_id)
        .single(); // Esperamos encontrar uno solo

    if (intentoError) throw intentoError;
    if (!intentoData) throw new Error(`Intento con ID ${intento_id} no encontrado.`);
    // Opcional: Podrías verificar si ya está 'calificado' y salir temprano.
    // if (intentoData.estado === 'calificado') return new Response(...)

    // 4. Obtener todas las preguntas de la evaluación (con opciones y datos_extra)
    console.log(`Obteniendo preguntas para Evaluación ID: ${intentoData.evaluacion_id}`);
    const { data: preguntasData, error: preguntasError } = await supabaseAdmin
        .from('preguntas')
        .select('id, tipo_pregunta, puntos, datos_extra, opciones (id, es_correcta)') // <-- Incluir datos_extra
        .eq('evaluacion_id', intentoData.evaluacion_id);

    if (preguntasError) throw preguntasError;

    // Manejo si la evaluación no tiene preguntas
    if (!preguntasData || preguntasData.length === 0) {
        console.warn(`La evaluación ${intentoData.evaluacion_id} no tiene preguntas.`);
        // Marcar intento como calificado con 0 puntos
         await supabaseAdmin.from('intentos_evaluacion').update({ calificacion_final: 0, estado: 'calificado' }).eq('id', intento_id);
         return new Response(JSON.stringify({ message: "Calificación completada (evaluación sin preguntas).", calificacion_final: 0, estado_final: 'calificado' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
         });
    }
    // Convertir a un Map para búsqueda rápida por ID de pregunta
    const preguntasMap = new Map(preguntasData.map(p => [p.id, p as Pregunta]));
    console.log(`Encontradas ${preguntasMap.size} preguntas.`);

    // 5. Obtener todas las respuestas del alumno para ese intento
    console.log(`Obteniendo respuestas para Intento ID: ${intento_id}`);
    const { data: respuestasData, error: respuestasError } = await supabaseAdmin
        .from('respuestas_alumno')
        .select('*') // Seleccionamos todo para tener respuesta_json, etc.
        .eq('intento_id', intento_id);

    if (respuestasError) throw respuestasError;
    // Convertir a un Map para búsqueda rápida por ID de pregunta
    const respuestasMap = new Map((respuestasData as RespuestaAlumno[] || []).map(r => [r.pregunta_id, r]));
    console.log(`Encontradas ${respuestasMap.size} respuestas guardadas para el intento.`);

    // 6. Calcular puntaje total y preparar actualizaciones para respuestas autocalificables
    let calificacionTotal = 0; // Suma de puntos obtenidos en el intento
    const updatesRespuestas = []; // Array para operaciones upsert en respuestas_alumno
    let todasLasAbiertasCalificadas = true; // Flag para saber si quedan preguntas abiertas sin calificar

    // Iterar sobre TODAS las preguntas de la evaluación (no solo las respondidas)
    for (const pregunta of preguntasData as Pregunta[]) {
        const respuestaExistente = respuestasMap.get(pregunta.id); // Busca si el alumno respondió esta pregunta
        let puntosObtenidosPregunta = 0; // Puntos para esta pregunta específica
        let esCorrectaRespuesta: boolean | null = null; // Estado de corrección (null si no aplica o pendiente)

        // --- Lógica de Calificación por Tipo de Pregunta ---
        switch (pregunta.tipo_pregunta) {
            case 'opcion_multiple_unica': {
                const opcionesCorrectas = pregunta.opciones?.filter(o => o.es_correcta).map(o => o.id) || [];
                const opcionSeleccionada = respuestaExistente?.respuesta_opciones?.[0]; // ID de la opción que marcó el alumno
                if (opcionSeleccionada && opcionesCorrectas.includes(opcionSeleccionada))
                {
                    // Si seleccionó una opción y es la correcta
                    puntosObtenidosPregunta = pregunta.puntos; // Obtiene todos los puntos
                    esCorrectaRespuesta = true;
                } else {
                    // Si no respondió o seleccionó incorrecta
                    puntosObtenidosPregunta = 0;
                    esCorrectaRespuesta = false;
                }
                // Añadir a updates solo si la calificación automática difiere de lo guardado o si no existía respuesta
                if (!respuestaExistente || respuestaExistente.puntos_obtenidos !== puntosObtenidosPregunta || respuestaExistente.es_correcta !== esCorrectaRespuesta) {
                     updatesRespuestas.push({
                        id: respuestaExistente?.id, // undefined si es nueva, Supabase lo maneja en upsert
                        intento_id: intento_id, // Necesario para upsert si es nueva
                        pregunta_id: pregunta.id, // Necesario para upsert si es nueva
                        puntos_obtenidos: puntosObtenidosPregunta,
                        es_correcta: esCorrectaRespuesta,
                        // Limpiar otros campos para asegurar consistencia
                        respuesta_texto: null,
                        respuesta_json: null,
                        respuesta_opciones: respuestaExistente?.respuesta_opciones || null // Conservar la opción marcada
                    });
                }
                break;
            }

            // --- NUEVO CASE: opcion_multiple_multiple ---
            case 'opcion_multiple_multiple': {
                const opcionesCorrectasMultiple = new Set(pregunta.opciones?.filter(o => o.es_correcta).map(o => o.id) || []);
                const opcionesSeleccionadasMultiple = new Set(respuestaExistente?.respuesta_opciones || []);

                // Verificar si ambos sets tienen el mismo tamaño y todos los elementos seleccionados están en los correctos
                // (Esto implica que no seleccionó ninguna incorrecta y seleccionó todas las correctas)
                let esTotalmenteCorrecta = false;
                if (opcionesCorrectasMultiple.size > 0 && // Debe haber al menos una correcta definida
                    opcionesSeleccionadasMultiple.size === opcionesCorrectasMultiple.size) {
                    esTotalmenteCorrecta = true;
                    for (const selectedId of opcionesSeleccionadasMultiple) {
                        if (!opcionesCorrectasMultiple.has(selectedId)) {
                            esTotalmenteCorrecta = false;
                            break;
                        }
                    }
                }

                if (esTotalmenteCorrecta) {
                    puntosObtenidosPregunta = pregunta.puntos;
                    esCorrectaRespuesta = true;
                } else {
                    // Podrías implementar puntaje parcial aquí si lo deseas
                    // (ej. puntos por cada correcta seleccionada, restar por incorrectas seleccionadas)
                    // Por ahora, es todo o nada.
                    puntosObtenidosPregunta = 0;
                    esCorrectaRespuesta = false;
                }

                // Añadir a updates si cambió o no existía
                if (!respuestaExistente || respuestaExistente.puntos_obtenidos !== puntosObtenidosPregunta || respuestaExistente.es_correcta !== esCorrectaRespuesta) {
                    updatesRespuestas.push({
                        id: respuestaExistente?.id,
                        intento_id: intento_id,
                        pregunta_id: pregunta.id,
                        puntos_obtenidos: puntosObtenidosPregunta,
                        es_correcta: esCorrectaRespuesta,
                        respuesta_texto: null,
                        respuesta_json: null,
                        // Guardar el array de opciones seleccionadas
                        respuesta_opciones: respuestaExistente?.respuesta_opciones || []
                    });
                }
                break;
            }

            case 'abierta': {
                // Para preguntas abiertas, RESPETAR la calificación manual si existe
                if (respuestaExistente && respuestaExistente.puntos_obtenidos !== null && respuestaExistente.puntos_obtenidos !== undefined) {
                    // Si ya tiene puntos asignados (manualmente), usarlos
                    puntosObtenidosPregunta = respuestaExistente.puntos_obtenidos;
                    // Mantener el estado 'es_correcta' que pudo haber puesto el docente (true, false o null)
                    esCorrectaRespuesta = respuestaExistente.es_correcta ?? null;
                } else {
                    // Si no hay respuesta o no tiene puntos asignados, está pendiente // O podría ser null para diferenciar "pendiente" de "0 puntos"
                    puntosObtenidosPregunta = 0; // O podría ser null para diferenciar "pendiente" de "0 puntos"
                    esCorrectaRespuesta = null; // Pendiente de revisión
                    todasLasAbiertasCalificadas = false; // Marcar que al menos una abierta falta por calificar
                }
                // NO se añade a 'updatesRespuestas' porque la calificación manual es la fuente autoritativa.
                break;
            }
            case 'sopa_letras': {
                const datosSopa = pregunta.datos_extra as DatosExtraSopa | null;
                const respuestaSopa = respuestaExistente?.respuesta_json as RespuestaSopa | null;

                // Validar que tengamos la configuración y la respuesta del alumno
                if (datosSopa && Array.isArray(datosSopa.palabras) && datosSopa.palabras.length > 0 &&
                    respuestaSopa && Array.isArray(respuestaSopa.encontradas)) {

                    const palabrasCorrectasDefinidas = datosSopa.palabras; // Palabras que debían encontrarse
                    const palabrasEncontradasAlumno = respuestaSopa.encontradas; // Palabras que el alumno marcó

                    // Contar cuántas de las encontradas por el alumno están en la lista correcta
                    // (Se asume que las palabras están normalizadas - ej. MAYÚSCULAS)
                    const numCorrectasEncontradas = palabrasEncontradasAlumno.filter(p => palabrasCorrectasDefinidas.includes(p)).length;

                    // Calcular proporción y puntos (redondeado a 1 decimal)
                    const proporcion = palabrasCorrectasDefinidas.length > 0 ? numCorrectasEncontradas / palabrasCorrectasDefinidas.length : 0;
                    puntosObtenidosPregunta = Math.round(proporcion * pregunta.puntos * 10) / 10;
                    esCorrectaRespuesta = proporcion === 1; // Solo es 100% correcta si encontró todas
                } else {
                    // Si faltan datos (configuración o respuesta), asignar 0 puntos
                    puntosObtenidosPregunta = 0;
                    esCorrectaRespuesta = false;
                    if (!datosSopa?.palabras || datosSopa.palabras.length === 0) console.warn(`Sopa de Letras (Pregunta ID: ${pregunta.id}) no tiene palabras definidas en datos_extra.`);
                    if (!respuestaSopa?.encontradas) console.warn(`Respuesta para Sopa de Letras (Pregunta ID: ${pregunta.id}) no encontrada o mal formada.`);
                }
                // Añadir a updates si cambió o no existía
                if (!respuestaExistente || respuestaExistente.puntos_obtenidos !== puntosObtenidosPregunta || respuestaExistente.es_correcta !== esCorrectaRespuesta) {
                     updatesRespuestas.push({
                        id: respuestaExistente?.id,
                        intento_id: intento_id,
                        pregunta_id: pregunta.id,
                        puntos_obtenidos: puntosObtenidosPregunta,
                        es_correcta: esCorrectaRespuesta,
                        respuesta_texto: null,
                        respuesta_opciones: null,
                        respuesta_json: respuestaExistente?.respuesta_json || { encontradas: [] } // Mantener JSON o poner valor por defecto
                    });
                }
                break;
            }
            case 'crucigrama': {
                 const datosCrucigrama = pregunta.datos_extra as DatosExtraCrucigrama | null;
                 const respuestaCrucigrama = respuestaExistente?.respuesta_json as RespuestaCrucigrama | null;

                let palabrasCompletasCorrectasCrucigrama = 0;
                let totalPalabrasDefinidas = 0;

                // Validar que tengamos la configuración (entradas con posición) y la respuesta del alumno (grid)
                if (datosCrucigrama && Array.isArray(datosCrucigrama.entradas) && datosCrucigrama.entradas.length > 0 &&
                    respuestaCrucigrama?.grid && typeof respuestaCrucigrama.grid === 'object') {

                    totalPalabrasDefinidas = datosCrucigrama.entradas.length;
                    const gridRespuestasAlumno = respuestaCrucigrama.grid; // { 'fila-col': 'L', ... }

                    console.log(`Verificando Crucigrama (Pregunta ID: ${pregunta.id}). ${totalPalabrasDefinidas} palabras definidas.`);

                    // Iterar sobre cada palabra definida en la configuración
                    datosCrucigrama.entradas.forEach((entradaCorrecta, index) => {
                        // Validar que la entrada tenga la estructura esperada
                        if (typeof entradaCorrecta.palabra !== 'string' ||
                            typeof entradaCorrecta.fila !== 'number' ||
                            typeof entradaCorrecta.columna !== 'number' ||
                            (entradaCorrecta.direccion !== 'horizontal' && entradaCorrecta.direccion !== 'vertical')) {
                            console.warn(`Entrada ${index} del crucigrama (Pregunta ID: ${pregunta.id}) tiene formato inválido. Saltando.`);
                            return; // Saltar esta entrada si está mal formada
                        }

                        const { palabra, fila, columna, direccion } = entradaCorrecta;
                        let palabraAlumno = ''; // Reconstruir la palabra del alumno para esta entrada

                        // Reconstruir la palabra letra por letra desde la respuesta del alumno
                        for (let i = 0; i < palabra.length; i++) {
                            let celdaFila: number, celdaCol: number;
                            // Calcular coordenadas de la celda actual
                            if (direccion === 'horizontal') {
                                celdaFila = fila;
                                celdaCol = columna + i;
                            } else { // vertical
                                celdaFila = fila + i;
                                celdaCol = columna;
                            }
                            // Crear la clave 'fila-col' para buscar en la respuesta del alumno
                            const keyCelda = `${celdaFila}-${celdaCol}`;
                            // Obtener la letra (o ''), convertir a mayúsculas
                            const letraAlumno = (gridRespuestasAlumno[keyCelda] || '').toUpperCase();
                            palabraAlumno += letraAlumno; // Añadir la letra (o '' si no respondió)
                        }

                        // Comparar palabra reconstruida (del alumno) con la correcta
                        if (palabraAlumno === palabra) {
                            palabrasCompletasCorrectasCrucigrama++; // Incrementar contador si coinciden
                        }
                    }); // Fin forEach entradaCorrecta

                    console.log(`Crucigrama (Pregunta ID: ${pregunta.id}): ${palabrasCompletasCorrectasCrucigrama} / ${totalPalabrasDefinidas} palabras correctas.`);

                } else {
                    // Loguear si faltan datos cruciales
                    if (!datosCrucigrama?.entradas || datosCrucigrama.entradas.length === 0) console.warn(`Crucigrama (Pregunta ID: ${pregunta.id}) no tiene entradas válidas en datos_extra.`);
                    if (!respuestaCrucigrama?.grid) console.warn(`Respuesta para Crucigrama (Pregunta ID: ${pregunta.id}) no encontrada o sin 'grid'.`);
                    totalPalabrasDefinidas = datosCrucigrama?.entradas?.length || 0; // Para evitar división por cero abajo
                }

                // Calcular puntos basados en la proporción de palabras correctas
                if (totalPalabrasDefinidas > 0) {
                    const proporcion = palabrasCompletasCorrectasCrucigrama / totalPalabrasDefinidas;
                    puntosObtenidosPregunta = Math.round(proporcion * pregunta.puntos * 10) / 10; // Redondear a 1 decimal
                    esCorrectaRespuesta = proporcion === 1; // Correcta solo si todas las palabras están bien
                } else {
                    puntosObtenidosPregunta = 0;
                    esCorrectaRespuesta = false;
                }
                 // Añadir a updates si cambió o no existía
                 if (!respuestaExistente || respuestaExistente.puntos_obtenidos !== puntosObtenidosPregunta || respuestaExistente.es_correcta !== esCorrectaRespuesta) {
                     updatesRespuestas.push({
                        id: respuestaExistente?.id,
                        intento_id: intento_id,
                        pregunta_id: pregunta.id,
                        puntos_obtenidos: puntosObtenidosPregunta,
                        es_correcta: esCorrectaRespuesta,
                        respuesta_texto: null,
                        respuesta_json: respuestaExistente?.respuesta_json || { grid: {} } // Mantener JSON o defecto
                    });
                }
                break;
            }

            // --- NUEVO CASE: relacionar_columnas ---
            case 'relacionar_columnas': {
                const datosRelacionar = pregunta.datos_extra as DatosExtraRelacionar | null;
                const respuestaRelacionar = respuestaExistente?.respuesta_json as RespuestaRelacionar | null;

                // Validar que tengamos la configuración y la respuesta
                if (datosRelacionar && Array.isArray(datosRelacionar.pares_correctos) && datosRelacionar.pares_correctos.length > 0 &&
                    respuestaRelacionar && Array.isArray(respuestaRelacionar.pares_seleccionados)) {

                    const paresCorrectosDefinidos = datosRelacionar.pares_correctos;
                    const paresSeleccionadosAlumno = respuestaRelacionar.pares_seleccionados;

                    // Contar cuántos pares seleccionados por el alumno coinciden (en ambos sentidos) con los definidos como correctos
                    let numParesAcertados = 0;
                    paresSeleccionadosAlumno.forEach(parAlumno => {
                        const encontrado = paresCorrectosDefinidos.some(parCorrecto =>
                            (parCorrecto.id_columna_a === parAlumno.id_a && parCorrecto.id_columna_b === parAlumno.id_b) ||
                            (parCorrecto.id_columna_a === parAlumno.id_b && parCorrecto.id_columna_b === parAlumno.id_a) // Considerar si el orden importa o no
                        );
                        if (encontrado) {
                            numParesAcertados++;
                        }
                    });

                    // Calcular proporción y puntos (redondeado a 1 decimal)
                    // Considerar si penalizar por relaciones incorrectas extras (aquí no lo hacemos)
                    const totalParesPosibles = paresCorrectosDefinidos.length;
                    const proporcion = totalParesPosibles > 0 ? numParesAcertados / totalParesPosibles : 0;
                    puntosObtenidosPregunta = Math.round(proporcion * pregunta.puntos * 10) / 10;
                    esCorrectaRespuesta = proporcion === 1 && paresSeleccionadosAlumno.length === totalParesPosibles; // Correcta solo si acertó todos y no hizo relaciones extra

                } else {
                    // Si faltan datos o respuesta inválida, 0 puntos
                    puntosObtenidosPregunta = 0;
                    esCorrectaRespuesta = false;
                    if (!datosRelacionar?.pares_correctos || datosRelacionar.pares_correctos.length === 0) console.warn(`Relacionar Columnas (Pregunta ID: ${pregunta.id}) no tiene pares correctos definidos.`);
                    if (!respuestaRelacionar?.pares_seleccionados) console.warn(`Respuesta para Relacionar Columnas (Pregunta ID: ${pregunta.id}) no encontrada o mal formada.`);
                }

                // Añadir a updates si cambió o no existía
                if (!respuestaExistente || respuestaExistente.puntos_obtenidos !== puntosObtenidosPregunta || respuestaExistente.es_correcta !== esCorrectaRespuesta) {
                     updatesRespuestas.push({
                        id: respuestaExistente?.id,
                        intento_id: intento_id,
                        pregunta_id: pregunta.id,
                        puntos_obtenidos: puntosObtenidosPregunta,
                        es_correcta: esCorrectaRespuesta,
                        respuesta_json: respuestaExistente?.respuesta_json || { pares_seleccionados: [] } // Mantener JSON o poner valor por defecto
                    });
                }
                break;
            }

            default: {
                // Tipo de pregunta no reconocido para autocalificación
                console.warn(`Tipo de pregunta no reconocido para calificación automática: ${pregunta.tipo_pregunta} (Pregunta ID: ${pregunta.id})`);
                // Si existía una respuesta (posiblemente calificada manualmente antes), mantener sus puntos
                if (respuestaExistente && respuestaExistente.puntos_obtenidos !== null && respuestaExistente.puntos_obtenidos !== undefined) {
                     puntosObtenidosPregunta = respuestaExistente.puntos_obtenidos;
                } else {
                    puntosObtenidosPregunta = 0; // O null si se prefiere
                }
                // No se puede determinar si es correcta automáticamente
                esCorrectaRespuesta = null;
            }
        } // --- Fin del switch ---

        // Acumular los puntos obtenidos en esta pregunta al total del intento
        calificacionTotal += puntosObtenidosPregunta;

    } // --- Fin del bucle de preguntas ---

    // 7. Actualizar la tabla 'respuestas_alumno' en batch si hubo cambios
    if (updatesRespuestas.length > 0) {
        console.log(`Realizando upsert para ${updatesRespuestas.length} respuestas en BD...`);
        const { error: updateRespError } = await supabaseAdmin
            .from('respuestas_alumno')
            .upsert(updatesRespuestas, {
                 onConflict: 'intento_id, pregunta_id', // Clave única para actualizar si existe
                 // ignoreDuplicates: false // Asegura que actualice
             });

        if (updateRespError) {
             console.error("Error al hacer upsert de las respuestas calificadas:", updateRespError);
             // Considerar si lanzar un error aquí o solo loguearlo y continuar
             // throw new Error(`Error al actualizar respuestas: ${updateRespError.message}`);
        } else {
             console.log("Upsert de respuestas completado.");
        }
    } else {
        console.log("No hubo cambios en las calificaciones automáticas para actualizar en BD.");
    }

    // 8. Calcular calificación final sobre 100
    const puntosPosiblesTotales = preguntasData.reduce((sum, p) => sum + (p.puntos || 0), 0);
    const calificacionFinalCalculada = puntosPosiblesTotales > 0
        ? (calificacionTotal / puntosPosiblesTotales) * 100 // Porcentaje
        : 0; // Evitar división por cero si no hay puntos totales
    // Redondear a 2 decimales
    const calificacionFinalRedondeada = Math.round(calificacionFinalCalculada * 100) / 100;

    // 9. Determinar el estado final del INTENTO
    // Será 'calificado' solo si no hay preguntas abiertas O si todas las abiertas ya tienen puntos asignados.
    const hayPreguntasAbiertas = preguntasData.some(p => p.tipo_pregunta === 'abierta');
    const estadoFinalIntento = (!hayPreguntasAbiertas || todasLasAbiertasCalificadas)
        ? 'calificado' // Listo, todo calificado (auto y/o manual)
        : 'pendiente_revision'; // Aún falta calificar preguntas abiertas manualmente

    console.log(`Determinando estado final: Hay abiertas=${hayPreguntasAbiertas}, Todas calificadas=${todasLasAbiertasCalificadas} -> Estado=${estadoFinalIntento}`);

    // 10. Actualizar la tabla 'intentos_evaluacion' con la calificación final y el estado
    console.log(`Actualizando Intento ID ${intento_id} con Calificación=${calificacionFinalRedondeada}, Estado=${estadoFinalIntento}`);
    const { error: updateIntentoError } = await supabaseAdmin
        .from('intentos_evaluacion')
        .update({
            calificacion_final: calificacionFinalRedondeada,
            estado: estadoFinalIntento
         })
        .eq('id', intento_id); // Asegurar que solo se actualice el intento correcto

    if (updateIntentoError) throw updateIntentoError;

    // 11. Log final y respuesta exitosa
    console.log(`Intento ${intento_id} (re)calculado exitosamente. Puntos: ${calificacionTotal}/${puntosPosiblesTotales}. Calificación: ${calificacionFinalRedondeada}. Estado: ${estadoFinalIntento}`);
    return new Response(JSON.stringify({
        message: `Calificación ${estadoFinalIntento === 'calificado' ? 'final' : 'parcial'} recalculada: ${calificacionFinalRedondeada}.`,
        calificacion_final: calificacionFinalRedondeada,
        estado_final: estadoFinalIntento
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    // Manejo de errores global para la función
    console.error("ERROR GRAVE en calificar-intento:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido durante la calificación.";
    // Podríamos intentar marcar el intento como 'fallido_calificacion' si es relevante
    // await supabaseAdmin.from('intentos_evaluacion').update({ estado: 'fallido_calificacion' }).eq('id', intento_id); // Cuidado con bucles infinitos si esto falla
    return new Response(JSON.stringify({ message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500 // Internal Server Error
    });
  }
});