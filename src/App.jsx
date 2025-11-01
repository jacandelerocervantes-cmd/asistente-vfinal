// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Layout from './components/Layout';
import Auth from './pages/Auth'; // Login Docente
import MateriasDashboard from './pages/MateriasDashboard';
import MateriaPanel from './pages/MateriaPanel';
import CalificacionPanel from './pages/CalificacionPanel';
import CalificacionManualPanel from './pages/CalificacionManualPanel';
import AlumnoPortal from './pages/AlumnoPortal'; // Login Alumno (Matrícula/Correo)
import AlumnoDashboard from './pages/AlumnoDashboard'; // Evaluaciones con login
import ExamenAlumno from './pages/ExamenAlumno';
import RevisionExamenAlumno from './pages/RevisionExamenAlumno';
import RegistroAsistencia from './pages/RegistroAsistencia';
import { supabase } from './supabaseClient';

// --- Componente para Rutas Protegidas de Alumno ---
// Este guardia revisa sessionStorage, no el estado de Supabase Auth
const AlumnoProtectedRoute = ({ loading }) => {
  if (loading) return <div>Verificando acceso...</div>;
  
  // Revisa el sessionStorage que AlumnoPortal.jsx debió crear
  const alumnoAuthData = sessionStorage.getItem('alumnoAuth');
  
  // Si existe, permite el acceso. Si no, redirige al portal de login.
  return (alumnoAuthData) ? <Outlet /> : <Navigate to="/alumno/portal" replace />;
};
// --- Fin Componente ---

// --- Componente para Rutas Protegidas de Docente ---
// Este guardia revisa el estado de Supabase Auth (docenteSession)
const DocenteProtectedRoute = ({ docenteSession, loading }) => {
    if (loading) return <div>Verificando acceso...</div>;
    return docenteSession ? <Outlet /> : <Navigate to="/" replace />; // A raíz (login docente)
}
// --- Fin Componente ---

function App() {
  const [docenteSession, setDocenteSession] = useState(null);
  // No necesitamos 'alumnoSession' en el estado, se maneja en sessionStorage
  const [loadingSession, setLoadingSession] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInProgress = useRef(false);

  useEffect(() => {
    setLoadingSession(true);
    
    // 1. Obtener sesión inicial (SOLO PARA DOCENTES)
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (initialSession) {
        // Si hay sesión de Supabase Auth, ES UN DOCENTE.
        setDocenteSession(initialSession);
        
        const needsSync = initialSession.user.user_metadata?.drive_synced === undefined ||
                          initialSession.user.user_metadata?.drive_synced === false;
        
        if (needsSync && !isSyncing) {
          triggerSync();
        }
      }
      // No hay 'else' para 'setAlumnoSession', es irrelevante aquí.
      setLoadingSession(false);
    });

    // 2. Escuchar cambios (SOLO PARA DOCENTES)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      console.log(`Auth state changed: ${_event}, User: ${currentSession?.user?.id}`);
      
      if (currentSession) {
        // SIEMPRE es un Docente si hay sesión de Supabase Auth
        setDocenteSession(currentSession);
        
        const needsSync = currentSession.user.user_metadata?.drive_synced === undefined ||
                          currentSession.user.user_metadata?.drive_synced === false;

        // Iniciar sincronización si es un nuevo login y necesita sync
        if ((_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION') && needsSync && !isSyncing) {
          triggerSync();
        }
      } else {
        // Es un logout de docente
        setDocenteSession(null);
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSyncing]);

  const triggerSync = async () => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setIsSyncing(true); // Muestra "Sincronizando..."
    console.log("triggerSync: Encolando trabajo de sincronización...");
    try {
        // Llama a una NUEVA función que solo crea el trabajo
        const { error } = await supabase.functions.invoke('queue-drive-sync'); 
        if (error) throw error;

        // Actualiza la metadata localmente para que el usuario pueda continuar
        // (Aunque el trabajo real siga pendiente en el backend)
        await supabase.auth.refreshSession(); 

    } catch (error) {
        console.error("triggerSync Error:", error);
        alert("Error al iniciar la sincronización con Drive: " + error.message);
    } finally {
        setIsSyncing(false);
        syncInProgress.current = false;
    }
  };


  if (loadingSession) {
    return <div>Cargando sesión...</div>;
  }

  return (
    <Router>
      {/* Pasamos solo la sesión de docente al Layout (para la UserBar) */}
      <Layout session={docenteSession}> 
        <Routes>
          {/* --- Rutas Públicas (Asistencia por QR y Login de Alumno) --- */}
          <Route path="/asistencia/:materia_id/:unidad/:sesion" element={<RegistroAsistencia />} />
          <Route path="/alumno/portal" element={<AlumnoPortal />} />


          {/* --- Rutas "Privadas" Alumno (protegidas por sessionStorage) --- */}
          {/* Este guardia (AlumnoProtectedRoute) revisa sessionStorage */}
          <Route element={<AlumnoProtectedRoute loading={loadingSession} />}>
            <Route path="/alumno/evaluaciones" element={<AlumnoDashboard />} />
            <Route path="/alumno/examen/:evaluacionId" element={<ExamenAlumno />} />
            <Route path="/alumno/revision/:intentoId" element={<RevisionExamenAlumno />} />
          </Route>


          {/* --- Rutas Privadas Docente (Protegidas por Supabase Auth) --- */}
           {/* Este guardia (DocenteProtectedRoute) revisa el estado docenteSession */}
           <Route element={<DocenteProtectedRoute docenteSession={docenteSession} loading={loadingSession} />}>
                <Route path="/dashboard" element={<MateriasDashboard session={docenteSession} />} />
                <Route path="/materia/:id" element={<MateriaPanel session={docenteSession} />} />
                <Route path="/actividad/:id" element={<CalificacionPanel />} />
                <Route path="/evaluacion/:evaluacionId/calificar" element={<CalificacionManualPanel />} />
           </Route>

          {/* --- Ruta Raíz (Login Docente) --- */}
          <Route
            path="/"
            element={
              loadingSession ? <div>Cargando...</div> :
              docenteSession ? <Navigate to="/dashboard" replace /> :
              <Auth /> // Si no hay sesión de docente, mostrar el login de docente
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