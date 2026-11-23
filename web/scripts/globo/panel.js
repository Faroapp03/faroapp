// Lo que el globo pone en la página, sin el dibujo. Arriba, la escena con sus mandos (un anillo para girar y volver al
// país elegido, y el zoom) y, a su lado, «Escribe o elige tu país» (selector.js) con el arranque de la ficha del país elegido
// (ficha.js); debajo, el resto de la ficha, en una rejilla de tarjetas. La escena va primero: en pantallas estrechas
// queda encima del selector, que así sigue pegado a la ficha que elige; en las anchas, a la derecha
// (estilos/globo.css). La línea de estado y las instrucciones, que describen el globo, solo las leen los lectores de
// pantalla; los créditos de la imagen y de las fronteras están en creditos.html. Todo se crea con `crear` y se escribe
// con `escribir` (scripts/idioma.js): nada de HTML en cadenas, y cada texto cambia con el idioma de la página.

import { crear } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { conVersiones, traducible } from '../textos.js';
import { crearSelector } from './selector.js';

/**
 * @import { Territorio } from '../datos-globales/datos.js'
 * @import { Traducible } from '../textos.js'
 * @import { Sitios } from './ficha.js'
 * @import { Selector } from './selector.js'
 */

/**
 * Los mandos del globo, de abajo a la derecha: un anillo con las cuatro direcciones y, en su centro, «Volver a mi país»,
 * y al lado el zoom en una píldora (+ arriba, − abajo). Cada uno lleva su acción y su grupo; su símbolo (un trazo) lo
 * dibuja globo.css, se ve y no se lee: se lee su nombre.
 * @type {readonly { accion: Accion, grupo: 'anillo' | 'zoom' }[]}
 */
const MANDOS = Object.freeze([
  { accion: 'arriba', grupo: 'anillo' },
  { accion: 'izquierda', grupo: 'anillo' },
  { accion: 'centrar', grupo: 'anillo' },
  { accion: 'derecha', grupo: 'anillo' },
  { accion: 'abajo', grupo: 'anillo' },
  { accion: 'acercar', grupo: 'zoom' },
  { accion: 'alejar', grupo: 'zoom' },
]);

/** El identificador de las instrucciones del globo, que describen el lienzo (aria-describedby). */
const ID_DE_LAS_INSTRUCCIONES = 'globo-instrucciones';

/**
 * Una acción de los mandos: girar, volver a centrar el país elegido o acercar y alejar.
 * @typedef {'izquierda' | 'derecha' | 'arriba' | 'abajo' | 'centrar' | 'acercar' | 'alejar'} Accion
 */
/**
 * Las partes del globo en la página.
 * @typedef {Object} Partes
 * @property {HTMLDivElement} raiz
 * @property {HTMLDivElement} escena el lienzo y sus mandos
 * @property {HTMLCanvasElement} lienzo
 * @property {Map<Accion, HTMLButtonElement>} mandos
 * @property {HTMLParagraphElement} nota la línea discreta que dice que se ve el mapa plano, oculta con el globo
 * @property {HTMLParagraphElement} aviso lo que no funciona (sin WebGL, sin recursos), oculto si todo va bien
 * @property {HTMLParagraphElement} estado región viva, solo para lectores de pantalla: lo que se anuncia al elegir
 * @property {Selector} selector
 * @property {Sitios} ficha el arranque de la ficha, junto al globo, y su resto, debajo
 * @property {2 | 3 | 4} nivel el del título de la ficha en la página
 */

/**
 * Un párrafo con un texto traducible.
 * @param {string} clase @param {string} clave
 */
function parrafo(clase, clave) {
  return escribir(crear('p', { className: clase }), traducible(clave));
}

/**
 * El nombre de un territorio, en el idioma de la página.
 * @param {Territorio} territorio
 */
function nombreDe({ nombre }) {
  return conVersiones(nombre);
}

