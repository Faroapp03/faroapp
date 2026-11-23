import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentariosHtml } from './etiquetas.ts';

const MAPA = /<script type="importmap">([\s\S]*?)<\/script>/;
const MAPAS = new RegExp(MAPA.source, 'g');
/** Una lista de huellas CSP de mapas: una o más `'sha256-<base64>'` separadas por un espacio, y nada más. */
export const HUELLA_MAPA = /^'sha256-[A-Za-z0-9+/]{43}='(?: 'sha256-[A-Za-z0-9+/]{43}=')*(?![\s\S])/;

/**
 * La huella CSP de un texto en línea: sha256 en base64, entre comillas simples como la escribe la directiva.
 *
 * @param texto - El contenido del bloque en línea.
 * @returns La huella entre comillas simples, en la forma `'sha256-<base64>'`.
 */
export function huellaCsp(texto: string): string {
  return `'sha256-${createHash('sha256').update(texto).digest('base64')}'`;
}

/**
 * El texto del mapa de una página, o null si no lo tiene.
 *
 * @param html - El HTML de una página.
 * @returns El texto del mapa, o null si la página no lo tiene.
 */
export function textoDelMapa(html: string): string | null {
  return MAPA.exec(html)?.[1] ?? null;
}

/**
 * Las huellas CSP de todos los mapas no comentados de las páginas de una web construida (sin repetir y ordenadas):
 * las que tiene que admitir la CSP de quien la sirva.
 *
 * @param web - La carpeta de la web construida.
 * @returns Las huellas, en la forma `'sha256-<base64>'`.
 */
export function huellasDeLosMapas(web: string): string[] {
  const huellas = readdirSync(web, { recursive: true, encoding: 'utf8' })
    .filter((archivo) => archivo.endsWith('.html'))
    .flatMap((archivo) =>
      [...sinComentariosHtml(readFileSync(join(web, archivo), 'utf8')).matchAll(MAPAS)].map(([, mapa]) =>
        huellaCsp(mapa ?? ''),
      ),
    );
  return [...new Set(huellas)].sort();
}
