// src/pages/AlumnoLogin.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './AlumnoLogin.css'; // Asegúrate de crear este archivo

const AlumnoLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Redirigir si ya hay sesión de alumno
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      // TODO: Mejorar esta lógica para diferenciar roles si es necesario
      if (session && session.user.user_metadata?.drive_synced === undefined) {
        navigate('/alumno/evaluaciones');
      }
    });
  }, [navigate]);


  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password: password,
      });

      if (signInError) throw signInError;

      // Verificar si el usuario está vinculado a un alumno
      const { data: alumnoCheck, error: checkError } = await supabase
        .from('alumnos')
        .select('id')
        .eq('user_id', data.user.id)
        .maybeSingle(); // Puede ser null si no está vinculado

      if (checkError) {
          console.error("Error verificando vinculación de alumno:", checkError);
          // Podrías permitir el login pero mostrar advertencia, o denegarlo
      }

      if (!alumnoCheck) {
           // Si no está vinculado, cerrar sesión y mostrar error
           await supabase.auth.signOut();
           throw new Error("Acceso denegado. Esta cuenta no está vinculada a un registro de alumno.");
      }


      console.log('Inicio de sesión de alumno exitoso:', data.session?.user?.id);
      navigate('/alumno/evaluaciones'); // Redirige al dashboard

    } catch (err) {
      console.error("Error en login alumno:", err);
      if (err.message.includes('Invalid login credentials')) {
          setError('Correo o contraseña incorrectos.');
      } else if (err.message.includes('Email not confirmed')) {
           setError('Debes confirmar tu correo electrónico.');
      } else {
          setError(err.message || 'Ocurrió un error inesperado.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card card">
        <h2 className="auth-title">Acceso Alumnos</h2>
        <p className="auth-subtitle">Inicia sesión con tu correo institucional y contraseña.</p>
        {error && <p className="error-message">{error}</p>}
        <form onSubmit={handleLogin} style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
          <div className="form-group">
            <label htmlFor="email">Correo Institucional</label>
            <input
              id="email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} required
              autoComplete="email"
              placeholder="tu.correo@instituto.edu.mx"
              style={{padding: '10px', fontSize: '1rem'}}
             />
          </div>
           <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} required
              autoComplete="current-password"
              placeholder="Contraseña (inicialmente tu matrícula)"
              style={{padding: '10px', fontSize: '1rem'}}
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary" style={{marginTop: '10px'}}>
            {loading ? 'Ingresando...' : 'Iniciar Sesión'}
          </button>
          {/* Opcional: Enlace para recuperación */}
        </form>
         <Link to="/alumno/portal" style={{ marginTop: '15px', fontSize: '0.9em' }}>
            Ir al registro de asistencia (sin login)
         </Link>
      </div>
    </div>
  );
};

export default AlumnoLogin;