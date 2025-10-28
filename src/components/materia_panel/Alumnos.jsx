// src/components/materia_panel/Alumnos.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import AlumnoForm from './AlumnoForm';
import CSVUploader from './CSVUploader'; // Asegúrate de que este también llame a la función si sube con correo
import './Alumnos.css';

// Importa el icono de llave o similar
import { FaKey, FaUserPlus, FaEdit, FaTrash, FaCheckCircle, FaTimesCircle, FaSpinner } from 'react-icons/fa'; // Añadir FaSpinner

const Alumnos = ({ materiaId, nombreMateria }) => {
    const [alumnos, setAlumnos] = useState([]);
    const [loading, setLoading] = useState(true); // Iniciar como true
    const [editingAlumno, setEditingAlumno] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [showCSVUploader, setShowCSVUploader] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');
    const [creatingAccountStates, setCreatingAccountStates] = useState({}); // Estado para manejar la carga por botón
    const [grupos, setGrupos] = useState([]); // Estado para guardar los grupos

    // --- Cargar Grupos de la Materia ---
    const fetchGrupos = useCallback(async () => {
        if (!materiaId) return; // No cargar si no hay ID
        try {
            const { data, error: grupoError } = await supabase
                .from('grupos')
                .select('id, nombre')
                .eq('materia_id', materiaId)
                .order('nombre');
            if (grupoError) throw grupoError;
            setGrupos(data || []);
        } catch (err) {
            console.error("Error cargando grupos:", err);
            // Considera mostrar un error al usuario si la carga de grupos falla
        }
    }, [materiaId]);


    const fetchAlumnos = useCallback(async () => {
        // Solo ejecutar si materiaId es un número válido
        if (!materiaId || typeof materiaId !== 'number' || isNaN(materiaId)) {
            console.warn("fetchAlumnos: materiaId no es válido aún:", materiaId);
            setLoading(false); // Detener carga si no hay ID
            setAlumnos([]); // Limpiar lista
            setError('ID de materia no válido para cargar alumnos.'); // Mostrar error
            return;
        }

        console.log("Fetching alumnos for materiaId:", materiaId); // Log para confirmar ID
        setLoading(true);
        setError('');
        try {
            const { data, error: fetchError } = await supabase
                .from('alumnos')
                .select(`
                    *,
                    grupos ( nombre )
                `) // Seleccionar todo de alumnos y el nombre del grupo relacionado
                .eq('materia_id', materiaId) // Ahora materiaId debería ser válido
                .order('apellido', { ascending: true });

            if (fetchError) throw fetchError;
            setAlumnos(data || []);
        } catch (err) {
            console.error("Error cargando alumnos:", err);
            setError("No se pudieron cargar los alumnos: " + err.message); // Mostrar mensaje
            setAlumnos([]); // Limpiar en caso de error
        } finally {
            setLoading(false);
        }
    }, [materiaId]);

    useEffect(() => {
        // Cargar grupos y alumnos cuando el materiaId sea válido
        if (materiaId) {
            fetchGrupos();
            fetchAlumnos();
        } else {
            // Si el ID se vuelve inválido, limpiar estados
            setAlumnos([]);
            setGrupos([]);
            setLoading(false);
        }
    }, [materiaId, fetchAlumnos, fetchGrupos]); // Depender de materiaId aquí

    // ... (resto de las funciones: handleEdit, handleDelete, handleSave, handleCancel, handleCrearAcceso) ...
    const handleEdit = (alumno) => {
        console.log("Editando alumno:", alumno); // Verificar que llega el alumno correcto
        setEditingAlumno(alumno);
        setShowForm(true);
        setShowCSVUploader(false);
    };

    const handleDelete = async (alumnoId, alumnoUserId) => { // Recibir también user_id
        if (window.confirm("¿Estás seguro de eliminar este alumno? Esto NO eliminará su cuenta de acceso si ya fue creada.")) {
            // setLoading(true); // No es necesario bloquear toda la tabla
             setError('');
            try {
                const { error: deleteError } = await supabase
                    .from('alumnos')
                    .delete()
                    .eq('id', alumnoId);
                if (deleteError) throw deleteError;

                 // Opcional: Lógica para borrar cuenta Auth (requiere función Edge 'borrar-usuario-alumno')
                 if (alumnoUserId) {
                     console.warn(`Alumno ${alumnoId} eliminado, pero su cuenta Auth (${alumnoUserId}) permanece. Implementar borrado si es necesario.`);
                     // try {
                     //   await supabase.functions.invoke('borrar-usuario-alumno', { body: { user_id: alumnoUserId } });
                     // } catch(authDeleteError){ console.error("Error borrando cuenta Auth:", authDeleteError);}
                 }

                setAlumnos(prev => prev.filter(a => a.id !== alumnoId));
                // alert("Alumno eliminado."); // Quizás un mensaje menos intrusivo
            } catch (err) {
                console.error("Error eliminando alumno:", err);
                setError("Error al eliminar alumno: " + err.message);
                // alert("Error al eliminar alumno: " + err.message);
            } finally {
                // setLoading(false);
            }
        }
    };

    const handleSave = () => {
        setShowForm(false);
        setShowCSVUploader(false);
        setEditingAlumno(null); // Limpiar alumno en edición
        fetchAlumnos(); // Recargar la lista
        fetchGrupos(); // Recargar grupos por si se añadió uno nuevo
    };

    const handleCancel = () => {
        setShowForm(false);
        setShowCSVUploader(false);
        setEditingAlumno(null); // Limpiar alumno en edición
    };

    // --- NUEVA FUNCIÓN PARA CREAR LA CUENTA DE ACCESO ---
    const handleCrearAcceso = async (alumno) => { /* ... (sin cambios funcionales, asegurar que matricula exista) ... */
        if (!alumno.email) { alert("Este alumno no tiene correo."); return; }
        if (!alumno.matricula) { alert("Se necesita la matrícula para la contraseña inicial."); return; }
        if (!window.confirm(`¿Crear cuenta de acceso para ${alumno.nombre} ${alumno.apellido} (${alumno.email})?\nPass inicial: ${alumno.matricula}`)) return;
        setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'loading' })); // Indicar carga para este alumno
        setError('');

        try {
            console.log(`Llamando a crear-usuario-alumno para Alumno ID: ${alumno.id}, Email: ${alumno.email}`);
            const { data, error: functionError } = await supabase.functions.invoke('crear-usuario-alumno', {
                body: {
                    alumno_id: alumno.id,
                    email: alumno.email,
                    password: alumno.matricula // Usar matrícula como contraseña inicial
                }
            });

            if (functionError) {
                 // Manejar error 409 (ya existe)
                 if (functionError.context?.status === 409 || functionError.message?.includes('ya está registrado')) {
                      console.warn(`Cuenta para ${alumno.email} ya existía o el alumno ya estaba vinculado.`);
                     setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'exists' }));
                      // Forzar recarga para obtener el user_id correcto si faltaba
                      fetchAlumnos();
                } else {
                    throw functionError; // Lanzar otros errores
                }
            } else {
                console.log('Respuesta de crear-usuario-alumno:', data);
                setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'success' }));
                alert(data.message || `Cuenta creada para ${alumno.email}.`);
                // Actualizar el estado localmente o recargar
                // fetchAlumnos(); // Recargar para mostrar el cambio (user_id ya no será null)
                setAlumnos(prev => prev.map(a => a.id === alumno.id ? { ...a, user_id: 'pending_refresh' } : a)); // Marcar visualmente hasta recargar
            }

        } catch (err) {
            console.error("Error al crear cuenta de acceso:", err);
            const message = err.context?.details || err.message || 'Error desconocido.';
            setError(`Error al crear cuenta para ${alumno.email}: ${message}`);
            setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'error' }));
            alert(`Error al crear cuenta: ${message}`); // Mostrar alerta al usuario
        }
        // No ponemos finally aquí para mantener el estado visual (success/error/exists)
    };
    // --- FIN NUEVA FUNCIÓN ---

    const filteredAlumnos = alumnos.filter(alumno =>
        `${alumno.nombre} ${alumno.apellido} ${alumno.matricula}`.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // --- RENDERIZADO (con condición inicial si no hay materiaId) ---
    if (!materiaId) {
         return <div className="alumnos-container section-container"><p>Selecciona una materia para ver los alumnos.</p></div>;
    }

    return (
        <div className="alumnos-container section-container">
            <h3>Gestión de Alumnos <span className='section-subtitle'>({nombreMateria})</span></h3>

            {/* Botones para añadir */}
            <div className="table-actions">
                <input
                    type="text"
                    placeholder="Buscar por nombre, apellido o matrícula..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                />
                <div>
                     <button onClick={() => { setShowForm(true); setEditingAlumno(null); setShowCSVUploader(false);}} className="btn-primary icon-button">
                        <FaUserPlus /> Añadir Alumno
                    </button>
                    <button onClick={() => { setShowCSVUploader(true); setShowForm(false); setEditingAlumno(null); }} className="btn-secondary icon-button" style={{marginLeft: '10px'}}>
                        Subir CSV
                    </button>
                </div>
            </div>

            {error && <p className="error-message">{error}</p>}

            {/* Formularios Modales */}
            {showForm && <AlumnoForm alumno={editingAlumno} materiaId={materiaId} onSave={handleSave} onCancel={handleCancel} />}
            {showCSVUploader && <CSVUploader materiaId={materiaId} onUploadComplete={handleSave} onCancel={handleCancel} />}


            {loading && !showForm && !showCSVUploader ? <p>Cargando alumnos...</p> : ( !showForm && !showCSVUploader && ( // Añadir condición para no mostrar tabla si modales están abiertos
            <div className='table-responsive'>
                <table className="alumnos-table">
                    <thead>
                        <tr>
                            <th>Matrícula</th>
                            <th>Apellido</th>
                            <th>Nombre</th>
                            <th>Correo Electrónico</th>
                            <th>Acceso</th> {/* Nueva Columna */}
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAlumnos.length > 0 ? filteredAlumnos.map(alumno => {
                             const accountState = creatingAccountStates[alumno.id];
                             const hasUserId = !!alumno.user_id && alumno.user_id !== 'pending_refresh';
                             const canCreate = alumno.email && alumno.matricula && !hasUserId; // Añadir chequeo de matrícula

                            return (
                                <tr key={alumno.id}>
                                    <td>{alumno.matricula}</td>
                                    <td>{alumno.apellido}</td>
                                    <td>{alumno.nombre}</td>
                                    <td>{alumno.email || '-'}</td>
                                    {/* --- Celda de Estado de Acceso --- */}
                                    <td style={{ textAlign: 'center' }}>
                                        {hasUserId || accountState === 'exists' || accountState === 'success' ? (
                                            <FaCheckCircle style={{ color: 'var(--color-success)', fontSize: '1.2em' }} title="Acceso activado"/>
                                        ) : accountState === 'loading' ? (
                                            <span>Creando...</span>
                                        ) : accountState === 'error' ? (
                                            <FaTimesCircle style={{ color: 'var(--color-danger)', fontSize: '1.2em' }} title="Error al crear"/>
                                        ) : canCreate ? (
                                             <button
                                                onClick={() => handleCrearAcceso(alumno)}
                                                className="btn-secondary btn-small icon-button"
                                                title={`Crear acceso para ${alumno.email}\nPass inicial: ${alumno.matricula}`}
                                                disabled={accountState === 'loading'}
                                            >
                                                <FaKey /> Crear
                                            </button>
                                        ) : (
                                            // Tooltip más específico
                                            <span title={!alumno.email ? "Se requiere correo" : (!alumno.matricula ? "Se requiere matrícula" : "Acceso ya activo o procesando")}>-</span>
                                        )}
                                    </td>
                                    {/* --- Fin Celda Estado --- */}
                                    <td>
                                        <button onClick={() => handleEdit(alumno)} className="btn-secondary btn-small icon-button" title="Editar Alumno">
                                            <FaEdit />
                                        </button>
                                        <button onClick={() => handleDelete(alumno.id)} className="btn-danger btn-small icon-button" title="Eliminar Alumno" style={{marginLeft: '5px'}}>
                                            <FaTrash />
                                        </button>
                                    </td>
                                </tr>
                            );
                        }) : (
                            <tr>
                                <td colSpan="6">No se encontraron alumnos{searchTerm && ' que coincidan con la búsqueda'}.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
             </div>
             ) // Fin condición !showForm && !showCSVUploader
            )}
        </div>
    );
};

export default Alumnos;