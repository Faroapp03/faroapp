// El selector de idioma. En la cabecera, un botón con la bandera del idioma en uso («Idioma: Castellano» para los
// lectores de pantalla) abre la lista de idiomas, cada uno con su bandera y su nombre en su propia lengua (con su
// lang). Sigue el patrón de botón de menú de las WAI-ARIA APG: aria-expanded en el botón, flechas, Inicio y Fin para
// moverse por la lista, Escape para cerrarla con el foco de vuelta en el botón, y Tab o un clic fuera para salir.
// Escape la cierra aunque el foco ya no esté en una opción (un clic en el borde de la lista lo deja en la página):
// abierta, la lista tapa lo que tiene debajo, y sin una tecla que la cierre solo quedaría buscar dónde pulsar fuera.
// Los botones de idioma sueltos (data-cambiar-idioma fuera de un menú, como los del diálogo del recorrido en los
// móviles) marcan el idioma en uso con aria-pressed; los del menú, con aria-checked.
// La lista aparece sin moverse: solo un fundido de una vez, que base.css quita con prefers-reduced-motion.
// El primer cambio a un idioma espera a su diccionario: si no llega, la página se queda como estaba y un aviso lo dice;
// elegir otra vez el idioma lo vuelve a pedir.

import { crearAviso } from './aviso.js';
import { PaginaIncompleta } from './dom.js';
import { alCambiarIdioma, cambiarIdioma, DiccionarioNoCargado, VersionNueva } from './idioma.js';
import { hayDiccionario, idiomaActual, traducible } from './textos.js';

/** @import { AvisoFlotante } from './aviso.js' */

/**
 * Cuánto avanza el foco con cada flecha.
 * @type {Record<string, number>}
 */
const PASOS_DE_FLECHA = { ArrowDown: 1, ArrowUp: -1 };
/** Rol ARIA de cada idioma de la lista (menú de opciones exclusivas, WAI-ARIA APG). */
const OPCION_DE_MENU = 'menuitemradio';

/**
 * Marca en cada botón de idioma si es el que está en uso.
 * @returns {void}
 */
function marcarIdiomaEnUso() {
  for (const boton of document.querySelectorAll('[data-cambiar-idioma]')) {
    if (!(boton instanceof HTMLElement)) {
      continue;
    }
    const enUso = String(boton.dataset.cambiarIdioma === idiomaActual());
    boton.setAttribute(boton.getAttribute('role') === OPCION_DE_MENU ? 'aria-checked' : 'aria-pressed', enUso);
  }
}

/**
 * El elemento del selector que encaja con `css`, de la clase pedida; si falta, la cabecera está mal hecha y se dice.
 * @template {Element} Elemento
 * @param {Element} selector El selector de la cabecera.
 * @param {string} css El selector CSS del elemento buscado.
 * @param {abstract new () => Elemento} Clase La clase que debe tener el elemento.
 * @returns {Elemento} El elemento.
 * @throws {PaginaIncompleta} Si falta o no es de esa clase.
 */
function dentroDe(selector, css, Clase) {
  const elemento = selector.querySelector(css);
  if (!(elemento instanceof Clase)) {
    throw new PaginaIncompleta(`El selector de la cabecera no tiene ${css}`);
  }
  return elemento;
}

/**
 * Abrir, cerrar y moverse por la lista de un selector de la cabecera.
 * @param {Element} selector El selector de la cabecera.
 */
function crearMenu(selector) {
  const boton = dentroDe(selector, '[aria-haspopup="menu"]', HTMLButtonElement);
  const lista = dentroDe(selector, '[role="menu"]', HTMLElement);
  const opciones = [...lista.querySelectorAll(`[role="${OPCION_DE_MENU}"]`)].filter(
    (opcion) => opcion instanceof HTMLButtonElement,
  );
  const abierto = () => boton.getAttribute('aria-expanded') === 'true';
  /** @param {number} posicion */
  const enfocar = (posicion) => opciones.at(posicion % opciones.length)?.focus();
  const posicionEnUso = () =>
    Math.max(
      0,
      opciones.findIndex((opcion) => opcion.dataset.cambiarIdioma === idiomaActual()),
    );

  const abrir = (posicion = posicionEnUso()) => {
    lista.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
    enfocar(posicion);
  };
  const cerrar = ({ devolverFoco = false } = {}) => {
    if (!abierto()) {
      return;
    }
    lista.hidden = true;
    boton.setAttribute('aria-expanded', 'false');
    if (devolverFoco) {
      boton.focus();
    }
  };
  return { boton, lista, opciones, abierto, abrir, cerrar, enfocar };
}

/**
 * Adónde lleva el foco cada tecla de la lista, o undefined si la tecla no mueve el foco.
 * @param {string} tecla El valor de `KeyboardEvent.key`.
 * @param {number} actual La posición de la opción enfocada, o -1.
 * @param {number} total Cuántas opciones tiene la lista.
 * @returns {number | undefined} La posición de destino, sin dar la vuelta.
 */
function destinoDeTecla(tecla, actual, total) {
  const paso = PASOS_DE_FLECHA[tecla];
  if (paso !== undefined) {
    return actual + paso;
  }
  if (tecla === 'Home') {
    return 0;
  }
  if (tecla === 'End') {
    return total - 1;
  }
  return undefined;
}

/**
 * El teclado dentro de la lista: flechas (dan la vuelta), Inicio, Fin y Tab.
 * @param {ReturnType<typeof crearMenu>} menu El menú abierto.
 * @param {KeyboardEvent} evento La tecla pulsada.
 */
