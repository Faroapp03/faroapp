import './copia.js';
import {
  BASE,
  COPIA,
  ENTRADA_DEL_RECORRIDO,
  GUARDABLES,
  HUELLAS_DE_LA_COPIA,
  HUELLAS_DE_PAGINAS,
  REDUCIDAS,
  SIN_CONEXION,
  urlDe,
} from './catalogo.js';
import {
  anotarEscrituraEnLaCopia,
  deEstaVersion,
  HuellaQueNoCoincide,
  marcadaPorElAcceso,
  modoDeLaCopia,
  noSirveComoCopia,
  siEstaProtegido,
} from './copia.js';
import { anotarElRecorrido, estadoDelRecorrido, modoDeLaInstalacion } from './modo.js';
import { cuadraLaEntradaGuardada } from './paquete.js';
import { paginaDeLaRuta, rutaFueraDeLaCopia } from './politica.js';
import { disponibilidadSecciones, HTTP_SECCIONES, PRIMER_FALLO_DEL_SERVIDOR, paginaDeEstado } from './secciones.js';

/**
 * Lo guardado para `clave`; si es una fotografía grande que no se llegó a ver, su versión de 800 px.
 *
 * @param {Cache} copia - La copia de esta versión.
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @returns {Promise<Response | undefined>}
 */
async function buscarEnLaCopia(copia, clave) {
  const guardada = await guardadaQueCuadra(copia, clave);
  const reducida = REDUCIDAS.get(clave);
  if (guardada || !reducida) {
    return guardada;
  }
  return guardadaQueCuadra(copia, reducida);
}

/**
 * Lo guardado para `clave`, solo si sus bytes siguen siendo los de esta versión (HUELLAS_DE_LA_COPIA), como lo
 * comprobado («Lo comprobado», desdeLoComprobado): la copia del navegador la puede tocar cualquier script de la web, y un
 * script o un estilo alterado lo bloquearía la huella SRI de la página sin que nada lo reparase. Lo que no cuadra se
 * descarta de la copia y se deja en la consola; quien llama lo pide a la red, y lo que traiga, si es de esta versión,
 * vuelve a la copia (guardarSiEsDeEstaVersion). Se vuelve a calcular la huella cada vez, sin memoria de lo ya
 * comprobado: la copia puede cambiar entre dos peticiones, y el coste es pequeño frente a leer la entrada.
 *
 * @param {Cache} copia - La copia de esta versión.
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @returns {Promise<Response | undefined>}
 */
async function guardadaQueCuadra(copia, clave) {
  const guardada = await copia.match(clave);
  const huella = HUELLAS_DE_LA_COPIA.get(clave);
  if (!guardada || huella === undefined) {
    return guardada;
  }
  const servida = guardada.clone();
  if (await cuadraLaEntradaGuardada(guardada, huella)) {
    return servida;
  }
  console.warn(`Faro: ${clave} ha cambiado en la copia sin conexión; se descarta y se pide a la red.`);
  await copia.delete(clave);
  anotarEscrituraEnLaCopia();
  return undefined;
}

/**
 * Si `error` es un fallo esperado al pedir algo a la red: la red misma, marcada al pedir o al leer (FalloDeLaRed), unos
 * bytes que no son de esta versión (HuellaQueNoCoincide) o una respuesta que no sirve como copia (RespuestaQueNoSirve).
 * Lo demás, también un TypeError del programa, es un fallo del programa y no se hace pasar por falta de conexión. Se
 * distinguen por el nombre, no por la clase, como el rechazo de fetch, que puede ser de otro reino.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function esFalloDeLaRed(error) {
  return typeof error === 'object' && error !== null && FALLOS_ESPERADOS.has(nombreDelError(error));
}
const FALLOS_ESPERADOS = new Set(['FalloDeLaRed', 'HuellaQueNoCoincide', 'RespuestaQueNoSirve']);
/** Con lo que rechazan fetch y la lectura de un cuerpo cuando falla la red: TypeError, o AbortError y TimeoutError. */
const RECHAZOS_DE_LA_RED = new Set(['TypeError', 'AbortError', 'TimeoutError']);

/** @param {unknown} error */
const nombreDelError = (error) =>
  typeof error === 'object' && error !== null ? String(Reflect.get(error, 'name')) : '';

/** La red no ha contestado o el cuerpo no ha llegado entero (pedirALaRed, leerDeLaRed). */
class FalloDeLaRed extends Error {
  /** @param {unknown} causa */
  constructor(causa) {
    super('La red no ha contestado.', { cause: causa });
    this.name = 'FalloDeLaRed';
  }
}

