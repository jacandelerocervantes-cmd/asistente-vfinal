// src/pages/Auth.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { FaGoogle, FaSpinner } from 'react-icons/fa'; // Importar FaSpinner
import { useNotification } from '../context/NotificationContext';
import './Auth.css';

const Auth = () => {
    const navigate = useNavigate();
    const [session, setSession] = useState(null);
    const [syncInProgress, setSyncInProgress] = useState(false);
    const { showNotification } = useNotification();

    // Función de sondeo (sin cambios)
    const pollSyncStatus = async (jobId, retries = 10) => {
        if (retries === 0) {
            setSyncInProgress(false);
            showNotification('La sincronización está tardando más de lo esperado. Se ejecutará en segundo plano.', 'warning');
            return;
        }
        try {
            const { data: job, error } = await supabase
                .from('drive_sync_jobs')
                .select('status, ultimo_error')
                .eq('id', jobId)
                .single();
            if (error) throw error;

            if (job.status === 'completed') {
                setSyncInProgress(false);
                showNotification('¡Sincronización con Google Drive completada!', 'success');
            } else if (job.status === 'error') {
                setSyncInProgress(false);
                const errorMsg = job.ultimo_error?.trigger_error || job.ultimo_error?.message || 'Error desconocido';
                showNotification(`Error de sincronización: ${errorMsg}`, 'error');
            } else {
                setTimeout(() => pollSyncStatus(jobId, retries - 1), 3000);
            }
        } catch (error) {
            console.error('Error en pollSyncStatus:', error);
            setSyncInProgress(false);
        }
    };

    // Función de Trigger Sync (sin cambios, ya envía el body)
    const triggerSync = async (session) => {
        if (!session?.provider_token) {
            return; 
        }
        try {
            const { data: syncJob, error: syncError } = await supabase
                .from('drive_sync_jobs')
                .select('id, status')
                .eq('user_id', session.user.id)
                .maybeSingle();
            if (syncError) throw syncError;

            let shouldQueue = false;
            if (!syncJob) {
                shouldQueue = true;
            } else if (syncJob.status === 'error') {
                shouldQueue = true;
            }

            if (shouldQueue) {
                console.log("Iniciando y esperando la sincronización completa...");
                setSyncInProgress(true);
                showNotification('Iniciando sincronización con Google Drive...', 'info');

                const { data: queueData, error: queueError } = await supabase.functions.invoke(
                    'queue-drive-sync',
                    {
                        body: {
                            provider_token: session.provider_token // Envía el token
                        }
                    }
                );
                
                if (queueError) throw queueError;
                
                const jobId = queueData.job_id;
                console.log(`Trabajo de sincronización encolado con ID: ${jobId}`);
                pollSyncStatus(jobId);
            } else {
                console.log(`El trabajo de sincronización ya existe y su estado es '${syncJob.status}'. No se encolará uno nuevo.`);
            }
        } catch (error) {
            console.error('Error en triggerSync:', error.message);
            showNotification(`Error al iniciar sincronización: ${error.message}`, 'error');
            setSyncInProgress(false);
        }
    };

    // --- useEffect CORREGIDO ---
    useEffect(() => {
        const { data: authListener } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                setSession(session);
                
                // --- ¡AQUÍ ESTÁ LA CORRECCIÓN! ---
                // Añadimos comprobaciones 'session' para evitar el error '...reading user of null'
                if (event === 'SIGNED_IN' && session) {
                    console.log('Auth state changed: SIGNED_IN, User:', session.user.id);
                    await triggerSync(session);
                    navigate('/dashboard');
                }
                else if (event === 'INITIAL_SESSION') {
                    if (session) {
                        console.log('Auth state changed: INITIAL_SESSION, User:', session.user.id);
                        navigate('/dashboard');
                    } else {
                        console.log('Auth state changed: INITIAL_SESSION, User: undefined');
                        // No hacer nada, esperar al login
                    }
                }
                // --- FIN DE LA CORRECCIÓN ---
                else if (event === 'SIGNED_OUT') {
                    console.log('Auth state changed: SIGNED_OUT');
                    navigate('/');
                }
            }
        );

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, [navigate]);

    // ... (handleGoogleLogin sin cambios)
    const handleGoogleLogin = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                scopes: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
                redirectTo: window.location.origin
            }
        });
        if (error) {
            console.error("Error al iniciar sesión con Google:", error);
            showNotification(error.message, 'error');
        }
    };

    if (session) {
         navigate('/dashboard');
         return null; 
    }
    
    // ... (JSX de return sin cambios)
    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <img src="/images/tecnm_logo.png" alt="TecNM Logo" className="logo tec-logo" />
                    <h2>Asistente Docente</h2>
                    <img src="/images/tec_tizimin_logo.png" alt="Tec Tizimín Logo" className="logo it-logo" />
                </div>
                
                {syncInProgress ? (
                    <div className="sync-in-progress">
                        <FaSpinner className="spinner" />
                        <h4>Sincronizando con Google Drive...</h4>
                        <p>Esto puede tardar un momento. Estamos creando tus carpetas.</p>
                    </div>
                ) : (
                    <div className="auth-body">
                        <p>Inicia sesión para continuar</p>
                        <button onClick={handleGoogleLogin} className="google-login-btn">
                            <FaGoogle />
                            Iniciar Sesión con Google
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Auth;