// src/pages/Auth.jsx
import React from 'react';
import { supabase } from '../supabaseClient';
import { FaGoogle } from 'react-icons/fa';
import { useNotification } from '../context/NotificationContext';
import './Auth.css';

const Auth = () => {
    const { showNotification } = useNotification();

    const handleGoogleLogin = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                scopes: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
                // La redirección será manejada por la lógica centralizada en App.jsx
                // redirectTo: window.location.origin 
            }
        });
        if (error) {
            console.error("Error al iniciar sesión con Google:", error);
            showNotification(error.message, 'error');
        }
    };

    return (
        <div className="auth-card">
            <div className="auth-body">
                <p>Inicia sesión para continuar</p>
                <button onClick={handleGoogleLogin} className="google-login-btn">
                    <FaGoogle />
                    Iniciar Sesión con Google
                </button>
            </div>
        </div>
    );
};

export default Auth;