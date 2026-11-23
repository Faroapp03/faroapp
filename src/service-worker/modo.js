import { BASE, urlDe } from './catalogo.js';
import { anotarEscrituraEnLaCopia, respuestaParaLaCopia } from './copia.js';

// ---------- Modo de la instalación ----------
//
// Si la instalación es pública o está detrás de un portal (o de Basic) es una marca propia, «publica» o «privada»,
// guardada en un almacén aparte: no lleva el prefijo de las copias (PREFIJO), así que la limpieza por versión
// (borrarCopiasViejas) no la toca y sobrevive al reinicio del service worker, del navegador y al cambio de versión,
// porque el modo es de la instalación y no de una versión de la web; ninguna respuesta se sirve de este almacén.
// Solo la cambia una evidencia del servidor sobre inicio.html (evidenciaDe); un fallo de red, un plazo vencido, un
// 5xx, un 404 u otra respuesta no la cambian. Sin marca, el modo sale de la cabecera de inicio.html en la copia, como
// en las versiones anteriores. En el mismo almacén va el último estado observado del recorrido real (estadoDelRecorrido).
// Las marcas se leen y se escriben en su turno (cambiarMarca), también entre el service worker activo y el que espera.

// Se calculan al usarlas: este módulo se evalúa antes que catalogo.js (que importa portal.js).
const almacenDelModo = () => caches.open(`faro-modo:${BASE.href}`);
const claveDelModo = () => urlDe('modo-de-la-instalacion');
const claveDelRecorrido = () => urlDe('estado-del-recorrido');
const turnoDeLasMarcas = () => `faro-modo:${BASE.href}`;
const inicio = () => urlDe('inicio.html');
const NO_AUTENTICADO = 401;
const PROHIBIDO = 403;
/** Sin sesión, el portal o Basic contestan con 401 o 403. */
const ESTADOS_SIN_SESION = [NO_AUTENTICADO, PROHIBIDO];
const CORRECTO = 200;
const PRIMERA_REDIRECCION = 300;
/**
 * Lo que espera una navegación de una instalación pública, con red, a la sonda antes de servir la copia. Cubre la ida
 * y vuelta de unas cabeceras al mismo origen en una conexión móvil lenta (unos 560 ms en el perfil «Fast 3G») más el
 * servidor; sin red, la sonda falla enseguida y no se espera. Si vence, se sirve la copia y la sonda sigue en segundo
 * plano (sondearInicio): una evidencia tardía de privada lleva igualmente a todas las pestañas al portal.
 */
const PLAZO_DE_LA_SONDA_MS = 1000;
/**
 * Lo que puede durar una consulta en segundo plano (la sonda, la entrada del recorrido): holgado para unas cabeceras, o
 * una página de unas decenas de KB (recorrido.html), en una conexión móvil lenta, y acota lo que una red sin salida
 * mantiene vivo el evento (waitUntil). Si vence, es como la falta de red: no cambia nada de lo anotado.
 */
const PLAZO_DE_LA_CONSULTA_MS = 10_000;

/**
 * @typedef {'publica' | 'privada'} Modo
 * @typedef {'activo' | 'protegido'} EstadoDelRecorrido
 */

/**
 * Lo que demuestra una respuesta de la sonda de inicio.html; undefined si no demuestra nada. De privada, solo lo que
 * contesta Faro: una redirección (al portal) o su página, su 401 o su 403 con x-faro-portal: privado
 * (src/plataforma/cloudflare: el portal, sin-sesion.ts y la puerta de Basic, acceso-privado.ts). Un 401 o un 403 de
 * otro (un cortafuegos, un bloqueo geográfico, un proxy, también con su propio desafío) no lo demuestra.
 * @param {Response} respuesta
 * @returns {Modo | undefined}
 */
function evidenciaDe(respuesta) {
  const portal = respuesta.headers.get('x-faro-portal');
  if (respuesta.status === CORRECTO && portal === 'publico') {
    return 'publica';
  }
  const exito = respuesta.status >= CORRECTO && respuesta.status < PRIMERA_REDIRECCION;
  const rechazo = ESTADOS_SIN_SESION.includes(respuesta.status);
  if (respuesta.type === 'opaqueredirect' || ((exito || rechazo) && portal === 'privado')) {
    return 'privada';
  }
  return undefined;
}

