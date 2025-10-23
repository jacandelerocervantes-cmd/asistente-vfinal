// src/pages/RegistroAsistencia.jsx
import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './RegistroAsistencia.css';

const RegistroAsistencia = () => {
    const { materia_id, unidad, sesion } = useParams(); // Get params as strings
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
            // --- Convertir IDs/Números a Number ANTES de enviar ---
            const materiaIdNum = parseInt(materia_id || '0', 10);
            const unidadNum = parseInt(unidad || '0', 10);
            const sesionNum = parseInt(sesion || '0', 10);

            // Validar que la conversión fue exitosa (básico)
            if (!materiaIdNum || !unidadNum || !sesionNum) {
                throw new Error("URL inválida: Faltan parámetros numéricos.");
            }
            // --- Fin Conversión ---

            const { data, error } = await supabase.functions.invoke('registrar-asistencia', {
                body: { 
                    matricula: matricula.toUpperCase(), // Mantener matrícula como string
                    materia_id: materiaIdNum,         // Enviar como número
                    unidad: unidadNum,                 // Enviar como número
                    sesion: sesionNum,                 // Enviar como número
                    token                             // Token sigue siendo string
                },
            });

            // --- Manejo del error específico de la función ---
            // Supabase devuelve error.message si la función falla
            if (error) {
                 // Intenta obtener un mensaje más detallado si está disponible
                 const errorMessage = error.context?.details || error.message || "Error desconocido desde la función.";
                throw new Error(errorMessage);
            }
            // Si no hay error, data debería contener el { message: "..." } de éxito
            if (!data?.message) {
                 throw new Error("Respuesta inesperada de la función.");
            }
            // --- Fin Manejo Error ---


            setMessage(data.message);
            setStatus('success');

        } catch (err) {
            // Asegurarse de mostrar el mensaje del error capturado
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
                {/* Mostrar los números parseados para confirmar */}
                <p>Materia ID: {parseInt(materia_id || '0')}, Unidad: {parseInt(unidad || '0')}, Sesión: {parseInt(sesion || '0')}</p>
                <form onSubmit={handleSubmit}>
                    <label htmlFor="matricula">Matrícula</label>
                    <input
                        id="matricula"
                        type="text"
                        value={matricula}
                        onChange={(e) => setMatricula(e.target.value.toUpperCase())} // Convertir a mayúsculas al escribir
                        placeholder="Ingresa tu matrícula"
                        required
                        // Deshabilitar input si ya fue exitoso?
                        // disabled={status === 'success'}
                    />
                    <button type="submit" disabled={loading || status === 'success'}>
                        {loading ? 'Registrando...' : (status === 'success' ? '¡Registrado!' : 'Registrar Asistencia')}
                    </button>
                </form>
                {message && <p className={`message ${status}`}>{message}</p>}
                 {/* Añadir un enlace para volver o refrescar si falla */}
                 {status === 'error' && <button onClick={() => window.location.reload()} style={{marginTop: '10px', backgroundColor: '#718096'}}>Reintentar</button>}
            </div>
        </div>
    );
};

export default RegistroAsistencia;