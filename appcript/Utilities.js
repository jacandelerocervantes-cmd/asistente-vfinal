/**
 * Extrae el ID de un archivo o carpeta de una URL de Google Drive.
 * @param {string} driveUrl La URL de Google Drive.
 * @return {string | null} El ID extraído o null si no se encuentra.
 */
function extractDriveIdFromUrl(driveUrl) {
  if (!driveUrl || typeof driveUrl !== 'string') return null;
  const match = driveUrl.match(/(?:folders\/|d\/|id=|\/open\?id=)([-\w]{25,})/);
  return match ? match[1] : null;
}