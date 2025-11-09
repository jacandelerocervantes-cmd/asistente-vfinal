// EN: src/components/InactivityModal.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } // <-- 1. IMPORTAR useLocation
    from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './InactivityModal.css'; // Asumiendo que ya creaste este CSS

const IDLE_TIMEOUT_MS = 300000; // 5 minutos (300,000 ms)
const MODAL_COUNTDOWN_SECONDS = 30; // 30 segundos en el modal

// --- 2. LISTA DE RUTAS DONDE EL TIMER NO DEBE CORRER ---
const DISABLED_PATHS = [
    '/actividad/', // Deshabilitado en CalificacionPanel.jsx
    '/evaluacion/' // Deshabilitado en CalificacionManualPanel.jsx
];

// Le pasamos la 'session' como prop desde Layout
const InactivityModal = ({ session }) => { 
    const [showModal, setShowModal] = useState(false);
    const [countdown, setCountdown] = useState(MODAL_COUNTDOWN_SECONDS);
    const navigate = useNavigate();
    const location = useLocation(); // <-- 3. OBTENER LA UBICACIÓN ACTUAL

    const idleTimerRef = useRef(null);
    const modalTimerRef = useRef(null);

    // --- 4. VERIFICAR SI LA RUTA ACTUAL ESTÁ DESHABILITADA ---
    const isTimerDisabled = DISABLED_PATHS.some(path => 
        location.pathname.startsWith(path)
    );

    // Función para cerrar sesión
    const handleSignOut = useCallback(() => {
        supabase.auth.signOut();
        navigate('/'); 
    }, [navigate]);

    // Inicia el temporizador de cuenta regresiva del modal
    const startModalCountdown = () => {
        setCountdown(MODAL_COUNTDOWN_SECONDS); 
        clearInterval(modalTimerRef.current); 

        modalTimerRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(modalTimerRef.current);
                    handleSignOut(); // Cierra sesión si llega a 0
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    // Muestra el modal e inicia su cuenta regresiva
    const showIdleModal = () => {
        setShowModal(true);
        startModalCountdown();
    };

    // Inicia el temporizador principal de inactividad
    const startIdleTimer = useCallback(() => {
        clearTimeout(idleTimerRef.current);
        // --- 5. SOLO INICIAR EL TIMER SI NO ESTÁ DESHABILITADO ---
        if (!isTimerDisabled) {
            idleTimerRef.current = setTimeout(showIdleModal, IDLE_TIMEOUT_MS);
        }
    }, [isTimerDisabled]); // <-- 6. Añadir dependencia

    // Reinicia el temporizador de inactividad (porque el usuario hizo algo)
    const resetIdleTimer = useCallback(() => {
        // --- 7. SOLO REINICIAR SI NO ESTÁ DESHABILITADO ---
        if (!showModal && !isTimerDisabled) {
            startIdleTimer();
        }
    }, [showModal, isTimerDisabled, startIdleTimer]);

    // El usuario hace clic en "Seguir aquí"
    const handleStayActive = () => {
        setShowModal(false);
        clearInterval(modalTimerRef.current);
        resetIdleTimer();
    };

    // Efecto para configurar los listeners de actividad
    useEffect(() => {
        // --- 8. SI NO HAY SESIÓN, NO HACER NADA ---
        if (!session) {
            return; 
        }

        const events = ['mousemove', 'keydown', 'click', 'scroll'];
        
        // Si el timer debe estar deshabilitado en esta ruta
        if (isTimerDisabled) {
            // Limpiamos cualquier timer que pudiera estar corriendo
            clearTimeout(idleTimerRef.current);
            clearInterval(modalTimerRef.current);
            setShowModal(false); // Ocultamos el modal si estaba visible
        } else {
            // Si el timer SÍ debe correr, añadimos los listeners
            events.forEach(event => window.addEventListener(event, resetIdleTimer));
            startIdleTimer(); // Iniciar el primer temporizador
        }

        // Limpieza
        return () => {
            events.forEach(event => window.removeEventListener(event, resetIdleTimer));
            clearTimeout(idleTimerRef.current);
            clearInterval(modalTimerRef.current);
        };
    // --- 9. AÑADIR DEPENDENCIAS CLAVE ---
    }, [resetIdleTimer, startIdleTimer, isTimerDisabled, session]); 

    // --- 10. NO MOSTRAR NADA SI NO HAY SESIÓN O SI EL TIMER ESTÁ DESHABILITADO ---
    if (!showModal || !session || isTimerDisabled) {
        return null; 
    }

    return (
        <div className="modal-overlay inactivity-modal-overlay">
            <div className="modal-content inactivity-modal">
                <h3>¿Sigues ahí?</h3>
                <p>Tu sesión está a punto de expirar por inactividad.</p>
                <p className="inactivity-countdown">
                    Cerrando sesión en... {countdown} segundos
                </p>
                <div className="form-actions">
                    <button onClick={handleSignOut} className="btn-tertiary">
                        Cerrar Sesión
                    </button>
                    <button onClick={handleStayActive} className="btn-primary">
                        Seguir aquí
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InactivityModal;