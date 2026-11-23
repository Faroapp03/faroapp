// Renovación para un despliegue que use Cloudflare Access (src/plataforma/cloudflare/worker.ts). Si la página viene de la copia del
// service worker y GET /api/salud da señal de sesión caducada (la redirección de Access, un 401 con su desafío o el 403
// de una puerta por formulario sin sesión), la vuelve a pedir con ?acceso=renovar, que el service worker deja pasar a
// la red (src/service-worker/servicio.js, renovarAcceso). Es una señal, no una prueba de que la respuesta proceda de Access, y al
// volver solo se quita la marca de la dirección: no se verifica que la sesión se haya renovado. Sin respuesta o sin
// service worker no se inicia la renovación.

import { CABECERA_CONTRATO, CONTRATO_API } from './protocolo-web.js';

/**
 * La marca de la dirección con que una página pide pasar por la red. El service worker se publica como guion clásico y
 * no puede importarla: lleva su propia copia (src/service-worker/portal.js), que debe conservar esta misma marca.
 */
export const MARCA_ACCESO = 'acceso';
/**
 * El valor con que se escribe la marca. Solo cuenta que la marca esté: ni este módulo ni el service worker leen su
 * valor, así que cualquier otro tendría el mismo efecto.
 */
const RENOVAR = 'renovar';
/** La ruta de salud de la API, desde este archivo en scripts/. */
const SALUD = new URL('../api/salud', import.meta.url);
/** Lo que se espera a /api/salud: una red atascada no deja la comprobación abierta mientras dure la página. */
const PLAZO_SALUD_MS = 10_000;
/** La respuesta de salud solo contiene estado, versión e interruptores; no se acumula su cuerpo. */
const MAX_BYTES_SALUD = 16_384;
/** Los estados HTTP 401 (sin autenticar, con desafío) y 403 (prohibido; también una puerta por formulario sin sesión). */
const NO_AUTORIZADO = 401;
const PROHIBIDO = 403;
/**
 * Estados que se interpretan como falta de sesión; el cerrojo de la API también puede responder 403. El service worker
 * lleva su propia copia (src/service-worker/modo.js, ESTADOS_SIN_SESION) y debe reconocer los mismos estados.
 * @type {readonly number[]}
 */
export const SIN_SESION = Object.freeze([NO_AUTORIZADO, PROHIBIDO]);

/**
 * Dice si la respuesta de /api/salud parece de una sesión caducada: la redirección de Access o un estado sin sesión.
 * Es una señal, no una certeza (el 403 también lo da el cerrojo de la API).
 * @param {Response} respuesta La respuesta, pedida sin seguir redirecciones.
 * @returns {boolean} Si hay señal de que falta la sesión.
 */
function pareceSinSesion(respuesta) {
  return respuesta.type === 'opaqueredirect' || SIN_SESION.includes(respuesta.status);
}

/**
 * Quita la marca de la dirección (sin recargar) y dice si la llevaba, sin comprobar la sesión.
 * @returns {boolean} Si la dirección llevaba la marca.
 */
function quitarLaMarca() {
  const direccion = new URL(location.href);
  if (!direccion.searchParams.has(MARCA_ACCESO)) {
    return false;
  }
  direccion.searchParams.delete(MARCA_ACCESO);
  history.replaceState(history.state, '', direccion);
  return true;
}

/**
 * Pregunta a la API si responde, sin seguir redirecciones; null si no hay red o no responde a tiempo.
 * @returns {Promise<Response | null>} La respuesta, o null.
 */
async function preguntarALaApi() {
  try {
    const respuesta = await fetch(SALUD, {
      // Con el contrato de la web: sin él, la API responde 409 y la consola lo cuenta como un error.
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
      redirect: 'manual',
      cache: 'no-store',
      // La cookie de Access (del mismo origen) tiene que viajar: es lo que se comprueba.
      credentials: 'same-origin',
      signal: AbortSignal.timeout(PLAZO_SALUD_MS),
    });
    // Una señal de renovación no debe esperar al cuerpo de una página de autenticación.
    if (!pareceSinSesion(respuesta)) {
      await terminarRespuesta(respuesta);
    }
    return respuesta;
  } catch {
    // Sin red o sin respuesta en PLAZO_SALUD_MS: no hay nada que renovar.
    return null;
  }
}

/** Consume la respuesta acotada para que su plazo no aborte después una lectura todavía pendiente.
 * @param {Response} respuesta
 */
async function terminarRespuesta(respuesta) {
  if (!respuesta.body) {
    return;
  }
  const lector = respuesta.body.getReader();
  let total = 0;
  let completo = false;
  try {
    for (;;) {
      const parte = await lector.read();
      if (parte.done) {
        completo = true;
        return;
      }
      total += parte.value.byteLength;
      if (total > MAX_BYTES_SALUD) {
        throw new RangeError('Respuesta de salud excedida');
      }
    }
  } finally {
    try {
      if (!completo) {
        // El cierre no debe prolongar el plazo de una respuesta ya descartada.
        void lector.cancel().catch(() => {});
      }
    } finally {
      lector.releaseLock();
    }
  }
}

/**
 * Si /api/salud da señal de sesión caducada, vuelve a pedir la página por la red para que Access pida el código. Una página
 * que ya viene de renovarla no vuelve a preguntar: así nunca se entra en un bucle.
 * @returns {Promise<void>}
 */
export async function comprobarAcceso() {
  const veniaDeRenovar = quitarLaMarca();
  if (veniaDeRenovar || !navigator.serviceWorker?.controller) {
    return;
  }
  const respuesta = await preguntarALaApi();
  if (!respuesta || !pareceSinSesion(respuesta)) {
    return;
  }
  const direccion = new URL(location.href);
  direccion.searchParams.set(MARCA_ACCESO, RENOVAR);
  location.replace(direccion);
}
