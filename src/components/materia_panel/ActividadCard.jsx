// src/components/materia_panel/ActividadCard.jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaEdit, FaTrash, FaArrowRight, FaFileSignature, FaCalendarAlt } from 'react-icons/fa';
import { supabase } from '../../supabaseClient';
import ToggleSwitch from '../common/ToggleSwitch.jsx';

const ActividadCard = ({ actividad, onEdit, onDelete }) => {
    const { id, nombre, unidad, tipo_entrega, fecha_limite, esta_activo } = actividad;

    const [isActive, setIsActive] = useState(esta_activo);
    const [isToggling, setIsToggling] = useState(false);

    const handleToggleActivo = async (e) => {
        const nuevoEstado = e.target.checked;
        setIsToggling(true);
        setIsActive(nuevoEstado); // Actualización optimista

        try {
            const { error } = await supabase
                .from('actividades')
                .update({ esta_activo: nuevoEstado })
                .eq('id', id);
            
            if (error) throw error;
            // Asumo que tienes un sistema de notificaciones, si no, puedes usar alert()
            // showNotification(`'${nombre}' ${nuevoEstado ? 'está ahora ACTIVA' : 'está ahora OCULTA'}.`, 'success');

        } catch (error) {
            console.error("Error al actualizar estado:", error);
            // showNotification("Error al cambiar el estado.", 'error');
            alert("Error al cambiar el estado.");
            setIsActive(!nuevoEstado); // Revertir en caso de error
        } finally {
            setIsToggling(false);
        }
    };

    return (
        <div className={`materia-card actividad-card ${!isActive ? 'desactivada' : ''}`}>
            <div className="card-header">
                <h3 className="materia-nombre">{nombre}</h3>
                <div className="card-actions">
                    <button onClick={(e) => { e.preventDefault(); onEdit(actividad); }} className="icon-btn" title="Editar Actividad"><FaEdit /></button>
                    <button onClick={(e) => { e.preventDefault(); onDelete(actividad); }} className="icon-btn icon-btn-delete" title="Eliminar Actividad"><FaTrash /></button>
                </div>
            </div>
            <div className="card-body">
                <p className="materia-semestre">Unidad: {unidad}</p>
                {tipo_entrega && <p><FaFileSignature /> {tipo_entrega}</p>}
                {fecha_limite && <p><FaCalendarAlt /> Límite: {new Date(fecha_limite).toLocaleDateString()}</p>}
                <Link to={`/actividad/${id}`} className="card-footer">
                    <span>Evaluar Entregas</span>
                    <FaArrowRight />
                </Link>
            </div>
            <div className="actividad-card-footer">
                <span>{isActive ? 'Visible para alumnos' : 'Oculta para alumnos'}</span>
                <ToggleSwitch id={`act-${id}`} isChecked={isActive} onChange={handleToggleActivo} disabled={isToggling} />
            </div>
        </div>
    );
};

export default ActividadCard;