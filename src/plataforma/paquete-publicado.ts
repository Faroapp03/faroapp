// Contrato público del paquete de datos: /paquete/<versión>/<archivo>.json. La versión deriva del manifiesto;
// cada ruta identifica contenido inmutable y evita mezclar archivos de distintas versiones al trabajar sin conexión.

/** La carpeta de la web bajo la que se publica el paquete. */
export const CARPETA_DEL_PAQUETE = 'paquete';

/** Prefijo hexadecimal de la huella del manifiesto que nombra la ruta de la versión del paquete. */
const LETRAS_DE_LA_HUELLA = 16;

/** Un año y sin volver a preguntar: el contenido de una ruta del paquete no cambia nunca. */
export const CACHE_DEL_PAQUETE = 'public, max-age=31536000, immutable';

/** La ruta de un archivo del paquete publicado: la huella de su versión y el nombre de un JSON, sin subcarpetas. */
const RUTA_DEL_PAQUETE = new RegExp(`^/${CARPETA_DEL_PAQUETE}/([0-9a-f]{${LETRAS_DE_LA_HUELLA}})/([a-z0-9-]+\\.json)$`);

/**
 * La versión del paquete (las primeras cifras de la SHA-256 del manifiesto, en hexadecimal).
 *
 * @param sha256DelManifiesto - La huella SHA-256 del manifiesto.
 * @returns La versión corta del paquete.
 */
export function versionDelPaquete(sha256DelManifiesto: string): string {
  return sha256DelManifiesto.slice(0, LETRAS_DE_LA_HUELLA);
}

/**
 * La huella y el archivo de una ruta del paquete publicado, o null si la ruta no es del paquete.
 *
 * @param ruta - La ruta del archivo en el paquete.
 * @returns Su huella y su archivo, o null si no está publicado.
 */
export function archivoDelPaquetePublicado(ruta: string): { huella: string; archivo: string } | null {
  const partes = RUTA_DEL_PAQUETE.exec(ruta);
  // Los dos grupos de RUTA_DEL_PAQUETE son obligatorios: una coincidencia siempre contiene ambas cadenas.
  return partes ? { huella: partes[1] as string, archivo: partes[2] as string } : null;
}