/** La escena: el lienzo, que se lee por su descripción, y los mandos para girar y acercar sin arrastrar. */
function crearEscena() {
  const lienzo = crear('canvas', { className: 'globo-lienzo', tabIndex: 0 });
  lienzo.setAttribute('role', 'img');
  /** @type {Map<Accion, HTMLButtonElement>} */
  const mandos = new Map();
  const grupos = {
    anillo: crear('div', { className: 'globo-mandos-anillo' }),
    zoom: crear('div', { className: 'globo-mandos-zoom' }),
  };
  for (const { accion, grupo } of MANDOS) {
    const boton = crear('button', { type: 'button', className: `globo-mando globo-mando--${accion}` });
    escribirAtributo(boton, 'aria-label', traducible(`globo.mando.${accion}`));
    escribirAtributo(boton, 'title', traducible(`globo.mando.${accion}`));
    mandos.set(accion, boton);
    grupos[grupo].append(boton);
  }
  const todos = crear('div', { className: 'globo-mandos' }, grupos.anillo, grupos.zoom);
  todos.setAttribute('role', 'group');
  escribirAtributo(todos, 'aria-label', traducible('globo.mandos'));
  return { escena: crear('div', { className: 'globo-escena' }, lienzo, todos), lienzo, mandos };
}

// ---------- Lo público ----------

/**
 * Crea el globo dentro de `contenedor` (que vacía): arriba, la escena con sus mandos (y las instrucciones, solo para
 * los lectores de pantalla) y, a su
 * lado, el selector de país y el arranque de la ficha; debajo, el resto de la ficha.
 * @param {HTMLElement} contenedor @param {2 | 3 | 4} nivel el del título de la ficha en la página
 * @returns {Partes}
 */
export function crearPartes(contenedor, nivel) {
  const { escena, lienzo, mandos } = crearEscena();
  // Las instrucciones no se ven: las leen los lectores de pantalla como descripción del globo, con la ayuda del teclado.
  const instrucciones = parrafo('globo-instrucciones solo-lectores', 'globo.instrucciones');
  instrucciones.id = ID_DE_LAS_INSTRUCCIONES;
  lienzo.setAttribute('aria-describedby', ID_DE_LAS_INSTRUCCIONES);
  const aviso = crear('p', { className: 'globo-aviso', hidden: true });
  // Sin WebGL se ve el mapa plano (plano.js), y lo dice esta línea discreta.
  const nota = parrafo('globo-nota', 'globo.vista-plana');
  nota.hidden = true;
  const estado = crear('p', { className: 'globo-estado solo-lectores' });
  estado.setAttribute('role', 'status');
  const selector = crearSelector();
  const ficha = {
    arranque: crear('div', { className: 'globo-ficha' }),
    resto: crear('div', { className: 'globo-ficha globo-tarjetas' }),
  };
  const raiz = crear(
    'div',
    { className: 'globo' },
    crear(
      'div',
      { className: 'globo-arriba' },
      crear('div', { className: 'globo-columna-globo' }, escena, nota, aviso, instrucciones),
      crear('div', { className: 'globo-columna-ficha' }, selector.raiz, ficha.arranque),
    ),
    ficha.resto,
    estado,
  );
  contenedor.replaceChildren(raiz);
  return { raiz, escena, lienzo, mandos, aviso, nota, estado, selector, ficha, nivel };
}

/**
 * Lo que se anuncia al elegir un país: que su ficha está abierta.
 * @param {Territorio} territorio
 * @returns {Traducible}
 */
export function anuncio(territorio) {
  const clave = territorio.tipo === 'region' ? 'globo.panel.anuncio-region' : 'globo.panel.anuncio';
  return traducible(clave, { territorio: nombreDe(territorio) });
}

/**
 * La descripción del globo para los lectores de pantalla, con el país elegido.
 * @param {Territorio | null} territorio
 * @returns {Traducible}
 */
export function descripcion(territorio) {
  return territorio
    ? traducible('globo.descripcion', { territorio: nombreDe(territorio) })
    : traducible('globo.descripcion.ninguno');
}
