// src/components/common/NotificationProvider.jsx
import React, { useState, useCallback } from 'react';
import { NotificationContext } from '../../context/NotificationContext';
import './Notification.css';

const Notification = ({ message, type, onDismiss }) => {
    React.useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss();
        }, 5000); // Desaparece después de 5 segundos

        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className={`notification ${type}`} onClick={onDismiss}>
            {message}
        </div>
    );
};

export const NotificationProvider = ({ children }) => {
    const [notifications, setNotifications] = useState([]);

    const showNotification = useCallback((message, type = 'info') => {
        const id = Date.now();
        setNotifications(prev => [...prev, { id, message, type }]);
    }, []);

    const dismissNotification = useCallback((id) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    return (
        <NotificationContext.Provider value={{ showNotification }}>
            {children}
            <div className="notification-container">
                {notifications.map(n => <Notification key={n.id} {...n} onDismiss={() => dismissNotification(n.id)} />)}
            </div>
        </NotificationContext.Provider>
    );
};