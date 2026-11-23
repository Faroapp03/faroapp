// El saludo de Faro al abrir el recorrido (y al empezar de nuevo): directo a lo que importa, «Hola, soy Faro. ¿A qué
// te dedicas?». Sin presentación larga ni ejemplos de ocupaciones, que empujarían a la persona hacia una respuesta.
// La identificación de Faro y la información sobre el tratamiento local están en la interfaz del recorrido.
// Este módulo conserva el mismo saludo al abrir una sesión y al reiniciarla.

import { traducible } from '../textos.js';
import { decirFaro } from './conversacion.js';

/** @import { Traducible } from '../textos.js' */

/** Dos párrafos: al empezar, estilos/recorrido/bienvenida.css los pinta como el título de bienvenida, en dos líneas. */
const SALUDO = Object.freeze([traducible('recorrido.saludo.hola'), traducible('recorrido.saludo.pregunta')]);
/** La línea que dice que se ha borrado el recorrido, antes del saludo. */
const TRAS_BORRAR = traducible('recorrido.saludo.tras-borrar');

/**
 * Faro saluda y pregunta por el trabajo. Tras borrar el recorrido, lo dice primero, en una línea: «He borrado…» o,
 * si se dio, el motivo (lo borró otra pestaña), que ya dice que ha empezado de nuevo; nunca las dos. Ninguno de los dos
 * desplaza la página, que está al principio: así el primer Tab llega a «Saltar al contenido» y no a la barra de
 * escritura.
 * @param {{ borrado?: boolean, motivo?: Traducible }} [opciones] @returns {void}
 */
export function saludar({ borrado = false, motivo } = {}) {
  if (borrado) {
    decirFaro(motivo ?? TRAS_BORRAR, { tipo: 'nota', desplazar: false });
  }
  decirFaro([...SALUDO], { tipo: 'saludo', desplazar: false });
}
