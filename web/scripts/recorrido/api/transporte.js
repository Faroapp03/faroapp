// Las peticiones del recorrido se resuelven en el Worker del dispositivo. El transporte conserva el filtro
// de datos personales, el plazo, la cancelación y la validación de cada respuesta local.

import { camposDe, esObjeto } from '../../json.js';
import { MotorBloqueado, MotorQueNoCoincide, pedirAlMotorLocal } from '../../motor-local/cliente.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../protocolo-web.js';
import { traducible } from '../../textos.js';
import { antesDeQueNoCoincida } from '../instalacion-que-no-coincide.js';
import { limpiarTareaLocal, minimizarParaEnviar, RutaSinFiltro } from '../minimizar.js';
import {
  ERROR_DE_ARRANQUE,
  ERROR_DE_PLAZO,
  ERROR_DEL_MOTOR_LOCAL,
  ERROR_GENERICO,
  ERROR_MOTOR_QUE_NO_COINCIDE,
  ERROR_SIN_LIMPIEZA,
  ErrorFaro,
  errorDeCancelacion,
  errorDeLaRespuesta,
} from './errores.js';

/** @import { CuerpoDeLaApi } from '../traduccion-api.js' */

/** Una versión de contrato distinta requiere recargar los recursos compatibles. */
const ESTADO_CONFLICTO = 409;

/** La base de la API, en el mismo origen que la web. La comparten las peticiones que no son del recorrido. */
export const API = '/api';
/** Plazo máximo de una petición, incluida la preparación y lectura locales. */
const TIEMPO_MAXIMO_MS = 60_000;
/**
 * La API solo acepta JSON del mismo origen. Se declara en todas las peticiones, también en las lecturas, para que
 * ninguna dependa de llevar cuerpo o no; `same-origin` hace que el navegador rechace cualquier otro destino. Las usan
 * también las peticiones a la API que no son del recorrido, para hablar el mismo contrato.
 */
export const CABECERAS = Object.freeze({
  accept: 'application/json',
  'content-type': 'application/json',
  [CABECERA_CONTRATO]: String(CONTRATO_API),
});
/** @type {RequestMode} */
const MODO = 'same-origin';

/**
 * El cuerpo JSON de una petición; sin cuerpo (undefined), la petición es un GET.
 * @typedef {Record<string, unknown>} CuerpoDePeticion
 */
/**
 * Si `error` es el DOMException de fetch o de una señal con ese nombre (TimeoutError, AbortError).
 * @param {unknown} error @param {string} nombre @returns {boolean}
 */
function esDomException(error, nombre) {
  return error instanceof DOMException && error.name === nombre;
}

/**
 * No hay red de por medio: el TypeError con que falla el motor del dispositivo (motor-local/cliente.js)
 * se identifica como un fallo de ese motor. Si el motor no es el de esta versión (MotorQueNoCoincide), volver a pedirlo
 * daría lo mismo: el fallo tiene su propia explicación, sin «Volver a intentarlo» (api/errores.js). Si el motor no ha
 * arrancado con la copia ya lista (MotorBloqueado), se dice como en el paso de ocupación (ERROR_DE_ARRANQUE), con
 * «Volver a intentarlo» y sin pedir que se recargue la página. La cancelación y el plazo siguen su camino.
 * @param {unknown} error @returns {never}
 */
function falloDelMotorLocal(error) {
  if (!(error instanceof TypeError)) {
    throw error;
  }
  if (error instanceof MotorQueNoCoincide) {
    console.error('Faro: el motor del dispositivo no es el de esta versión.', error);
    throw new ErrorFaro(traducible(ERROR_MOTOR_QUE_NO_COINCIDE), 0);
  }
  if (error instanceof MotorBloqueado) {
    console.error('Faro: el motor del dispositivo no ha arrancado.', error);
    throw new ErrorFaro(traducible(ERROR_DE_ARRANQUE), 0);
  }
  console.error('Faro: el motor del dispositivo no ha podido responder.', error);
  throw new ErrorFaro(traducible(ERROR_DEL_MOTOR_LOCAL), 0);
}

/**
 * Una ruta con cuerpo que el filtro de datos personales no conoce es un error del programa: la petición no sale, la
 * pista va a la consola y la persona ve el fallo general, nunca un fallo de conexión que no ha ocurrido.
 * @param {unknown} error @returns {never}
 */
function rutaSinFiltro(error) {
  if (!(error instanceof RutaSinFiltro)) {
    throw error;
  }
  console.error('Faro: una petición no ha salido porque su ruta no está en el filtro de datos personales.', error);
  throw new ErrorFaro(ERROR_GENERICO, 0);
}

