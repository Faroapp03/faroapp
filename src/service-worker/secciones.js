import './catalogo.js';
import { BASE, urlDe } from './catalogo.js';
import {
  CSP_DE_LAS_PAGINAS,
  claveDeCopia,
  consultarAutoridadSecciones,
  PAGINAS_DEL_SERVICIO,
  rutaFueraDeLaCopia,
  seccionDeLaRuta,
} from './politica.js';

/** La política pertenece a la entidad, no a VERSION ni a las preferencias personales. */
const COPIA_SECCIONES = `faro-secciones-v3:${BASE.href}`;
const URL_SECCIONES = urlDe('secciones-v3.json');
const PLAZO_SECCIONES_MS = 3000;
const HTTP_SECCIONES = { correcto: 200, retirada: 404, noDisponible: 503 };
/** @type {import('../../web/scripts/secciones-publicas.js').MemoriaAutoridad} */
const memoriaSecciones = { actual: null, porAutoridad: new Map(), soloMemoria: false };
/** La autoridad y su revisión se leen y escriben bajo el mismo lock que la página. */
async function disponibilidadSecciones() {
  return consultarAutoridadSecciones({
    url: URL_SECCIONES,
    memoria: memoriaSecciones,
    abrir: () => caches.open(COPIA_SECCIONES),
    solicitar: () =>
      fetch(URL_SECCIONES, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(PLAZO_SECCIONES_MS) }),
    // Web Locks está en todo navegador que puede ejecutar este service worker: es anterior a AbortSignal.timeout,
    // que usa esta misma consulta, en los tres motores.
    bloquear: (accion) => navigator.locks.request(COPIA_SECCIONES, accion),
  });
}

/** @param {string} clave */
function seccionDeLaClave(clave) {
  return seccionDeLaRuta(`/${new URL(clave).pathname.slice(BASE.pathname.length)}`);
}
/** Página neutra de un estado del service worker, en castellano y en catalán, sin recursos externos ni contenido de una
 * sección retirada. Su texto sale de los diccionarios en la construcción (politica-del-servicio.ts).
 * @param {number} estado
 * @param {'sin-conexion' | 'no-comprobada' | 'retirada' | 'otra-version' | 'acceso-sin-conexion'} nombre
 *   El estado, con su texto en ESTADOS_DEL_SERVICIO (politica-del-servicio.ts).
 */
function paginaDeEstado(estado, nombre) {
  return new Response(PAGINAS_DEL_SERVICIO[nombre].replaceAll('{{inicio}}', urlDe('inicio.html')), {
    status: estado,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': CSP_DE_LAS_PAGINAS,
    },
  });
}
/** Mensaje que envía scripts/instalacion.js para activar la versión que espera. */
const ACTIVAR_VERSION_NUEVA = 'ACTIVATE_UPDATE';
/** Desde este estado, la respuesta es un fallo del servidor (5xx). */
const PRIMER_FALLO_DEL_SERVIDOR = 500;

/** Reserva también los alias de páginas que la política genérica de caché excluye por su forma.
 * @param {Request} peticion @param {URL} url
 */
function seccionPublicaDePeticion(peticion, url) {
  if (peticion.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) {
    return undefined;
  }
  const seccion = seccionDeLaClave(claveDeCopia(url, BASE));
  const exigeRed = rutaFueraDeLaCopia(url.pathname.slice(BASE.pathname.length));
  return seccion === 'recorrido' && exigeRed ? undefined : seccion;
}

export {
  ACTIVAR_VERSION_NUEVA,
  disponibilidadSecciones,
  HTTP_SECCIONES,
  PRIMER_FALLO_DEL_SERVIDOR,
  paginaDeEstado,
  seccionDeLaClave,
  seccionPublicaDePeticion,
};
