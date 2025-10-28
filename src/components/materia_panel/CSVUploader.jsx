import React, { useState, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import Papa from 'papaparse';
import './CSVUploader.css';
import { FaUpload, FaSpinner } from 'react-icons/fa'; // Añadir FaSpinner

const CSVUploader = ({ materiaId, onUploadComplete, onCancel }) => {
  const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [results, setResults] = useState(null); // Para mostrar resultados
    const [createAccounts, setCreateAccounts] = useState(true); // Checkbox para crear cuentas

    const handleFileChange = (event) => {
        setFile(event.target.files[0]);
        setError('');
        setResults(null);
    };

    const processCSV = useCallback(async () => {
        if (!file) {
            setError('Por favor, selecciona un archivo CSV.');
            return;
        }
        if (!materiaId) {
            setError('Error: No se ha proporcionado el ID de la materia.');
            return;
        }

        setUploading(true);
        setError('');
        setResults(null); // Limpiar resultados anteriores

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (result) => {
                const alumnosFromCSV = result.data;
                console.log("Datos CSV parseados:", alumnosFromCSV);

                if (!alumnosFromCSV || alumnosFromCSV.length === 0) {
                    setError('El archivo CSV está vacío o no tiene el formato esperado (con cabeceras).');
                    setUploading(false);
                    return;
                }

                // Validar cabeceras esperadas (ajusta según tu CSV)
                const expectedHeaders = ['matricula', 'nombre', 'apellido'];
                const actualHeaders = Object.keys(alumnosFromCSV[0]);
                if (!expectedHeaders.every(header => actualHeaders.includes(header))) {
                    setError(`Cabeceras incorrectas. Se esperan: ${expectedHeaders.join(', ')}. Encontradas: ${actualHeaders.join(', ')}`);
                    setUploading(false);
                    return;
                }

                // Preparar datos para Supabase (añadiendo materia_id)
                const alumnosParaGuardar = alumnosFromCSV.map(a => ({
                    materia_id: materiaId,
                    matricula: String(a.matricula).trim(), // Asegurar string y quitar espacios
                    nombre: String(a.nombre).trim(),
                    apellido: String(a.apellido).trim(),
                    email: a.email ? String(a.email).trim().toLowerCase() : null // Normalizar email si existe
                })).filter(a => a.matricula && a.nombre && a.apellido); // Filtrar filas incompletas

                if (alumnosParaGuardar.length === 0) {
                     setError('No se encontraron alumnos válidos (con matrícula, nombre y apellido) en el CSV.');
                     setUploading(false);
                     return;
                }

                console.log(`Intentando guardar/actualizar ${alumnosParaGuardar.length} alumnos...`);

                try {
                    // Usar upsert para insertar nuevos o actualizar existentes por matrícula y materia_id
                    const { data: savedAlumnos, error: upsertError } = await supabase
                        .from('alumnos')
                        .upsert(alumnosParaGuardar, { onConflict: 'materia_id, matricula' }) // Clave única
                        .select('id, matricula, email'); // Necesitamos el ID y email para la creación de cuentas

                    if (upsertError) throw upsertError;

                    console.log(`${savedAlumnos.length} alumnos guardados/actualizados.`);
                    setResults({ message: `${savedAlumnos.length} alumnos procesados desde CSV.` });

                    // --- INICIO CREACIÓN MASIVA DE CUENTAS ---
                    if (createAccounts && savedAlumnos && savedAlumnos.length > 0) {
                        const alumnosParaCrearCuenta = savedAlumnos.filter(a => a.email && a.matricula); // Filtrar los que tienen email y matrícula

                        if (alumnosParaCrearCuenta.length > 0) {
                            console.log(`Intentando crear ${alumnosParaCrearCuenta.length} cuentas de acceso...`);
                            setResults(prev => ({ ...prev, accountMessage: `Creando ${alumnosParaCrearCuenta.length} cuentas...` }));

                            const payloadBatch = {
                                alumnos: alumnosParaCrearCuenta.map(a => ({
                                    alumno_id: a.id,
                                    email: a.email,
                                    matricula: a.matricula // La función usará esto como password
                                }))
                            };

                            try {
                                const { data: batchResult, error: batchError } = await supabase.functions.invoke(
                                    'crear-usuarios-alumnos-batch',
                                    { body: payloadBatch }
                                );

                                if (batchError) throw batchError;

                                const erroresCuenta = batchResult.resultados.filter(r => !r.success);
                                const mensajeCuentas = `Cuentas creadas: ${batchResult.exitosos}/${batchResult.totalProcesados}. ${erroresCuenta.length > 0 ? `Errores: ${erroresCuenta.length}` : ''}`;
                                console.log("Resultado creación masiva:", batchResult);
                                setResults(prev => ({ ...prev, accountMessage: mensajeCuentas, accountErrors: erroresCuenta.length > 0 ? erroresCuenta : null }));
                                if (erroresCuenta.length > 0) {
                                     console.warn("Errores al crear cuentas:", erroresCuenta);
                                }


                            } catch (batchInvokeError) {
                                console.error("Error invocando crear-usuarios-alumnos-batch:", batchInvokeError);
                                const errMsg = batchInvokeError.context?.details || batchInvokeError.message || 'Error desconocido.';
                                setResults(prev => ({ ...prev, accountMessage: `Error creando cuentas: ${errMsg}` }));
                            }
                        } else {
                            console.log("No hay alumnos con correo en el CSV para crear cuentas.");
                            setResults(prev => ({ ...prev, accountMessage: "No se encontraron alumnos con correo para crear cuentas." }));
                        }
                    } else if (createAccounts) {
                         setResults(prev => ({ ...prev, accountMessage: "No se procesaron alumnos desde CSV para crear cuentas." }));
                    }
                    // --- FIN CREACIÓN MASIVA ---

                    // Llamar al callback de éxito después de todo
                    onUploadComplete();

                } catch (err) {
                    console.error("Error guardando alumnos desde CSV:", err);
                    setError("Error al procesar el archivo CSV: " + err.message);
                } finally {
                    setUploading(false);
                }
            },
            error: (err) => {
                console.error("Error parseando CSV:", err);
                setError("Error al leer el archivo CSV: " + err.message);
                setUploading(false);
            }
        });
    }, [file, materiaId, onUploadComplete, createAccounts]); // Añadir createAccounts a dependencias

  return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content csv-uploader-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h4>Subir Alumnos desde CSV</h4>
                    <button onClick={onCancel} className="close-btn">&times;</button>
                </div>
                <div className="modal-body">
                    <p>El archivo CSV debe tener las columnas: <strong>matricula</strong>, <strong>nombre</strong>, <strong>apellido</strong>. Opcionalmente puede incluir <strong>email</strong>.</p>
                    {error && <p className="error-message">{error}</p>}
                    {results && (
                        <div className="results-message">
                            <p>{results.message}</p>
                            {results.accountMessage && <p>{results.accountMessage}</p>}
                            {/* Opcional: Mostrar detalles de errores de creación de cuenta */}
                            {results.accountErrors && results.accountErrors.length > 0 && (
                                <details style={{marginTop: '10px', fontSize: '0.9em', textAlign: 'left'}}>
                                    <summary>Ver errores ({results.accountErrors.length})</summary>
                                    <ul>
                                        {results.accountErrors.map((e, i) => (
                                            <li key={i}>{e.email}: {e.error}</li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}

                    <div className="form-group">
                        <label htmlFor="csvFile">Seleccionar Archivo CSV</label>
                        <input
                            type="file"
                            id="csvFile"
                            accept=".csv"
                            onChange={handleFileChange}
                            disabled={uploading}
                        />
                    </div>

                     {/* --- Checkbox para crear cuentas --- */}
                     <div className="form-group" style={{ marginTop: '1rem', textAlign: 'left' }}>
                        <label>
                            <input
                                type="checkbox"
                                checked={createAccounts}
                                onChange={(e) => setCreateAccounts(e.target.checked)}
                                disabled={uploading}
                            />
                            Intentar crear cuenta de acceso para alumnos con correo (usará matrícula como contraseña inicial)
                        </label>
                    </div>
                     {/* --- Fin Checkbox --- */}


                </div>
                 <div className="modal-footer form-actions">
                    <button type="button" onClick={onCancel} className="btn-tertiary" disabled={uploading}>Cancelar</button>
                    <button
                        onClick={processCSV}
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