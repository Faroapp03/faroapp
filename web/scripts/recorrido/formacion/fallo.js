/** Lo que se le dice a la persona cuando la formación no se ha podido preparar o confirmar. */
import { escribir } from '../../idioma.js';
import { traducible } from '../../textos.js';
import { ERRORES_DEL_MOTOR, ErrorFaro, problemaDe } from '../api/errores.js';
import { decirFaro } from '../conversacion.js';

/**
 * El texto de un fallo: con el reloj del dispositivo atrasado, su explicación, que dice qué corregir; con cualquier
 * otro, el aviso general de la formación.
 * @param {unknown} error
 */
function textoDelFallo(error) {
  const relojAtrasado = error instanceof ErrorFaro && problemaDe(error.datos) === ERRORES_DEL_MOTOR.RELOJ_ATRASADO;
  return relojAtrasado ? error.explicacion : traducible('formacion.fallo');
}

/**
 * Cuenta el fallo: en `aviso`, si lo hay (el de un formulario que espera), y si no, como mensaje de error de Faro.
 * @param {unknown} error @param {HTMLElement | null} aviso
 */
export function contarFalloDeFormacion(error, aviso) {
  if (aviso) {
    escribir(aviso, textoDelFallo(error));
  } else {
    decirFaro(textoDelFallo(error), { tipo: 'error' });
  }
}
