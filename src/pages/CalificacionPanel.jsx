// src/pages/CalificacionPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useNotification } from '../context/NotificationContext';

const CalificacionPanel = () => {
    const { actividadId } = useParams();
    const [isLoading, setIsLoading] = useState(false);
    const [calificaciones, setCalificaciones] = useState([]);
    const { showNotification } = useNotification();

    // Función para obtener las calificaciones (después de sincronizar)
    const fetchCalificaciones = useCallback(async () => {
        setIsLoading(true);
        const { data, error } = await supabase
            .from('calificaciones')
            .select('*, alumnos(nombre, apellido)')
            .eq('actividad_id', actividadId);

        if (error) {
            showNotification('Error al cargar las calificaciones: ' + error.message, 'error');
        } else {
            setCalificaciones(data);
        }
        setIsLoading(false);
    }, [actividadId, showNotification]);

    // Función que llama a la nueva Edge Function
    const handleSync = useCallback(async () => {
        setIsLoading(true);
        showNotification('Sincronizando entregas desde Google Drive...', 'info');
        try {
            const { data, error } = await supabase.functions.invoke('sync-activity-deliveries', {
                body: { actividad_id: actividadId }
            });

            if (error) throw error;

            showNotification(data.message, 'success');
            // Después de sincronizar, volver a cargar la lista de calificaciones
            await fetchCalificaciones();

        } catch (error) {
            showNotification('Error en la sincronización: ' + error.message, 'error');
            setIsLoading(false);
        }
    }, [actividadId, showNotification, fetchCalificaciones]);

    // Sincronizar y cargar datos al montar el componente
    useEffect(() => {
        handleSync();
    }, [handleSync]);

    // ... El resto de tu JSX para mostrar la tabla de calificaciones, etc.
    return (
        <div>
            <h1>Panel de Calificación (Actividad: {actividadId})</h1>
            <button onClick={handleSync} disabled={isLoading}>
                {isLoading ? 'Sincronizando...' : 'Sincronizar con Drive'}
            </button>
            {/* Aquí renderizarías la lista de `calificaciones` */}
            {isLoading && <p>Cargando...</p>}
            <ul>
                {calificaciones.map(cal => (
                    <li key={cal.id}>
                        {cal.alumnos.nombre} {cal.alumnos.apellido} - Estado: {cal.estado}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default CalificacionPanel;