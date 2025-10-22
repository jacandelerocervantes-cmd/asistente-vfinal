// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Auth from './pages/Auth';
import MateriasDashboard from './pages/MateriasDashboard';
import MateriaPanel from './pages/MateriaPanel';
import RegistroAsistencia from './pages/RegistroAsistencia';
import CalificacionPanel from './pages/CalificacionPanel';
import AlumnoPortal from './pages/AlumnoPortal';
import AlumnoDashboard from './pages/AlumnoDashboard';
import ExamenAlumno from './pages/ExamenAlumno';
import { supabase } from './supabaseClient';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // --- ¡CORRECCIÓN CLAVE! ---
  // Usamos un estado para asegurarnos de que la sincronización se invoque una sola vez.
  const [isSyncing, setIsSyncing] = useState(false);

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
        // y si no estamos ya en medio de una sincronización.
        if (!session.user.user_metadata?.drive_synced && !isSyncing) {
          setIsSyncing(true); // Marcamos que la sincronización ha comenzado.
          console.log("Drive sync metadata not found. Invoking sync function...");
          
          // Invocamos la función para crear las carpetas en Google Drive
          supabase.functions.invoke('sync-drive-on-first-login')
            .then(response => {
              console.log('Sync function response:', response);
              if (response.error) throw response.error;
              // Se elimina la llamada a refreshSession de aquí, se moverá al finally
            })
            .catch(error => {
              console.error("Error invoking sync-drive-on-first-login:", error);
              // Mantenemos la alerta para notificar el fallo de Drive al usuario
              alert("Hubo un error al intentar sincronizar con Google Drive. Por favor, asegúrate de haber dado permisos en Google: " + error.message);
            })
            .finally(async () => {
              // --- 🚨 CORRECCIÓN CLAVE: Refrescar sesión SIEMPRE ---
              // Esto garantiza que se recoja la metadata 'drive_synced: true'
              // establecida al comienzo de la función Edge, deteniendo el bucle.
              try {
                  await supabase.auth.refreshSession();
                  console.log('Session refreshed to update metadata.');
              } catch (e) {
                  console.error('Error refreshing session in finally:', e);
              }
              
              setIsSyncing(false); // Marcamos que la sincronización ha terminado (éxito o fallo).
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
          {/* --- Rutas Públicas --- */}
          <Route path="/asistencia/:materia_id/:unidad/:sesion" element={<RegistroAsistencia />} />
          <Route path="/alumno/portal" element={<AlumnoPortal />} /> {/* <-- Ruta Portal Alumno */}

          {/* --- Rutas "Privadas" Alumno (protegidas por lógica en componente) --- */}
          <Route path="/alumno/evaluaciones" element={<AlumnoDashboard />} /> {/* <-- Ruta Dashboard Alumno */}
          <Route path="/alumno/examen/:evaluacionId" element={<ExamenAlumno />} /> {/* <-- Ruta Examen */}


          {/* --- Rutas Privadas para el Docente --- */}
          <Route
            path="/"
            element={!session ? <Navigate to="/alumno/portal" /> : <Navigate to="/dashboard" />}
          />
          <Route
            path="/dashboard"
            element={session ? <MateriasDashboard session={session} /> : <Navigate to="/" />}
          />
          <Route
            path="/materia/:id"
            element={session ? <MateriaPanel session={session} /> : <Navigate to="/" />}
          />
          <Route
            path="/actividad/:id"
            element={session ? <CalificacionPanel /> : <Navigate to="/" />}
          />

           {/* Ruta comodín o 404 si es necesario */}
           <Route path="*" element={<Navigate to={session ? "/dashboard" : "/alumno/portal"} />} />

        </Routes>
      </Layout>
    </Router>
  );
}

export default App;