// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Layout from './components/Layout';
import Auth from './pages/Auth'; // Login Docente
import MateriasDashboard from './pages/MateriasDashboard';
import MateriaPanel from './pages/MateriaPanel';
import RegistroAsistencia from './pages/RegistroAsistencia';
import CalificacionPanel from './pages/CalificacionPanel';
import CalificacionManualPanel from './pages/CalificacionManualPanel';
import AlumnoPortal from './pages/AlumnoPortal'; // Asistencia sin login
import AlumnoDashboard from './pages/AlumnoDashboard'; // Evaluaciones con login
import ExamenAlumno from './pages/ExamenAlumno';
import RevisionExamenAlumno from './pages/RevisionExamenAlumno';
import { supabase } from './supabaseClient';

// --- Componente para Rutas Protegidas de Alumno ---
const AlumnoProtectedRoute = ({ alumnoSession, loading }) => {
  if (loading) return <div>Verificando acceso...</div>;
  // TODO: Mejorar verificación de rol en producción
  return alumnoSession ? <Outlet /> : <Navigate to="/alumno/login" replace />;
};
// --- Fin Componente ---

// --- Componente para Rutas Protegidas de Docente ---
const DocenteProtectedRoute = ({ docenteSession, loading }) => {
    if (loading) return <div>Verificando acceso...</div>;
    return docenteSession ? <Outlet /> : <Navigate to="/" replace />; // A raíz (login docente)
}
// --- Fin Componente ---


function App() {
  const [docenteSession, setDocenteSession] = useState(null);
  const [alumnoSession, setAlumnoSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInProgress = useRef(false);

  useEffect(() => {
    setLoadingSession(true);
    // Obtener sesión inicial
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      // Diferenciar sesión inicial (ejemplo básico)
      if (initialSession && initialSession.user.user_metadata?.drive_synced !== undefined) {
         setDocenteSession(initialSession);
         if (!initialSession.user.user_metadata?.drive_synced && !isSyncing) {
             triggerSync();
         }
      } else if (initialSession) {
          setAlumnoSession(initialSession);
      }
      setLoadingSession(false);
    });

    // Escuchar cambios
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      console.log(`Auth state changed: ${_event}, User: ${currentSession?.user?.id}`);
      if (currentSession && currentSession.user.user_metadata?.drive_synced !== undefined) {
         setDocenteSession(currentSession);
         setAlumnoSession(null);
         if (currentSession.user.user_metadata?.drive_synced !== true && !isSyncing) {
           triggerSync();
         }
      } else if (currentSession) {
          setDocenteSession(null);
          setAlumnoSession(currentSession);
      } else {
         setDocenteSession(null);
         setAlumnoSession(null);
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSyncing]);

  // Función separada para llamar a la Edge Function
  const triggerSync = async () => { /* ... (sin cambios) ... */
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setIsSyncing(true);
    console.log("triggerSync: Calling...");
    try {
        const { error } = await supabase.functions.invoke('sync-drive-on-first-login');
        if (error) throw error;
        await supabase.auth.refreshSession();
    } catch (error) {
        console.error("triggerSync Error:", error);
        if (!error.message?.includes("ya está en ejecución")) {
             alert("Error al sincronizar con Drive: " + error.message);
        }
    } finally {
        setIsSyncing(false);
        syncInProgress.current = false;
    }
  };


  if (loadingSession) {
    return <div>Cargando sesión...</div>;
  }

  const currentSession = docenteSession || alumnoSession;

  return (
    <Router>
      <Layout session={currentSession}>
        <Routes>
          {/* --- Rutas Públicas --- */}
          <Route path="/asistencia/:materia_id/:unidad/:sesion" element={<RegistroAsistencia />} />
          {/* Login Docente (implícito en "/") */}


          {/* --- Rutas "Privadas" Alumno (protegidas por lógica en componente) --- */}
          <Route element={<AlumnoProtectedRoute alumnoSession={alumnoSession} loading={loadingSession} />}>
            <Route path="/alumno/evaluaciones" element={<AlumnoDashboard />} />
            <Route path="/alumno/examen/:evaluacionId" element={<ExamenAlumno />} />
            <Route path="/alumno/revision/:intentoId" element={<RevisionExamenAlumno />} />
            {/* Futura ruta para subir archivos */}
            {/* <Route path="/alumno/actividad/:actividadId/entrega" element={<PaginaEntregaAlumno />} /> */}
          </Route>


          {/* --- Rutas Privadas Docente (Protegidas) --- */}
           <Route element={<DocenteProtectedRoute docenteSession={docenteSession} loading={loadingSession} />}>
                <Route path="/dashboard" element={<MateriasDashboard session={docenteSession} />} />
                <Route path="/materia/:id" element={<MateriaPanel session={docenteSession} />} />
                <Route path="/actividad/:id" element={<CalificacionPanel />} />
                <Route path="/evaluacion/:evaluacionId/calificar" element={<CalificacionManualPanel />} />
           </Route>

          {/* --- Ruta Raíz --- */}
          <Route
            path="/"
            element={
              loadingSession ? <div>Cargando...</div> :
              docenteSession ? <Navigate to="/dashboard" replace /> :
              alumnoSession ? <Navigate to="/alumno/evaluaciones" replace /> :
              <Auth /> // Mostrar login docente por defecto
            }
          />

          {/* Ruta comodín (404) */}
          <Route path="*" element={<Navigate to="/" replace />} />

        </Routes>
      </Layout>
    </Router>
  );
}
export default App;