/**
 * fetch, con su rechazo de red marcado (FalloDeLaRed): así solo el fallo de la red se trata como falta de conexión.
 *
 * @param {RequestInfo} peticion @param {RequestInit} [opciones]
 * @returns {Promise<Response>}
 */
async function pedirALaRed(peticion, opciones) {
  try {
    return await fetch(peticion, opciones);
  } catch (error) {
    throw RECHAZOS_DE_LA_RED.has(nombreDelError(error)) ? new FalloDeLaRed(error) : error;
  }
}

/**
 * `respuesta` con su cuerpo ya leído; si la red se corta mientras llega, FalloDeLaRed.
 *
 * @param {Response} respuesta
 * @returns {Promise<Response>}
 */
async function leerDeLaRed(respuesta) {
  /** @type {ArrayBuffer} */
  let bytes;
  try {
    bytes = await respuesta.arrayBuffer();
  } catch (error) {
    throw RECHAZOS_DE_LA_RED.has(nombreDelError(error)) ? new FalloDeLaRed(error) : error;
  }
  return new Response(bytes, {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: respuesta.headers,
  });
}

/** Lo que llega de la red no sirve como copia de esta versión (noSirveComoCopia, deEstaVersion). */
class RespuestaQueNoSirve extends Error {
  /** @param {string} mensaje @param {unknown} [causa] */
  constructor(mensaje, causa) {
    super(mensaje, { cause: causa });
    this.name = 'RespuestaQueNoSirve';
  }
}

/**
 * Sin red: lo guardado; si es una página que no está, la de sin conexión; si no, un 503 explicado.
 *
 * @param {Cache} copia - La copia de esta versión.
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @param {boolean} navegacion - Si la petición es una navegación entre páginas.
 * @returns {Promise<Response>}
 */
