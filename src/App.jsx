// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Auth from './pages/Auth'; // <-- Asegúrate que Auth esté importado
import MateriasDashboard from './pages/MateriasDashboard';
import MateriaPanel from './pages/MateriaPanel';
import RegistroAsistencia from './pages/RegistroAsistencia';
import CalificacionPanel from './pages/CalificacionPanel';
import CalificacionManualPanel from './pages/CalificacionManualPanel'; // <-- Nueva página
import AlumnoPortal from './pages/AlumnoPortal';      // <-- Rutas de Alumno
import AlumnoDashboard from './pages/AlumnoDashboard';  // <-- Rutas de Alumno
import ExamenAlumno from './pages/ExamenAlumno';      // <-- Rutas de Alumno
import RevisionExamenAlumno from './pages/RevisionExamenAlumno'; // <-- Nueva página
import { supabase } from './supabaseClient';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false); // Estado para controlar sync

  useEffect(() => {
    // ... (lógica existente de getSession y onAuthStateChange sin cambios) ...
    supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        console.log("Auth state changed. Event:", _event);
        if (_event === 'SIGNED_IN' && session) {
            console.log("User has signed in. Checking if Drive sync is needed.");
            if (!session.user.user_metadata?.drive_synced && !isSyncing) {
                setIsSyncing(true);
                console.log("Drive sync metadata not found. Invoking sync function...");
                supabase.functions.invoke('sync-drive-on-first-login')
                    .then(response => {
                        console.log('Sync function response:', response);
                        if (response.error) throw response.error;
                    })
                    .catch(error => {
                        console.error("Error invoking sync-drive-on-first-login:", error);
                        alert("Hubo un error al intentar sincronizar con Google Drive. Por favor, asegúrate de haber dado permisos en Google: " + error.message);
                    })
                    .finally(async () => {
                        try {
                            await supabase.auth.refreshSession();
                            console.log('Session refreshed to update metadata.');
                        } catch (e) {
                            console.error('Error refreshing session in finally:', e);
                        }
                        setIsSyncing(false);
                    });
            } else {
                console.log("Drive is already synced for this user or sync is in progress.");
            }
        }
        setSession(session);
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // El array vacío es correcto aquí para que solo se ejecute al montar

  if (loading) {
    return <div>Cargando...</div>;
  }

  return (
    <Router>
      <Layout session={session}>
        <Routes>
          {/* --- Rutas Públicas --- */}
          <Route path="/asistencia/:materia_id/:unidad/:sesion" element={<RegistroAsistencia />} />
          <Route path="/alumno/portal" element={<AlumnoPortal />} /> {/* <-- Portal Alumno (ruta específica) */}

          {/* --- Rutas "Privadas" Alumno (protegidas por lógica en componente) --- */}
          <Route path="/alumno/evaluaciones" element={<AlumnoDashboard />} />
          <Route path="/alumno/examen/:evaluacionId" element={<ExamenAlumno />} />

          {/* --- Nueva Ruta para Revisión del Alumno --- */}
          <Route
            path="/alumno/revision/:intentoId" // Usaremos el ID del intento
            element={<RevisionExamenAlumno />}   // <-- Nueva ruta
          />

          {/* --- Rutas Privadas Docente --- */}
          <Route
            path="/"
            // ¡CORREGIDO! Muestra Auth si no hay sesión, si no, dashboard docente
            element={!session ? <Auth /> : <Navigate to="/dashboard" />}
          />
          <Route path="/dashboard" element={session ? <MateriasDashboard session={session} /> : <Navigate to="/" />} />
          <Route path="/materia/:id" element={session ? <MateriaPanel session={session} /> : <Navigate to="/" />} />
          <Route path="/actividad/:id" element={session ? <CalificacionPanel /> : <Navigate to="/" />} />

          {/* --- Nueva Ruta para Calificación Manual de Evaluaciones --- */}
          <Route
            path="/evaluacion/:evaluacionId/calificar"
            element={session ? <CalificacionManualPanel /> : <Navigate to="/" />} // <-- Nueva ruta
          />

          {/* ¡CORREGIDO! Ruta comodín o 404 */}
          <Route path="*" element={<Navigate to={session ? "/dashboard" : "/"} />} />

        </Routes>
      </Layout>
    </Router>
  );
}
export default App;