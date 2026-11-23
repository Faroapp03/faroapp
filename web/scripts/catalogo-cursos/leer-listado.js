import { sha256Hex } from '../../recursos/catalogo-cursos/lector.js';
import { deBase64Url } from '../base64url.js';

/** Lee los bytes cuyo resumen fijó el módulo con SRI al construir la página.
 * @param {string | null | undefined} texto @param {number} longitud @param {string} sha256
 * @returns {Promise<import('../../recursos/catalogo-cursos/lector.js').ListadoCursos>}
 */
export async function leerListadoDePagina(texto, longitud, sha256) {
  const bytes = typeof texto === 'string' && texto.length === longitud ? deBase64Url(texto) : null;
  if (!bytes || sha256Hex(bytes) !== sha256) {
    throw new Error('El listado recibido no corresponde a esta edición de Cursos');
  }
  const json = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  // La huella pertenece a la serialización de ListadoCursos acreditada en esta construcción.
  return /** @type {import('../../recursos/catalogo-cursos/lector.js').ListadoCursos} */ (
    await new Response(json).json()
  );
}