async function desdeLaCopia(copia, clave, navegacion) {
  const guardada = await buscarEnLaCopia(copia, clave);
  if (guardada) {
    return guardada;
  }
  if (navegacion) {
    return paginaSinConexion(copia);
  }
  return new Response('Recurso no disponible sin conexión.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Primero la copia, y la copia es de una sola versión: todo lo que se pinta en una página sale de la misma, así que
 * nunca se mezclan un estilo de una versión y un HTML de otra. Lo que no está guardado (una fotografía grande que nadie
 * ha visto, una ruta que no es de la web) se pide a la red; si el navegador dice que no hay conexión, lo que es de la
 * copia y falta en ella no se pide (responder). Las secciones administrables comprueban su disponibilidad.
 *
 * @param {FetchEvent} evento - La petición que se atiende.
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @param {boolean} navegacion - Si la petición es una navegación entre páginas.
 * @returns {Promise<Response>}
 */
async function responderDesdeLaCopia(evento, clave, navegacion) {
  const copia = await caches.open(COPIA);
  // Lo guardado para esta clave exactamente: una fotografía grande que no se ha visto se pide a la red, y solo si no
  // hay red, o si el navegador dice que no hay conexión, se sirve su versión de 800 px (desdeLaCopia).
  return (await guardadaQueCuadra(copia, clave)) ?? responder(evento, clave, navegacion);
}

/**
 * La entrada de un recorrido (esNavegacionRecorrido, politica.js): el servidor decide qué variante entra, así que se
 * pide siempre a la red y su respuesta se entrega tal cual, también una redirección o un rechazo. Si es la entrada del
 * recorrido real, lo que contesta se anota en segundo plano (guardarLaEntradaDelRecorrido): con el acceso temporal,
 * sale de la copia; con la página de esta versión, entra en la copia, si no llegó al instalar. Sin red:
 * - en una instalación pública (modoDeLaInstalacion, modo.js), la del recorrido real sale de la copia como
 *   la página de su sección, con su política y su huella (responderSeccion); si no está, la página de sin conexión;
 * - la del recorrido real protegido (estadoDelRecorrido) y cualquier entrada detrás de un portal, la página de estado
 *   con 503 que dice que hace falta conexión; la de una extensión, que no entra en la copia, la de sin conexión;
 * nunca el error del navegador. Un fallo del programa se relanza.
 *
 * @param {FetchEvent} evento - La navegación a la entrada.
 * @param {URL} url - Su dirección.
 * @returns {Promise<Response>}
 */
async function responderEntradaDelRecorrido(evento, url) {
  const peticion = evento.request;
  const real = !rutaFueraDeLaCopia(url.pathname.slice(BASE.pathname.length));
  try {
    const respuesta = await pedirALaRed(peticion);
    if (real) {
      evento.waitUntil(guardarLaEntradaDelRecorrido(respuesta.clone()));
    }
    return respuesta;
  } catch (error) {
    if (nombreDelError(error) !== 'FalloDeLaRed') {
      throw error;
    }
  }
  if ((await modoDeLaInstalacion(await caches.open(COPIA))) !== 'publica') {
    return paginaDeEstado(HTTP_SECCIONES.noDisponible, 'acceso-sin-conexion');
  }
  if (!real) {
    return paginaSinConexion(await caches.open(COPIA));
  }
  if ((await estadoDelRecorrido()) === 'protegido') {
    return paginaDeEstado(HTTP_SECCIONES.noDisponible, 'acceso-sin-conexion');
  }
  return responderSeccion(urlDe(ENTRADA_DEL_RECORRIDO), 'recorrido', true);
}

/**
 * Anota lo que ha traído la red a la entrada del recorrido real. Con el acceso temporal, el recorrido real está
 * protegido y su página sale de la copia (siEstaProtegido). Con su página de esta versión (guardarSiEsDeEstaVersion:
 * la variante protegida, una extensión o el acceso de un portal no cuadran con su huella y no entran), entra en la
 * copia si no la tiene o si lo último anotado es «protegido», y se anota «activo». Es la misma para una instalación
 * pública y para una privada.
 *
 * @param {Response} respuesta - Lo que ha contestado el servidor a la entrada, sin leer.
 * @returns {Promise<void>}
 */
async function guardarLaEntradaDelRecorrido(respuesta) {
  const clave = urlDe(ENTRADA_DEL_RECORRIDO);
  if (!GUARDABLES.has(clave) || (await siEstaProtegido(respuesta))) {
    return;
  }
  if (respuesta.status !== HTTP_SECCIONES.correcto || noSirveComoCopia(clave, respuesta)) {
    return;
  }
  const copia = await caches.open(COPIA);
  if ((await estadoDelRecorrido()) !== 'protegido' && (await guardadaQueCuadra(copia, clave))) {
    return;
  }
  if (await guardarSiEsDeEstaVersion(copia, clave, respuesta)) {
    await anotarElRecorrido('activo');
  }
}

/**
 * La página de sin conexión de la copia, comprobada (guardadaQueCuadra), o, si falta o ha cambiado, la página de estado
 * del propio service worker, sin nada de la copia.
 *
 * @param {Cache} copia - La copia de esta versión.
 * @returns {Promise<Response>}
 */
async function paginaSinConexion(copia) {
  return (await guardadaQueCuadra(copia, SIN_CONEXION)) ?? paginaDeEstado(HTTP_SECCIONES.noDisponible, 'sin-conexion');
}

/** La página propia y los alias conservan el veredicto del servidor: no se inventan rutas al normalizarlos.
 * Solo el HTML de la página (la propia o la que nombra el alias, paginaDelAlias), de esta versión, puede incorporarse
 * a la copia.
 * @param {string} clave
 */
async function descargarPaginaSeccion(clave) {
  // La página con su nombre se pide como al instalar (modoDeLaCopia: las páginas, sin la caché HTTP); el alias, sin la
  // caché HTTP. Las dos, sin seguir redirecciones: lo que no es un 200 (un error, un cierre o una redirección) y lo que
  // entrega el acceso temporal al recorrido (marcadaPorElAcceso) se devuelven tal cual, y el navegador sigue la
  // redirección por su cuenta.
  const pagina = HUELLAS_DE_PAGINAS.has(clave) ? new URL(clave).pathname.slice(BASE.pathname.length) : undefined;
  const modo = pagina === undefined ? 'reload' : modoDeLaCopia(pagina);
  const respuesta = await pedirALaRed(new Request(clave, { cache: modo, redirect: 'manual' }));
  if (respuesta.status !== HTTP_SECCIONES.correcto || marcadaPorElAcceso(respuesta)) {
    return respuesta;
  }
  // Lo que entrega tiene que ser su página, con los bytes de esta versión: las mismas reglas que cualquier otro archivo
  // de la copia.
  const archivo = pagina ?? paginaDelAlias(clave);
  const leida = await leerDeLaRed(respuesta);
  // deEstaVersion rechaza con un Error simple lo que no es la página de esta versión («no es una página HTML», «no
  // tiene huella»), y con HuellaQueNoCoincide lo que no cuadra; los dos son de la respuesta, no del programa.
  return deEstaVersion(archivo, leida).catch((error) => {
    throw error?.constructor === Error ? new RespuestaQueNoSirve(error.message, error) : error;
  });
}

/**
 * La página que nombra el alias `clave`, desde la base de la web, con la regla del servidor (paginaDeLaRuta,
 * herramientas/web/politica-cache.ts). Si no nombra ninguna, lo que ha entregado no sirve como copia (RespuestaQueNoSirve):
 * lo que no se sabe de qué página es no entra en la copia.
 *
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @returns {string}
 */
function paginaDelAlias(clave) {
  const pagina = paginaDeLaRuta(`/${new URL(clave).pathname.slice(BASE.pathname.length)}`);
  if (pagina === undefined) {
    throw new RespuestaQueNoSirve(`${clave}: el alias no nombra ninguna página de una sección`);
  }
  return pagina.slice(1);
}

/**
 * La página de estado de una sección que no se ha podido traer de la red. Solo la falta de red es «sin conexión» (en
 * una navegación, la página de sin conexión de la copia, paginaSinConexion): unos bytes de otra publicación o lo que no
 * es una página HTML son de otra versión. Un fallo del programa se relanza.
 * @param {Cache} copia @param {string} clave @param {unknown} error @param {boolean} navegacion
 * @returns {Promise<Response>}
 */
async function paginaDelFallo(copia, clave, error, navegacion) {
  if (!esFalloDeLaRed(error)) {
    throw error;
  }
  console.warn(`Faro: ${clave} no se ha podido traer de la red.`, error);
  if (nombreDelError(error) !== 'FalloDeLaRed') {
    return paginaDeEstado(HTTP_SECCIONES.noDisponible, 'otra-version');
  }
  return navegacion ? paginaSinConexion(copia) : paginaDeEstado(HTTP_SECCIONES.noDisponible, 'sin-conexion');
}

/** La guardia precede incluso a una página ya guardada. No modifica el relato de pestañas abiertas.
 * @param {string} clave @param {import('../administracion/secciones-web.js').IdSeccionPublica} seccion
 * @param {boolean} [navegacion] - Si es una navegación: sin red, la página de sin conexión de la copia.
 */
async function responderSeccion(clave, seccion, navegacion = false) {
  const politica = await disponibilidadSecciones();
  if (politica.fallo || !politica.documento) {
    return paginaDeEstado(HTTP_SECCIONES.noDisponible, 'no-comprobada');
  }
  if (!politica.documento.secciones[seccion]) {
    return paginaDeEstado(HTTP_SECCIONES.retirada, 'retirada');
  }
  const copia = await caches.open(COPIA);
  const guardada = await guardadaQueCuadra(copia, clave);
  if (guardada) {
    return guardada;
  }
  /** @type {Response} */
  let respuesta;
  try {
    respuesta = await descargarPaginaSeccion(clave);
  } catch (error) {
    return paginaDelFallo(copia, clave, error, navegacion);
  }
  if (respuesta.status !== HTTP_SECCIONES.correcto || marcadaPorElAcceso(respuesta)) {
    await anotarSiEsLaEntrada(clave, respuesta);
    return respuesta;
  }
  // La retirada aprendida mientras llegaba el HTML prevalece sobre la descarga.
  const ultima = await disponibilidadSecciones();
  if (ultima.fallo || !ultima.documento) {
    return paginaDeEstado(HTTP_SECCIONES.noDisponible, 'no-comprobada');
  }
  if (!ultima.documento.secciones[seccion]) {
    return paginaDeEstado(HTTP_SECCIONES.retirada, 'retirada');
  }
  await copia.put(clave, respuesta.clone()).catch(() => undefined);
  anotarEscrituraEnLaCopia();
  await anotarSiEsLaEntrada(clave, respuesta);
  return respuesta;
}

/**
 * Si `clave` es la entrada del recorrido real, lo que demuestra de su estado lo que ha traído la red: el acceso
 * temporal (siEstaProtegido) o, con un 200 sin marca y ya comprobado contra su huella (descargarPaginaSeccion), «activo».
 *
 * @param {string} clave @param {Response} respuesta
 */
async function anotarSiEsLaEntrada(clave, respuesta) {
  if (clave !== urlDe(ENTRADA_DEL_RECORRIDO)) {
    return;
  }
  if (!(await siEstaProtegido(respuesta)) && respuesta.status === HTTP_SECCIONES.correcto) {
    await anotarElRecorrido('activo');
  }
}

/**
 * La red, para lo que no está en la copia; si falla, lo que haya guardado y, si es una página, la de sin conexión. Lo
 * que la red traiga y sea de esta versión se guarda en segundo plano (evento.waitUntil), sin retrasar la página: así
 * una fotografía grande ya vista, o un archivo que no se pudo guardar al instalar, quedan para la próxima vez.
 * Si el navegador dice que no hay conexión (sinConexionDeclarada), lo que es de la copia (GUARDABLES) no se pide a la
 * red y se responde como sin red: en el modo «Trabajar sin conexión» de Firefox, fetch no falla y contesta desde la
 * caché HTTP, que puede ser de otra versión y que nada comprueba con su huella. Con conexión, el camino es el mismo de
 * siempre.
 *
 * @param {FetchEvent} evento - La petición que se atiende.
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @param {boolean} navegacion - Si la petición es una navegación entre páginas.
 * @returns {Promise<Response>}
 */
async function responder(evento, clave, navegacion) {
  const copia = await caches.open(COPIA);
  if (GUARDABLES.has(clave) && sinConexionDeclarada()) {
    return desdeLaCopia(copia, clave, navegacion);
  }
  // Lo que se va a guardar en la copia se pide como al instalar (modoDeLaCopia): sin la caché HTTP, salvo lo que lleva
  // la huella en el nombre.
  const guardable = GUARDABLES.has(clave) && !navegacion;
  const modo = guardable ? modoDeLaCopia(clave.slice(BASE.href.length)) : undefined;
  /** @type {Response} */
  let respuesta;
  try {
    respuesta = await pedirALaRed(evento.request, modo ? { cache: modo } : undefined);
  } catch (error) {
    // Sin red es lo normal sin conexión: no se deja en la consola. Lo demás no se hace pasar por falta de conexión.
    if (!esFalloDeLaRed(error)) {
      throw error;
    }
    return desdeLaCopia(copia, clave, navegacion);
  }
  if (guardable && !noSirveComoCopia(clave, respuesta)) {
    evento.waitUntil(guardarSiEsDeEstaVersion(copia, clave, respuesta.clone()));
  }
  // Un 5xx no tapa la copia de esta versión, incluida la foto reducida si la ruta pública la declara.
  if (respuesta.status >= PRIMER_FALLO_DEL_SERVIDOR) {
    return (await buscarEnLaCopia(copia, clave)) ?? respuesta;
  }
  return respuesta;
}

/**
 * Si el navegador dice que no hay conexión (navigator.onLine es false). Solo se fía de un false explícito: un navegador
 * sin la propiedad, o que dice que hay conexión, sigue pidiendo a la red, y un fallo de la red se trata igual que antes.
 *
 * @returns {boolean}
 */
function sinConexionDeclarada() {
  return self.navigator.onLine === false;
}

/**
 * Guarda en la copia lo que ha traído la red para `clave`, si es de esta versión (deEstaVersion). Si es de otra, no lo
 * guarda: la página lo usa igual, pero la copia no mezcla versiones. Sin espacio o sin permiso para guardar, tampoco.
 *
 * @param {Cache} copia - La copia de esta versión.
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia), de GUARDABLES.
 * @param {Response} respuesta - Lo que ha contestado el servidor, que sirve como copia (noSirveComoCopia).
 * @returns {Promise<boolean>} Si ha entrado en la copia.
 */
async function guardarSiEsDeEstaVersion(copia, clave, respuesta) {
  /** @type {Response} */
  let comprobada;
  try {
    comprobada = await deEstaVersion(clave.slice(BASE.href.length), respuesta);
  } catch (error) {
    // deEstaVersion rechaza con un Error simple una página que no es HTML: tampoco es de esta versión.
    if (!(error instanceof HuellaQueNoCoincide) && error?.constructor !== Error) {
      throw error;
    }
    console.warn(`Faro: ${error.message}; no se guarda en la copia sin conexión.`);
    return false;
  }
  const guardada = await copia.put(clave, comprobada).then(
    () => true,
    // Sin espacio o sin permiso para guardar: la respuesta sigue llegando a la página.
    () => false,
  );
  anotarEscrituraEnLaCopia();
  return guardada;
}

export { responderDesdeLaCopia, responderEntradaDelRecorrido, responderSeccion };
