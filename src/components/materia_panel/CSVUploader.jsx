import React, { useState, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import Papa from 'papaparse';
import './CSVUploader.css';
import { FaUpload, FaSpinner } from 'react-icons/fa';

const CSVUploader = ({ materiaId, onUploadComplete, onCancel }) => {
  const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [results, setResults] = useState(null);
    const [uploadType, setUploadType] = useState('alumnos'); // 'alumnos' o 'grupos'
    const [createAccounts, setCreateAccounts] = useState(true); // Checkbox

    const handleFileChange = (event) => {
        setFile(event.target.files[0]);
        setError('');
        setResults(null);
    };

    // Parsear el CSV
    const parseCSV = () => {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('No se seleccionó ningún archivo.'));
                return;
            }
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: (result) => resolve(result.data),
                error: (err) => reject(err),
            });
        });
    };

    // Lógica para subir Alumnos
    const handleUploadAlumnos = async (alumnosFromCSV) => {
        const expectedHeaders = ['matricula', 'nombre', 'apellido'];
        const actualHeaders = Object.keys(alumnosFromCSV[0] || {});
        if (!expectedHeaders.every(h => actualHeaders.includes(h))) {
            throw new Error(`Cabeceras incorrectas para Alumnos. Se esperan: ${expectedHeaders.join(', ')}.`);
        }

        const alumnosParaGuardar = alumnosFromCSV.map(a => ({
            materia_id: materiaId,
            matricula: String(a.matricula || '').trim(),
            nombre: String(a.nombre || '').trim(),
            apellido: String(a.apellido || '').trim(),
            email: a.email ? String(a.email).trim().toLowerCase() : null
        })).filter(a => a.matricula && a.nombre && a.apellido);

        if (alumnosParaGuardar.length === 0) {
            throw new Error('No se encontraron alumnos válidos (con matrícula, nombre y apellido) en el CSV.');
        }

        console.log(`Upserting ${alumnosParaGuardar.length} alumnos...`);
        const { data: savedAlumnos, error: upsertError } = await supabase
            .from('alumnos')
            .upsert(alumnosParaGuardar, { onConflict: 'materia_id, matricula' })
            .select('id, matricula, email, user_id'); // Necesitamos user_id para no re-crear
        if (upsertError) throw upsertError;

        let accountResults = { message: "Creación de cuentas omitida." };
        if (createAccounts) {
            // Filtrar alumnos que tienen email, matrícula y NO tienen ya un user_id
            const alumnosParaCrearCuenta = savedAlumnos.filter(a => a.email && a.matricula && !a.user_id);
            if (alumnosParaCrearCuenta.length > 0) {
                console.log(`Intentando crear ${alumnosParaCrearCuenta.length} cuentas de acceso...`);
                setResults(prev => ({ ...prev, accountMessage: `Creando ${alumnosParaCrearCuenta.length} cuentas...` }));

                const payloadBatch = {
                    alumnos: alumnosParaCrearCuenta.map(a => ({
                        alumno_id: a.id,
                        email: a.email,
                        matricula: a.matricula
                    }))
                };
                
                try {
                    const { data: batchResult, error: batchError } = await supabase.functions.invoke(
                        'crear-usuarios-alumnos-batch', { body: payloadBatch }
                    );
                    if (batchError) throw batchError;
                    
                    const errores = batchResult.resultados.filter(r => !r.success);
                    accountResults = {
                        message: `Cuentas creadas: ${batchResult.exitosos}/${batchResult.totalProcesados}.`,
                        errors: errores.length > 0 ? errores : null
                    };
                } catch (batchInvokeError) {
                     console.error("Error invocando crear-usuarios-alumnos-batch:", batchInvokeError);
                     accountResults = { message: `Error al invocar la creación masiva: ${batchInvokeError.message}` };
                }
            } else {
                 accountResults = { message: "No hay alumnos nuevos con correo para crear cuentas." };
            }
        }
        
        setResults({
            message: `${savedAlumnos.length} alumnos procesados.`,
            accountMessage: accountResults.message,
            accountErrors: accountResults.errors
        });
    };

    // Lógica para subir Grupos/Equipos
    const handleUploadGrupos = async (gruposFromCSV) => {
        const expectedHeaders = ['nombre'];
        const actualHeaders = Object.keys(gruposFromCSV[0] || {});
         if (!expectedHeaders.every(h => actualHeaders.includes(h))) {
            throw new Error(`Cabeceras incorrectas para Grupos. Se espera la columna: ${expectedHeaders.join(', ')}.`);
        }
        
        const gruposParaGuardar = gruposFromCSV.map(g => ({
            materia_id: materiaId,
            nombre: String(g.nombre || '').trim()
        })).filter(g => g.nombre); // Filtrar nombres vacíos

        if (gruposParaGuardar.length === 0) {
            throw new Error('No se encontraron nombres de grupo válidos en el CSV.');
        }

        console.log(`Upserting ${gruposParaGuardar.length} grupos...`);
        // Usar upsert para evitar duplicados de nombre en la misma materia
        const { data: savedGrupos, error: upsertError } = await supabase
            .from('grupos')
            .upsert(gruposParaGuardar, { onConflict: 'materia_id, nombre' })
            .select('nombre');
        
        if (upsertError) throw upsertError;

        setResults({ message: `${savedGrupos.length} grupos procesados exitosamente.` });
    };


    const handleSubmit = async () => {
        setUploading(true);
        setError('');
        setResults(null);
        try {
            const parsedData = await parseCSV();
            if (!parsedData || parsedData.length === 0) {
                 throw new Error('El archivo CSV está vacío o no se pudo leer.');
            }

            if (uploadType === 'alumnos') {
                await handleUploadAlumnos(parsedData);
            } else if (uploadType === 'grupos') {
                await handleUploadGrupos(parsedData);
            }
            onUploadComplete(); // Llama al callback para recargar la lista
        } catch (err) {
            console.error("Error al procesar CSV:", err);
            setError(err.message);
        } finally {
            setUploading(false);
        }
    };


    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content csv-uploader-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h4>Subir desde CSV</h4>
                    <button onClick={onCancel} className="close-btn">&times;</button>
                </div>
                <div className="modal-body">
                    {error && <p className="error-message">{error}</p>}
                    {results && (
                        <div className="results-message">
                            <p>{results.message}</p>
                            {results.accountMessage && <p>{results.accountMessage}</p>}
                            {results.accountErrors && (
                                <details style={{marginTop: '10px', fontSize: '0.9em', textAlign: 'left'}}>
                                    <summary>Ver errores de creación de cuentas ({results.accountErrors.length})</summary>
                                    <ul>
                                        {results.accountErrors.map((e, i) => (
                                            <li key={i}>{e.email || `ID ${e.alumno_id}`}: {e.error}</li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}

                    {/* Selector de Tipo de Subida */}
                    <div className="form-group">
                        <label htmlFor="uploadType">1. ¿Qué deseas subir?</label>
                        <select
                            id="uploadType"
                            value={uploadType}
                            onChange={(e) => setUploadType(e.target.value)}
                            disabled={uploading}
                            style={{width: '100%', padding: '8px'}}
                        >
                            <option value="alumnos">Lista de Alumnos</option>
                            <option value="grupos">Lista de Grupos/Equipos</option>
                        </select>
                    </div>
                    
                    <div className="form-group">
                        <label htmlFor="csvFile">2. Seleccionar Archivo CSV</label>
                        <input
                            type="file"
                            id="csvFile"
                            accept=".csv"
                            onChange={handleFileChange}
                            disabled={uploading}
                        />
                    </div>
                    
                    {/* Checkbox para crear cuentas (solo si sube alumnos) */}
                    {uploadType === 'alumnos' && (
                         <div className="form-group" style={{ marginTop: '1rem', textAlign: 'left' }}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={createAccounts}
                                    onChange={(e) => setCreateAccounts(e.target.checked)}
                                    disabled={uploading}
                                />
                                3. Intentar crear cuenta de acceso (usará matrícula como pass)
                            </label>
                        </div>
                    )}

                    <small style={{display: 'block', marginTop: '1rem'}}>
                        {uploadType === 'alumnos' 
                            ? "Columnas esperadas: matricula, nombre, apellido, email (opcional)"
                            : "Columna esperada: nombre"
                        }
                    </small>

                </div>
                 <div className="modal-footer form-actions">
                    <button type="button" onClick={onCancel} className="btn-tertiary" disabled={uploading}>Cancelar</button>
                    <button
                        onClick={handleSubmit}
                        className="btn-primary icon-button"
                        disabled={!file || uploading}
                    >
                        {uploading ? <FaSpinner className="spinner" /> : <FaUpload />}
                        {uploading ? 'Procesando...' : 'Subir y Procesar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CSVUploader;