// src/pages/Auth.jsx
import React from 'react';
import './Auth.css'; // Creamos este CSS en el siguiente paso
import { supabase } from '../supabaseClient'; // Importamos nuestro cliente de Supabase

const Auth = () => {
  const handleGoogleSignIn = async () => {
    try {
      // Este método redirige al usuario a la página de Google para autenticación
      // Supabase se encargará de la redirección de vuelta a nuestra app
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Si estás desarrollando localmente, asegúrate que esta URL sea correcta
          // Generalmente es el mismo localhost donde corre tu app de React
          redirectTo: window.location.origin,
          queryParams: {
            access_type: 'offline', // Para obtener un refresh_token si lo necesitas
            prompt: 'consent', // Para que Google siempre pida consentimiento
          },
        },
      });

      if (error) throw error;
      console.log('Redirigiendo para inicio de sesión con Google:', data);
      // Supabase manejará la redirección, no necesitamos hacer nada más aquí
    } catch (error) {
      alert(error.message);
      console.error('Error al iniciar sesión con Google:', error);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card card">
        <h2 className="auth-title">Inicio de Sesión Docente</h2>
        <p className="auth-subtitle">Accede a la plataforma con tu cuenta de Google institucional.</p>
        <button
          onClick={handleGoogleSignIn}
          className="google-signin-button"
        >
          <img src="/images/google-logo.svg" alt="Google Logo" className="google-icon" />
          Iniciar Sesión con Google
        </button>
      </div>
    </div>
  );
};

export default Auth;