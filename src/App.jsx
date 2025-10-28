// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
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
  const syncInProgress = useRef(false); // Ref para control atómico y evitar race conditions

  useEffect(() => {
    // Obtener sesión inicial
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
        setLoading(false);
      // --- Llamada inicial si aplica ---
      if (initialSession && !initialSession.user.user_metadata?.drive_synced && !isSyncing) {
        console.log("App Mount: Initial session needs sync. Invoking...");
        triggerSync();
      } else if (initialSession) {
          console.log("App Mount: Initial session already synced or sync in progress.");
      }
      // --- Fin llamada inicial ---
    });

    // Escuchar cambios
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      console.log(`Auth state changed. Event: ${_event}, Session User: ${currentSession?.user?.id}, Synced: ${currentSession?.user?.user_metadata?.drive_synced}`);

      // Actualizar el estado de la sesión local
      setSession(currentSession);

      // --- Lógica de Sincronización Simplificada ---
      // Solo llamar si:
      // 1. Hay una sesión (SIGNED_IN o INITIAL_SESSION con datos)
      // 2. Los metadatos NO indican que ya está sincronizado
      // 3. NO estamos ya sincronizando (estado isSyncing)
      if (currentSession && currentSession.user.user_metadata?.drive_synced !== true && !isSyncing) {
        console.log(`onAuthStateChange (${_event}): Needs sync and not currently syncing. Invoking...`);
        triggerSync();
      } else if (currentSession && isSyncing) {
          console.log(`onAuthStateChange (${_event}): Sync already in progress.`);
      } else if (currentSession) {
          console.log(`onAuthStateChange (${_event}): Already synced.`);
      }
      // --- Fin Lógica Sincronización ---
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSyncing]); // Añadir isSyncing como dependencia ayuda a re-evaluar si cambia

  // Función separada para llamar a la Edge Function
  const triggerSync = async () => {
    // --- ¡CORRECCIÓN CLAVE! ---
    // Usar una referencia para un chequeo síncrono inmediato y evitar race conditions.
    if (syncInProgress.current) {
      console.log("triggerSync: Sync already in progress, skipping call.");
      return;
    }
    syncInProgress.current = true; // Set lock before setting state
    setIsSyncing(true); // Marcar inicio
    console.log("triggerSync: Calling sync-drive-on-first-login...");
    try {
      const { data, error } = await supabase.functions.invoke('sync-drive-on-first-login');
      console.log('triggerSync: Sync function response:', { data, error });
      if (error) throw error;
       console.log("triggerSync: Sync successful or already done. Refreshing session...");
       await supabase.auth.refreshSession(); // Refresh para obtener metadata actualizada
       console.log("triggerSync: Session refreshed after sync call.");

    } catch (error) {
      console.error("triggerSync: Error invoking sync function:", error);
      
      // === INICIO DE LA MEJORA UX: Manejo Silencioso del Error de Bloqueo ===
      const errorMessage = error.message || String(error);
      const isLockError = errorMessage.includes("El proceso de sincronización ya está en ejecución");
      
      if (isLockError) {
          // Si es el error específico de bloqueo (concurrencia), lo logueamos pero NO mostramos la alerta.
          console.warn("triggerSync: Detectado error de bloqueo de Apps Script. Omitiendo alerta, se espera reintento exitoso.");
      } else {
          // Mostrar alerta para cualquier otro error real (ej. red, Apps Script URL no válida, etc.)
          alert("Hubo un error al intentar la sincronización inicial con Google Drive: " + errorMessage);
      }
      // === FIN DE LA MEJORA UX ===
    } finally {
       console.log("triggerSync: Setting isSyncing to false.");
       setIsSyncing(false); // Marcar fin (incluso si falló, para posible reintento)
       syncInProgress.current = false; // Liberar el "lock"
    }
  };

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