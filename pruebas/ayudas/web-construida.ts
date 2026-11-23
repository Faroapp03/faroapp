/**
 * La web construida que leen las pruebas: `.web-local/web`, la que deja `npm run web:preparar` (construir --local),
 * solo si salió de las fuentes actuales. Lo generado (el service worker con sus catálogos, el marcador, la barrera con
 * su huella y el motor) ya no está en web/.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebConstruida } from '../../herramientas/cloudflare/comprobar-construccion.ts';
import { contextoDeLaWebLocal, webLocalVigente } from '../../herramientas/web/construir.ts';
import { textoDelMapa } from '../../herramientas/web/huellas-de-los-mapas.ts';

let web: string | undefined;
let huellaMapaModulos: string | undefined;

/**
 * @returns La carpeta de la web local construida desde las fuentes actuales.
 * @throws {Error} Si falta o salió de otras fuentes: hay que ejecutar antes npm run web:preparar.
 */
export function webConstruida(): string {
  const vigente = web === undefined ? webLocalVigente() : undefined;
  web ??= vigente?.web;
  huellaMapaModulos ??= vigente?.huellaMapaModulos;
  if (web === undefined) {
    throw new Error('Falta la web local de estas fuentes (.web-local/): ejecuta antes npm run web:preparar');
  }
  return web;
}

/** @returns La web local construida como contexto de una construcción (construir.ts, contextoDeLaWebLocal). */
export function contextoConstruido(): WebConstruida {
  return contextoDeLaWebLocal();
}

/** @returns El service worker publicado en la web local construida. */
export function servicioPublicado(): string {
  return readFileSync(join(webConstruida(), 'service-worker.js'), 'utf8');
}

/**
 * La entrada de una página construida: el módulo que carga, con su SRI comprobado contra sus bytes publicados.
 *
 * @param pagina - La página, desde la raíz de la web.
 * @returns La ruta de su entrada, desde la raíz de la web.
 */
export function entradaConSri(pagina: string): string {
  const web = webConstruida();
  const html = readFileSync(join(web, pagina), 'utf8');
  const entrada = /<script type="module" src="\/?([^"]+)" integrity="(sha384-[A-Za-z0-9+/]{64})"/.exec(html);
  if (!entrada?.[1] || !entrada[2]) {
    throw new Error(`${pagina}: la página construida no carga su entrada con SRI`);
  }
  const bytes = readFileSync(join(web, entrada[1]));
  if (`sha384-${createHash('sha384').update(bytes).digest('base64')}` !== entrada[2]) {
    throw new Error(`${pagina}: el SRI de ${entrada[1]} no es el de sus bytes`);
  }
  return entrada[1];
}

/**
 * Los módulos que carga una página construida, por su mapa de módulos, desde la raíz de la web.
 *
 * @param pagina - La página, desde la raíz de la web.
 */
export function modulosDelMapa(pagina: string): string[] {
  const mapa = textoDelMapa(readFileSync(join(webConstruida(), pagina), 'utf8'));
  const { integrity = {} } = JSON.parse(mapa ?? '{}') as { integrity?: Record<string, string> };
  return Object.keys(integrity).map((ruta) => ruta.replace(/^\.\//, ''));
}

/** @returns Las huellas CSP de los mapas de la web local construida (su construccion.json). */
export function huellaDeLaWebConstruida(): string {
  webConstruida();
  if (huellaMapaModulos === undefined) {
    throw new Error('Falta la huella de los mapas de la web local: ejecuta antes npm run web:preparar');
  }
  return huellaMapaModulos;
}
