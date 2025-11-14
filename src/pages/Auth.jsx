import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { FaGoogle, FaSpinner } from 'react-icons/fa';
import { useNotification } from '../context/NotificationContext';
import './Auth.css';

const Auth = () => {
    const navigate = useNavigate();
    const [session, setSession] = useState(null);
    const [syncInProgress, setSyncInProgress] = useState(false);
    const { showNotification } = useNotification();

    // Función de sondeo para verificar el estado del job
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
                showNotification(`Error de sincronización: ${job.ultimo_error?.trigger_error || 'Error desconocido'}`, 'error');
            } else {
                // Si sigue 'pending' o 'processing', esperar 3 segundos y volver a consultar
                setTimeout(() => pollSyncStatus(jobId, retries - 1), 3000);
            }
        } catch (error) {
            console.error('Error en pollSyncStatus:', error);
            setSyncInProgress(false);
        }
    };

    // --- LÓGICA DE triggerSync CORREGIDA ---
    const triggerSync = async (session) => {
        if (!session?.provider_token) {
            // No es un login de Google, no hacer nada
            return; 
        }

        try {
            // 1. Buscar si YA existe un trabajo para este usuario
            const { data: syncJob, error: syncError } = await supabase
                .from('drive_sync_jobs')
                .select('id, status') // <-- Solo necesitamos el status
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (syncError) throw syncError;

            // 2. Comprobar la lógica
            //    La condición es: (NO hay job) O (el job falló y queremos reintentar)
            let shouldQueue = false;
            if (!syncJob) {
                shouldQueue = true; // No existe, hay que crearlo
            } else if (syncJob.status === 'error') {
                shouldQueue = true; // Falló, reintentar
            }
            // Si el job ya es 'pending', 'processing' o 'completed', no hacemos nada.

            if (shouldQueue) {
                console.log("Iniciando y esperando la sincronización completa...");
                setSyncInProgress(true);
                showNotification('Iniciando sincronización con Google Drive...', 'info');

                // 3. Llamar a 'queue-drive-sync'
                // --- ¡CAMBIO AQUÍ! ---
                // 3. Llamar a 'queue-drive-sync' PASANDO EL TOKEN EN EL BODY
                const { data: queueData, error: queueError } = await supabase.functions.invoke(
                    'queue-drive-sync',
                    {
                        body: {
                            provider_token: session.provider_token // <-- Enviar el token
                        }
                    }
                );
                if (queueError) throw queueError;
                
                const jobId = queueData.job_id;
                console.log(`Trabajo de sincronización encolado con ID: ${jobId}`);

                // 4. Iniciar el sondeo para dar feedback al usuario
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

    // useEffect para manejar la sesión
    useEffect(() => {
        // Manejar el evento de inicio de sesión
        const { data: authListener } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                setSession(session);
                if (event === 'SIGNED_IN') {
                    console.log('Auth state changed: SIGNED_IN, User:', session?.user?.id);
                    await triggerSync(session); // Disparar la sincronización
                    navigate('/dashboard');
                }
                if (event === 'INITIAL_SESSION') {
                    // Solo loguear y navegar si la sesión existe
                    console.log('Auth state changed: INITIAL_SESSION, User:', session?.user?.id);
                    if(session) {
                         navigate('/dashboard');
                    }
                }
                if (event === 'SIGNED_OUT') {
                    navigate('/');
                }
            }
        );

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, [navigate]);

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

    return (
        <div className="auth-container">
            <div className="auth-card">
                <h2>Asistente Docente</h2>
                
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