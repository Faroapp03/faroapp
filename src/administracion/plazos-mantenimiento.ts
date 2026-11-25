/**
 * Lo que tarda como mucho cada receptor de máquina del mantenimiento en dar su respuesta, desde que empieza a atender
 * la petición. Pasado ese plazo responde `504 plazo_agotado`, que no es un rechazo: lo que estaba haciendo puede haber
 * quedado hecho, y repetir los mismos bytes lo reconoce como `repetido`.
 *
 * El cliente del job (`plataforma_datos/orquestacion/cliente_mantenimiento.py`) espera la respuesta más que el mayor
 * de estos plazos, con margen para el montaje del panel y la red: si esperara lo mismo, cortaría justo cuando el
 * servidor va a contestar y nunca sabría si fue un plazo o un rechazo. Una prueba de contrato lo comprueba.
 */

import { ESPERA_CLAVES_MS } from '../seguridad/jwt-rs256.ts';

/** Inicio, activación y consulta de versión: un cuerpo pequeño, la identidad y, cuando procede, una transición. */
export const PLAZO_RECEPTOR_MANTENIMIENTO_MS = 5000;

/** La prueba encadena la verificación OIDC con la lectura y el cálculo de la huella de ASSETS. */
export const PLAZO_PRUEBA_MANIFIESTO_MS = ESPERA_CLAVES_MS + PLAZO_RECEPTOR_MANTENIMIENTO_MS;

/**
 * El recibo puede llegar a 4 MiB y su receptor encadena, sin solapar, una lectura del almacén (hasta 3 s), la
 * descarga de las claves OIDC si no están en caché (hasta 5 s) y el registro del recibo con su copia fijada (hasta
 * 3 s): 11 s de esperas propias, más leer y validar el cuerpo. Con 5 s, un recibo grande con las claves frías no
 * cabía y el servidor respondía «plazo agotado» a un envío válido.
 */
export const PLAZO_RESULTADO_MS = 15_000;

/** Todos los plazos de los receptores que llama el cliente del job, para contrastarlos con su espera. */
export const PLAZOS_RECEPTORES_MANTENIMIENTO_MS: readonly number[] = Object.freeze([
  PLAZO_RECEPTOR_MANTENIMIENTO_MS,
  PLAZO_PRUEBA_MANIFIESTO_MS,
  PLAZO_RESULTADO_MS,
]);
