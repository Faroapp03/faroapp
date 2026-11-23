// Un aviso de Faro fuera de la conversación: una franja al pie de la pantalla con su texto y sus botones (una versión
// nueva de Faro, un idioma que no ha cargado). La franja es una región con nombre, así que nada queda fuera de las
// regiones de la página. Lo que dice se anuncia aparte, en una región viva que está en la página desde que se crea el
// aviso: un lector de pantalla no siempre anuncia una región que aparece de golpe con su texto ya dentro. Por eso hay
// que crear el aviso al cargar la página, antes de mostrarlo; y crearlo una sola vez por página (ver crearAviso).
// Aparece y desaparece sin moverse (base.css, .aviso-flotante).

import { crear } from './dom.js';
import { escribir, escribirAtributo } from './idioma.js';

/** @import { Parte } from './textos.js' */

/**
 * Un botón del aviso (crearBoton).
 * @typedef {Object} BotonDelAviso
 * @property {Parte} texto
 * @property {Parte} [nombre]
 * @property {boolean} [secundario]
 * @property {() => void} alPulsar
 */
/**
 * Un aviso ya creado: su elemento y cómo enseñarlo (con lo que se anuncia, si es otra cosa) u ocultarlo.
 * @typedef {Object} AvisoFlotante
 * @property {HTMLElement} elemento
 * @property {(mensaje: Parte, anuncio?: Parte) => void} mostrar
 * @property {() => void} ocultar
 */

/** Un botón del aviso: `texto` (traducible), `nombre` (su nombre accesible, si dice más que el texto) y su acción.
 * @param {BotonDelAviso} boton
 * @returns {HTMLButtonElement}
 */
function crearBoton({ texto, nombre, secundario = false, alPulsar }) {
  const clase = secundario ? { className: 'aviso-flotante-secundario' } : {};
  const boton = escribir(crear('button', { type: 'button', ...clase }), texto);
  if (nombre) {
    escribirAtributo(boton, 'aria-label', nombre);
  }
  boton.addEventListener('click', alPulsar);
  return boton;
}

/**
 * Crea un aviso, oculto, con su `nombre` (traducible) y sus `botones` (ver crearBoton). Devuelve cómo enseñarlo con un
 * texto (y lo que se anuncia, si es otra cosa), cómo ocultarlo y su elemento. Añade dos nodos al `body` (el aviso y su
 * región viva) y no tiene forma de retirarlos: se crea una sola vez por página, al cargar.
 * @param {{ nombre: Parte, botones: BotonDelAviso[] }} aviso @returns {AvisoFlotante}
 */
export function crearAviso({ nombre, botones }) {
  const texto = crear('span');
  const aviso = crear('section', { className: 'aviso-flotante', hidden: true }, texto, ...botones.map(crearBoton));
  escribirAtributo(aviso, 'aria-label', nombre);
  const regionViva = crear('p', { className: 'solo-lectores' });
  regionViva.setAttribute('role', 'status');
  document.body.append(regionViva, aviso);
  return {
    elemento: aviso,
    mostrar(mensaje, anuncio = mensaje) {
      escribir(texto, mensaje);
      aviso.hidden = false;
      escribir(regionViva, anuncio);
    },
    ocultar() {
      aviso.hidden = true;
      escribir(regionViva, '');
    },
  };
}
