// src/components/materia_panel/AlumnoForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import './AlumnoForm.css';
import { FaSave, FaTimes, FaSpinner } from 'react-icons/fa'; // Añadir FaSpinner

// --- CORRECCIÓN: Recibir 'grupos' como prop ---
const AlumnoForm = ({ alumno, materiaId, grupos = [], onSave, onCancel }) => {
// --- FIN CORRECCIÓN ---
    // Estado inicial vacío
    const initialState = { matricula: '', nombre: '', apellido: '', email: '', grupo_id: '' };
    const [formData, setFormData] = useState(initialState);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Determinar si es edición basado en si 'alumno' tiene un ID
    const isEditing = Boolean(alumno && alumno.id);

    useEffect(() => {
        // Llenar el formulario SI estamos en modo edición
        if (isEditing) {
            setFormData({
                matricula: alumno.matricula || '',
                nombre: alumno.nombre || '',
                apellido: alumno.apellido || '',
                email: alumno.email || '',
                // Asegurarse de que grupo_id sea string para el select, o '' si es null/undefined
                grupo_id: alumno.grupo_id?.toString() || '',
            });
            console.log("Cargando datos para editar:", alumno);
        } else {
            // Si no es edición (alumno es null o sin id), resetear
            setFormData(initialState);
            console.log("Formulario reseteado para crear.");
        }
        setError(''); // Limpiar errores al cambiar de modo
    }, [alumno, isEditing]); // Depender de 'alumno' y 'isEditing'

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        /* ... (sin cambios, ya maneja isEditing) ... */
        e.preventDefault();
        setLoading(true);
        setError('');

        // Validaciones básicas
        if (!formData.matricula || !formData.nombre || !formData.apellido) {
            setError('Matrícula, Nombre y Apellido son obligatorios.');
            setLoading(false);
            return;
        }

        try {
            const dataToSave = {
                ...formData,
                materia_id: materiaId,
                // Convertir grupo_id a null si está vacío o no seleccionado
                grupo_id: formData.grupo_id ? parseInt(formData.grupo_id, 10) : null,
                // Convertir email a null si está vacío
                email: formData.email || null,
            };

            let response;
            if (isEditing && alumno && alumno.id) {
                // Modo Edición: UPDATE
                 console.log("Actualizando alumno:", alumno.id, dataToSave);
                response = await supabase
                    .from('alumnos')
                    .update(dataToSave)
                    .eq('id', alumno.id);
            } else {
                // Modo Creación: INSERT
                 console.log("Insertando nuevo alumno:", dataToSave);
                 // Verificar duplicados antes de insertar (opcional pero recomendado)
                 const { data: existing, error: checkError } = await supabase
                    .from('alumnos')
                    .select('id')
                    .eq('materia_id', materiaId)
                    .eq('matricula', dataToSave.matricula)
                    .maybeSingle();

                 if (checkError) throw new Error(`Error verificando duplicados: ${checkError.message}`);
                 if (existing) throw new Error(`La matrícula ${dataToSave.matricula} ya existe en esta materia.`);


                response = await supabase
                    .from('alumnos')
                    .insert(dataToSave);
            }

            const { error: saveError } = response;
            if (saveError) throw saveError;

            console.log(`Alumno ${isEditing ? 'actualizado' : 'creado'} exitosamente.`);
            onSave(); // Llama al callback para cerrar y recargar

        } catch (err) {
            console.error(`Error ${isEditing ? 'actualizando' : 'guardando'} alumno:`, err);
            // Mensaje de error más específico para duplicados
            if (err.message?.includes('duplicate key value violates unique constraint')) {
                 if(err.message?.includes('alumnos_materia_id_matricula_key')) {
                    setError(`Error: La matrícula '${formData.matricula}' ya existe para esta materia.`);
                 } else if (err.message?.includes('alumnos_user_id_key')) {
                      setError(`Error: El usuario ya está vinculado a otro alumno.`);
                 }
                  else {
                      setError('Error: Conflicto de datos únicos. Verifica matrícula o correo.');
                  }
            } else {
                setError(`Error al ${isEditing ? 'actualizar' : 'guardar'} alumno: ${err.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content alumno-form-modal" onClick={(e) => e.stopPropagation()}>
                {/* ... (Header y Form con campos incluyendo el select de grupo) ... */}
                <div className="modal-header">/* ... */</div>
                <form onSubmit={handleSubmit} className="modal-body materia-form">
                    {/* ... (Campos: matricula, apellido, nombre, email) ... */}
                     {/* --- Selector de Grupo --- */}
                    <div className="form-group">
                        <label htmlFor="grupo_id">Grupo (Opcional)</label>
                        <select id="grupo_id" name="grupo_id" value={formData.grupo_id} onChange={handleChange} disabled={loading}>
                            <option value="">-- Sin asignar --</option>
                            {grupos.map(g => (
                                <option key={g.id} value={g.id}>{g.nombre}</option>
                            ))}
                        </select>
                    </div>
                    {/* ... (Botones Save/Cancel) ... */}
                </form>
            </div>
        </div>
    );
};

export default AlumnoForm;