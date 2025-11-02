// src/components/materia_panel/Alumnos.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import AlumnoForm from './AlumnoForm';
import CSVUploader from './CSVUploader';
import AsignarGrupoModal from './AsignarGrupoModal';
import GrupoForm from './GrupoForm';
import './Alumnos.css';
import {
    FaKey, FaUserPlus, FaEdit, FaTrash, FaCheckCircle, FaTimesCircle,
    FaSpinner, FaUsers, FaFolderPlus, FaAngleDown, FaAngleRight, FaUsersCog
} from 'react-icons/fa';

// Componente de Fila de Alumno (para limpiar el renderizado)
const AlumnoRow = ({ alumno, isSelected, onSelect, onEdit, onDelete, onCrearAcceso, creatingState, error }) => {
    const { id, matricula, apellido, nombre, email, grupo_id, user_id } = alumno;
    
    const accountState = creatingState;
    const hasUserId = !!user_id;
    // Se puede crear acceso si tiene email, matrícula, y no tiene ya un user_id
    const canCreate = email && matricula && !hasUserId && accountState !== 'loading' && accountState !== 'success' && accountState !== 'exists';

    return (
        <tr className={isSelected ? 'selected-row' : ''}>
            <td>
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onSelect(id)}
                />
            </td>
            <td>{matricula}</td>
            <td>{apellido || ''}</td>
            <td>{nombre || ''}</td>
            <td>{email || '-'}</td>
            <td>{grupo_id || '-'}</td>
            <td style={{ textAlign: 'center' }}>
                {hasUserId || accountState === 'exists' || accountState === 'success' ? (
                    <FaCheckCircle style={{ color: 'var(--color-success)' }} title="Acceso de alumno activado"/>
                ) : accountState === 'loading' ? (
                    <FaSpinner className="spinner" />
                ) : accountState === 'error' ? (
                    <FaTimesCircle style={{ color: 'var(--color-danger)'}} title={error || "Error al crear cuenta"}/>
                ) : canCreate ? (
                    <button onClick={() => onCrearAcceso(alumno)} className="btn-secondary btn-small icon-button" title={`Crear acceso (Pass: ${matricula})`} disabled={accountState === 'loading'}><FaKey /></button>
                ) : (<span title={!email ? "Requiere correo" : (!matricula ? "Requiere matrícula" : "N/A")}>-</span>)}
            </td>
            <td>
                <button onClick={() => onEdit(alumno)} className="btn-secondary btn-small icon-button" title="Editar Alumno"><FaEdit /></button>
                <button onClick={() => onDelete(id, user_id)} className="btn-danger btn-small icon-button" title="Eliminar Alumno" style={{marginLeft:'5px'}}><FaTrash /></button>
            </td>
        </tr>
    );
};

