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
    FaSpinner, FaUsers, FaFolderPlus, FaAngleDown, FaAngleRight
} from 'react-icons/fa';

const Alumnos = ({ materiaId, nombreMateria }) => {
    const [alumnos, setAlumnos] = useState([]);
    const [grupos, setGrupos] = useState([]);
    const [loadingAlumnos, setLoadingAlumnos] = useState(true);
    const [loadingGrupos, setLoadingGrupos] = useState(true);
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
    const [expandedGroups, setExpandedGroups] = useState(new Set(['sin_grupo'])); // Inicia con "Sin Grupo" expandido

    // --- Carga de Datos ---
    const fetchGrupos = useCallback(async () => {
        if (!materiaId) return;
        setLoadingGrupos(true);
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
            setError(prev => prev + " Error al cargar grupos.");
        } finally { setLoadingGrupos(false); }
    }, [materiaId]);

    const fetchAlumnos = useCallback(async () => {
        // Guarda para evitar ejecución sin materiaId
        if (!materiaId || typeof materiaId !== 'number' || isNaN(materiaId)) {
            setLoadingAlumnos(false); setAlumnos([]);
            return;
        }
        setLoadingAlumnos(true); setError('');
        try {
            const { data, error: fetchError } = await supabase
                .from('alumnos')
                .select(`*, grupos ( nombre )`) // Cargar nombre del grupo
                .eq('materia_id', materiaId)
                .order('apellido', { ascending: true });

            if (fetchError) throw fetchError;
            setAlumnos(data || []);
        } catch (err) {
            console.error("Error cargando alumnos:", err);
            setError("No se pudieron cargar los alumnos: " + err.message);
            setAlumnos([]);
        } finally {
            setLoadingAlumnos(false);
        }
    }, [materiaId]);

    useEffect(() => {
        if (materiaId) {
            fetchGrupos();
            fetchAlumnos();
        } else {
            setAlumnos([]); setGrupos([]); setLoadingAlumnos(false); setLoadingGrupos(false);
        }
    }, [materiaId, fetchAlumnos, fetchGrupos]);

    // --- Agrupar Alumnos ---
    const alumnosAgrupados = useMemo(() => {
        const grouped = { sin_grupo: [] }; // Clave para alumnos sin grupo
        grupos.forEach(g => grouped[g.id] = []); // Claves para grupos existentes

        alumnos.filter(alumno => // Filtrar por búsqueda
            `${alumno.nombre || ''} ${alumno.apellido || ''} ${alumno.matricula || ''} ${alumno.grupos?.nombre || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
        ).forEach(alumno => {
            const grupoKey = alumno.grupo_id || 'sin_grupo';
            (grouped[grupoKey] = grouped[grupoKey] || []).push(alumno);
        });
        return grouped;
    }, [alumnos, grupos, searchTerm]);

    const visibleAlumnoIds = useMemo(() => Object.values(alumnosAgrupados).flat().map(a => a.id), [alumnosAgrupados]);

    // --- Handlers Formularios y CRUD Individual ---
    const handleEditAlumno = (alumno) => {
        setEditingAlumno(alumno); // Establece el alumno a editar
        setShowAlumnoForm(true);
        setShowCSVUploader(false);
        setShowGrupoForm(false);
    };

    const handleDeleteAlumno = async (alumnoId, alumnoUserId) => {
        if (window.confirm("¿Estás seguro de eliminar este alumno? (La cuenta de acceso, si existe, no se borrará)")) {
             setError('');
            try {
                const { error: deleteError } = await supabase.from('alumnos').delete().eq('id', alumnoId);
                if (deleteError) throw deleteError;
                if (alumnoUserId) console.warn(`Alumno ${alumnoId} borrado, cuenta Auth ${alumnoUserId} permanece.`);
                setAlumnos(prev => prev.filter(a => a.id !== alumnoId)); // Actualiza UI
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
             setLoadingGrupos(true); setError('');
             try {
                await supabase.from('alumnos').update({ grupo_id: null }).eq('grupo_id', grupoId); // Desasignar alumnos
                 const { error } = await supabase.from('grupos').delete().eq('id', grupoId);
                 if (error) throw error;
                 fetchGrupos(); fetchAlumnos(); // Recargar ambos
             } catch (err) {
                 setError("Error al eliminar grupo: " + err.message);
             } finally { setLoadingGrupos(false); }
         }
     };
    const handleSaveGrupo = () => {
        setShowGrupoForm(false); setEditingGrupo(null); fetchGrupos(); // Recargar grupos
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

     const handleSelectGroup = (grupoKey, event) => {
         const alumnosEnGrupo = alumnosAgrupados[grupoKey]?.map(a => a.id) || [];
         if (alumnosEnGrupo.length === 0) return;
         setSelectedAlumnos(prev => {
             const next = new Set(prev);
             if (event.target.checked) alumnosEnGrupo.forEach(id => next.add(id));
             else alumnosEnGrupo.forEach(id => next.delete(id));
             return next;
         });
     };

    const isAllVisibleSelected = visibleAlumnoIds.length > 0 && selectedAlumnos.size >= visibleAlumnoIds.length &&
                                  visibleAlumnoIds.every(id => selectedAlumnos.has(id));

    const handleBulkDelete = async () => {
         const numSelected = selectedAlumnos.size;
         if (numSelected === 0) return;
         if (window.confirm(`¿Eliminar ${numSelected} alumno(s) seleccionado(s)?`)) {
             setLoadingAlumnos(true); setError('');
             try {
                 const idsToDelete = Array.from(selectedAlumnos);
                 const { error: deleteError } = await supabase.from('alumnos').delete().in('id', idsToDelete);
                 if (deleteError) throw deleteError;
                 setSelectedAlumnos(new Set());
                 fetchAlumnos();
             } catch (err) {
                 setError("Error en eliminación masiva: " + err.message);
             } finally { setLoadingAlumnos(false); }
         }
     };

    const handleOpenAssignGroupModal = () => { if (selectedAlumnos.size > 0) setShowAssignGroupModal(true); };

    const handleAssignGroup = async (grupoId) => { // Recibe el ID del grupo (o null)
         const numSelected = selectedAlumnos.size;
         setLoadingAlumnos(true); setError(''); setShowAssignGroupModal(false);
         try {
             const idsToUpdate = Array.from(selectedAlumnos);
             const { error: updateError } = await supabase
                 .from('alumnos')
                 .update({ grupo_id: grupoId }) // grupoId puede ser null
                 .in('id', idsToUpdate);
             if (updateError) throw updateError;
             setSelectedAlumnos(new Set());
             fetchAlumnos();
         } catch (err) {
             setError("Error al asignar grupo: " + err.message);
         } finally { setLoadingAlumnos(false); }
     };


    // --- Handler Creación de Cuenta Individual ---
    const handleCrearAcceso = async (alumno) => {
        if (!alumno.email) { alert("Este alumno no tiene correo."); return; }
        if (!alumno.matricula) { alert("Se necesita la matrícula para la contraseña inicial."); return; }
        if (!window.confirm(`¿Crear cuenta de acceso para ${alumno.nombre} (${alumno.email})?\nPass inicial: ${alumno.matricula}`)) return;

        setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'loading' }));
        setError('');
        try {
            const { data, error: functionError } = await supabase.functions.invoke('crear-usuario-alumno', {
                body: { alumno_id: alumno.id, email: alumno.email, password: alumno.matricula }
            });
             if (functionError) {
                 if (functionError.context?.status === 409 || functionError.message?.includes('ya está registrado')) {
                      console.warn(`Cuenta para ${alumno.email} ya existía.`);
                      setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'exists' }));
                      fetchAlumnos(); // Recargar para sincronizar user_id
                 } else {
                     throw functionError;
                 }
             } else {
                 console.log('Respuesta crear-usuario-alumno:', data);
                 setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'success' }));
                 setAlumnos(prev => prev.map(a => a.id === alumno.id ? { ...a, user_id: 'temp-id' } : a)); // Actualización visual temporal
             }
        } catch (err) {
            console.error("Error al crear cuenta:", err);
            const message = err.context?.details || err.message || 'Error desconocido.';
            setError(`Error cuenta ${alumno.email}: ${message}`);
            setCreatingAccountStates(prev => ({ ...prev, [alumno.id]: 'error' }));
        }
     };

    // --- Handler para expandir/colapsar grupos ---
     const toggleGroupExpansion = (grupoKey) => {
         setExpandedGroups(prev => {
             const next = new Set(prev);
             next.has(grupoKey) ? next.delete(grupoKey) : next.add(grupoKey);
             return next;
         });
     };

    // --- Renderizado ---
    if (!materiaId && !loadingAlumnos && !loadingGrupos) {
         return <div className="alumnos-container section-container"><p>ID de materia inválido.</p></div>;
     }
    const isLoading = loadingAlumnos || loadingGrupos;

    return (
        <div className="alumnos-container section-container">
            {/* Título y Botón Crear Grupo */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                 <h3>Gestión de Alumnos <span className='section-subtitle'>({nombreMateria})</span></h3>
                 <button onClick={() => { setEditingGrupo(null); setShowGrupoForm(true); }} className="btn-secondary icon-button" title="Crear Nuevo Grupo">
                     <FaFolderPlus /> Crear Grupo
                 </button>
            </div>

            {/* Barra Búsqueda y Añadir/Subir */}
            <div className="table-actions">
                <input type="text" placeholder="Buscar alumno por nombre, matrícula o grupo..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
                <div>
                     {/* CORRECCIÓN: Asegurar setEditingAlumno(null) */}
                     <button onClick={() => { setEditingAlumno(null); setShowAlumnoForm(true); setShowCSVUploader(false); setShowGrupoForm(false); }} className="btn-primary icon-button">
                        <FaUserPlus /> Añadir Alumno
                    </button>
                    <button onClick={() => { setEditingAlumno(null); setShowCSVUploader(true); setShowAlumnoForm(false); setShowGrupoForm(false); }} className="btn-secondary icon-button" style={{marginLeft: '10px'}}>
                        Subir CSV
                    </button>
                </div>
            </div>

            {/* Barra Acciones Masivas */}
            {selectedAlumnos.size > 0 && (
                <div className="bulk-actions-bar">
                    <span>{selectedAlumnos.size} seleccionado(s)</span>
                    <button onClick={handleOpenAssignGroupModal} className="btn-secondary icon-button btn-small">
                        <FaUsers /> Asignar Grupo
                    </button>
                    <button onClick={handleBulkDelete} className="btn-danger icon-button btn-small">
                        <FaTrash /> Eliminar Seleccionados
                    </button>
                      <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                              type="checkbox"
                              checked={isAllVisibleSelected}
                              onChange={handleSelectAllVisible}
                              disabled={visibleAlumnoIds.length === 0}
                              style={{ marginRight: '5px' }}
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
            {showCSVUploader && <CSVUploader materiaId={materiaId} onUploadComplete={handleSaveAlumno} onCancel={handleCancelAlumno} />}
            {showAssignGroupModal && <AsignarGrupoModal grupos={grupos} onClose={() => setShowAssignGroupModal(false)} onAssign={handleAssignGroup} />}

            {/* Listado de Alumnos por Grupo */}
            {isLoading && !showAlumnoForm && !showCSVUploader && !showGrupoForm ? (
                <div style={{textAlign: 'center', padding: '2rem'}}><FaSpinner className="spinner" /> Cargando...</div>
            ) : (
             !showAlumnoForm && !showCSVUploader && !showGrupoForm && (
                <div className="grupos-list">
                    {/* Grupos Existentes */}
                    {grupos.map(grupo => {
                        const grupoKey = grupo.id;
                        const alumnosEnEsteGrupo = alumnosAgrupados[grupoKey] || [];
                        const isExpanded = expandedGroups.has(grupoKey);
                         const areAllInGroupSelected = alumnosEnEsteGrupo.length > 0 && alumnosEnEsteGrupo.every(a => selectedAlumnos.has(a.id));

                        return (
                            <div key={grupoKey} className="grupo-container card">
                                <div className="grupo-header" onClick={() => toggleGroupExpansion(grupoKey)}>
                                     <span className='grupo-toggle-icon'>{isExpanded ? <FaAngleDown /> : <FaAngleRight />}</span>
                                    <input type="checkbox" checked={areAllInGroupSelected} onChange={(e) => handleSelectGroup(grupoKey, e)} onClick={(e) => e.stopPropagation()} disabled={alumnosEnEsteGrupo.length === 0} title={`Seleccionar ${grupo.nombre}`} style={{ marginRight: '10px' }}/>
                                    <h4>{grupo.nombre} ({alumnosEnEsteGrupo.length})</h4>
                                    <div className="grupo-actions">
                                        <button onClick={(e) => { e.stopPropagation(); handleEditGrupo(grupo); }} className="btn-secondary btn-small icon-button" title="Editar Nombre Grupo"> <FaEdit /> </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteGrupo(grupo.id); }} className="btn-danger btn-small icon-button" title="Eliminar Grupo"> <FaTrash /> </button>
                                    </div>
                                </div>
                                {isExpanded && (
                                     <div className='table-responsive'>
                                         <table className="alumnos-table inside-group">
                                             <thead><tr><th style={{width:'30px'}}></th><th>Matrícula</th><th>Apellido, Nombre</th><th>Correo</th><th>Acceso</th><th>Acciones</th></tr></thead>
                                             <tbody>
                                                 {alumnosEnEsteGrupo.length > 0 ? alumnosEnEsteGrupo.map(alumno => {
                                                     const isSelected = selectedAlumnos.has(alumno.id);
                                                     const accountState = creatingAccountStates[alumno.id];
                                                     const hasUserId = !!alumno.user_id;
                                                     const canCreate = alumno.email && alumno.matricula && !hasUserId && accountState !== 'loading' && accountState !== 'success' && accountState !== 'exists';
                                                     return (
                                                         <tr key={alumno.id} className={isSelected ? 'selected-row' : ''}>
                                                             <td><input type="checkbox" checked={isSelected} onChange={() => handleSelectAlumno(alumno.id)} /></td>
                                                             <td>{alumno.matricula}</td>
                                                             <td>{alumno.apellido}, {alumno.nombre}</td>
                                                             <td>{alumno.email || '-'}</td>
                                                             <td style={{ textAlign: 'center' }}>
                                                                  {hasUserId || accountState === 'exists' || accountState === 'success' ? (<FaCheckCircle style={{ color: 'var(--color-success)' }} title="Acceso activado"/>)
                                                                  : accountState === 'loading' ? (<FaSpinner className="spinner" />)
                                                                  : accountState === 'error' ? (<FaTimesCircle style={{ color: 'var(--color-danger)'}} title={error || "Error al crear"}/>)
                                                                  : canCreate ? (<button onClick={() => handleCrearAcceso(alumno)} className="btn-secondary btn-small icon-button" title={`Crear acceso (Pass: ${alumno.matricula})`} disabled={accountState === 'loading'}><FaKey /></button>)
                                                                  : (<span title={!alumno.email ? "Requiere correo" : (!alumno.matricula ? "Requiere matrícula" : "")}>-</span>)}
                                                             </td>
                                                             <td>
                                                                  <button onClick={() => handleEditAlumno(alumno)} className="btn-secondary btn-small icon-button" title="Editar Alumno"><FaEdit /></button>
                                                                  <button onClick={() => handleDeleteAlumno(alumno.id, alumno.user_id)} className="btn-danger btn-small icon-button" title="Eliminar Alumno" style={{marginLeft:'5px'}}><FaTrash /></button>
                                                             </td>
                                                         </tr>
                                                     );
                                                 }) : (<tr><td colSpan="6">No hay alumnos {searchTerm ? 'visibles ' : ''}en este grupo.</td></tr>)}
                                             </tbody>
                                         </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Alumnos Sin Grupo */}
                    <div key="sin_grupo" className="grupo-container card">
                         <div className="grupo-header" onClick={() => toggleGroupExpansion('sin_grupo')}>
                             <span className='grupo-toggle-icon'>{expandedGroups.has('sin_grupo') ? <FaAngleDown /> : <FaAngleRight />}</span>
                              <input type="checkbox"
                                checked={(alumnosAgrupados['sin_grupo']?.length || 0) > 0 && (alumnosAgrupados['sin_grupo'] || []).every(a => selectedAlumnos.has(a.id))}
                                onChange={(e) => handleSelectGroup('sin_grupo', e)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={!alumnosAgrupados['sin_grupo'] || alumnosAgrupados['sin_grupo'].length === 0}
                                title="Seleccionar/Deseleccionar todos sin grupo" style={{ marginRight: '10px' }}
                             />
                             <h4>Sin Grupo Asignado ({alumnosAgrupados['sin_grupo']?.length || 0})</h4>
                             {/* No hay acciones de editar/borrar para este "grupo" */}
                         </div>
                         {expandedGroups.has('sin_grupo') && (
                             <div className='table-responsive'>
                                 <table className="alumnos-table inside-group">
                                    <thead><tr><th style={{width:'30px'}}></th><th>Matrícula</th><th>Apellido, Nombre</th><th>Correo</th><th>Acceso</th><th>Acciones</th></tr></thead>
                                     <tbody>
                                         {(alumnosAgrupados['sin_grupo'] || []).length > 0 ? (alumnosAgrupados['sin_grupo'] || []).map(alumno => {
                                            const isSelected = selectedAlumnos.has(alumno.id);
                                            const accountState = creatingAccountStates[alumno.id];
                                            const hasUserId = !!alumno.user_id;
                                            const canCreate = alumno.email && alumno.matricula && !hasUserId && accountState !== 'loading' && accountState !== 'success' && accountState !== 'exists';
                                             return (
                                                 <tr key={alumno.id} className={isSelected ? 'selected-row' : ''}>
                                                     <td><input type="checkbox" checked={isSelected} onChange={() => handleSelectAlumno(alumno.id)} /></td>
                                                     <td>{alumno.matricula}</td>
                                                     <td>{alumno.apellido}, {alumno.nombre}</td>
                                                     <td>{alumno.email || '-'}</td>
                                                     <td style={{ textAlign: 'center' }}>
                                                         {hasUserId || accountState === 'exists' || accountState === 'success' ? (<FaCheckCircle style={{ color: 'var(--color-success)' }} title="Acceso activado"/>)
                                                         : accountState === 'loading' ? (<FaSpinner className="spinner" />)
                                                         : accountState === 'error' ? (<FaTimesCircle style={{ color: 'var(--color-danger)'}} title={error || "Error al crear"}/>)
                                                         : canCreate ? (<button onClick={() => handleCrearAcceso(alumno)} className="btn-secondary btn-small icon-button" title={`Crear acceso (Pass: ${alumno.matricula})`} disabled={accountState === 'loading'}><FaKey /></button>)
                                                         : (<span title={!alumno.email ? "Requiere correo" : (!alumno.matricula ? "Requiere matrícula" : "")}>-</span>)}
                                                     </td>
                                                     <td>
                                                         <button onClick={() => handleEditAlumno(alumno)} className="btn-secondary btn-small icon-button" title="Editar Alumno"><FaEdit /></button>
                                                         <button onClick={() => handleDeleteAlumno(alumno.id, alumno.user_id)} className="btn-danger btn-small icon-button" title="Eliminar Alumno" style={{marginLeft:'5px'}}><FaTrash /></button>
                                                     </td>
                                                 </tr>
                                             );
                                         }) : (<tr><td colSpan="6">No hay alumnos {searchTerm ? 'visibles ' : ''}sin asignar.</td></tr>)}
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