/** @param {string} clave @returns {Promise<string | undefined>} */
async function leerMarca(clave) {
  return (await (await almacenDelModo()).match(clave))?.text();
}

/**
 * Guarda `valor` en la marca `clave`, en su turno (Web Locks, como la copia de las secciones): de N navegaciones que
 * ven el mismo cambio a la vez, solo una lo hace. Devuelve true si la ha cambiado. Si no se puede escribir (sin
 * espacio), lo deja en la consola y devuelve false: quien llama sigue con lo que ha observado.
 * @param {string} clave @param {string} valor
 * @returns {Promise<boolean>}
 */
async function cambiarMarca(clave, valor) {
  try {
    return await navigator.locks.request(turnoDeLasMarcas(), async () => {
      if ((await leerMarca(clave)) === valor) {
        return false;
      }
      await (await almacenDelModo()).put(clave, new Response(valor));
      return true;
    });
  } catch (error) {
    console.warn('Faro: no se ha podido anotar el modo de la instalación o del recorrido.', error);
    return false;
  }
}

/** @returns {Promise<Modo | undefined>} */
async function marcaDelModo() {
  const texto = await leerMarca(claveDelModo());
  return texto === 'publica' || texto === 'privada' ? texto : undefined;
}

/**
 * El modo de la instalación: la marca; sin ella, la cabecera de inicio.html en la copia.
 * @param {Cache} copia - La copia de esta versión.
 * @returns {Promise<Modo>}
 */
async function modoDeLaInstalacion(copia) {
  const marca = await marcaDelModo();
  if (marca) {
    return marca;
  }
  const guardada = await copia.match(inicio());
  return guardada?.headers.get('x-faro-portal') === 'publico' ? 'publica' : 'privada';
}

/**
 * Guarda la marca. Devuelve true si la instalación pasa a privada con esta escritura: una vez por paso a privada.
 * @param {Modo} modo
 * @returns {Promise<boolean>}
 */
async function fijarModo(modo) {
  return (await cambiarMarca(claveDelModo(), modo)) && modo === 'privada';
}

/**
 * El último estado observado del recorrido real en la red (anotarElRecorrido): «protegido» si su entrada ha llegado
 * con el acceso temporal (x-faro-recorrido), «activo» si ha llegado su página de esta versión; undefined si aún no se
 * ha observado (una copia anterior a esta marca), que no es «protegido». Si no se puede leer, «protegido»: sin red no
 * se abre lo que no se sabe si está protegido.
 * @returns {Promise<EstadoDelRecorrido | undefined>}
 */
async function estadoDelRecorrido() {
  const texto = await leerMarca(claveDelRecorrido()).catch(() => 'protegido');
  return texto === 'activo' || texto === 'protegido' ? texto : undefined;
}

/** @param {EstadoDelRecorrido} estado */
async function anotarElRecorrido(estado) {
  await cambiarMarca(claveDelRecorrido(), estado);
}

/** Mientras la pestaña que navega no muestra su página nueva, se vuelve a mirar cada PAUSA_DE_LA_ESPERA_MS. */
const PAUSA_DE_LA_ESPERA_MS = 100;
/**
 * Cuántas veces, como mucho: 1 s. En plazo, la página del portal aparece antes (Firefox, unos 230 ms). Con la evidencia
 * tardía, la página que salió de la copia ya está, pero los tres motores no la dan por resultingClientId: tras esta
 * espera, la pestaña vuelve a pedir su página igualmente (pruebas/navegadores/paso-a-privada.test.mjs).
 */
const ESPERAS_DE_LA_PESTANA = 10;

/**
 * Las pestañas de la web vuelven a pedir su página: como el modo ya es privado, va a la red y el portal decide. La que
 * navega con `evento` conserva su página anterior hasta que llega la nueva, y Firefox no da su clientId: se espera a la
 * nueva (resultingClientId). Si la evidencia ha llegado en plazo (`enPlazo`), esa navegación ya va al portal y no se
 * interrumpe; si ha llegado tarde, esa pestaña ya muestra la copia pública y vuelve a pedir su página como las demás.
 * @param {FetchEvent} evento @param {boolean} enPlazo
 */
