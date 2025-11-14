// src/hooks/useDriveSync.js
import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';

export const useDriveSync = () => {
    const [syncInProgress, setSyncInProgress] = useState(false);
    const { showNotification } = useNotification();

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

    const startSync = async (session) => {
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

            let shouldQueue = !syncJob || syncJob.status === 'error';

            if (shouldQueue) {
                console.log("Iniciando y esperando la sincronización completa...");
                setSyncInProgress(true);
                showNotification('Iniciando sincronización con Google Drive...', 'info');

                const { data: queueData, error: queueError } = await supabase.functions.invoke(
                    'queue-drive-sync',
                    { body: { provider_token: session.provider_token } }
                );
                
                if (queueError) throw queueError;
                
                pollSyncStatus(queueData.job_id);
            } else {
                console.log(`El trabajo de sincronización ya existe y su estado es '${syncJob.status}'. No se encolará uno nuevo.`);
            }
        } catch (error) {
            console.error('Error en startSync:', error.message);
            showNotification(`Error al iniciar sincronización: ${error.message}`, 'error');
            setSyncInProgress(false);
        }
    };

    return { syncInProgress, startSync };
};