function moverseConElTeclado(menu, evento) {
  const enfocada = document.activeElement;
  const actual = enfocada instanceof HTMLButtonElement ? menu.opciones.indexOf(enfocada) : -1;
  const destino = destinoDeTecla(evento.key, actual, menu.opciones.length);
  if (destino !== undefined) {
    evento.preventDefault();
    menu.enfocar(destino);
  } else if (evento.key === 'Tab') {
    menu.cerrar();
  }
}

/**
 * Escape con la lista abierta: la cierra esté donde esté el foco. Lo devuelve al botón si estaba en el selector o en
 * ninguna parte (el cuerpo de la página); si lo tiene otro control, se queda en él. Con la lista cerrada no hace nada,
 * y otra parte de la página puede usar la tecla.
 * @param {Element} selector El selector de la cabecera.
 * @param {ReturnType<typeof crearMenu>} menu Su menú.
 * @param {KeyboardEvent} evento La tecla pulsada.
 */
function cerrarConEscape(selector, menu, evento) {
  if (evento.key !== 'Escape' || !menu.abierto()) {
    return;
  }
  evento.preventDefault();
  const enfocado = document.activeElement;
  menu.cerrar({ devolverFoco: !enfocado || enfocado === document.body || selector.contains(enfocado) });
}

/**
 * Conecta un selector de la cabecera: el botón, la lista, el teclado y el clic fuera.
 * @param {Element} selector El selector de la cabecera.
 */
function conectarMenu(selector) {
  const menu = crearMenu(selector);
  menu.boton.addEventListener('click', () => (menu.abierto() ? menu.cerrar() : menu.abrir()));
  menu.boton.addEventListener('keydown', (evento) => {
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') {
      return;
    }
    menu.abrir(evento.key === 'ArrowDown' ? 0 : menu.opciones.length - 1);
    evento.preventDefault();
  });
  menu.lista.addEventListener('keydown', (evento) => moverseConElTeclado(menu, evento));
  document.addEventListener('keydown', (evento) => cerrarConEscape(selector, menu, evento));
  // Elegir un idioma lo cambia (lo hace el clic de cualquier botón de idioma) y cierra la lista.
  menu.lista.addEventListener('click', ({ target }) => {
    if (target instanceof Element && target.closest('[data-cambiar-idioma]')) {
      menu.cerrar({ devolverFoco: true });
    }
  });
  document.addEventListener('click', ({ target }) => {
    if (!(target instanceof Node) || !selector.contains(target)) {
      menu.cerrar();
    }
  });
}

// ---------- El idioma que no ha cargado ----------

/**
 * El aviso de que un idioma no ha cargado: se crea la primera vez que hace falta.
 * @type {AvisoFlotante | null}
 */
let avisoDeFallo = null;

/**
 * Dice que el diccionario de `idioma` no ha llegado: por la conexión o, si se ha activado una versión nueva de Faro
 * desde que se abrió la página, porque hay que volver a cargarla. Sin ningún diccionario no hay con qué decirlo: la
 * página se queda con su HTML, en castellano.
 * @param {string} idioma El idioma cuyo diccionario no ha llegado.
 * @param {{ porVersion?: boolean }} [opciones] `porVersion`: si el motivo es una versión nueva de Faro.
 * @returns {void}
 */
export function avisarDeIdiomaNoCargado(idioma, { porVersion = false } = {}) {
  if (!hayDiccionario(idiomaActual())) {
    return;
  }
  avisoDeFallo ??= crearAviso({
    nombre: traducible('comun.idioma.aviso-nombre'),
    botones: [{ texto: traducible('comun.cerrar'), secundario: true, alPulsar: () => avisoDeFallo?.ocultar() }],
  });
  const nombre = traducible(`comun.idioma.nombre.${idioma}`);
  const clave = porVersion ? 'comun.idioma.no-cargado-version' : 'comun.idioma.no-cargado';
  avisoDeFallo.mostrar(traducible(clave, { idioma: nombre }));
}

/**
 * Cambia al idioma del botón pulsado; si su diccionario no llega, lo dice. Con el cambio hecho, quita el aviso. Solo
 * los fallos de carga (DiccionarioNoCargado, VersionNueva) se cuentan como «no ha cargado»: cualquier otro es un error
 * del programa y se propaga, para que llegue a la consola en vez de disfrazarse de un problema de conexión.
 * @param {HTMLElement} boton El botón con data-cambiar-idioma.
 * @returns {Promise<void>}
 */
async function cambiarConElBoton(boton) {
  const idioma = boton.dataset.cambiarIdioma;
  if (!idioma) {
    return;
  }
  try {
    // La primera vez que se pide un idioma hay que esperar a su diccionario (idiomas/cargar.js).
    await cambiarIdioma(idioma);
    avisoDeFallo?.ocultar();
  } catch (error) {
    if (!(error instanceof DiccionarioNoCargado || error instanceof VersionNueva)) {
      throw error;
    }
    avisarDeIdiomaNoCargado(idioma, { porVersion: error instanceof VersionNueva });
  }
}

/**
 * Conecta los selectores de la cabecera y todos los botones de idioma de la página.
 * @returns {void}
 */
export function iniciarSelectorIdioma() {
  for (const selector of document.querySelectorAll('[data-selector-idioma]')) {
    conectarMenu(selector);
  }
  document.addEventListener('click', ({ target }) => {
    const boton = target instanceof Element ? target.closest('[data-cambiar-idioma]') : null;
    // Sin await: un diccionario que no llega lo dice el aviso; un error del programa sale en la consola como promesa
    // rechazada.
    if (boton instanceof HTMLElement) {
      void cambiarConElBoton(boton);
    }
  });
  alCambiarIdioma(marcarIdiomaEnUso);
  marcarIdiomaEnUso();
}
