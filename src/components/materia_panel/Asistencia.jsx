// src/components/materia_panel/Asistencia.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import * as qrCodeLib from 'qrcode.react';
import { useNotification } from '../../context/NotificationContext';
import { supabase } from '../../supabaseClient';
import './Asistencia.css';
import { FaSync, FaLock, FaQrcode, FaTimes } from 'react-icons/fa';

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
    const [isSyncing, setIsSyncing] = useState(false);
    const [isClosingUnit, setIsClosingUnit] = useState(false);

    const { showNotification } = useNotification();
    const channelRef = useRef(null);

    // --- CARGA INICIAL DE DATOS ---
    useEffect(() => {
        const loadInitialData = async () => {
            setLoading(true);
            try {
                // 1. Cargar Materia
                const { data: materiaData, error: materiaError } = await supabase
                    .from('materias').select('unidades').eq('id', materia_id).single();
                if (materiaError) throw materiaError;
                setMateria(materiaData);

                // 2. Cargar Alumnos
                const { data: alumnosData, error: alumnosError } = await supabase
                    .from('alumnos').select('*').eq('materia_id', materia_id).order('apellido');
                if (alumnosError) throw alumnosError;
                setAlumnos(alumnosData);

                // 3. Cargar Sesiones Cerradas Hoy
                const fechaHoy = new Date().toISOString().slice(0, 10);
                // (Aquí podrías consultar una tabla de sesiones_logs si existiera, 
                //  o inferir si ya hay asistencias guardadas para esa sesión/fecha)
                const { data: registrosDeHoy } = await supabase
                    .from('asistencias')
                    .select('unidad, sesion')
                    .eq('materia_id', materia_id)
                    .eq('fecha', fechaHoy)
                    .limit(100); // Traer una muestra para ver qué sesiones ya tienen datos

                if (registrosDeHoy) {
                    const cerradasHoySet = new Set(registrosDeHoy.map(r => `${r.unidad}-${r.sesion}`));
                    setSesionesCerradasHoy(cerradasHoySet);
                }

                // 4. Cargar Unidades Cerradas
                const { data: cerradasData, error: unidadesCerradasError } = await supabase
                    .from('unidades_cerradas')
                    .select('unidad')
                    .eq('materia_id', materia_id);
                if (unidadesCerradasError) throw unidadesCerradasError;
                
                const cerradasSet = new Set(cerradasData.map(item => item.unidad));
                setUnidadesCerradas(cerradasSet);

            } catch (error) {
                console.error("Error cargando datos:", error);
                showNotification("Error al cargar datos de asistencia.", 'error');
            } finally {
                setLoading(false);
            }
        };
        loadInitialData();
    }, [materia_id]);

    // --- REALTIME ---
    useEffect(() => {
        if (!channelRef.current) channelRef.current = supabase.channel(`asistencias-materia-${materia_id}`);
        const channel = channelRef.current;

        if (sesionActiva) {
            channel.on('broadcast', { event: 'asistencia-registrada' }, (message) => {
                const registro = message.payload;
                if (registro && String(registro.unidad) === String(unidad) && String(registro.sesion) === String(sesion)) {
                    setAsistenciasHoy(prev => new Map(prev).set(registro.alumno_id, registro.presente));
                }
            }).subscribe((status) => setRealtimeStatus(status));
        } else if (channel && channel.state === 'joined') {
            supabase.removeChannel(channel);
            channelRef.current = null;
            setRealtimeStatus('DISCONNECTED');
        }
        return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
    }, [sesionActiva, materia_id, unidad, sesion]);

    // --- TIMER ---
    useEffect(() => {
        if (sesionActiva && timer > 0) {
            const interval = setInterval(() => setTimer(t => t - 1), 1000);
            return () => clearInterval(interval);
        } else if (timer === 0 && sesionActiva) {
            showNotification("Tiempo terminado.", 'info');
            setSesionActiva(false);
        }
    }, [sesionActiva, timer]);


    // --- HANDLERS ---

    const handleGenerarQR = async () => {
        try {
            const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            const { data: sesionData, error: sesionError } = await supabase
                .from('sesiones_activas')
                .insert({ 
                    materia_id: parseInt(materia_id), 
                    unidad: parseInt(unidad), 
                    sesion: parseInt(sesion), 
                    expires_at 
                })
                .select('token')
                .single();

            if (sesionError) throw sesionError;
            
            const url = `${window.location.origin}/asistencia/${materia_id}/${unidad}/${sesion}?token=${sesionData.token}`;
            setQrValue(url);
            setTimer(300);
            setSesionActiva(true);

            // Cargar estado previo de asistencia para esta sesión (si existe)
            const fechaHoy = new Date().toISOString().slice(0, 10);
            const { data: prev } = await supabase.from('asistencias')
                .select('alumno_id, presente')
                .eq('materia_id', materia_id)
                .eq('unidad', unidad)
                .eq('sesion', sesion)
                .eq('fecha', fechaHoy);
            
            const mapa = new Map();
            prev?.forEach(r => mapa.set(r.alumno_id, r.presente));
            setAsistenciasHoy(mapa);

        } catch (error) {
            showNotification(error.message, 'error');
        }
    };

    const handleCancelar = () => { 
        setShowConfig(false); 
        setSesionActiva(false); 
    };

    const handleSyncFromSheets = async () => {
        if (!window.confirm("¿Sincronizar desde Google Sheets?\nSe traerán los datos del Excel a la base de datos.")) return;
        
        setIsSyncing(true);
        try {
            const { data, error } = await supabase.functions.invoke('sync-asistencia-from-sheets', {
                body: { materia_id: parseInt(materia_id) }
            });
            if (error) throw error;
            showNotification(`Sincronizado: ${data.message}`, 'success');
        } catch (error) {
            showNotification("Error al sincronizar: " + error.message, 'error');
        } finally {
            setIsSyncing(false);
        }
    };

    const handleCerrarUnidad = async () => {
        if (!window.confirm(`¿Seguro que deseas CERRAR la Unidad ${unidad}?\nSe calcularán porcentajes finales en Google Sheets.`)) return;

        setIsClosingUnit(true);
        try {
            // Llamamos a la función que calcula y protege en Sheets
            const { data, error } = await supabase.functions.invoke('cerrar-unidad-asistencia', {
                body: { 
                    materia_id: parseInt(materia_id), 
                    unidad: parseInt(unidad) 
                }
            });

            if (error) throw error;

            // Guardamos localmente que la unidad está cerrada
            const { error: dbError } = await supabase
                .from('unidades_cerradas')
                .insert({ materia_id: parseInt(materia_id), unidad: parseInt(unidad) });
            
            if (dbError && !dbError.message.includes('duplicate')) throw dbError;

            showNotification(data.message || "Unidad cerrada exitosamente.", 'success');
            setUnidadesCerradas(prev => new Set(prev).add(parseInt(unidad)));

        } catch (error) {
            console.error("Error cerrando unidad:", error);
            showNotification("Error al cerrar unidad: " + error.message, 'error');
        } finally {
            setIsClosingUnit(false);
        }
    };

    const cerrarSesionAsistencia = async () => {
        if (!window.confirm("¿Cerrar sesión y guardar en Drive?")) return;
        try {
            const { error } = await supabase.functions.invoke('finalizar-sesion-asistencia', {
                body: { materia_id: parseInt(materia_id), unidad: parseInt(unidad), sesion: parseInt(sesion) }
            });
            if (error) throw error;
            showNotification("Guardado en Drive correctamente.", 'success');
            setSesionesCerradasHoy(prev => new Set(prev).add(`${unidad}-${sesion}`));
            handleCancelar();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    };

    // Manejo manual de asistencia (Click en el nombre)
    const handleManualToggle = async (alumno_id) => {
        const nuevoEstado = !asistenciasHoy.get(alumno_id);
        const fechaHoy = new Date().toISOString().slice(0, 10);
        
        // Actualización optimista en UI
        setAsistenciasHoy(prev => new Map(prev).set(alumno_id, nuevoEstado));

        const { error } = await supabase.from('asistencias').upsert({
            fecha: fechaHoy,
            unidad: parseInt(unidad),
            sesion: parseInt(sesion),
            alumno_id,
            materia_id: parseInt(materia_id),
            presente: nuevoEstado
        }, { onConflict: 'fecha,unidad,sesion,alumno_id' });

        if (error) {
            showNotification("Error al guardar cambio manual.", 'error');
            // Revertir en caso de error
            setAsistenciasHoy(prev => new Map(prev).set(alumno_id, !nuevoEstado));
        }
    };

    const unidadActualCerrada = unidadesCerradas.has(parseInt(unidad));
    const sesionActualCerradaHoy = sesionesCerradasHoy.has(`${unidad}-${sesion}`);

    if (loading) return <div className="loading-spinner">Cargando...</div>;

    return (
        <div className="asistencia-panel section-container">
            <div className="header-actions">
                {!showConfig ? (
                    <div className="main-buttons">
                        <button onClick={() => setShowConfig(true)} className="btn-primary">
                            <FaQrcode /> Iniciar Pase de Lista
                        </button>
                        
                        <button 
                            onClick={handleSyncFromSheets} 
                            className="btn-secondary" 
                            disabled={isSyncing}
                            title="Traer datos manuales desde Drive"
                        >
                            <FaSync className={isSyncing ? 'spin' : ''} /> {isSyncing ? 'Sincronizando...' : 'Sincronizar desde Sheet'}
                        </button>
                    </div>
                ) : (
                    <div className="config-bar card">
                        <div className="selectors">
                            <label>Unidad:
                                <select value={unidad} onChange={e => setUnidad(e.target.value)} disabled={sesionActiva}>
                                    {Array.from({ length: materia?.unidades || 5 }, (_, i) => i + 1).map(u => (
                                        <option key={u} value={u}>{u}</option>
                                    ))}
                                </select>
                            </label>
                            <label>Sesión:
                                <select value={sesion} onChange={e => setSesion(e.target.value)} disabled={sesionActiva}>
                                    {[1,2,3,4,5,6,7,8,9,10].map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </label>
                        </div>

                        <div className="action-buttons">
                            <button 
                                onClick={handleGenerarQR} 
                                className="btn-primary" 
                                disabled={sesionActiva || sesionActualCerradaHoy || unidadActualCerrada}
                            >
                                {unidadActualCerrada ? 'Unidad Cerrada' : 'Generar QR'}
                            </button>

                            <button 
                                onClick={handleCerrarUnidad} 
                                className="btn-danger"
                                disabled={sesionActiva || unidadActualCerrada || isClosingUnit}
                                title="Calcula promedios y cierra la unidad"
                            >
                                {isClosingUnit ? 'Procesando...' : (unidadActualCerrada ? <><FaLock/> Cerrada</> : 'Cerrar Unidad')}
                            </button>

                            <button onClick={handleCancelar} className="btn-tertiary"><FaTimes/> Cancelar</button>
                        </div>
                    </div>
                )}
            </div>

            {showConfig && unidadActualCerrada && (
                <div className="alert-banner warning">Esta unidad está cerrada. No se pueden modificar asistencias.</div>
            )}

            {sesionActiva && (
                <div className="sesion-activa-container card">
                    <div className="qr-section">
                        <qrCodeLib.QRCodeSVG value={qrValue} size={200} />
                        <p className="timer">Tiempo restante: {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}</p>
                        <button onClick={cerrarSesionAsistencia} className="btn-success">Finalizar y Guardar en Drive</button>
                    </div>
                    
                    <div className="lista-asistencia">
                        <h4>Asistencia en Tiempo Real</h4>
                        <ul>
                            {alumnos.map(alumno => {
                                const presente = asistenciasHoy.get(alumno.id);
                                return (
                                    <li key={alumno.id} className={presente ? 'presente' : ''}>
                                        <span>{alumno.apellido} {alumno.nombre}</span>
                                        <button 
                                            className="status-icon-btn"
                                            onClick={() => handleManualToggle(alumno.id)}
                                            title="Cambiar asistencia manualmente"
                                        >
                                            {presente ? '✅' : '❌'}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Asistencia;