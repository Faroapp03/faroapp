// La señal de scripts/instalacion.js de que la instalación del service worker ha fallado porque uno de sus archivos no
// es el de esta versión, sin ningún service worker activo: la marca en <html> y su evento (mismos valores que allí).
// Sin service worker activo no hay motor del dispositivo, y lo que le pide algo (motor-local/cliente.js espera antes a
// un service worker activo, hasta dos minutos) no debe seguir esperando ni reintentar: cada petición compite con esta
// señal (antesDeQueNoCoincida) y, si llega, falla con su propia explicación, la de una primera visita: no hay nada
// guardado que borrar.

import { traducible } from '../textos.js';
import { ERROR_INSTALACION_QUE_NO_COINCIDE, ErrorFaro } from './api/errores.js';

const MARCA_NO_COINCIDE = 'instalacionNoCoincide';
const EVENTO_NO_COINCIDE = 'faro-instalacion-no-coincide';

/** Si ya se sabe que la instalación no coincide (la marca de <html>). Fuera del navegador, no. @returns {boolean} */
export function laInstalacionNoCoincide() {
  return globalThis.document?.documentElement?.dataset[MARCA_NO_COINCIDE] !== undefined;
}

/**
 * La misma promesa, que rechaza con ErrorFaro(ERROR_INSTALACION_QUE_NO_COINCIDE) si ya se sabe que la instalación no
 * coincide o en cuanto llegue su evento. Su oyente se retira al acabar, de una forma o de otra.
 * @template T @param {Promise<T>} promesa @returns {Promise<T>}
 * @throws {ErrorFaro} Si la instalación no coincide.
 */
export async function antesDeQueNoCoincida(promesa) {
  /** @type {() => void} */
  let dejar = () => {};
  /** @type {Promise<never>} */
  const senal = new Promise((_, rechazar) => {
    const fallar = () => rechazar(new ErrorFaro(traducible(ERROR_INSTALACION_QUE_NO_COINCIDE), 0, {}));
    if (laInstalacionNoCoincide()) {
      fallar();
      return;
    }
    globalThis.addEventListener?.(EVENTO_NO_COINCIDE, fallar, { once: true });
    dejar = () => globalThis.removeEventListener?.(EVENTO_NO_COINCIDE, fallar);
  });
  try {
    return await Promise.race([promesa, senal]);
  } finally {
    dejar();
  }
}
