// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Auth from './pages/Auth';
import MateriasDashboard from './pages/MateriasDashboard';
import MateriaPanel from './pages/MateriaPanel';
import RegistroAsistencia from './pages/RegistroAsistencia';
import CalificacionPanel from './pages/CalificacionPanel'; // Se importa el nuevo panel
import { supabase } from './supabaseClient';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div>Cargando...</div>;
  }

  return (
    <Router>
      <Layout session={session}>
        <Routes>
          {/* --- Ruta Pública para Asistencia --- */}
          <Route
            path="/asistencia/:materia_id/:unidad/:sesion"
            element={<RegistroAsistencia />}
          />

          {/* --- Rutas Privadas para el Docente --- */}
          <Route
            path="/"
            element={!session ? <Auth /> : <Navigate to="/dashboard" />}
          />
          <Route
            path="/dashboard"
            element={session ? <MateriasDashboard session={session} /> : <Navigate to="/" />}
          />
          <Route
            path="/materia/:id"
            element={session ? <MateriaPanel session={session} /> : <Navigate to="/" />}
          />
          
          {/* --- NUEVA RUTA PARA EL PANEL DE CALIFICACIÓN --- */}
          <Route 
            path="/actividad/:id" 
            element={session ? <CalificacionPanel /> : <Navigate to="/" />} 
          />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;