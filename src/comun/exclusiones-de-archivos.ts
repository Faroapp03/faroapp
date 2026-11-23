// Intérprete de los patrones positivos de web/.assetsignore, compartido por la comprobación de la web y el servidor
// local. Admite rutas, directorios, «*», «?» y «**» como tramo completo de una ruta. Otra sintaxis se rechaza
// explícitamente: no se debe decidir qué publicar interpretando parcialmente un patrón de Cloudflare.

/** El archivo de Cloudflare que decide qué recursos de la web no se publican. */
export const ARCHIVO_EXCLUSIONES_WEB = '.assetsignore';

/** Un patrón que no se puede interpretar con las reglas compartidas de publicación. */
export class PatronDeExclusionNoAdmitido extends Error {
  override name = 'PatronDeExclusionNoAdmitido';
}

/** Un patrón positivo: con «/» al principio o en medio se ancla a la raíz (gitignore). */
function patronDeExclusion(linea: string): RegExp {
  const dobleAsteriscoFueraDeTramo = linea.split('/').some((tramo) => tramo.includes('**') && tramo !== '**');
  if (/[![\]\\]/.test(linea) || linea.includes('\u0000') || linea.includes('\u0001') || dobleAsteriscoFueraDeTramo) {
    throw new PatronDeExclusionNoAdmitido(`Patrón de ${ARCHIVO_EXCLUSIONES_WEB} no admitido: ${linea}`);
  }
  const anclado = linea.startsWith('/') || linea.slice(0, -1).includes('/');
  // Los marcadores separan los comodines de las expresiones que los representan; «**/» también admite cero carpetas.
  const cuerpo = linea
    .replace(/^\//, '')
    .replace(/\/$/, '/**')
    .replace(/[.+^${}()|]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll('\u0001', '(?:.*/)?')
    .replaceAll('\u0000', '.*');
  return new RegExp(`${anclado ? '^' : '(?:^|/)'}${cuerpo}(?:/.*)?$`);
}

/**
 * Los patrones de exclusión del contenido leído; las líneas vacías y los comentarios no son patrones.
 *
 * @param contenido - El texto del archivo de exclusiones, una línea por patrón.
 * @returns Una expresión regular por patrón.
 * @throws {PatronDeExclusionNoAdmitido} Si un patrón usa una sintaxis que no se admite.
 */
export function exclusionesDeArchivos(contenido: string): RegExp[] {
  return contenido
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !linea.startsWith('#'))
    .map(patronDeExclusion);
}
