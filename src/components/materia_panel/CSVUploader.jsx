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
                delimiter: ",", // <--- FORZAMOS LA COMA
                complete: (result) => resolve(result.data),
                error: (err) => reject(err),
            });
        });
    };

    // Lógica para subir Alumnos
    const handleUploadAlumnos = async (rawData) => {
        let alumnosFromCSV = rawData;
        let actualHeaders = Object.keys(rawData[0] || {});

        // --- DETECCIÓN Y REPARACIÓN DE "FALSO CSV" ---
        // Si detectamos solo 1 columna y esa columna contiene comas (ej. "matricula,nombre,apellido")
        if (actualHeaders.length === 1 && actualHeaders[0].includes(',')) {
            console.warn("Detectado formato de línea completa entrecomillada. Reparando...");
            const headerString = actualHeaders[0]; // La columna única larga
            const realHeaders = headerString.split(',').map(h => h.trim()); // Separamos manual
            
            // Reconstruimos la data fila por fila
            alumnosFromCSV = rawData.map(row => {
                const rowString = row[headerString]; // El valor largo: "A001,Juan,..."
                if (!rowString) return null;
                const values = rowString.split(',');
                
                const newObj = {};
                realHeaders.forEach((h, i) => {
                    newObj[h] = values[i] ? values[i].trim() : '';
                });
                return newObj;
            }).filter(Boolean);
            
            actualHeaders = realHeaders; // Actualizamos las cabeceras para la validación siguiente
        }
        // ------------------------------------------------

        const expectedHeaders = ['matricula', 'nombre', 'apellido'];
        
        // Mapa de Cabeceras (Normalización)
        const headerMap = {};
        actualHeaders.forEach(h => {
            const normalized = h.replace(/^\uFEFF/, '').trim().toLowerCase();
            headerMap[normalized] = h;
        });

        const missing = expectedHeaders.filter(h => !headerMap[h]);
        if (missing.length > 0) {
            throw new Error(`Faltan columnas obligatorias en el CSV: ${missing.join(', ')}. (Detectadas: ${actualHeaders.join(', ')})`);
        }

        // Mapeamos usando las llaves reales encontradas en el archivo
        const alumnosParaGuardar = alumnosFromCSV.map(a => ({
            materia_id: materiaId,
            matricula: String(a[headerMap['matricula']] || '').trim(),
            nombre: String(a[headerMap['nombre']] || '').trim(),
            apellido: String(a[headerMap['apellido']] || '').trim(),
            // Email es opcional, buscamos su llave si existe
            email: headerMap['email'] ? String(a[headerMap['email']] || '').trim().toLowerCase() : null
        })).filter(a => a.matricula && a.nombre && a.apellido);
        if (alumnosParaGuardar.length === 0) {
            throw new Error('No se encontraron alumnos válidos (con matrícula, nombre y apellido) en el CSV.');
        }

        console.log(`Upserting ${alumnosParaGuardar.length} alumnos...`);
        const { data: upsertedAlumnos, error: upsertError } = await supabase
            .from('alumnos')
            .upsert(alumnosParaGuardar, { onConflict: 'materia_id, matricula' })
            .select('id, matricula, email, user_id'); // Seleccionamos los datos actualizados
        if (upsertError) throw upsertError;

        let accountResults = { message: "Creación de cuentas omitida." };
        if (createAccounts) {
            // Filtrar alumnos que tienen email, matrícula y NO tienen ya un user_id
            const alumnosParaCrearCuenta = upsertedAlumnos.filter(a => a.email && a.matricula && !a.user_id);
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
            message: `${upsertedAlumnos.length} alumnos procesados.`,
            accountMessage: accountResults.message,
            accountErrors: accountResults.errors
        });
    };

    // Lógica para subir Grupos/Equipos
    const handleUploadGrupos = async (dataFromCSV) => {
        // 1. Validar Cabeceras
        const expectedHeaders = ['matricula', 'grupo'];
        const actualHeaders = Object.keys(dataFromCSV[0] || {});

        // Hacemos la validación de cabeceras más robusta (igual que en alumnos)
        const headerMap = {};
        actualHeaders.forEach(h => {
            const normalized = h.replace(/^\uFEFF/, '').trim().toLowerCase();
            headerMap[normalized] = h;
        });

        const missing = expectedHeaders.filter(h => !headerMap[h]);
        if (missing.length > 0) {
            throw new Error(`Faltan columnas obligatorias en el CSV: ${missing.join(', ')}. (Detectadas: ${actualHeaders.join(', ')})`);
        }

        // 2. Obtener el usuario actual (Docente)
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Usuario no autenticado.");

        // 3. Procesar Datos del CSV
        const filasValidas = dataFromCSV.filter(row => row[headerMap['matricula']] && row[headerMap['grupo']]);
        if (filasValidas.length === 0) throw new Error("El CSV no tiene filas válidas con matrícula y grupo.");

        console.log(`Procesando ${filasValidas.length} asignaciones de grupo...`);

        // 4. Paso A: Asegurar que los GRUPOS existan (Upsert Grupos)
        // Extraemos nombres únicos de grupos del CSV
        const nombresGruposUnicos = [...new Set(filasValidas.map(r => String(r[headerMap['grupo']]).trim()))];
        
        const gruposParaInsertar = nombresGruposUnicos.map(nombre => ({
            materia_id: materiaId,
            user_id: user.id, // Importante para RLS
            nombre: nombre
        }));

        // Insertamos/Actualizamos grupos y recuperamos sus IDs
        const { data: gruposGuardados, error: errorGrupos } = await supabase
            .from('grupos')
            .upsert(gruposParaInsertar, { onConflict: 'materia_id, nombre' })
            .select('id, nombre');
        
        if (errorGrupos) throw errorGrupos;

        // Mapa rápido: "Nombre Grupo" -> ID
        const mapaGrupos = {};
        gruposGuardados.forEach(g => mapaGrupos[g.nombre] = g.id);

        // 5. Paso B: Obtener IDs de ALUMNOS basados en las matrículas del CSV
        const matriculasEnCSV = [...new Set(filasValidas.map(r => String(r[headerMap['matricula']]).trim()))];
        
        const { data: alumnosEncontrados, error: errorAlumnos } = await supabase
            .from('alumnos')
            .select('id, matricula')
            .eq('materia_id', materiaId)
            .in('matricula', matriculasEnCSV);
            
        if (errorAlumnos) throw errorAlumnos;

        // Mapa rápido: "Matrícula" -> ID
        const mapaAlumnos = {};
        alumnosEncontrados.forEach(a => mapaAlumnos[a.matricula] = a.id);

        // 6. Paso C: Crear las Relaciones (Tabla Pivote)
        const relacionesParaInsertar = [];
        const errores = [];

        filasValidas.forEach(row => {
            const matricula = String(row[headerMap['matricula']]).trim();
            const nombreGrupo = String(row[headerMap['grupo']]).trim();
            
            const alumnoId = mapaAlumnos[matricula];
            const grupoId = mapaGrupos[nombreGrupo];

            if (alumnoId && grupoId) {
                relacionesParaInsertar.push({
                    alumno_id: alumnoId,
                    grupo_id: grupoId,
                    user_id: user.id
                });
            } else {
                if (!alumnoId) errores.push(`Matrícula no encontrada: ${matricula}`);
            }
        });

        if (relacionesParaInsertar.length > 0) {
            // Insertamos relaciones (ignorando duplicados si ya existen)
            const { error: errorRelaciones } = await supabase
                .from('alumnos_grupos')
                .upsert(relacionesParaInsertar, { onConflict: 'alumno_id, grupo_id', ignoreDuplicates: true });
            
            if (errorRelaciones) throw errorRelaciones;
        }

        // 7. Reporte Final
        let mensajeFinal = `Proceso completado. ${relacionesParaInsertar.length} asignaciones creadas.`;
        if (errores.length > 0) {
            mensajeFinal += ` (Hubo ${errores.length} matrículas que no existían en esta materia).`;
            console.warn("Errores en asignación:", errores);
        }
        
        setResults({ message: mensajeFinal });
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
                            ? "Columnas: matricula, nombre, apellido, email"
                            : "Columnas: matricula, grupo (Crea el grupo si no existe y asigna al alumno)"
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