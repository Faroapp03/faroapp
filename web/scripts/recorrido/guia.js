// La guía del recorrido: los cuatro pasos, con el que está en curso y los ya hechos. En pantallas anchas está a la
// izquierda de la conversación y se puede plegar; en las estrechas se abre en un diálogo desde el botón del paso
// («Tu ocupación · Paso 2 de 4»), que también está en la cabecera de la conversación.
//
// El paso en curso se marca también en <body data-paso>: estilos/recorrido/conversacion.css lo usa para llenar la
// barra de avance de la cabecera (un tramo por paso) e informe-en-la-pagina.css, para pasar el informe (paso 4) a una
// página que se lee de arriba abajo.

import { porId, pulsaFuera } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { traducible } from '../textos.js';
import { formatearNumero } from './formato.js';

/** @import { Parte } from '../textos.js' */

/** La lista de los pasos de la guía (el <ol> de #rc-guia). @returns {HTMLOListElement} */
function lista() {
  const pasos = porId('rc-guia').querySelector('ol');
  if (!pasos) {
    throw new Error('La guía del recorrido no tiene su lista de pasos');
  }
  return pasos;
}

/**
 * Marca cada paso de la guía: el que está en curso (aria-current) y los anteriores, ya hechos.
 * @param {number} paso
 */
function marcarPasos(paso) {
  for (const item of lista().children) {
    if (!(item instanceof HTMLElement)) {
      continue;
    }
    const suPaso = Number(item.dataset.paso);
    if (suPaso === paso) {
      item.setAttribute('aria-current', 'step');
    } else {
      item.removeAttribute('aria-current');
    }
    item.toggleAttribute('data-hecho', suPaso < paso);
  }
}

/** Pliega o despliega la guía lateral (solo en pantallas anchas: en las estrechas no se ve). */
function alternarGuia() {
  const guia = porId('rc-guia');
  const boton = porId('alternar-guia');
  const mostrar = guia.hidden;
  guia.hidden = !mostrar;
  boton.setAttribute('aria-expanded', String(mostrar));
  escribirAtributo(boton, 'title', traducible(mostrar ? 'recorrido.guia.ocultar' : 'recorrido.guia.mostrar'));
}

/**
 * Abre el diálogo del recorrido con una copia de los pasos de la guía, tal como están ahora. La copia no lleva la
 * etiqueta de la guía: la nombra el título del diálogo.
 */
function abrirRecorrido() {
  const copia = lista().cloneNode(true);
  if (!(copia instanceof HTMLOListElement)) {
    throw new Error('La copia de la guía no es una lista');
  }
  copia.removeAttribute('aria-labelledby');
  porId('dialogo-pasos').replaceChildren(copia);
  porId('dialogo-recorrido', HTMLDialogElement).showModal();
}

/** Conecta el diálogo del recorrido: abrirlo, cerrarlo (también pulsando fuera) y devolver el foco. */
function prepararDialogo() {
  const dialogo = porId('dialogo-recorrido', HTMLDialogElement);
  porId('ver-recorrido').addEventListener('click', abrirRecorrido);
  porId('cerrar-recorrido').addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('click', (evento) => {
    if (pulsaFuera(dialogo, evento)) {
      dialogo.close();
    }
  });
  // Al cerrarse, el foco vuelve al botón que lo abrió, también en los navegadores que no lo devuelven solos.
  dialogo.addEventListener('close', () => porId('ver-recorrido').focus({ preventScroll: true }));
}

/**
 * Enseña `paso` como el que está en curso: en la guía, en el botón de la cabecera («Tu ocupación» y la pastilla
 * «Paso 2 de 4», que los lectores de pantalla oyen como nombre del botón) y en <body data-paso>, que llena la barra de
 * avance. `nombre` es el traducible del paso y `total`, el número de pasos. La pastilla que se ve forma parte del
 * nombre del botón: lo que se lee en pantalla se puede decir en voz alta para activarlo (WCAG 2.5.3).
 * @param {{ paso: number, nombre: Parte, total: number }} enCurso
 */
export function marcarPasoEnLaGuia({ paso, nombre, total }) {
  document.body.dataset.paso = String(paso);
  marcarPasos(paso);
  const cifras = { paso: formatearNumero(paso), total: formatearNumero(total) };
  escribir(porId('rc-paso-nombre'), nombre);
  escribir(porId('rc-paso-cifra'), traducible('recorrido.paso.pastilla', cifras));
}

/**
 * Conecta el botón que pliega la guía y el diálogo del recorrido.
 */
export function iniciarGuia() {
  porId('alternar-guia').addEventListener('click', alternarGuia);
  prepararDialogo();
}
