// src/components/materia_panel/AlumnoForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import './AlumnoForm.css';
import { FaSave, FaTimes, FaSpinner } from 'react-icons/fa'; // Añadir FaSpinner

// Recibe la lista de grupos como prop
const AlumnoForm = ({ alumno, materiaId, grupos = [], onSave, onCancel }) => {
    
    // Estado inicial
    const initialState = {
        matricula: '',
        nombre: '',
        apellido: '',
        email: '',
        grupo_id: '', // Usar string vacío para "Sin asignar"
    };
    
    const [formData, setFormData] = useState(initialState);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    // Determinar si estamos editando
    const isEditing = Boolean(alumno && alumno.id);

    // --- CORRECCIÓN: useEffect para llenar el formulario ---
    useEffect(() => {
        if (isEditing) {
            // Modo Edición: Llenar el formulario con los datos del alumno
            setFormData({
                matricula: alumno.matricula || '',
                nombre: alumno.nombre || '',
                apellido: alumno.apellido || '',
                email: alumno.email || '',
                // Asegurar que grupo_id sea un string para el <select>
                grupo_id: alumno.grupo_id?.toString() || '', 
            });
            console.log("Cargando datos para editar:", alumno);
        } else {
            // Modo Creación: Resetear el formulario
            setFormData(initialState);
            console.log("Formulario reseteado para crear.");
        }
        setError(''); // Limpiar errores al cambiar de modo
    }, [alumno, isEditing]); // Depender de 'alumno' y 'isEditing'
    // --- FIN CORRECCIÓN ---

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (!formData.matricula || !formData.nombre || !formData.apellido) {
            setError('Matrícula, Nombre y Apellido son obligatorios.');
            setLoading(false);
            return;
        }

        try {
            // Preparar datos para enviar a Supabase
            const dataToSave = {
                materia_id: materiaId,
                matricula: formData.matricula.trim(),
                nombre: formData.nombre.trim(),
                apellido: formData.apellido.trim(),
                // Convertir '' a null para el email
                email: formData.email.trim() || null, 
                // Convertir '' (del select) a null para la BD
                grupo_id: formData.grupo_id ? parseInt(formData.grupo_id, 10) : null,
            };

            let response;
            if (isEditing) {
                // --- MODO UPDATE ---
                console.log("Actualizando alumno:", alumno.id, dataToSave);
                response = await supabase
                    .from('alumnos')
                    .update(dataToSave)
                    .eq('id', alumno.id);
            } else {
                // --- MODO INSERT ---
                 console.log("Insertando nuevo alumno:", dataToSave);
                 // Verificar duplicados (matrícula + materia_id)
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
            // Mensajes de error más amigables
            if (err.message?.includes('alumnos_materia_id_matricula_key')) {
                setError(`Error: La matrícula '${formData.matricula}' ya existe para esta materia.`);
            } else if (err.message?.includes('alumnos_user_id_key')) {
                 setError(`Error: El usuario ya está vinculado a otro alumno.`);
            } else {
                setError(`Error: ${err.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content alumno-form-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{isEditing ? 'Editar Alumno' : 'Añadir Nuevo Alumno'}</h3>
                    <button onClick={onCancel} className="close-btn" disabled={loading}>&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="modal-body materia-form">
                    {error && <p className="error-message">{error}</p>}
                    <div className="form-group">
                        <label htmlFor="matricula">Matrícula*</label>
                        <input type="text" id="matricula" name="matricula" value={formData.matricula} onChange={handleChange} required disabled={loading || isEditing} />
                        {isEditing && <small>La matrícula no se puede editar.</small>}
                    </div>
                    <div className="form-group">
                        <label htmlFor="apellido">Apellido(s)*</label>
                        <input type="text" id="apellido" name="apellido" value={formData.apellido} onChange={handleChange} required disabled={loading} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="nombre">Nombre(s)*</label>
                        <input type="text" id="nombre" name="nombre" value={formData.nombre} onChange={handleChange} required disabled={loading} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="email">Correo Electrónico (Opcional, para acceso)</label>
                        <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} disabled={loading} placeholder="ejemplo@correo.com"/>
                    </div>
                    <div className="form-group">
                        <label htmlFor="grupo_id">Grupo (Opcional)</label>
                        <select id="grupo_id" name="grupo_id" value={formData.grupo_id} onChange={handleChange} disabled={loading}>
                            <option value="">-- Sin asignar --</option>
                            {grupos.map(g => (
                                <option key={g.id} value={g.id}>{g.nombre}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-actions">
                        <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>
                           <FaTimes /> Cancelar
                        </button>
                        <button type="submit" className="btn-primary icon-button" disabled={loading}>
                            {loading ? <FaSpinner className="spinner" /> : <FaSave />}
                            {isEditing ? 'Actualizar Alumno' : 'Guardar Alumno'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AlumnoForm;