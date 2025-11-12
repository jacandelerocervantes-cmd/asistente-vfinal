// src/context/NotificationContext.jsx
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import './Notification.css'; // Crearemos este CSS a continuación

// 1. Crear el Contexto
const NotificationContext = createContext(null);

// Componente Toast individual
const Toast = ({ message, type, onDismiss }) => {
    useEffect(() => {
        // Autocerrar después de 5 segundos
        const timer = setTimeout(() => {
            onDismiss();
        }, 5000);

        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className={`toast toast-${type}`}>
            <p>{message}</p>
            <button onClick={onDismiss} className="toast-close-btn">&times;</button>
        </div>
    );
};

// 2. Crear el Proveedor (Provider)
export const NotificationProvider = ({ children }) => {
    const [notifications, setNotifications] = useState([]);
    
    // showNotification: función para añadir una nueva notificación
    const showNotification = useCallback((message, type = 'info') => {
        // Usamos un ID único para cada toast para poder cerrarlos
        const id = Date.now() + Math.random();
        setNotifications((prev) => [...prev, { id, message, type }]);
    }, []);

    // dismissNotification: función para cerrar un toast específico
    const dismissNotification = useCallback((id) => {
        setNotifications((prev) => prev.filter(n => n.id !== id));
    }, []);

    return (
        <NotificationContext.Provider value={{ showNotification }}>
            {children}
            {/* Contenedor donde se renderizarán los toasts */}
            <div className="notification-container">
                {notifications.map((n) => (
                    <Toast
                        key={n.id}
                        message={n.message}
                        type={n.type}
                        onDismiss={() => dismissNotification(n.id)}
                    />
                ))}
            </div>
        </NotificationContext.Provider>
    );
};

// 3. Crear el Hook personalizado (useNotification)
export const useNotification = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotification debe ser usado dentro de un NotificationProvider');
    }
    return context;
};