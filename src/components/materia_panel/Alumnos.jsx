// src/components/materia_panel/Alumnos.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import AlumnoForm from './AlumnoForm';
import CSVUploader from './CSVUploader';
import AsignarGrupoModal from './AsignarGrupoModal';
import GrupoForm from './GrupoForm';
import './Alumnos.css';

// Importa el icono de llave o similar
import {
    FaKey, FaUserPlus, FaEdit, FaTrash, FaCheckCircle, FaTimesCircle,
    FaSpinner, FaUsers, FaFolderPlus, FaAngleDown, FaAngleRight
} from 'react-icons/fa';

const Alumnos = ({ materiaId, nombreMateria }) => {
    // --- Estados ---
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
    const [expandedGroups, setExpandedGroups] = useState(new Set(['sin_grupo'])); // Grupo "Sin Asignar" expandido

    // --- Cargar Grupos de la Materia ---
    const fetchGrupos = useCallback(async () => {
        if (!materiaId) return; // No cargar si no hay ID
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
        // Solo ejecutar si materiaId es un número válido
        if (!materiaId || typeof materiaId !== 'number' || isNaN(materiaId)) {
            setLoadingAlumnos(false); setAlumnos([]); return;
        }
        setLoadingAlumnos(true); setError('');
        setError('');
        try {
            const { data, error: fetchError } = await supabase
                .from('alumnos')
                .select(`
                    *,
                    grupos ( nombre )
                `)
                .eq('materia_id', materiaId) // Ahora materiaId debería ser válido
                .order('apellido', { ascending: true });

            if (fetchError) throw fetchError;
            setAlumnos(data || []);
        } catch (err) {
            console.error("Error cargando alumnos:", err);
            setError("No se pudieron cargar los alumnos: " + err.message);
            setAlumnos([]); // Limpiar en caso de error
        } finally {
            setLoadingAlumnos(false);
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
            setLoadingAlumnos(false);
            setLoadingGrupos(false);
        }
    }, [materiaId, fetchAlumnos, fetchGrupos]); // Depender de materiaId aquí

    // --- Agrupar Alumnos para Visualización ---
    const alumnosAgrupados = useMemo(() => {
        const grouped = { sin_grupo: [] };
        grupos.forEach(g => grouped[g.id] = []);
        alumnos.filter(a =>
            `${a.nombre||''} ${a.apellido||''} ${a.matricula||''} ${a.grupos?.nombre||''}`.toLowerCase().includes(searchTerm.toLowerCase())
        ).forEach(a => {
            const key = a.grupo_id || 'sin_grupo';
            (grouped[key] = grouped[key] || []).push(a); // Agrupa o pone en 'sin_grupo'
        });
        return grouped;
    }, [alumnos, grupos, searchTerm]);

    // IDs visibles para "Seleccionar Todos"
    const visibleAlumnoIds = useMemo(() => Object.values(alumnosAgrupados).flat().map(a => a.id), [alumnosAgrupados]);

    // --- Handlers Formularios y CRUD Individual ---
    const handleEditAlumno = (alumno) => { // Función restaurada
        console.log("Editando alumno:", alumno); // Verificar que llega el alumno correcto
        setEditingAlumno(alumno); // Establece el alumno a editar
        setShowAlumnoForm(true); // Abre el formulario
        // Asegurar que otros modales estén cerrados
        setShowCSVUploader(false);
        setShowGrupoForm(false);
    };
    const handleDeleteAlumno = async (alumnoId, alumnoUserId) => { /* ... (como estaba antes) ... */ };
    const handleSaveAlumno = () => { setShowAlumnoForm(false); setEditingAlumno(null); fetchAlumnos(); };
    const handleCancelAlumno = () => { setShowAlumnoForm(false); setEditingAlumno(null); };

    // Handlers Grupos (como estaban antes)
    const handleEditGrupo = (grupo) => { setEditingGrupo(grupo); setShowGrupoForm(true); };
    const handleDeleteGrupo = async (grupoId) => { /* ... (como estaba antes) ... */ };
    const handleSaveGrupo = () => { setShowGrupoForm(false); setEditingGrupo(null); fetchGrupos(); fetchAlumnos(); }; // Recargar ambos
    const handleCancelGrupo = () => { setShowGrupoForm(false); setEditingGrupo(null); };

    // --- Handlers Selección y Acciones Masivas (como estaban antes) ---
    const handleSelectAlumno = (alumnoId) => { /* ... */ };
    const handleSelectAllVisible = (event) => { /* ... */ };
    const handleSelectGroup = (grupoKey, event) => { /* ... */ };
    const isAllVisibleSelected = visibleAlumnoIds.length > 0 && selectedAlumnos.size >= visibleAlumnoIds.length && visibleAlumnoIds.every(id => selectedAlumnos.has(id));
    const handleBulkDelete = async () => { /* ... */ };
    const handleOpenAssignGroupModal = () => { if (selectedAlumnos.size > 0) setShowAssignGroupModal(true); };
    const handleAssignGroup = async (grupoId) => { /* ... */ };

    // --- Handler Creación de Cuenta (como estaba antes) ---
    const handleCrearAcceso = async (alumno) => { /* ... */ };

    // --- Handler Expandir/Colapsar (como estaba antes) ---
    const toggleGroupExpansion = (grupoKey) => { /* ... */ };

    // --- Renderizado ---
    if (!materiaId && !loadingAlumnos && !loadingGrupos) return <div className="alumnos-container section-container"><p>ID de materia inválido.</p></div>;
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
                <input type="text" placeholder="Buscar alumno..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
                <div>
                     {/* CORRECCIÓN: Asegurar setEditingAlumno(null) al añadir */}
                     <button onClick={() => { setEditingAlumno(null); setShowAlumnoForm(true); setShowCSVUploader(false); setShowGrupoForm(false); }} className="btn-primary icon-button">
                        <FaUserPlus /> Añadir Alumno
                    </button>
                    {/* FIN CORRECCIÓN */}
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
                      {/* Checkbox "Seleccionar Todos Visibles" aquí */}
                      <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                              type="checkbox"
                              checked={isAllVisibleSelected}
                              onChange={handleSelectAllVisible}
                              disabled={visibleAlumnoIds.length === 0}
                              style={{ marginRight: '5px' }}
                          />
                          Todos Visibles
                      </label>
                </div>
            )}

            {error && <p className="error-message">{error}</p>}

            {/* Modales */}
            {showAlumnoForm && <AlumnoForm alumno={editingAlumno} materiaId={materiaId} grupos={grupos} onSave={handleSaveAlumno} onCancel={handleCancelAlumno} />}
            {showGrupoForm && <GrupoForm grupo={editingGrupo} materiaId={materiaId} onSave={handleSaveGrupo} onCancel={handleCancelGrupo} />}
            {showCSVUploader && <CSVUploader materiaId={materiaId} onUploadComplete={handleSaveAlumno} onCancel={handleCancelAlumno} createAccountsInitial={true}/>}
            {showAssignGroupModal && <AsignarGrupoModal grupos={grupos} onClose={() => setShowAssignGroupModal(false)} onAssign={handleAssignGroup} />}

            {/* Listado Agrupado */}
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
                                        <button onClick={(e) => { e.stopPropagation(); handleEditGrupo(grupo); }} className="btn-secondary btn-small icon-button" title="Editar Grupo"> <FaEdit /> </button>
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
                                                     const hasUserId = !!alumno.user_id && alumno.user_id !== 'pending_refresh';
                                                     const canCreate = alumno.email && alumno.matricula && !hasUserId && accountState !== 'loading' && accountState !== 'success' && accountState !== 'exists';
                                                     return (
                                                         <tr key={alumno.id} className={isSelected ? 'selected-row' : ''}>
                                                             <td><input type="checkbox" checked={isSelected} onChange={() => handleSelectAlumno(alumno.id)} /></td>
                                                             <td>{alumno.matricula}</td>
                                                             <td>{alumno.apellido}, {alumno.nombre}</td>
                                                             <td>{alumno.email || '-'}</td>
                                                             <td style={{ textAlign: 'center' }}>
                                                                  {hasUserId || accountState === 'exists' || accountState === 'success' ? (<FaCheckCircle style={{ color: 'var(--color-success)' }} title="Acceso"/>)
                                                                  : accountState === 'loading' ? (<FaSpinner className="spinner" />)
                                                                  : accountState === 'error' ? (<FaTimesCircle style={{ color: 'var(--color-danger)'}} title={error || "Error"}/>)
                                                                  : canCreate ? (<button onClick={() => handleCrearAcceso(alumno)} className="btn-secondary btn-small icon-button" title={`Crear (P:${alumno.matricula})`} disabled={accountState === 'loading'}><FaKey /></button>)
                                                                  : (<span title={!alumno.email ? "Requiere correo" : (!alumno.matricula ? "Requiere matrícula" : "")}>-</span>)}
                                                             </td>
                                                             <td>
                                                                  <button onClick={() => handleEditAlumno(alumno)} className="btn-secondary btn-small icon-button" title="Editar"><FaEdit /></button>
                                                                  <button onClick={() => handleDeleteAlumno(alumno.id, alumno.user_id)} className="btn-danger btn-small icon-button" title="Eliminar" style={{marginLeft:'5px'}}><FaTrash /></button>
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
                                title="Seleccionar sin grupo" style={{ marginRight: '10px' }}
                             />
                             <h4>Sin Grupo Asignado ({alumnosAgrupados['sin_grupo']?.length || 0})</h4>
                         </div>
                         {expandedGroups.has('sin_grupo') && (
                             <div className='table-responsive'>
                                 <table className="alumnos-table inside-group">
                                    <thead><tr><th style={{width:'30px'}}></th><th>Matrícula</th><th>Apellido, Nombre</th><th>Correo</th><th>Acceso</th><th>Acciones</th></tr></thead>
                                     <tbody>
                                         {(alumnosAgrupados['sin_grupo'] || []).length > 0 ? (alumnosAgrupados['sin_grupo'] || []).map(alumno => {
                                            const isSelected = selectedAlumnos.has(alumno.id);
                                            const accountState = creatingAccountStates[alumno.id];
                                            const hasUserId = !!alumno.user_id && alumno.user_id !== 'pending_refresh';
                                            const canCreate = alumno.email && alumno.matricula && !hasUserId && accountState !== 'loading' && accountState !== 'success' && accountState !== 'exists';
                                             return (
                                                 <tr key={alumno.id} className={isSelected ? 'selected-row' : ''}>
                                                     <td><input type="checkbox" checked={isSelected} onChange={() => handleSelectAlumno(alumno.id)} /></td>
                                                     <td>{alumno.matricula}</td>
                                                     <td>{alumno.apellido}, {alumno.nombre}</td>
                                                     <td>{alumno.email || '-'}</td>
                                                     <td style={{ textAlign: 'center' }}>
                                                         {hasUserId || accountState === 'exists' || accountState === 'success' ? (<FaCheckCircle style={{ color: 'var(--color-success)' }} title="Acceso"/>)
                                                         : accountState === 'loading' ? (<FaSpinner className="spinner" />)
                                                         : accountState === 'error' ? (<FaTimesCircle style={{ color: 'var(--color-danger)'}} title={error || "Error"}/>)
                                                         : canCreate ? (<button onClick={() => handleCrearAcceso(alumno)} className="btn-secondary btn-small icon-button" title={`Crear (P:${alumno.matricula})`} disabled={accountState === 'loading'}><FaKey /></button>)
                                                         : (<span title={!alumno.email ? "Requiere correo" : (!alumno.matricula ? "Requiere matrícula" : "")}>-</span>)}
                                                     </td>
                                                     <td>
                                                         <button onClick={() => handleEditAlumno(alumno)} className="btn-secondary btn-small icon-button" title="Editar"><FaEdit /></button>
                                                         <button onClick={() => handleDeleteAlumno(alumno.id, alumno.user_id)} className="btn-danger btn-small icon-button" title="Eliminar" style={{marginLeft:'5px'}}><FaTrash /></button>
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