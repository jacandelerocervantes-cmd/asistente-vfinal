// src/components/banco_preguntas/BancoPreguntasPanel.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import PreguntaBancoForm from './PreguntaBancoForm'; // Componente para añadir/editar preguntas del banco
import { useNotification } from '../../context/NotificationContext'; // Importar hook
import PreguntaBancoCard from './PreguntaBancoCard'; // Componente para mostrar cada pregunta en la lista
import './BancoPreguntasPanel.css'; // Crearemos este CSS

const BancoPreguntasPanel = ({ materiaId = null, modoSeleccion = false, onSeleccionarPregunta }) => {
    // materiaId: Si se pasa, filtra por esa materia. Si es null, muestra todas las del docente.
    // modoSeleccion: Si es true, muestra un botón para seleccionar/importar en lugar de editar/eliminar.
    // onSeleccionarPregunta: Callback para pasar la pregunta seleccionada al componente padre (EvaluacionForm).

    const [preguntasBanco, setPreguntasBanco] = useState([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('list'); // 'list' o 'form'
    const [preguntaToEdit, setPreguntaToEdit] = useState(null);
    const [filtroMateria, setFiltroMateria] = useState(materiaId || 'todas'); // 'todas' o un ID de materia
    const [filtroUnidad, setFiltroUnidad] = useState(''); // Filtro por unidad
    const [filtroTema, setFiltroTema] = useState(''); // Filtro por tema/palabra clave
    const [materiasDocente, setMateriasDocente] = useState([]); // Para el dropdown de filtro
    const { showNotification } = useNotification(); // Usar el contexto

    // Cargar materias del docente para el filtro
    useEffect(() => {
        const fetchMaterias = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { data, error } = await supabase
                    .from('materias')
                    .select('id, nombre')
                    .eq('user_id', user.id)
                    .order('nombre');
                if (error) throw error;
                setMateriasDocente(data || []);
            } catch (error) {
                console.error("Error cargando materias del docente:", error);
            }
        };
        // Solo cargar materias si no estamos filtrando por una específica O si queremos mostrar el filtro
        if (!materiaId || !modoSeleccion) {
             fetchMaterias();
        }
    }, [materiaId, modoSeleccion]);

    // Cargar preguntas del banco según filtros
    useEffect(() => {
        if (view === 'list') {
            fetchPreguntasBanco();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, filtroMateria, filtroUnidad, filtroTema]); // Recargar si cambian los filtros o la vista

    const fetchPreguntasBanco = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuario no autenticado");

            let query = supabase
                .from('banco_preguntas')
                .select(`
                    *,
                    banco_opciones ( * ),
                    materias ( nombre )
                `)
                .eq('user_id', user.id); // Siempre filtrar por el usuario actual

            // Aplicar filtros
            if (filtroMateria !== 'todas') {
                query = query.eq('materia_id', filtroMateria);
            }
            if (filtroUnidad) {
                query = query.eq('unidad', filtroUnidad);
            }
            if (filtroTema) {
                // Usar 'ilike' para búsqueda insensible a mayúsculas/minúsculas
                // y '%' como comodín para buscar en cualquier parte del campo 'tema'
                query = query.ilike('tema', `%${filtroTema}%`);
            }

            query = query.order('created_at', { ascending: false }); // Ordenar por más recientes

            const { data, error } = await query;
            if (error) throw error;

            setPreguntasBanco(data || []);

        } catch (error) {
            console.error("Error cargando preguntas del banco:", error);
            const errorMessage = error.context?.details || error.message || "Error desconocido al cargar preguntas.";
            showNotification(errorMessage, 'error');
        } finally {
            setLoading(false);
        }
    };

    // --- Manejadores CRUD ---
    const handleEdit = (pregunta) => {
        setPreguntaToEdit(pregunta);
        setView('form');
    };

    const handleDelete = async (pregunta) => {
        if (window.confirm(`¿Estás seguro de eliminar esta pregunta del banco?\n"${pregunta.texto_pregunta.substring(0, 50)}..."`)) {
            try {
                // setLoading(true); // O un spinner específico
                const { error } = await supabase.from('banco_preguntas').delete().eq('id', pregunta.id);
                if (error) throw error;
                showNotification("Pregunta eliminada del banco.", 'success');
                fetchPreguntasBanco(); // Recargar lista
            } catch (error) {
                const errorMessage = error.context?.details || error.message || "Error desconocido al eliminar.";
                showNotification(errorMessage, 'error');
                // setLoading(false);
            }
        }
    };

    const handleSave = () => {
        setPreguntaToEdit(null);
        setView('list'); // Volver a la lista (fetch se ejecutará por useEffect)
    };

    const handleCancel = () => {
        setPreguntaToEdit(null);
        setView('list');
    };

    // --- Manejador para Modo Selección ---
    const handleSelectClick = (pregunta) => {
        if (modoSeleccion && onSeleccionarPregunta) {
            // Preparamos la pregunta para insertarla en la evaluación actual
            const preguntaParaEvaluacion = {
                ...pregunta,
                id: `banco-${pregunta.id}-${Date.now()}`, // ID temporal único que referencia al banco
                banco_pregunta_id: pregunta.id, // Guardamos referencia al original
                isNew: true, // Marcar como nueva para el form de evaluación
                // Limpiar campos que no aplican directamente o que se reasignarán
                created_at: undefined,
                updated_at: undefined,
                user_id: undefined, // Se asignará al guardar la evaluación
                materia_id: undefined, // Se asignará al guardar la evaluación
                materias: undefined, // Quitar relación anidada
                orden: undefined, // Se asignará en EvaluacionForm
                // Mapear opciones del banco a un formato compatible si es necesario
                opciones: (pregunta.banco_opciones || []).map(opt => ({
                    ...opt,
                    id: `banco-opt-${opt.id}-${Date.now()}`, // ID temporal
                    banco_opcion_id: opt.id, // Referencia
                    pregunta_id: undefined, // Se asignará al guardar
                    banco_pregunta_id: undefined, // Limpiar
                    created_at: undefined,
                    user_id: undefined,
                }))
            };
            delete preguntaParaEvaluacion.banco_opciones; // Eliminar el array original anidado

            onSeleccionarPregunta(preguntaParaEvaluacion);
        }
    };


    // --- Renderizado ---
    if (view === 'form') {
        return (
            <PreguntaBancoForm
                preguntaToEdit={preguntaToEdit}
                materiasDocente={materiasDocente} // Pasar materias para el select
                onSave={handleSave}
                onCancel={handleCancel}
            />
        );
    }

    // Vista de Lista (con filtros)
    return (
        <div className="banco-preguntas-panel">
            {!modoSeleccion && ( // No mostrar título ni botón Añadir en modo selección
                <div className="panel-header">
                    <h3>Mi Banco de Preguntas</h3>
                    <button onClick={() => { setPreguntaToEdit(null); setView('form'); }} className="btn-primary">
                        ＋ Añadir Pregunta al Banco
                    </button>
                </div>
            )}

            {/* Filtros */}
            <div className="filtros-banco">
                 {/* Filtro Materia (solo si no estamos en modo selección para una materia específica) */}
                 {(!materiaId || !modoSeleccion) && materiasDocente.length > 0 && (
                     <div className="filtro-item">
                        <label>Materia:</label>
                        <select value={filtroMateria} onChange={(e) => setFiltroMateria(e.target.value)}>
                            <option value="todas">Todas Mis Materias</option>
                            {materiasDocente.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                        </select>
                    </div>
                 )}
                 <div className="filtro-item">
                    <label>Unidad:</label>
                    <input
                        type="number"
                        min="1"
                        placeholder="N°"
                        value={filtroUnidad}
                        onChange={(e) => setFiltroUnidad(e.target.value)}
                        style={{ width: '80px' }}
                    />
                 </div>
                 <div className="filtro-item">
                    <label>Tema/Palabra Clave:</label>
                    <input
                        type="text"
                        placeholder="Buscar..."
                        value={filtroTema}
                        onChange={(e) => setFiltroTema(e.target.value)}
                    />
                 </div>
                 {/* Botón limpiar filtros */}
                 <button onClick={() => {setFiltroUnidad(''); setFiltroTema(''); if(!materiaId) setFiltroMateria('todas');}} className="btn-tertiary">Limpiar</button>
            </div>

            {/* Lista de Preguntas */}
            {loading ? (
                <p>Cargando preguntas...</p>
            ) : (
                <div className="preguntas-banco-list">
                    {preguntasBanco.length === 0 ? (
                        <p style={{ textAlign: 'center', marginTop: '20px' }}>No se encontraron preguntas con los filtros actuales.</p>
                    ) : (
                        preguntasBanco.map(pregunta => (
                            <PreguntaBancoCard
                                key={pregunta.id}
                                pregunta={pregunta}
                                modoSeleccion={modoSeleccion}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                onSelect={handleSelectClick}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default BancoPreguntasPanel;