const Alumnos = ({ materiaId, nombreMateria }) => {
    const [alumnos, setAlumnos] = useState([]);
    const [grupos, setGrupos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingAlumno, setEditingAlumno] = useState(null);
    const [editingGrupo, setEditingGrupo] = useState(null);
    const [showAlumnoForm, setShowAlumnoForm] = useState(false);
    const [showGrupoForm, setShowGrupoForm] = useState(false);
    const [showCSVUploader, setShowCSVUploader] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');
    const [creatingAccountStates, setCreatingAccountStates] = useState({});
    const [selectedAlumnos, setSelectedAlumnos] = useState(new Set());
    const [showAssignGroupModal, setShowAssignGroupModal] = useState(false);
    const [expandedSections, setExpandedSections] = useState(new Set(['lista_alumnos', 'gestion_grupos'])); // Ambas expandidas por defecto

    // --- Carga de Datos ---
    const fetchGrupos = useCallback(async () => {
        if (!materiaId) return;
        setLoading(true);
        try {
            const { data, error: grupoError } = await supabase
                .from('grupos')
                .select('id, nombre')
                .eq('materia_id', materiaId)
                .order('nombre');
            if (grupoError) throw grupoError;
            setGrupos(data || []);
        } catch (err) { setError(prev => (prev ? prev + " | " : "") + "Error al cargar grupos."); }
        finally { setLoading(false); }
    }, [materiaId]);

    const fetchAlumnos = useCallback(async () => {
        // Guarda para evitar ejecución sin materiaId
        if (!materiaId || typeof materiaId !== 'number' || isNaN(materiaId)) {
            setLoading(false); setAlumnos([]);
            return;
        }
        setLoading(true); setError('');
        try {
            const { data, error: fetchError } = await supabase
                .from('alumnos')
                .select(`id, matricula, apellido, nombre, email, grupo_id, user_id`)
                .eq('materia_id', materiaId)
                .order('apellido', { ascending: true });

            if (fetchError) throw fetchError;
            setAlumnos(data || []);
        } catch (err) { setError("No se pudieron cargar los alumnos: " + err.message); setAlumnos([]); }
        finally { setLoading(false); }
    }, [materiaId]);

    useEffect(() => {
        if (materiaId) {
            fetchGrupos();
            fetchAlumnos();
        } else { setAlumnos([]); setGrupos([]); setLoading(false); }
    }, [materiaId, fetchAlumnos, fetchGrupos]);

    // --- Filtrar Alumnos (para la lista principal) ---
    const grupoMap = useMemo(() => new Map(grupos.map(g => [g.id, g.nombre])), [grupos]);

    const filteredAlumnos = useMemo(() => {
        return alumnos.filter(alumno =>
            `${alumno.nombre || ''} ${alumno.apellido || ''} ${alumno.matricula || ''} ${grupoMap.get(alumno.grupo_id) || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [alumnos, searchTerm, grupoMap]);

    const visibleAlumnoIds = useMemo(() => filteredAlumnos.map(a => a.id), [filteredAlumnos]);



    // --- Handlers Formularios y CRUD Individual ---
    const handleEditAlumno = (alumno) => {
        setEditingAlumno(alumno); // Establece el alumno a editar
        setShowAlumnoForm(true);
        setShowCSVUploader(false);
        setShowGrupoForm(false);
    };

    const handleDeleteAlumno = async (alumnoId, alumnoUserId) => {
        if (window.confirm("¿Seguro que quieres eliminar este alumno?")) {
             setError('');
            try {
                const { error: deleteError } = await supabase.from('alumnos').delete().eq('id', alumnoId);
                if (deleteError) throw deleteError;
                if (alumnoUserId) console.warn(`Alumno ${alumnoId} borrado, cuenta Auth ${alumnoUserId} permanece.`);
                fetchAlumnos(); // Recargar
            } catch (err) {
                setError("Error al eliminar alumno: " + err.message);
            }
        }
    };

    const handleSaveAlumno = () => { // Se llama al guardar/actualizar
        setShowAlumnoForm(false); setEditingAlumno(null); fetchAlumnos(); 
    };
    const handleCancelAlumno = () => { // Se llama al cancelar
        setShowAlumnoForm(false); setEditingAlumno(null);
    };

    // Handlers Grupos
    const handleEditGrupo = (grupo) => {
        setEditingGrupo(grupo); setShowGrupoForm(true);
    };
     const handleDeleteGrupo = async (grupoId) => {
         const alumnosEnGrupo = alumnos.filter(a => a.grupo_id === grupoId).length;
         let confirmMessage = `¿Eliminar este grupo?`;
         if (alumnosEnGrupo > 0) confirmMessage += ` ${alumnosEnGrupo} alumno(s) quedarán sin asignar.`;

        if (window.confirm(confirmMessage)) {
             setLoading(true); setError('');
             try {
                await supabase.from('alumnos').update({ grupo_id: null }).eq('grupo_id', grupoId); // Desasignar alumnos
                 const { error } = await supabase.from('grupos').delete().eq('id', grupoId);
                 if (error) throw error;
                 fetchGrupos(); fetchAlumnos(); // Recargar ambos
             } catch (err) {
                 setError("Error al eliminar grupo: " + err.message);
             } finally { setLoading(false); }
         }
     };
    const handleSaveGrupo = () => {
        setShowGrupoForm(false); setEditingGrupo(null); fetchGrupos(); fetchAlumnos(); // Recargar ambos
    };
    const handleCancelGrupo = () => {
        setShowGrupoForm(false); setEditingGrupo(null);
    };

    // --- Handlers Selección y Acciones Masivas ---
    const handleSelectAlumno = (alumnoId) => {
        setSelectedAlumnos(prev => {
            const next = new Set(prev);
            next.has(alumnoId) ? next.delete(alumnoId) : next.add(alumnoId);
            return next;
        });
    };

    const handleSelectAllVisible = (event) => {
        setSelectedAlumnos(event.target.checked ? new Set(visibleAlumnoIds) : new Set());
    };

    const isAllVisibleSelected = visibleAlumnoIds.length > 0 && selectedAlumnos.size >= visibleAlumnoIds.length &&
                                  visibleAlumnoIds.every(id => selectedAlumnos.has(id));

    const handleBulkDelete = async () => {
         const numSelected = selectedAlumnos.size;
         if (numSelected === 0 || !window.confirm(`¿Eliminar ${numSelected} alumno(s) seleccionado(s)?`)) return;
         setLoading(true); setError('');
             try {
                 const idsToDelete = Array.from(selectedAlumnos);
                 const { error: deleteError } = await supabase.from('alumnos').delete().in('id', idsToDelete);
                 if (deleteError) throw deleteError;
                 setSelectedAlumnos(new Set());
                 fetchAlumnos();
             } catch (err) {
                 setError("Error en eliminación masiva: " + err.message);
             } finally { setLoading(false); }
     };

    const handleOpenAssignGroupModal = () => { if (selectedAlumnos.size > 0) setShowAssignGroupModal(true); };

    const handleAssignGroup = async (grupoId) => {
         const numSelected = selectedAlumnos.size;
         setLoading(true); setError(''); setShowAssignGroupModal(false);
         try {
             const idsToUpdate = Array.from(selectedAlumnos);
             const { error: updateError } = await supabase
                 .from('alumnos')
                 .update({ grupo_id: grupoId })
                 .in('id', idsToUpdate);
             if (updateError) throw updateError;
             setSelectedAlumnos(new Set());
             fetchAlumnos();
         } catch (err) {
             setError("Error al asignar grupo: " + err.message);
         } finally { setLoading(false); }
     };

    // --- Handler Creación de Cuenta Individual ---
    const handleCrearAcceso = async (alumno) => {
        if (!alumno.email || !alumno.matricula) { alert("Se requiere correo y matrícula."); return; }
        if (!window.confirm(`¿Crear cuenta de acceso para ${alumno.nombre} (${alumno.email})?\nPass inicial: ${alumno.matricula}`)) return;
        setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'loading' })); setError('');
        try {
            const { data, error: functionError } = await supabase.functions.invoke('crear-usuario-alumno', {
                body: { alumno_id: alumno.id, email: alumno.email, password: alumno.matricula }
            });
             if (functionError) {
                 if (functionError.context?.status === 409 || functionError.message?.includes('ya está registrado')) {
                      setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'exists' }));
                      fetchAlumnos(); // Sincronizar
                 } else { throw functionError; }
             } else {
                 setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'success' }));
                 setAlumnos(prev => prev.map(a => a.id === alumno.id ? { ...a, user_id: 'temp-id' } : a));
             }
        } catch (err) {
            const message = err.context?.details || err.message || 'Error desconocido.';
            setError(`Error cuenta ${alumno.email}: ${message}`);
            setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'error' }));
        }
     };

     const toggleSectionExpansion = (sectionKey) => {
         setExpandedSections(prev => {
             const next = new Set(prev);
             next.has(sectionKey) ? next.delete(sectionKey) : next.add(sectionKey);
             return next;
         });
     };


    return (
        <div className="alumnos-container section-container">
            <div className="table-actions">
                <input type="text" placeholder="Buscar alumno por nombre, matrícula o grupo..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
                <div className='table-actions-buttons'>
                     {/* CORRECCIÓN: Asegurar setEditingAlumno(null) */}
                     <button onClick={() => { setEditingAlumno(null); setShowAlumnoForm(true); setShowCSVUploader(false); setShowGrupoForm(false); }} className="btn-primary icon-button">
                        <FaUserPlus /> Añadir Alumno
                    </button>
                    <button onClick={() => { setEditingAlumno(null); setShowCSVUploader(true); setShowAlumnoForm(false); setShowGrupoForm(false); }} className="btn-secondary icon-button">
                        Subir CSV
                    </button>
                </div>
            </div>

            {/* Barra Acciones Masivas */}
            {selectedAlumnos.size > 0 && (
                <div className="bulk-actions-bar">
                    <span className="selected-count">{selectedAlumnos.size} seleccionado(s)</span>
                    <button onClick={handleOpenAssignGroupModal} className="btn-secondary icon-button btn-small">
                        <FaUsersCog /> Asignar Grupo
                    </button>
                    <button onClick={handleBulkDelete} className="btn-danger icon-button btn-small">
                        <FaTrash /> Eliminar Seleccionados
                    </button>
                      <label className='select-all-label'>
                          <input
                              type="checkbox"
                              checked={isAllVisibleSelected}
                              onChange={handleSelectAllVisible}
                              disabled={visibleAlumnoIds.length === 0}
                              title="Seleccionar Todos los Visibles"
                          />
                          Todos Visibles
                      </label>
                </div>
            )}

            {error && <p className="error-message">{error}</p>}

            {/* Modales */}
            {showAlumnoForm && <AlumnoForm alumno={editingAlumno} materiaId={materiaId} grupos={grupos} onSave={handleSaveAlumno} onCancel={handleCancelAlumno} />}
            {showGrupoForm && <GrupoForm grupo={editingGrupo} materiaId={materiaId} onSave={handleSaveGrupo} onCancel={handleCancelGrupo} />}
            {showCSVUploader && <CSVUploader materiaId={materiaId} onUploadComplete={handleSaveAlumno} onCancel={() => setShowCSVUploader(false)} />}
            {showAssignGroupModal && <AsignarGrupoModal grupos={grupos} onClose={() => setShowAssignGroupModal(false)} onAssign={handleAssignGroup} />}

            {/* Listado de Alumnos por Grupo */}
            {loading ? (
                <div style={{textAlign: 'center', padding: '2rem'}}><FaSpinner className="spinner" /> Cargando...</div>
            ) : (
             !showAlumnoForm && !showCSVUploader && !showGrupoForm && (
                <div className="grupos-list">
                
                    {/* --- Sección 1: Gestión de Grupos --- */}
                    <div className="grupo-container card">
                        <div className="grupo-header" onClick={() => toggleSectionExpansion('gestion_grupos')}>
                             <span className='grupo-toggle-icon'>{expandedSections.has('gestion_grupos') ? <FaAngleDown /> : <FaAngleRight />}</span>
                             <h4>Gestión de Grupos/Equipos ({grupos.length})</h4>
                             <div className="grupo-actions">
                                <button onClick={(e) => { e.stopPropagation(); setEditingGrupo(null); setShowGrupoForm(true); }} className="btn-primary btn-small icon-button" title="Crear Nuevo Grupo">
                                    <FaFolderPlus /> Crear Grupo
                                </button>
                             </div>
                        </div>
                        {expandedSections.has('gestion_grupos') && (
                            <div className='table-responsive'>
                                <table className="alumnos-table inside-group">
                                    <thead><tr><th>Nombre del Grupo</th><th>Miembros</th><th style={{textAlign: 'right'}}>Acciones</th></tr></thead>
                                    <tbody>
                                        {grupos.length > 0 ? grupos.map(grupo => {
                                            const miembrosCount = alumnos.filter(a => a.grupo_id === grupo.id).length;
                                            return (
                                                <tr key={grupo.id}>
                                                    <td>{grupo.nombre}</td>
                                                    <td>{miembrosCount}</td>
                                                    <td style={{textAlign: 'right'}}>
                                                        <button onClick={() => handleEditGrupo(grupo)} className="btn-secondary btn-small icon-button" title="Editar Nombre"><FaEdit /></button>
                                                        <button onClick={() => handleDeleteGrupo(grupo.id)} className="btn-danger btn-small icon-button" title="Eliminar Grupo" style={{marginLeft:'5px'}}><FaTrash /></button>
                                                    </td>
                                                </tr>
                                            );
                                        }) : (
                                            <tr><td colSpan="3">No hay grupos creados. Haz clic en "Crear Grupo" para empezar.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* --- Sección 2: Lista de Alumnos --- */}
                    <div key="lista_alumnos" className="grupo-container card">
                         <div className="grupo-header" onClick={() => toggleSectionExpansion('lista_alumnos')}>
                             <span className='grupo-toggle-icon'>{expandedSections.has('lista_alumnos') ? <FaAngleDown /> : <FaAngleRight />}</span>
                             {/* Cambiamos el checkbox por el título */}
                             <h4>Lista de Alumnos ({filteredAlumnos.length})</h4>
                             {/* El checkbox "Seleccionar Todos" ya está en la barra de acciones masivas */}
                         </div>
                         {expandedSections.has('lista_alumnos') && (
                             <div className='table-responsive'>
                                 <table className="alumnos-table inside-group">
                                    <thead>
                                        <tr>
                                            <th style={{width:'30px'}}>
                                                <input
                                                    type="checkbox"
                                                    checked={isAllVisibleSelected}
                                                    onChange={handleSelectAllVisible}
                                                    disabled={visibleAlumnoIds.length === 0}
                                                    title="Seleccionar Todos los Visibles"
                                                />
                                            </th>
                                            <th>Matrícula</th>
                                            <th>Apellido</th>
                                            <th>Nombre</th>
                                            <th>Correo</th>
                                            <th>Grupo</th>
                                            <th>Acceso</th>
                                            <th style={{textAlign: 'right'}}>Acciones</th>
                                        </tr>
                                    </thead>
                                     <tbody>
                                         {filteredAlumnos.length > 0 ? filteredAlumnos.map(alumno => (
                                             <AlumnoRow
                                                key={alumno.id}
                                                alumno={alumno}
                                                isSelected={selectedAlumnos.has(alumno.id)}
                                                onSelect={handleSelectAlumno}
                                                onEdit={handleEditAlumno}
                                                onDelete={() => handleDeleteAlumno(alumno.id, alumno.user_id)}
                                                onCrearAcceso={handleCrearAcceso}
                                                creatingState={creatingAccountStates[alumno.id]}
                                                error={error}
                                             />
                                         )) : (
                                            <tr><td colSpan="8">No hay alumnos {searchTerm ? 'que coincidan con la búsqueda.' : 'en esta materia.'}</td></tr>
                                         )}
                                     </tbody>
                                 </table>
                             </div>
                         )}
                     </div>
                </div>
              )
            )}
        </div>
    );
};

export default Alumnos;