async function llevarAlPortal(evento, enPlazo) {
  const nueva = evento.resultingClientId;
  for (let espera = 0; nueva && espera < ESPERAS_DE_LA_PESTANA && !(await self.clients.get(nueva)); espera++) {
    await new Promise((resolver) => setTimeout(resolver, PAUSA_DE_LA_ESPERA_MS));
  }
  const pestanas = await self.clients.matchAll({ type: 'window' });
  const navegando = enPlazo ? [nueva, evento.clientId] : [];
  await Promise.all(
    pestanas
      .filter((pestana) => !navegando.includes(pestana.id) && pestana.url.startsWith(BASE.href))
      .map((pestana) => /** @type {WindowClient} */ (pestana).navigate(pestana.url).catch(() => undefined)),
  );
}

/**
 * Al instalar: si inicio.html ha llegado de la red con la evidencia de pública, la marca, para que la copia nueva no
 * dependa de la cabecera guardada antes de su primera navegación. La de privada llega con la sonda.
 * @param {Response} respuesta - inicio.html, tal como entra en la copia.
 */
async function anotarModoAlInstalar(respuesta) {
  if (evidenciaDe(respuesta) === 'publica') {
    await fijarModo('publica');
  }
}

/**
 * La sonda: inicio.html por red, sin seguir redirecciones, sin la caché HTTP, con la sesión y con plazo
 * (PLAZO_DE_LA_CONSULTA_MS); solo las cabeceras, salvo si inicio.html falta en la copia y la instalación es pública:
 * entonces vuelve a la copia, con su huella. No falla: lo que no llega a una evidencia (la red, el plazo, un fallo al
 * leer la copia) es «sin prueba».
 * @param {Cache} copia
 * @returns {Promise<{evidencia: Modo | undefined, aPrivada: boolean}>}
 */
async function sondearInicio(copia) {
  try {
    const respuesta = await fetch(inicio(), {
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'include',
      signal: AbortSignal.timeout(PLAZO_DE_LA_CONSULTA_MS),
    });
    await respuesta.body?.cancel().catch(() => undefined);
    const evidencia = evidenciaDe(respuesta);
    const aPrivada = evidencia ? await fijarModo(evidencia) : false;
    if (evidencia === 'publica' && !(await copia.match(inicio()))) {
      await reponerInicio(copia);
    }
    return { evidencia, aPrivada };
  } catch {
    return { evidencia: undefined, aPrivada: false };
  }
}

/** @param {Cache} copia */
async function reponerInicio(copia) {
  try {
    await copia.put(inicio(), await respuestaParaLaCopia('inicio.html'));
    anotarEscrituraEnLaCopia();
  } catch (error) {
    console.warn('Faro: inicio.html no ha vuelto a la copia sin conexión.', error);
  }
}

/**
 * Antes de servir la copia de una instalación pública: la sonda, con su plazo (PLAZO_DE_LA_SONDA_MS). Devuelve true si
 * en el plazo ha llegado la evidencia de privada; si no, la sonda sigue en segundo plano (evento.waitUntil). Si pasa a
 * privada, en el plazo o después, las demás pestañas van al portal (llevarAlPortal).
 * @param {FetchEvent} evento @param {Cache} copia
 * @returns {Promise<boolean>}
 */
async function pasaAPrivada(evento, copia) {
  const sonda = sondearInicio(copia);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let plazo;
  const vencido = new Promise((resolver) => {
    plazo = setTimeout(resolver, PLAZO_DE_LA_SONDA_MS, undefined);
  });
  const enPlazo = await Promise.race([sonda, vencido]);
  clearTimeout(plazo);
  evento.waitUntil(
    sonda.then(({ aPrivada }) => (aPrivada ? llevarAlPortal(evento, enPlazo !== undefined) : undefined)),
  );
  return enPlazo?.evidencia === 'privada';
}

/**
 * Tras una navegación por red de una instalación privada: si la respuesta no es ya evidencia de privada (evidenciaDe:
 * el portal, una redirección o un rechazo), la sonda en segundo plano, por si la instalación ha vuelto a ser pública.
 * @param {FetchEvent} evento @param {Cache} copia @param {Response} respuesta
 */
function revisarSiVuelveAPublica(evento, copia, respuesta) {
  if (evidenciaDe(respuesta) !== 'privada') {
    evento.waitUntil(sondearInicio(copia));
  }
}

export {
  anotarElRecorrido,
  anotarModoAlInstalar,
  ESTADOS_SIN_SESION,
  estadoDelRecorrido,
  modoDeLaInstalacion,
  PLAZO_DE_LA_CONSULTA_MS,
  pasaAPrivada,
  revisarSiVuelveAPublica,
};
