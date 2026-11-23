// «Ayuda»: comienzos de frase para quien no sabe por dónde empezar a escribir. Solo comienzos («Trabajo como…»),
// nunca nombres de ocupaciones ni de tareas: Faro no sugiere a nadie qué es ni qué hace, porque un ejemplo empuja la
// respuesta hacia él. El comienzo elegido se añade a lo ya escrito, sin borrarlo ni enviarlo.
//
// Cada paso tiene los suyos: la respuesta a «¿A qué te dedicas?» (también en el relato libre) y lo que la persona
// hace de más. Mientras elige en una tarjeta de la ocupación no hay ninguno y el botón no se muestra
// (estilos/recorrido/barra-de-escritura.css, con <body data-paso>).

import { crear, porId } from '../dom.js';
import { escribir } from '../idioma.js';
import { texto, traducible } from '../textos.js';
import { anadirAlBorrador } from './compositor.js';
import { PASO_RELATO, PASO_TAREAS } from './navegacion.js';

/** Lo que se ve acaba en «…»; al borrador pasa sin ella y con un espacio, listo para seguir escribiendo. */
const PUNTOS_SUSPENSIVOS = /…$/;
/** Cuántos comienzos tiene cada paso en los diccionarios (recorrido.ayudas.<paso>.1 a .4). */
export const COMIENZOS_POR_PASO = 4;
/**
 * Lo que ofrece un paso: su descripción, ya como texto traducible, y las claves de sus comienzos.
 * @param {string} nombre
 */
function comienzosDe(nombre) {
  return {
    descripcion: traducible(`recorrido.ayudas.${nombre}.descripcion`),
    opciones: Array.from({ length: COMIENZOS_POR_PASO }, (_, i) => `recorrido.ayudas.${nombre}.${i + 1}`),
  };
}
/**
 * Los comienzos de cada paso que los tiene, por el número del paso. Se construyen al importar el módulo (comienzosDe).
 * @type {Readonly<Record<number, ReturnType<typeof comienzosDe>>>}
 */
const COMIENZOS = Object.freeze({ [PASO_RELATO]: comienzosDe('relato'), [PASO_TAREAS]: comienzosDe('tareas') });

/** El panel de «Ayuda» y el botón que lo abre, que recorrido.html tiene siempre. */
function panel() {
  return porId('rc-ayudas');
}
function boton() {
  return porId('abrir-ayudas');
}

/**
 * Cierra el panel. Con `devolverFoco`, el foco vuelve a «Ayuda» (al cerrar con su botón o con Escape).
 * @param {{ devolverFoco?: boolean }} [opciones]
 */
function cerrar({ devolverFoco = false } = {}) {
  panel().hidden = true;
  boton().setAttribute('aria-expanded', 'false');
  if (devolverFoco) {
    boton().focus({ preventScroll: true });
  }
}

/**
 * Añade el comienzo al borrador en el idioma en que se ve ahora.
 * @param {string} clave
 */
function elegir(clave) {
  cerrar();
  anadirAlBorrador(texto(clave).replace(PUNTOS_SUSPENSIVOS, ' '));
}

/** Pinta los comienzos del paso en curso y abre el panel, con el foco en el primero. */
function abrir() {
  const deEstePaso = COMIENZOS[Number(document.body.dataset.paso)];
  if (!deEstePaso) {
    return;
  }
  escribir(porId('rc-ayudas-descripcion'), deEstePaso.descripcion);
  const botones = deEstePaso.opciones.map((clave) => {
    const opcion = escribir(crear('button', { type: 'button' }), traducible(clave));
    opcion.addEventListener('click', () => elegir(clave));
    return opcion;
  });
  porId('rc-ayudas-opciones').replaceChildren(...botones);
  panel().hidden = false;
  boton().setAttribute('aria-expanded', 'true');
  const primero = botones[0];
  if (primero) {
    primero.focus({ preventScroll: true });
  }
}

/**
 * Un clic fuera del panel (y de su botón) lo cierra, sin mover el foco de donde se ha pulsado.
 * @param {MouseEvent} evento
 */
function cerrarAlPulsarFuera(evento) {
  const destino = evento.target;
  if (!(destino instanceof Node) || panel().hidden || panel().contains(destino) || boton().contains(destino)) {
    return;
  }
  cerrar();
}

/** Abre el panel si está cerrado y lo cierra si está abierto. */
function alternar() {
  if (panel().hidden) {
    abrir();
  } else {
    cerrar();
  }
}

/** Conecta «Ayuda»: abrir y cerrar el panel, Escape, el clic fuera y el cierre al enviar. */
export function iniciarAyudas() {
  boton().addEventListener('click', alternar);
  porId('cerrar-ayudas').addEventListener('click', () => cerrar({ devolverFoco: true }));
  panel().addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') {
      cerrar({ devolverFoco: true });
    }
  });
  document.addEventListener('click', cerrarAlPulsarFuera);
  porId('compositor').addEventListener('submit', () => cerrar());
}
