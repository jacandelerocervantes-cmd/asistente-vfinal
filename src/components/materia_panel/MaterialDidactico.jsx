// src/components/materia_panel/MaterialDidactico.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { FaFolder, FaFilePdf, FaFileWord, FaFilePowerpoint, FaFile, FaSpinner, FaUpload, FaFolderPlus, FaFileImage, FaFileArchive, FaFileVideo } from 'react-icons/fa';
import './MaterialDidactico.css'; // Importamos el CSS

const MaterialDidactico = ({ materia }) => {
    // Estados de UI
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

    // Estados de Navegación
    const [path, setPath] = useState([]); // [{ id, name }]
    const [currentFolderId, setCurrentFolderId] = useState(null);
    const [currentContents, setCurrentContents] = useState({ folders: [], files: [] });

    // Estados del Formulario
    const [newFolderName, setNewFolderName] = useState('');
    const [fileToUpload, setFileToUpload] = useState(null);

    // 1. Hook Inicial: Establecer la carpeta raíz
    useEffect(() => {
        if (materia?.drive_folder_material_id) {
            const rootId = materia.drive_folder_material_id;
            const rootName = "Material Didáctico";
            setPath([{ id: rootId, name: rootName }]);
            setCurrentFolderId(rootId);
        } else {
            setError("La carpeta raíz de 'Material Didáctico' no está configurada para esta materia.");
            setLoading(false);
        }
    }, [materia]);

    // 2. Hook de Fetching: Cargar contenido cuando cambia la carpeta actual
    const fetchContents = useCallback(async (folderId) => {
        if (!folderId) return;
        setLoading(true);
        setError('');
        try {
            const { data, error: invokeError } = await supabase.functions.invoke('material-get-contents', {
                body: { folder_id: folderId }
            });
            if (invokeError) throw invokeError;
            
            setCurrentContents({
                folders: data.archivos.folders || [],
                files: data.archivos.files || []
            });
        } catch (error) {
            const errorMessage = error.context?.details || error.message || "Error al cargar el contenido.";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (currentFolderId) {
            fetchContents(currentFolderId);
        }
    }, [currentFolderId, fetchContents]);

    // 3. Handlers de Navegación
    const handleFolderClick = (folder) => {
        setPath(prevPath => [...prevPath, { id: folder.id, name: folder.name }]);
        setCurrentFolderId(folder.id);
    };

    const handleBreadcrumbClick = (index) => {
        const newPath = path.slice(0, index + 1);
        setPath(newPath);
        setCurrentFolderId(newPath[newPath.length - 1].id);
    };

    // 4. Handlers de Acciones (Crear Carpeta, Subir Archivo)
    const handleCrearCarpeta = async (e) => {
        e.preventDefault();
        if (!newFolderName) return;
        
        setUploading(true); // Reutilizar estado 'uploading'
        setError('');
        try {
            const { error: invokeError } = await supabase.functions.invoke('material-create-folder', {
                body: { 
                    parentFolderId: currentFolderId, 
                    newFolderName: newFolderName 
                }
            });
            if (invokeError) throw invokeError;
            
            setNewFolderName(''); // Limpiar input
            fetchContents(currentFolderId); // Recargar
        } catch (error) {
            const errorMessage = error.context?.details || error.message || "Error al crear la carpeta.";
            setError(errorMessage);
        } finally {
            setUploading(false);
        }
    };

    const handleSubirArchivo = async (e) => {
        e.preventDefault();
        if (!fileToUpload) return;

        setUploading(true);
        setError('');

        // Convertir a Base64
        const reader = new FileReader();
        reader.readAsDataURL(fileToUpload);
        reader.onload = async () => {
            const base64Data = reader.result;
            try {
                const { error: invokeError } = await supabase.functions.invoke('material-upload-file', {
                    body: {
                        targetFolderId: currentFolderId,
                        fileName: fileToUpload.name,
                        mimeType: fileToUpload.type,
                        base64Data: base64Data 
                    }
                });
                if (invokeError) throw invokeError;

                setFileToUpload(null); // Limpiar input de archivo
                e.target.reset(); // Resetear el formulario de subida
                fetchContents(currentFolderId); // Recargar
            } catch (error) {
                const errorMessage = error.context?.details || error.message || "Error al subir el archivo.";
                setError(errorMessage);
            } finally {
                setUploading(false);
            }
        };
        reader.onerror = (error) => {
            setError("Error al leer el archivo local.");
            setUploading(false);
        };
    };

    // 5. Helper para íconos de archivos
    const getFileIcon = (mimeType) => {
        if (!mimeType) return <FaFile />;
        if (mimeType.includes('pdf')) return <FaFilePdf style={{ color: '#D9534F' }} />;
        if (mimeType.includes('word')) return <FaFileWord style={{ color: '#2A5699' }} />;
        if (mimeType.includes('powerpoint')) return <FaFilePowerpoint style={{ color: '#D24726' }} />;
        if (mimeType.startsWith('image/')) return <FaFileImage style={{ color: '#5CB85C' }} />;
        if (mimeType.startsWith('video/')) return <FaFileVideo style={{ color: '#5BC0DE' }} />;
        if (mimeType.includes('zip') || mimeType.includes('archive')) return <FaFileArchive style={{ color: '#F0AD4E' }} />;
        return <FaFile style={{ color: '#777' }} />;
    };

    return (
        <div className="material-panel">
            {/* --- FORMULARIOS DE ACCIÓN --- */}
            <div className="material-form-container card">
                <h3>Gestor de Material</h3>
                {error && <p className="error-message">{error}</p>}
                
                <div className="form-group-horizontal">
                    {/* Formulario Crear Carpeta */}
                    <form onSubmit={handleCrearCarpeta} style={{ flex: 1 }}>
                        <div className="form-group">
                            <label>Crear Tema / Subtema</label>
                            <input
                                type="text"
                                placeholder="Nombre de la nueva carpeta..."
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                disabled={uploading || loading}
                            />
                        </div>
                        <button type="submit" className="btn-primary" disabled={uploading || loading || !newFolderName}>
                            <FaFolderPlus /> Crear Carpeta
                        </button>
                    </form>

                    {/* Formulario Subir Archivo */}
                    <form onSubmit={handleSubirArchivo} style={{ flex: 1 }}>
                        <div className="form-group">
                            <label>Subir Archivo</label>
                            <input
                                type="file"
                                onChange={(e) => setFileToUpload(e.target.files[0])}
                                disabled={uploading || loading}
                            />
                        </div>
                        <button type="submit" className="btn-secondary" disabled={uploading || loading || !fileToUpload}>
                            <FaUpload /> Subir Material
                        </button>
                    </form>
                </div>
                {uploading && <div className="upload-progress"><FaSpinner className="spinner" /> Procesando...</div>}
            </div>

            {/* --- EXPLORADOR DE ARCHIVOS --- */}
            <h3>Contenido de la Carpeta</h3>
            
            {/* Breadcrumbs */}
            <nav className="material-breadcrumbs">
                {path.map((p, index) => (
                    <React.Fragment key={p.id}>
                        {index > 0 && <span className="breadcrumb-separator">/</span>}
                        <button 
                            className="breadcrumb-item"
                            onClick={() => handleBreadcrumbClick(index)}
                            disabled={index === path.length - 1}
                        >
                            {p.name}
                        </button>
                    </React.Fragment>
                ))}
            </nav>

            {/* Lista de Contenidos */}
            <div className="material-list-container">
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}><FaSpinner className="spinner" /> Cargando...</div>
                ) : (
                    <div className="material-list">
                        {/* Carpetas */}
                        {currentContents.folders.map(folder => (
                            <div key={folder.id} className="material-item folder" onClick={() => handleFolderClick(folder)}>
                                <span className="material-item-icon folder"><FaFolder /></span>
                                <span className="material-item-name">{folder.name}</span>
                            </div>
                        ))}
                        
                        {/* Archivos */}
                        {currentContents.files.map(file => (
                            <a key={file.id} href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="material-item file" style={{ textDecoration: 'none', color: 'inherit' }}>
                                <span className="material-item-icon file">
                                    {file.iconLink ? <img src={file.iconLink} alt="tipo" /> : getFileIcon(file.mimeType)}
                                </span>
                                <span className="material-item-name">{file.name}</span>
                            </a>
                        ))}

                        {!loading && currentContents.folders.length === 0 && currentContents.files.length === 0 && (
                            <p className="material-empty">Esta carpeta está vacía.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MaterialDidactico;