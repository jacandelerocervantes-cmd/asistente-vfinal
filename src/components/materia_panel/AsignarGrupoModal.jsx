// src/components/materia_panel/AsignarGrupoModal.jsx
import React, { useState } from 'react';

const AsignarGrupoModal = ({ grupos, onClose, onAssign }) => {
    const [selectedGrupoId, setSelectedGrupoId] = useState('');

    const handleAssignClick = () => {
        if (selectedGrupoId) {
            onAssign(parseInt(selectedGrupoId, 10));
        } else {
            // Asignar a "Sin Grupo"
            onAssign(null);
        }
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h4>Asignar a Grupo</h4>
                <div className="form-group">
                    <label htmlFor="grupo-select">Selecciona un grupo:</label>
                    <select id="grupo-select" value={selectedGrupoId} onChange={(e) => setSelectedGrupoId(e.target.value)}>
                        <option value="">-- Sin Grupo --</option>
                        {grupos.map(g => (
                            <option key={g.id} value={g.id}>{g.nombre}</option>
                        ))}
                    </select>
                </div>
                <div className="form-actions">
                    <button onClick={onClose} className="btn-tertiary">Cancelar</button>
                    <button onClick={handleAssignClick} className="btn-primary">Asignar</button>
                </div>
            </div>
        </div>
    );
};

export default AsignarGrupoModal;