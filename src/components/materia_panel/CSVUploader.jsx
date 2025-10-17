import React from 'react';
import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../supabaseClient';
import './CSVUploader.css';

const CSVUploader = ({ materia_id, onFinish }) => {
  const [uploadType, setUploadType] = useState('alumnos');
  const [file, setFile] = useState(null);
  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setHeaders(Object.keys(results.data[0] || {}));
          setData(results.data);
        },
      });
    }
  };

  const handleUpload = async () => {
    if (data.length === 0) {
      alert('No hay datos para subir.');
      return;
    }
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (uploadType === 'alumnos') {
        const alumnosToInsert = data.map(row => ({
          matricula: row.matricula,
          nombre: row.nombre,
          apellido: row.apellido,
          correo: row.correo,
          materia_id,
          user_id: user.id
        }));

        // Use 'upsert' to update if matricula already exists, or insert if it's new.
        const { error } = await supabase.from('alumnos').upsert(alumnosToInsert, { onConflict: 'materia_id,matricula' });
        if (error) throw error;
        alert(`¡${data.length} registros de alumnos han sido subidos/actualizados exitosamente!`);

      } else if (uploadType === 'grupos') {
        // 1. Get all students in the course to map matricula -> id
        const { data: todosLosAlumnos, error: alumnosError } = await supabase.from('alumnos').select('id, matricula').eq('materia_id', materia_id);
        if (alumnosError) throw alumnosError;
        const matriculaToIdMap = new Map(todosLosAlumnos.map(a => [String(a.matricula), a.id]));

        // 2. Group the CSV by group name
        const gruposCSV = data.reduce((acc, row) => {
          const nombreGrupo = row.nombre_grupo;
          const matricula = row.matricula_alumno;
          if (!acc[nombreGrupo]) {
            acc[nombreGrupo] = [];
          }
          acc[nombreGrupo].push(matricula);
          return acc;
        }, {});

        // 3. Process each group
        for (const nombreGrupo in gruposCSV) {
          // Create or find the group
          const { data: grupoData } = await supabase.from('grupos').upsert({ nombre: nombreGrupo, materia_id, user_id: user.id }, { onConflict: 'materia_id,nombre' }).select('id').single();
          const grupoId = grupoData.id;

          // Prepare student assignments
          const asignaciones = gruposCSV[nombreGrupo]
            .map(matricula => matriculaToIdMap.get(String(matricula))) // Convert matricula to id
            .filter(id => id) // Filter out matriculas that don't exist
            .map(alumnoId => ({ grupo_id: grupoId, alumno_id: alumnoId, user_id: user.id }));

          // Delete old members and add the new ones
          await supabase.from('alumnos_grupos').delete().eq('grupo_id', grupoId);
          if (asignaciones.length > 0) {
            await supabase.from('alumnos_grupos').insert(asignaciones);
          }
        }
        alert(`¡Grupos procesados desde el CSV exitosamente!`);
      }
      onFinish();
    } catch (error) {
      alert(`Error al subir los datos: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const expectedHeaders = uploadType === 'alumnos' ? ['matricula', 'nombre', 'apellido', 'correo'] : ['nombre_grupo', 'matricula_alumno'];

  return (
    <div className="csv-uploader-container card">
      <h3>Subida Masiva con CSV</h3>
      
      <div className="upload-type-selector">
        <label>
          <input type="radio" value="alumnos" checked={uploadType === 'alumnos'} onChange={() => setUploadType('alumnos')} />
          Subir Alumnos
        </label>
        <label>
          <input type="radio" value="grupos" checked={uploadType === 'grupos'} onChange={() => setUploadType('grupos')} />
          Subir Grupos
        </label>
      </div>
      
      <p>Asegúrate de que tu archivo CSV tenga las columnas: <strong>{expectedHeaders.join(', ')}</strong>.</p>
      
      <input type="file" accept=".csv" onChange={handleFileChange} />

      {data.length > 0 && (
        <div className="preview-container">
          <h4>Vista Previa ({data.length} filas)</h4>
          <table className="preview-table">
            <thead>
              <tr>
                {headers.map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 5).map((row, i) => ( // Show only the first 5 rows for preview
                <tr key={i}>
                  {headers.map(h => <td key={h}>{row[h]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="form-actions">
        <button onClick={onFinish} className="btn-tertiary" disabled={loading}>Cancelar</button>
        <button onClick={handleUpload} className="btn-primary" disabled={!file || loading}>
          {loading ? 'Subiendo...' : `Subir ${data.length} Registros`}
        </button>
      </div>
    </div>
  );
};

export default CSVUploader;