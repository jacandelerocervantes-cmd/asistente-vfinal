// src/pages/AlumnoPortal.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient'; // Asumiendo que alumnos NO usan Supabase Auth directamente
import './Auth.css'; // <--- AÑADIR ESTA LÍNEA (Reutilizando Auth.css) o './AlumnoPortal.css' si lo creaste
 
// Estilos similares a Auth.css podrían aplicarse

const AlumnoPortal = () => {
    const [matricula, setMatricula] = useState('');
    const [correo, setCorreo] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            // Llama a una función Edge para validar al alumno y obtener sus evaluaciones
            // Esta función haría la consulta a la tabla 'alumnos'
            const { data, error: invokeError } = await supabase.functions.invoke('validar-alumno', {
                body: { matricula: matricula.toUpperCase(), correo }
            });

            if (invokeError) throw invokeError;
            if (data.error) throw new Error(data.error);

            // Si la validación es exitosa, data podría contener el ID del alumno y/o la lista de exámenes
            // Guardamos la info necesaria en localStorage/sessionStorage para usarla en la siguiente pantalla
            sessionStorage.setItem('alumnoAuth', JSON.stringify({
                alumnoId: data.alumnoId, // La función 'validar-alumno' debe devolver esto
                matricula: matricula.toUpperCase(),
                correo: correo
            }));

            navigate('/alumno/evaluaciones'); // Redirige al dashboard del alumno

        } catch (err) {
            console.error("Error en login alumno:", err);
            setError(err.message || 'Matrícula o correo incorrectos.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card card">
                <h2 className="auth-title">Portal del Alumno</h2>
                <p className="auth-subtitle">Ingresa con tu matrícula y correo institucional.</p>
                {error && <p style={{ color: 'red' }}>{error}</p>}
                <form onSubmit={handleLogin} style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
                    <div className="form-group">
                        <label htmlFor="matricula">Matrícula</label>
                        <input
                            id="matricula" type="text" value={matricula}
                            onChange={(e) => setMatricula(e.target.value)} required
                            style={{padding: '10px', fontSize: '1rem'}}
                         />
                    </div>
                     <div className="form-group">
                        <label htmlFor="correo">Correo Institucional</label>
                        <input
                            id="correo" type="email" value={correo}
                            onChange={(e) => setCorreo(e.target.value)} required
                            style={{padding: '10px', fontSize: '1rem'}}
                        />
                    </div>
                    <button type="submit" disabled={loading} className="btn-primary" style={{marginTop: '10px'}}>
                        {loading ? 'Validando...' : 'Acceder'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AlumnoPortal;