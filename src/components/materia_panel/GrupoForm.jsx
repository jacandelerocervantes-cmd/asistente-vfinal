// src/components/materia_panel/GrupoForm.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';

const GrupoForm = ({ grupo, materiaId, onSave, onCancel }) => {
    const [nombre, setNombre] = useState('');
    const [loading, setLoading] = useState(false);
    const isEditing = Boolean(grupo);

    useEffect(() => {
        if (isEditing) {
            setNombre(grupo.nombre);
        } else {
            setNombre('');
        }
    }, [grupo, isEditing]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!nombre.trim()) {
            alert("El nombre del grupo no puede estar vacío.");
            return;
        }
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const dataToSave = {
                nombre: nombre.trim(),
                materia_id: materiaId,
                user_id: user.id
            };

            if (isEditing) {
                const { error } = await supabase.from('grupos').update(dataToSave).eq('id', grupo.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('grupos').insert(dataToSave);
                if (error) throw error;
            }
            onSave();
        } catch (error) {
            console.error("Error guardando grupo:", error);
            alert("Error al guardar el grupo: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h4>{isEditing ? 'Editar Grupo' : 'Nuevo Grupo'}</h4>
                <form onSubmit={handleSubmit} className="materia-form">
                    <div className="form-group">
                        <label htmlFor="nombre-grupo">Nombre del Grupo</label>
                        <input id="nombre-grupo" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required disabled={loading} />
                    </div>
                    <div className="form-actions">
                        <button type="button" onClick={onCancel} className="btn-tertiary" disabled={loading}>Cancelar</button>
                        <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default GrupoForm;