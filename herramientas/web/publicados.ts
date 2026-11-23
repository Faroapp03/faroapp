// Qué se publica de la web: los archivos de web/ salvo los que excluye web/.assetsignore, la misma lista que lee
// Cloudflare al subir los recursos. Todas las comprobaciones de la web leen de aquí.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVO_EXCLUSIONES_WEB, exclusionesDeArchivos } from '../../src/comun/exclusiones-de-archivos.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';

/** La carpeta web/ del repositorio, con «/» al final. */
export const WEB = RUTAS.web;
/** El service worker: se publica, pero el navegador lo pide siempre a la red y sus listas se revisan aparte. */
export const SERVICE_WORKER = 'service-worker.js';
/**
 * Lo que solo genera la construcción en la web construida: el motor (el empaquetado con esbuild), el paquete de datos
 * (herramientas/publicar-paquete.ts) y el manifiesto del dispositivo. No entran en la lista de lo publicado a mano: el
 * motor llega a las comprobaciones como bytes de referencia (ContextoWeb.motor, el empaquetado), y el paquete, con las
 * huellas de su manifiesto. web:comprobar exige que no estén en las fuentes de web/.
 */
const GENERADOS = /^(motor|paquete|firmas)\//;

/**
 * El contenido de un archivo de web/, por su ruta desde web/.
 *
 * @param archivo - La ruta desde web/.
 * @param web - La raíz de lectura; por defecto, web/ de la instalación.
 * @returns El contenido, en UTF-8.
 */
export function leer(archivo: string, web: string = WEB): string {
  return readFileSync(join(web, archivo), 'utf8');
}

/**
 * Todos los archivos de una carpeta de web/ y de sus subcarpetas, se publiquen o no. La recursión baja una carpeta en
 * cada llamada y no sigue enlaces simbólicos (un enlace no es un directorio para Dirent): la acota la profundidad del
 * árbol de web/.
 *
 * @param carpeta - La carpeta desde web/; vacía, la raíz.
 * @param web - La raíz de lectura; por defecto, web/ de la instalación.
 * @returns Las rutas de los archivos, desde web/.
 */
export function listar(carpeta = '', web: string = WEB): string[] {
  return readdirSync(join(web, carpeta), { withFileTypes: true }).flatMap((entrada) => {
    const ruta = carpeta ? `${carpeta}/${entrada.name}` : entrada.name;
    return entrada.isDirectory() ? listar(ruta, web) : [ruta];
  });
}

/**
 * Los archivos que se publican y se escriben a mano, en orden alfabético: los de web/ que no excluye .assetsignore,
 * sin los que se generan al desplegar (GENERADOS).
 *
 * @param web - La raíz de lectura; por defecto, web/ de la instalación.
 * @returns Las rutas, desde web/, en orden alfabético.
 */
export function archivosPublicados(web: string = WEB): string[] {
  const patrones = exclusionesDeArchivos(leer(ARCHIVO_EXCLUSIONES_WEB, web));
  return listar('', web)
    .filter((archivo) => !patrones.some((patron) => patron.test(archivo)) && !GENERADOS.test(archivo))
    .sort();
}