/**
 * El fallo de una petición que no ha traído respuesta, contado con lo que de verdad ha pasado: el plazo, la
 * cancelación o un fallo del motor local.
 * @param {unknown} error un fallo local o un DOMException de plazo o cancelación
 * @returns {ErrorFaro}
 */
function errorSinRespuesta(error) {
  if (esDomException(error, 'TimeoutError')) {
    return new ErrorFaro(traducible(ERROR_DE_PLAZO), 0);
  }
  if (esDomException(error, 'AbortError')) {
    return errorDeCancelacion();
  }
  // La pista técnica va a la consola; la persona ve un mensaje sencillo.
  console.warn('Faro: el motor del dispositivo no ha respondido.', error);
  return new ErrorFaro(traducible(ERROR_DEL_MOTOR_LOCAL), 0);
}

/** Se renueva cada vez que se cancelan las peticiones en curso: las nuevas no nacen canceladas. */
let cancelacion = new AbortController();
/**
 * Anula todas las peticiones en curso cuando la persona vuelve atrás o borra el recorrido.
 * @returns {void}
 */
export function cancelarPeticiones() {
  cancelacion.abort();
  cancelacion = new AbortController();
}

/** La señal que anula las peticiones de la conversación en curso (cancelarPeticiones). @returns {AbortSignal} */
export function senalDeCancelacion() {
  return cancelacion.signal;
}

/**
 * Sin cuerpo, la petición es un GET; con cuerpo, un POST. Las dos, en JSON y al mismo origen.
 * @param {CuerpoDePeticion | undefined} cuerpo @param {AbortSignal} signal
 * @returns {RequestInit}
 */
function opcionesDePeticion(cuerpo, signal) {
  const comunes = { signal, mode: MODO, headers: CABECERAS };
  if (cuerpo === undefined) {
    return comunes;
  }
  return { ...comunes, method: 'POST', body: JSON.stringify(cuerpo) };
}

/**
 * Una señal retirada conserva su cancelación aunque se haya empezado otra conversación.
 * @param {AbortSignal} signal
 */
function comprobarCancelacion(signal) {
  signal.throwIfAborted();
}

/**
 * Termina la espera al abortar aunque una importación del navegador siga pendiente. Se retira la escucha en todos
 * los cierres; la resolución o el rechazo posteriores del trabajo quedan observados sin entregar otro resultado.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} trabajo @param {AbortSignal} signal @returns {Promise<T>}
 */
function esperarConSenal(trabajo, signal) {
  return new Promise((resolve, reject) => {
    const retirar = () => signal.removeEventListener('abort', abortar);
    const abortar = () => {
      retirar();
      reject(signal.reason);
    };
    signal.addEventListener('abort', abortar, { once: true });
    if (signal.aborted) {
      abortar();
      return;
    }
    void Promise.resolve()
      .then(() => {
        comprobarCancelacion(signal);
        return trabajo(signal);
      })
      .then(
        (valor) => {
          retirar();
          resolve(valor);
        },
        (error) => {
          retirar();
          reject(error);
        },
      );
  });
}

/**
 * El mismo plazo y la misma cancelación para las peticiones y la preparación de literales del recorrido. Al terminar,
 * la señal combinada se da por cerrada (`terminada`): así el relleno de AbortSignal.any (compatibilidad.js) retira sus
 * oyentes de la cancelación de la conversación, que vive mucho más que cada petición.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} trabajo @param {AbortSignal} retirada @returns {Promise<T>}
 */
function conPlazoDelRecorrido(trabajo, retirada) {
  const terminada = new AbortController();
  const plazo = AbortSignal.any([retirada, AbortSignal.timeout(TIEMPO_MAXIMO_MS), terminada.signal]);
  return esperarConSenal(trabajo, plazo).finally(() => terminada.abort());
}

/**
 * Limpia un literal con el filtro compartido dentro del plazo de la conversación. No crea una tarea ni escribe estado.
 * @param {string} texto @returns {ReturnType<typeof limpiarTareaLocal>}
 */
export async function limpiarTareaDelRecorrido(texto) {
  try {
    return await conPlazoDelRecorrido((signal) => limpiarTareaLocal(texto, signal), cancelacion.signal);
  } catch (error) {
    throw error instanceof ErrorFaro ? error : errorSinRespuesta(error);
  }
}

/**
 * Lo mínimo que trae la respuesta correcta de cada ruta, para no confundir una respuesta vacía con una lectura correcta
 * o una tarea sin información. El informe se pide siempre con su HTML (api.js, RUTAS.informe).
 * @type {Readonly<Record<string, (datos: CuerpoDeLaApi) => boolean>>}
 */
