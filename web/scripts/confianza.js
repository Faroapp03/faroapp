// Tipos de confianza (Trusted Types): la política de contenidos de la web (src/plataforma/cabeceras-web.ts) exige
// que todo texto que el navegador vaya a convertir en HTML o en la dirección de un guion pase antes por una política
// con nombre. Estas dos son las únicas, y cada una admite solo lo que la web necesita de verdad:
//   faro-guiones   las direcciones de los guiones que la web arranca: el service worker, los workers del motor, del
//                  motor de cursos (anidado en el del motor). Se rechazan los destinos que no pasan guionAdmitido; la consulta y
//                  el fragmento no se comparan.
//   faro-informe   el informe que pinta el motor, ya escapado, antes de insertarlo con innerHTML. Se admite el
//                  HTML compatible con esta lectura del informe (src/presentacion/): sus etiquetas, sus atributos
//                  y sus esquemas de dirección, de listas cerradas, con su sintaxis exacta (comillas dobles, uno o más
//                  blancos HTML antes de cada atributo, referencias de carácter terminadas en «;»). Lo que no encaja no
//                  se arregla: se rechaza entero, sin reparar ni reconstruir el árbol que después interpretará el
//                  navegador.
// El resto del texto entra con textContent o con construcción de nodos, sin interpretar HTML. Sin Trusted Types,
// se devuelve la misma dirección o el mismo HTML, revisados igualmente (la dirección, normalizada). La CSP frena
// lo ejecutable aunque algo pasara: estas políticas son la segunda línea.

import { HtmlNoAdmitido, informeAdmitido } from './confianza/informe.js';

export { HtmlNoAdmitido };

/** Los nombres de las políticas, los mismos que la directiva trusted-types de la CSP. */
export const POLITICAS = /** @type {const} */ (['faro-guiones', 'faro-informe']);
/** El nombre de cada política, por su papel: el orden de POLITICAS. */
const [POLITICA_DE_GUIONES, POLITICA_DEL_INFORME] = POLITICAS;

/** Las rutas de los guiones propios que se arrancan desde un script, dentro de la web. */
const GUIONES_PROPIOS = new Set([
  'service-worker.js',
  'scripts/motor-local/worker.js',
  'motor/src/plataforma/navegador/trabajador-de-cursos.js',
]);

/** La raíz de la web: la carpeta de este archivo es scripts/. */
const RAIZ = new URL('../', import.meta.url);

/**
 * Una política de Trusted Types (TrustedTypePolicy), con lo que usa la web. Trusted Types no está en los tipos del DOM
 * de TypeScript, así que se describe aquí; cada método lanza si la política no tiene su regla.
 * @typedef {{ createScriptURL(texto: string): unknown, createHTML(texto: string): unknown }} Politica
 */
/**
 * La fábrica de políticas del navegador (`globalThis.trustedTypes`, TrustedTypePolicyFactory).
 * @typedef {{ createPolicy(nombre: string, reglas: Record<string, (texto: string) => string>): Politica }} Fabrica
 */
/** @typedef {{ guiones: Politica, informe: Politica }} Politicas */

/** Un guion que no es el service worker ni un worker propio admitido. */
export class GuionNoAdmitido extends TypeError {}

/**
 * La dirección, si es un guion admitido; si no, un error.
 * @param {string} direccion
 * @returns {string}
 */
function guionAdmitido(direccion) {
  const url = new URL(direccion, RAIZ);
  const propio =
    url.origin === RAIZ.origin &&
    url.pathname.startsWith(RAIZ.pathname) &&
    GUIONES_PROPIOS.has(url.pathname.slice(RAIZ.pathname.length));
  if (!propio) {
    throw new GuionNoAdmitido(`Guion no admitido: ${direccion}`);
  }
  return url.href;
}

/**
 * Las políticas, creadas una sola vez (lasPoliticas, la primera vez que se piden); null si el navegador no tiene
 * Trusted Types.
 * @type {Politicas | null | undefined}
 */
let politicas;

/**
 * Si el valor es una fábrica de políticas de Trusted Types (tiene `createPolicy`).
 * @param {unknown} valor El valor de `globalThis.trustedTypes`.
 * @returns {valor is Fabrica} Si se puede usar como fábrica.
 */
function esFabrica(valor) {
  return (
    typeof valor === 'object' && valor !== null && 'createPolicy' in valor && typeof valor.createPolicy === 'function'
  );
}

/**
 * Las dos políticas, creadas la primera vez que se piden.
 * @returns {Politicas | null} Las políticas, o null si el navegador no tiene Trusted Types.
 */
function lasPoliticas() {
  if (politicas !== undefined) {
    return politicas;
  }
  /** @type {unknown} */
  const fabrica = Reflect.get(globalThis, 'trustedTypes');
  politicas = esFabrica(fabrica)
    ? {
        guiones: fabrica.createPolicy(POLITICA_DE_GUIONES, { createScriptURL: guionAdmitido }),
        informe: fabrica.createPolicy(POLITICA_DEL_INFORME, { createHTML: informeAdmitido }),
      }
    : null;
  return politicas;
}

/**
 * La dirección de un guion propio, lista para new Worker, serviceWorker.register o script.src.
 * @param {string | URL} direccion
 * @returns {string}
 */
export function urlDeGuion(direccion) {
  const texto = String(direccion);
  const politica = lasPoliticas()?.guiones;
  // Un TrustedScriptURL no está en los tipos del DOM: el navegador lo admite donde va la dirección de un guion, y para
  // TypeScript se nombra como lo que sustituye, un texto.
  return /** @type {string} */ (politica ? politica.createScriptURL(texto) : guionAdmitido(texto));
}

/**
 * El informe del motor, listo para innerHTML.
 * @param {unknown} html
 * @returns {string}
 */
export function htmlDeConfianza(html) {
  if (typeof html !== 'string') {
    throw new HtmlNoAdmitido('El informe trae HTML que la web no admite (se esperaba texto)');
  }
  const politica = lasPoliticas()?.informe;
  // Lo mismo con TrustedHTML, que el navegador admite en innerHTML.
  return /** @type {string} */ (politica ? politica.createHTML(html) : informeAdmitido(html));
}
