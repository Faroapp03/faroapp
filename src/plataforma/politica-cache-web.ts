// Rutas operativas que la copia pública no puede guardar ni interceptar. Esta política se publica también como
// guion clásico del service worker; el constructor de la copia y el fetch del navegador comparten la misma decisión.
// Las extensiones instaladas se leen del registro; la publicación clásica lo sustituye por una copia de sus datos.
import { EXTENSIONES } from './extensiones.ts';

const RUTAS_OPERATIVAS = /^(?:api|mcp|a2a|oauth|avisos-del-navegador|cdn-cgi)(?:\/|$)/;
const METADATOS_DEL_SERVIDOR =
  /^(?:capacidades-panel\.json|secciones-v3\.json|configuracion\.json|secciones\.json|openapi\.json|llms\.txt|\.well-known\/(?:agent-card\.json|api-catalog|oauth-authorization-server|oauth-protected-resource))(?:\/|$)/;
const PAGINAS_DE_ACCESO = /^(?:acceso-web|activar-acceso\.html|administracion(?:\.html)?)(?:\/|$)/;
const RECURSOS_DE_ACCESO = /^(?:scripts|estilos)\/(?:activar-acceso|administracion)(?:\.(?:js|css)(?:\/|$)|\/|$)/;

// El estado público funciona sin conexión; solo su respuesta dinámica queda fuera.
// Estos dos módulos manejan secretos de invitación y pertenecen a la activación privada.
const MODULOS_DE_INVITACION = /^scripts\/conectividad\/(?:invitacion|fragmento)\.js(?:\/|$)/;

/** La carpeta de la web de una extensión: el primer segmento de su entrada.
 * @param {string} entrada @returns {string}
 */
function carpetaDe(entrada: string): string {
  return entrada.slice(0, entrada.indexOf('/'));
}

/** Una ruta literal dentro de una expresión regular.
 * @param {string} texto @returns {string}
 */
function literal(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// El servidor decide qué recorrido es público. Una copia anterior no puede autorizar su entrada ni otra variante: las
// variantes de las extensiones y su modo quedan fuera de la copia, y las entradas se piden siempre a la red
// (esNavegacionRecorrido). Sin red, solo una instalación pública, que no tiene otras variantes, abre la del recorrido real
// desde su copia.
const RECORRIDOS = [...EXTENSIONES.map(({ entrada }) => literal(carpetaDe(entrada))), 'modo-recorrido\\.json'];
const RECORRIDOS_CON_AUTORIZACION = new RegExp(`^(?:${RECORRIDOS.join('|')})(?:\\/|$)`, 'i');

/** Las entradas del recorrido real y de cada extensión, en minúsculas: carpeta, página sin extensión y página. */
const ENTRADAS_DEL_RECORRIDO = [
  'recorrido',
  'recorrido.html',
  ...EXTENSIONES.flatMap(({ entrada }) => [carpetaDe(entrada), entrada.replace(/\.html$/, ''), entrada]),
].map((ruta) => ruta.toLowerCase());

/**
 * Si una ruta relativa a la raíz web queda fuera de la copia pública. Recibe solo el pathname relativo, sin consulta
 * ni fragmento, como lo entrega URL.pathname o el inventario de publicación. Se descodifica una vez; una codificación
 * ilegible o una ruta que no es relativa no se interpreta como recurso público.
 * @param {string} ruta
 * @returns {boolean}
 */
export function rutaFueraDeLaCopia(ruta: string): boolean {
  let descodificada: string;
  try {
    descodificada = decodeURIComponent(ruta);
  } catch (error) {
    if (error instanceof URIError) {
      return true;
    }
    throw error;
  }
  if (descodificada.startsWith('/') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(descodificada)) {
    return true;
  }
  return (
    RUTAS_OPERATIVAS.test(descodificada) ||
    METADATOS_DEL_SERVIDOR.test(descodificada) ||
    PAGINAS_DE_ACCESO.test(descodificada) ||
    RECURSOS_DE_ACCESO.test(descodificada) ||
    MODULOS_DE_INVITACION.test(descodificada) ||
    RECORRIDOS_CON_AUTORIZACION.test(descodificada)
  );
}

/** Solo las lecturas de esta instalación pueden emplear su copia.
 * @param {Request} peticion @param {URL} url @param {URL} base @returns {boolean}
 */
export function esDeLaWeb(peticion: Request, url: URL, base: URL): boolean {
  return (
    peticion.method === 'GET' &&
    url.origin === base.origin &&
    url.pathname.startsWith(base.pathname) &&
    !rutaFueraDeLaCopia(url.pathname.slice(base.pathname.length))
  );
}

/** Las entradas del recorrido real y de las extensiones conservan su navegación por red con el servicio activo.
 * @param {string} ruta @returns {boolean}
 */
export function rutaEsEntradaRecorrido(ruta: string): boolean {
  let decodificada: string;
  try {
    decodificada = decodeURIComponent(ruta).replaceAll('\\', '/').toLowerCase();
  } catch {
    return false;
  }
  if (decodificada.startsWith('/') || decodificada.includes('%')) {
    return false;
  }
  const partes: string[] = [];
  for (const parte of decodificada.split('/')) {
    if (parte === '..') {
      partes.pop();
    } else if (parte && parte !== '.') {
      partes.push(parte);
    }
  }
  return ENTRADAS_DEL_RECORRIDO.includes(partes.join('/'));
}

/** Solo las navegaciones de entrada se responden explícitamente por red.
 * @param {Request} peticion @param {URL} url @param {URL} base @returns {boolean}
 */
export function esNavegacionRecorrido(peticion: Request, url: URL, base: URL): boolean {
  return (
    peticion.method === 'GET' &&
    peticion.mode === 'navigate' &&
    url.origin === base.origin &&
    url.pathname.startsWith(base.pathname) &&
    rutaEsEntradaRecorrido(url.pathname.slice(base.pathname.length))
  );
}

/**
 * Clave de la copia pública, sin consulta ni fragmento; la raíz representa la página de inicio.
 * @param {URL} url
 * @param {URL} base
 * @returns {string}
 */
export function claveDeCopia(url: URL, base: URL): string {
  const limpia = new URL(url);
  limpia.search = '';
  limpia.hash = '';
  if (limpia.pathname === base.pathname) {
    limpia.pathname += 'inicio.html';
  }
  return limpia.href;
}
