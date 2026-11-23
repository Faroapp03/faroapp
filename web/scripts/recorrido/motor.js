// Las peticiones del recorrido al motor del dispositivo (src/plataforma/navegador/ruta-local.ts), con
// el mismo transporte que el resto de Faro sin conexión (../motor-local/cliente.js): el texto no sale del dispositivo.
// La primera vez el motor necesita la copia del paquete de datos; mientras el service worker la prepara, la petición
// falla con MotorNoListo y la pantalla lo dice y vuelve a intentarlo. Si el motor no se puede usar porque alguno de sus
// archivos no es el de esta versión (MotorQueNoCoincide), esperar no lo arregla: la petición falla con un ErrorFaro que
// lo dice, sin «Volver a intentarlo» (api/errores.js), y la preparación se detiene. Si el motor no arranca con la copia
// ya lista (MotorBloqueado: no responde a tiempo, o el almacenamiento no contesta o falla, también al abrir la base),
// repetirlo en el acto tampoco sirve: falla con un ErrorFaro que lo dice y que sí ofrece volver a intentarlo cuando la
// persona quiera. Tampoco se espera si la instalación del service worker ha fallado porque uno de los archivos del
// motor no es el de esta versión: sin service worker no hay motor, y la petición, que lo esperaría, falla sin «Volver a
// intentarlo» con la explicación de la primera visita en cuanto scripts/instalacion.js lo cuenta
// (instalacion-que-no-coincide.js).

import { esObjeto } from '../json.js';
import { MotorBloqueado, MotorQueNoCoincide, pedirAlMotorLocal } from '../motor-local/cliente.js';
import { ServiceWorkerNoDisponible, SinServiceWorker } from '../paquete-sin-conexion.js';
import { traducible } from '../textos.js';
import {
  ERROR_DE_ARRANQUE,
  ERROR_MOTOR_QUE_NO_COINCIDE,
  ERROR_SERVICE_WORKER_NO_DISPONIBLE,
  ERROR_SIN_SERVICE_WORKER,
  ErrorFaro,
} from './api/errores.js';
import { antesDeQueNoCoincida } from './instalacion-que-no-coincide.js';
import { detenerLaPreparacion } from './preparacion.js';

/** El motor del dispositivo aún no puede responder (sin service worker, sin la copia del paquete o cargándola). */
export class MotorNoListo extends Error {
  /** @override */
  name = 'MotorNoListo';
}

/** El motor ha respondido, pero con un error (una petición mal formada: un fallo de la pantalla). */
class RespuestaInvalida extends Error {
  /** @override */
  name = 'RespuestaInvalida';
}

/** @typedef {'paso' | 'buscar' | 'familias' | 'familia' | 'resultado' | 'enlazar'} Operacion */

/** Clasifica un fallo de arranque sin volver a pedir lo que no puede prepararse. @param {unknown} error */
function clasificarFallo(error) {
  if (error instanceof ErrorFaro) {
    detenerLaPreparacion();
    return error;
  }
  if (error instanceof ServiceWorkerNoDisponible) {
    detenerLaPreparacion();
    return new ErrorFaro(traducible(ERROR_SERVICE_WORKER_NO_DISPONIBLE), 0, {});
  }
  if (error instanceof SinServiceWorker) {
    detenerLaPreparacion();
    return new ErrorFaro(traducible(ERROR_SIN_SERVICE_WORKER), 0, {});
  }
  if (error instanceof MotorQueNoCoincide) {
    detenerLaPreparacion();
    return new ErrorFaro(traducible(ERROR_MOTOR_QUE_NO_COINCIDE), 0, {});
  }
  if (error instanceof MotorBloqueado) {
    return new ErrorFaro(traducible(ERROR_DE_ARRANQUE), 0, {});
  }
  return new MotorNoListo('El motor del dispositivo no ha podido responder', { cause: error });
}

/**
 * Pide una operación al motor del dispositivo y devuelve su respuesta como objeto. `avisos` dice cuándo empieza y
 * cuándo acaba cada espera de la copia del paquete (motor-local/cliente.js, AvisosDeLaCopia).
 * @param {Operacion} operacion @param {Record<string, unknown>} cuerpo @param {AbortSignal} [senal]
 * @param {import('../motor-local/cliente.js').AvisosDeLaCopia} [avisos]
 * @returns {Promise<Record<string, unknown>>}
 * @throws {MotorNoListo | RespuestaInvalida | ErrorFaro} ErrorFaro si el motor no es el de esta versión o no
 *   arranca con la copia ya lista; o el motivo de la señal, si se cancela.
 */
export async function pedir(operacion, cuerpo, senal, avisos = {}) {
  /** @type {Response} */
  let respuesta;
  try {
    const peticion = pedirAlMotorLocal(
      new URL(`local/recorrido-v2/${operacion}`, document.baseURI).href,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
        ...(senal ? { signal: senal } : {}),
      },
      avisos,
    );
    respuesta = await antesDeQueNoCoincida(peticion);
  } catch (error) {
    if (senal?.aborted) {
      throw error;
    }
    throw clasificarFallo(error);
  }
  /** @type {unknown} */
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !esObjeto(datos)) {
    throw new RespuestaInvalida(`El motor ha respondido ${respuesta.status} a ${operacion}`);
  }
  return datos;
}
