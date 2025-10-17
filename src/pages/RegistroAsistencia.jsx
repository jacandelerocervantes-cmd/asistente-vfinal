// src/pages/RegistroAsistencia.jsx
import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './RegistroAsistencia.css';

const RegistroAsistencia = () => {
    const { materia_id, unidad, sesion } = useParams();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [matricula, setMatricula] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(''); // 'success' o 'error'

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!token) {
            setMessage("Error: Enlace de asistencia inválido o incompleto.");
            setStatus('error');
            return;
        }
        setLoading(true);
        setMessage('');
        setStatus('');

        try {
            const { data, error } = await supabase.functions.invoke('registrar-asistencia', {
                body: { 
                    matricula: matricula.toUpperCase(), 
                    materia_id: parseInt(materia_id), 
                    unidad: parseInt(unidad), 
                    sesion: parseInt(sesion), 
                    token 
                },
            });

            if (error) {
                throw new Error(error.message);
            }

            setMessage(data.message || "¡Asistencia registrada con éxito!");
            setStatus('success');

        } catch (err) {
            setMessage(err.message || 'Error: No se pudo registrar la asistencia.');
            setStatus('error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="registro-container">
            <div className="registro-card">
                <h2>Registro de Asistencia</h2>
                <p>Unidad: {unidad}, Sesión: {sesion}</p>
                <form onSubmit={handleSubmit}>
                    <label htmlFor="matricula">Matrícula</label>
                    <input
                        id="matricula"
                        type="text"
                        value={matricula}
                        // --- ¡CORRECCIÓN APLICADA AQUÍ! ---
                        // Aseguramos que setMatricula se llame para actualizar el estado.
                        onChange={(e) => setMatricula(e.target.value.toUpperCase())}
                        placeholder="Ingresa tu matrícula"
                        required
                    />
                    <button type="submit" disabled={loading || status === 'success'}>
                        {loading ? 'Registrando...' : 'Registrar Asistencia'}
                    </button>
                </form>
                {message && <p className={`message ${status}`}>{message}</p>}
            </div>
        </div>
    );
};

export default RegistroAsistencia;