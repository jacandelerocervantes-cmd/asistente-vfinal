// src/components/banco_preguntas/PreguntaBancoCard.jsx
import React from 'react';
import { FaEdit, FaTrash, FaPlusCircle } from 'react-icons/fa'; // Importar iconos
import './BancoPreguntasPanel.css'; // Reutilizar CSS o crear uno específico

const PreguntaBancoCard = ({ pregunta, modoSeleccion, onEdit, onDelete, onSelect }) => {
    const { texto_pregunta, tipo_pregunta, puntos, datos_extra, unidad, tema, materias, banco_opciones } = pregunta;

    // Función para mostrar un resumen de la configuración didáctica
    const renderResumenDatosExtra = () => {
        if (!datos_extra) return null;
        if (tipo_pregunta === 'sopa_letras') {
            return `Sopa ${datos_extra.tamano}x${datos_extra.tamano}, ${datos_extra.palabras?.length || 0} palabras.`;
        }
        if (tipo_pregunta === 'crucigrama') {
            return `Crucigrama, ${datos_extra.entradas?.length || 0} entradas.`;
        }
        // Añadir más tipos si es necesario
        return null;
    };

    return (
        <div className="pregunta-banco-card card"> {/* Reutilizar clase card o crear una específica */}
            <div className="pregunta-banco-header">
                <span className="tipo-pregunta-tag">{tipo_pregunta.replace('_', ' ')}</span>
                <div className="pregunta-banco-actions">
                    {modoSeleccion ? (
                        <button onClick={() => onSelect(pregunta)} className="icon-btn action-select" title="Añadir a la evaluación">
                            <FaPlusCircle />
                        </button>
                    ) : (
                        <>
                            <button onClick={() => onEdit(pregunta)} className="icon-btn action-edit" title="Editar pregunta">
                                <FaEdit />
                            </button>
                            <button onClick={() => onDelete(pregunta)} className="icon-btn action-delete" title="Eliminar del banco">
                                <FaTrash />
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="pregunta-banco-body">
                <p className="texto-pregunta">{texto_pregunta}</p>
                {/* Mostrar opciones si es opción múltiple */}
                {tipo_pregunta.startsWith('opcion_multiple') && (
                    <ul className="opciones-resumen">
                        {(banco_opciones || []).map(opt => (
                            <li key={opt.id} className={opt.es_correcta ? 'correcta' : ''}>
                                {opt.texto_opcion} {opt.es_correcta && '✓'}
                            </li>
                        ))}
                    </ul>
                )}
                 {/* Mostrar resumen de datos extra */}
                {renderResumenDatosExtra() && (
                    <p className="datos-extra-resumen"><i>{renderResumenDatosExtra()}</i></p>
                )}
            </div>

            <div className="pregunta-banco-footer">
                <span>Pts: {puntos}</span>
                {unidad && <span>Unidad: {unidad}</span>}
                {tema && <span>Tema: {tema}</span>}
                {/* Mostrar materia si no estamos filtrando por ella */}
                {materias && <span title={`Materia: ${materias.nombre}`}>Materia: {materias.nombre.substring(0, 20)}...</span>}
            </div>
        </div>
    );
};

export default PreguntaBancoCard;