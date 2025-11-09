// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Layout from './components/Layout';
import Auth from './pages/Auth'; // Login Docente
import MateriasDashboard from './pages/MateriasDashboard';
import MateriaPanel from './pages/MateriaPanel';
import CalificacionPanel from './pages/CalificacionPanel';
import CalificacionManualPanel from './pages/CalificacionManualPanel'; 
import RegistroAsistencia from './pages/RegistroAsistencia';
import { supabase } from './supabaseClient';

// --- Componente para Rutas Protegidas de Docente ---
// Este guardia revisa el estado de Supabase Auth (docenteSession)
const DocenteProtectedRoute = ({ docenteSession, loading }) => {
    if (loading) return <div>Verificando acceso...</div>;
    return docenteSession ? <Outlet /> : <Navigate to="/" replace />; // A raíz (login docente)
}
// --- Fin Componente ---

function App() {
  const [docenteSession, setDocenteSession] = useState(null);
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
  }, []); // <-- ¡LISTA VACÍA!

  const triggerSync = async () => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setIsSyncing(true); // Muestra "Sincronizando..." y bloquea la UI
    console.log("triggerSync: Iniciando y esperando la sincronización completa...");

    try {
        // --- LÓGICA DE POLLING EN EL CLIENTE ---

        // Paso 1: Encolar el trabajo y obtener el ID
        const { data: queueData, error: queueError } = await supabase.functions.invoke('queue-drive-sync');
        if (queueError) throw queueError;
        if (!queueData.jobId) throw new Error("No se recibió un ID de trabajo para la sincronización.");

        const { jobId } = queueData;
        console.log(`Trabajo de sincronización encolado con ID: ${jobId}`);

        // Paso 2: Sondear el estado del trabajo periódicamente
        let isJobDone = false;
        while (!isJobDone) {
            // Esperar 5 segundos entre cada sondeo
            await new Promise(resolve => setTimeout(resolve, 5000));

            const { data: statusData, error: statusError } = await supabase
                .from('drive_sync_jobs')
                .select('status, ultimo_error')
                .eq('id', jobId)
                .single();

            if (statusError) throw new Error(`Error al consultar el estado del trabajo: ${statusError.message}`);

            console.log(`Estado actual del trabajo ${jobId}: ${statusData.status}`);

            if (statusData.status === 'completed') {
                isJobDone = true;
                console.log("Sincronización completada con éxito. Refrescando sesión.");
                // Una vez completado, refresca la sesión para obtener `drive_synced: true`
                await supabase.auth.refreshSession();
            } else if (statusData.status === 'failed') {
                isJobDone = true;
                throw new Error(`La sincronización falló: ${statusData.ultimo_error || 'Error desconocido en el servidor.'}`);
            }
            // Si el estado es 'pending' o 'processing', el bucle continúa.
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Ocurrió un error desconocido.";
        console.error("triggerSync Error:", message);
        alert("Error durante la sincronización con Drive: " + message);
    } finally {
        setIsSyncing(false); // Oculta "Sincronizando..."
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