const RESPUESTAS_VALIDAS = Object.freeze({
  '/informe': (datos) => typeof datos.html === 'string' && datos.html.length > 0,
  '/grupos': (datos) => Array.isArray(datos.hijos),
});

/** @param {CuerpoDeLaApi} datos @returns {boolean} */
function fichaValida(datos) {
  return (
    typeof datos.isco08 === 'string' &&
    typeof datos.titulo === 'string' &&
    Array.isArray(datos.tareas) &&
    Array.isArray(datos.ocupaciones)
  );
}

/**
 * La comprobación de la respuesta de una ruta; las fichas (/grupos/:isco) tienen la suya.
 * @param {string} ruta @returns {((datos: CuerpoDeLaApi) => boolean) | null}
 */
function comprobacionDeRespuesta(ruta) {
  const consulta = ruta.indexOf('?');
  const camino = consulta < 0 ? ruta : ruta.slice(0, consulta);
  return RESPUESTAS_VALIDAS[camino] ?? (camino.startsWith('/grupos/') ? fichaValida : null);
}

/**
 * JSON ilegible o sin su forma mínima se explica como un fallo, nunca como éxito.
 * @param {Response} respuesta @param {string} ruta @returns {Promise<CuerpoDeLaApi>}
 */
async function leerRespuesta(respuesta, ruta) {
  /** @type {unknown} */
  let datos;
  try {
    datos = await respuesta.json();
  } catch (error) {
    if (esDomException(error, 'AbortError') || esDomException(error, 'TimeoutError')) {
      throw error;
    }
    throw new ErrorFaro(ERROR_GENERICO, respuesta.status);
  }
  if (!esObjeto(datos)) {
    throw new ErrorFaro(ERROR_GENERICO, respuesta.status);
  }
  const cuerpo = camposDe(datos);
  const contrato = respuesta.headers.get(CABECERA_CONTRATO);
  if (contrato && contrato !== String(CONTRATO_API)) {
    throw new ErrorFaro(traducible('recorrido.error.actualizar'), ESTADO_CONFLICTO);
  }
  const validar = comprobacionDeRespuesta(ruta);
  if (respuesta.ok && validar && !validar(cuerpo)) {
    throw new ErrorFaro(ERROR_GENERICO, respuesta.status);
  }
  return cuerpo;
}

/**
 * Una petición local. La carga del filtro también pertenece al plazo y a la conversación que la inició.
 * @param {string} ruta @param {CuerpoDePeticion | undefined} cuerpo @param {AbortSignal} signal
 * @returns {Promise<{ respuesta: Response, datos: CuerpoDeLaApi }>}
 */
async function enviar(ruta, cuerpo, signal) {
  comprobarCancelacion(signal);
  return conPlazoDelRecorrido(async (plazo) => {
    comprobarCancelacion(plazo);
    const salida = await minimizarParaEnviar(ruta, cuerpo).catch(rutaSinFiltro);
    comprobarCancelacion(plazo);
    if (!salida) {
      throw new ErrorFaro(traducible(ERROR_SIN_LIMPIEZA), 0);
    }
    // Sin service worker activo, la petición esperaría hasta dos minutos: si la instalación no coincide, falla antes
    // (instalacion-que-no-coincide.js) con su explicación, que falloDelMotorLocal deja pasar.
    const peticion = pedirAlMotorLocal(`${API}${ruta}`, opcionesDePeticion(salida.cuerpo, plazo));
    const respuesta = await antesDeQueNoCoincida(peticion).catch(falloDelMotorLocal);
    const datos = await leerRespuesta(respuesta, ruta);
    comprobarCancelacion(plazo);
    return { respuesta, datos: salida.conAviso(datos) };
  }, signal);
}

/**
 * Pide `ruta` a la API (GET sin cuerpo, POST con él) y devuelve el cuerpo de la respuesta correcta; si no, lanza un
 * ErrorFaro. Solo la usan las funciones de las rutas (api.js). La cancelación y el plazo incluyen la preparación local.
 * @param {string} ruta @param {CuerpoDePeticion} [cuerpo] @returns {Promise<CuerpoDeLaApi>}
 * @throws {ErrorFaro} si la API no responde, rechaza la petición o la respuesta no es la esperada
 */
export async function pedir(ruta, cuerpo) {
  const retirada = cancelacion.signal;
  try {
    const { respuesta, datos } = await enviar(ruta, cuerpo, retirada);
    if (respuesta.ok) {
      return datos;
    }
    throw errorDeLaRespuesta(respuesta.status, datos);
  } catch (error) {
    throw error instanceof ErrorFaro ? error : errorSinRespuesta(error);
  }
}
