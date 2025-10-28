// src/components/materia_panel/Alumnos.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import AlumnoForm from './AlumnoForm';
import CSVUploader from './CSVUploader'; // Asegúrate de que este también llame a la función si sube con correo
import './Alumnos.css';

// Importa el icono de llave o similar
import { FaKey, FaUserPlus, FaEdit, FaTrash, FaCheckCircle, FaTimesCircle } from 'react-icons/fa'; // Añadir FaKey y FaCheckCircle/FaTimesCircle

const Alumnos = ({ materiaId, nombreMateria }) => {
    const [alumnos, setAlumnos] = useState([]);
    const [loading, setLoading] = useState(true); // Mantener true inicialmente
    const [editingAlumno, setEditingAlumno] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [showCSVUploader, setShowCSVUploader] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');
    const [creatingAccountStates, setCreatingAccountStates] = useState({}); // Estado para manejar la carga por botón

    const fetchAlumnos = useCallback(async () => {
        // --- INICIO CORRECCIÓN ---
        // Solo ejecutar si materiaId es un número válido
        if (!materiaId || typeof materiaId !== 'number' || isNaN(materiaId)) {
            console.warn("fetchAlumnos: materiaId no es válido aún:", materiaId);
            // Opcional: Puedes poner loading en false aquí si no quieres que muestre "Cargando..."
            // setLoading(false);
            // Opcional: Limpiar lista de alumnos si cambia la materia
            // setAlumnos([]);
            return; // No hacer la petición si no hay ID
        }
        // --- FIN CORRECCIÓN ---

        console.log("Fetching alumnos for materiaId:", materiaId); // Log para confirmar ID
        setLoading(true);
        setError('');
        try {
            const { data, error: fetchError } = await supabase
                .from('alumnos')
                .select('*')
                .eq('materia_id', materiaId) // Ahora materiaId debería ser válido
                .order('apellido', { ascending: true });

            if (fetchError) throw fetchError;
            setAlumnos(data || []);
        } catch (err) {
            console.error("Error cargando alumnos:", err);
            setError("No se pudieron cargar los alumnos: " + err.message); // Mostrar mensaje
        } finally {
            setLoading(false);
        }
    }, [materiaId]);

    useEffect(() => {
        fetchAlumnos();
    }, [fetchAlumnos]); // La dependencia es fetchAlumnos (que a su vez depende de materiaId)

    // ... (resto de las funciones: handleEdit, handleDelete, handleSave, handleCancel, handleCrearAcceso) ...
    const handleEdit = (alumno) => {
        setEditingAlumno(alumno);
        setShowForm(true);
        setShowCSVUploader(false);
    };

    const handleDelete = async (alumnoId) => {
        if (window.confirm("¿Estás seguro de eliminar este alumno?")) {
            setLoading(true);
            try {
                const { error: deleteError } = await supabase
                    .from('alumnos')
                    .delete()
                    .eq('id', alumnoId);
                if (deleteError) throw deleteError;
                // Opcional: Si el alumno tiene user_id, podrías borrar también la cuenta de Supabase Auth
                // (requiere llamar a una función Edge con permisos de admin)
                setAlumnos(prev => prev.filter(a => a.id !== alumnoId));
                alert("Alumno eliminado.");
            } catch (err) {
                console.error("Error eliminando alumno:", err);
                alert("Error al eliminar alumno: " + err.message);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleSave = () => {
        setShowForm(false);
        setShowCSVUploader(false);
        setEditingAlumno(null);
        fetchAlumnos(); // Recargar la lista
    };

    const handleCancel = () => {
        setShowForm(false);
        setShowCSVUploader(false);
        setEditingAlumno(null);
    };

    // --- NUEVA FUNCIÓN PARA CREAR LA CUENTA DE ACCESO ---
    const handleCrearAcceso = async (alumno) => {
        if (!alumno.email) {
            alert("Este alumno no tiene un correo electrónico registrado.");
            return;
        }
        if (!alumno.matricula) {
             alert("Este alumno no tiene matrícula registrada (necesaria para contraseña inicial).");
             return;
        }

        if (!window.confirm(`¿Crear cuenta de acceso para ${alumno.nombre} ${alumno.apellido} (${alumno.email})?\nLa contraseña inicial será su matrícula: ${alumno.matricula}`)) {
            return;
        }

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
                // Si el error es un 409 (Conflict), significa que ya existe
                if (functionError.context?.status === 409) {
                     setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'exists' }));
                     // Opcional: Refrescar solo este alumno para asegurar que user_id esté actualizado
                     fetchAlumnos(); // O una recarga más específica
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