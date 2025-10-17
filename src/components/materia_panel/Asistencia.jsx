// src/components/materia_panel/Asistencia.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import * as qrCodeLib from 'qrcode.react';
import { supabase } from '../../supabaseClient';
import './Asistencia.css';

const Asistencia = () => {
    const { id: materia_id } = useParams();
    const [materia, setMateria] = useState(null);
    const [alumnos, setAlumnos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [asistenciasHoy, setAsistenciasHoy] = useState(new Map());
    const [unidad, setUnidad] = useState(1);
    const [sesion, setSesion] = useState(1);
    const [qrValue, setQrValue] = useState('');
    const [timer, setTimer] = useState(300);
    const [showConfig, setShowConfig] = useState(false);
    const [sesionActiva, setSesionActiva] = useState(false);
    const [sesionesCerradasHoy, setSesionesCerradasHoy] = useState(new Set());
    const [realtimeStatus, setRealtimeStatus] = useState('DISCONNECTED');
    const [unidadesCerradas, setUnidadesCerradas] = useState(new Set());

    const channelRef = useRef(null);

    useEffect(() => {
        const loadInitialData = async () => {
            setLoading(true);
            try {
                const { data: materiaData, error: materiaError } = await supabase.from('materias').select('unidades').eq('id', materia_id).single();
                if (materiaError) throw materiaError;
                setMateria(materiaData);

                const { data: alumnosData, error: alumnosError } = await supabase.from('alumnos').select('*').eq('materia_id', materia_id).order('apellido');
                if (alumnosError) throw alumnosError;
                setAlumnos(alumnosData);

                const fechaHoy = new Date().toISOString().slice(0, 10);
                const { data: registrosDeHoy, error: cerradasHoyError } = await supabase
                    .from('asistencias')
                    .select('unidad, sesion')
                    .eq('materia_id', materia_id)
                    .eq('fecha', fechaHoy)
                    .eq('presente', false);
                if (cerradasHoyError) throw cerradasHoyError;
                const cerradasHoySet = new Set(registrosDeHoy.map(r => `${r.unidad}-${r.sesion}`));
                setSesionesCerradasHoy(cerradasHoySet);

                const { data: cerradasData, error: unidadesCerradasError } = await supabase
                    .from('unidades_cerradas')
                    .select('unidad')
                    .eq('materia_id', materia_id);
                if (unidadesCerradasError) throw unidadesCerradasError;
                const cerradasSet = new Set(cerradasData.map(item => item.unidad));
                setUnidadesCerradas(cerradasSet);

            } catch (error) {
                console.error("Error cargando datos iniciales:", error);
                alert("No se pudieron cargar los datos de la materia.");
            } finally {
                setLoading(false);
            }
        };
        loadInitialData();
    }, [materia_id]);

    useEffect(() => {
        if (!channelRef.current) {
            channelRef.current = supabase.channel(`asistencias-materia-${materia_id}`);
        }
        const channel = channelRef.current;
        if (sesionActiva) {
            channel
                .on('postgres_changes', { event: '*', schema: 'public', table: 'asistencias' }, (payload) => {
                    const registro = payload.new || payload.old;
                    if (registro && String(registro.unidad) === String(unidad) && String(registro.sesion) === String(sesion)) {
                        setAsistenciasHoy(prev => new Map(prev).set(registro.alumno_id, payload.new ? payload.new.presente : false));
                    }
                })
                .on('broadcast', { event: 'asistencia-registrada' }, (message) => {
                    const registro = message.payload;
                    if (registro && String(registro.unidad) === String(unidad) && String(registro.sesion) === String(sesion)) {
                         setAsistenciasHoy(prev => new Map(prev).set(registro.alumno_id, registro.presente));
                    }
                })
                .subscribe((status, err) => {
                    setRealtimeStatus(status);
                    if (status === 'SUBSCRIBED') {
                        console.log("¡Suscripción a Realtime estable y exitosa!");
                    } else if (status !== 'CLOSED') {
                        console.error(`Estado de la suscripción: ${status}`, err);
                    }
                });
        }
        return () => {
            if (channel) {
                supabase.removeChannel(channel);
                channelRef.current = null;
            }
        };
    }, [sesionActiva, materia_id, unidad, sesion]);
    
    useEffect(() => {
        if (sesionActiva && timer > 0) {
            const interval = setInterval(() => setTimer(t => t - 1), 1000);
            return () => clearInterval(interval);
        } else if (timer === 0 && sesionActiva) {
            alert("El tiempo para el registro ha terminado.");
            setSesionActiva(false);
        }
    }, [sesionActiva, timer]);

    const handleGenerarQR = async () => {
        try {
            const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            const { data: sesionData, error: sesionError } = await supabase
                .from('sesiones_activas')
                .insert({ materia_id: parseInt(materia_id, 10), unidad: parseInt(unidad, 10), sesion: parseInt(sesion, 10), expires_at })
                .select('token')
                .single();

            if (sesionError) throw sesionError;
            const { token } = sesionData;

            const url = `${window.location.origin}/asistencia/${materia_id}/${unidad}/${sesion}?token=${token}`;
            setQrValue(url);
            setTimer(300);
            setSesionActiva(true);

            const fechaHoy = new Date().toISOString().slice(0, 10);
            const { data: registrosPrevios } = await supabase
                .from('asistencias')
                .select('alumno_id, presente')
                .eq('materia_id', materia_id)
                .eq('unidad', unidad)
                .eq('sesion', sesion)
                .eq('fecha', fechaHoy);

            const mapaAsistencias = new Map();
            registrosPrevios.forEach(r => mapaAsistencias.set(r.alumno_id, r.presente));
            setAsistenciasHoy(mapaAsistencias);

        } catch (error) {
            console.error("Error al generar la sesión de QR:", error);
            alert("No se pudo iniciar la sesión de asistencia. Inténtalo de nuevo.");
        }
    };

    const handleCancelar = () => {
        setShowConfig(false);
        setSesionActiva(false);
    };
    
    const cerrarSesionAsistencia = async () => {
        if (!window.confirm("¿Estás seguro de cerrar la sesión?")) return;
        try {
            const { error } = await supabase.functions.invoke('finalizar-sesion-asistencia', {
                body: { materia_id: parseInt(materia_id, 10), unidad: parseInt(unidad, 10), sesion: parseInt(sesion, 10) }
            });
            if (error) throw error;
            alert("Sesión cerrada y datos procesados.");
            setSesionesCerradasHoy(prev => {
                const newSet = new Set(prev);
                newSet.add(`${unidad}-${sesion}`);
                return newSet;
            });
            handleCancelar();
        } catch (error) {
            alert("Error al cerrar la sesión: " + error.message);
        }
    };

    const cerrarUnidad = async () => {
        if (!window.confirm(`¿Estás seguro de cerrar la UNIDAD ${unidad}? Esta acción generará el reporte final en Google Sheets y bloqueará la unidad.`)) return;
        try {
            const { error } = await supabase.functions.invoke('cerrar-unidad-asistencia', {
                body: { materia_id: parseInt(materia_id, 10), unidad: parseInt(unidad, 10) }
            });
            if (error) throw error;
            
            setUnidadesCerradas(prev => new Set(prev).add(parseInt(unidad, 10)));
            alert(`Unidad ${unidad} cerrada y reporte enviado a Google Sheets.`);

        } catch (error) {
            alert("Error al cerrar la unidad: " + error.message);
        }
    };

    const handleManualToggle = async (alumno_id) => {
        const presenteActual = asistenciasHoy.get(alumno_id) || false;
        const nuevoEstado = !presenteActual;
        const { data: { user } } = await supabase.auth.getUser();

        const nuevoMapaAsistencias = new Map(asistenciasHoy);
        nuevoMapaAsistencias.set(alumno_id, nuevoEstado);
        
        setAsistenciasHoy(nuevoMapaAsistencias);
        
        const { error } = await supabase.from('asistencias').upsert({
            fecha: new Date().toISOString().slice(0, 10),
            unidad: parseInt(unidad, 10),
            sesion: parseInt(sesion, 10),
            alumno_id,
            materia_id: parseInt(materia_id, 10),
            presente: nuevoEstado,
            user_id: user.id
        }, { onConflict: 'fecha,unidad,sesion,alumno_id' });
        
        if (error) {
            console.error("Error en asistencia manual:", error);
            alert("Error al registrar manualmente: " + error.message);
            
            const mapaRevertido = new Map(asistenciasHoy);
            mapaRevertido.set(alumno_id, presenteActual);
            setAsistenciasHoy(mapaRevertido);
        }
    };

    const sesionActualCerradaHoy = sesionesCerradasHoy.has(`${unidad}-${sesion}`);
    const unidadActualCerrada = unidadesCerradas.has(parseInt(unidad, 10));

    if (loading) {
        return <p>Cargando datos de asistencia...</p>;
    }

    return (
        <div className="asistencia-panel">
            <div className="pase-lista-controles">
                <div className="controles-accion">
                    {!showConfig ? (
                        <button 
                            onClick={() => setShowConfig(true)} 
                            className="btn-primary btn-crear-pase"
                        >
                            ＋ Crear Pase de Lista
                        </button>
                    ) : (
                        <div className="config-bar">
                            <label>Unidad:</label>
                            <select value={unidad} onChange={e => setUnidad(e.target.value)} disabled={sesionActiva}>
                                {Array.from({ length: materia?.unidades || 1 }, (_, i) => i + 1).map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                            <label>Sesión:</label>
                            <select value={sesion} onChange={e => setSesion(e.target.value)} disabled={sesionActiva}>
                                <option value="1">1</option> <option value="2">2</option> <option value="3">3</option>
                            </select>
                            <button 
                                onClick={handleGenerarQR} 
                                className="btn-primary" 
                                disabled={sesionActiva || sesionActualCerradaHoy || unidadActualCerrada}
                            >
                                {unidadActualCerrada ? 'Unidad Cerrada' : (sesionActualCerradaHoy ? 'Sesión ya cerrada' : 'Generar QR')}
                            </button>
                            <button onClick={handleCancelar} className="btn-tertiary">Cancelar</button>
                        </div>
                    )}
                </div>
                
                <div className="controles-cierre">
                    <button 
                        onClick={cerrarUnidad} 
                        className="btn-danger"
                        disabled={unidadActualCerrada}
                    >
                        {unidadActualCerrada ? `Unidad ${unidad} ya está cerrada` : `Cerrar Unidad ${unidad}`}
                    </button>
                </div>
            </div>

            {/* --- ¡CORRECCIÓN! El mensaje solo aparece si el usuario intenta interactuar --- */}
            {showConfig && unidadActualCerrada && (
                <div className="info-message">
                    La Unidad {unidad} ya ha sido cerrada. No se pueden tomar nuevas asistencias. Por favor, selecciona otra unidad.
                </div>
            )}

            {showConfig && sesionActualCerradaHoy && !sesionActiva && !unidadActualCerrada && (
                <div className="info-message">
                    Esta sesión (Unidad {unidad}, Sesión {sesion}) ya fue cerrada el día de hoy y no puede ser reactivada.
                </div>
            )}

            {sesionActiva && (
                <div className="qr-display">
                    <h3>Escanea para registrar tu asistencia</h3>
                    <qrCodeLib.QRCodeSVG value={qrValue} size={256} />
                    <div className={`realtime-indicator ${realtimeStatus.toLowerCase()}`}>
                        {realtimeStatus === 'SUBSCRIBED' 
                            ? '● Conectado en tiempo real' 
                            : '◌ Intentando conectar...'}
                    </div>
                    <div className="timer">Tiempo restante: {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}</div>
                    <button onClick={cerrarSesionAsistencia} className="btn-secondary">Cerrar Sesión de Asistencia</button>
                    
                    <h4>Lista de Asistencia</h4>
                    <ul className="lista-alumnos-asistencia">
                        {alumnos.map(alumno => {
                            const presente = asistenciasHoy.get(alumno.id) || false;
                            return (
                                <li key={alumno.id}>
                                    {alumno.apellido}, {alumno.nombre}
                                    <button
                                        className={`status-btn ${presente ? 'presente' : 'ausente'}`}
                                        onClick={() => handleManualToggle(alumno.id)}
                                    >
                                        {presente ? '✔' : '✖'}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default Asistencia;