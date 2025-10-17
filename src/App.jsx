// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Auth from './pages/Auth';
import MateriasDashboard from './pages/MateriasDashboard';
import MateriaPanel from './pages/MateriaPanel';
import RegistroAsistencia from './pages/RegistroAsistencia';
import CalificacionPanel from './pages/CalificacionPanel';
import { supabase } from './supabaseClient';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Obtiene la sesión inicial al cargar la app
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // 2. Escucha los cambios en el estado de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("Auth state changed. Event:", _event);

      // --- ¡LÓGICA CLAVE AÑADIDA AQUÍ! ---
      // Si el evento es SIGNED_IN y es la primera vez que vemos esta sesión...
      if (_event === 'SIGNED_IN' && session) {
        console.log("User has signed in. Checking if Drive sync is needed.");
        // Verificamos si es la primera vez que el usuario inicia sesión
        // La metadata 'drive_synced' la creamos nosotros en la función de Supabase
        if (!session.user.user_metadata?.drive_synced) {
          console.log("Drive sync metadata not found. Invoking sync function...");
          
          // Invocamos la función para crear las carpetas en Google Drive
          supabase.functions.invoke('sync-drive-on-first-login')
            .then(response => {
              console.log('Sync function response:', response);
              if(response.error) throw response.error;
              // Opcional: Forzar una recarga de la sesión para obtener la nueva metadata
              supabase.auth.refreshSession();
            })
            .catch(error => {
              console.error("Error invoking sync-drive-on-first-login:", error);
              alert("Hubo un error al sincronizar con Google Drive: " + error.message);
            });
        } else {
            console.log("Drive is already synced for this user.");
        }
      }
      
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
          
          {/* --- RUTA PARA EL PANEL DE CALIFICACIÓN --- */}
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