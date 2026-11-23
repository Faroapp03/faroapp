// La tarjeta de explorar: la clasificación oficial de ocupaciones (ISCO-08), de lo general a lo concreto. Cada paso
// enseña los grupos de un nivel en orden alfabético, con cuántas ocupaciones tiene cada uno. Siempre con la salida
// «Prefiero contártelo con mis palabras», que lleva al relato libre.
// Volver al nivel anterior lo hace el botón «Volver» de la tarjeta (paso-ocupacion.js). Los títulos se ven en el
// idioma de la página si tienen su traducción de Faro y, si no, en castellano, marcados (datos-traducidos.js).

import { crear } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { resolver, traducible } from '../textos.js';
import { datoOficial } from './datos-traducidos.js';
import { formatearNumero, ordenarPorTitulo } from './formato.js';

/** @import { Parte, Traducible } from '../textos.js' */
/** @import { GrupoHijo } from './traduccion-api.js' */

/**
 * Lo que necesita la tarjeta de explorar (crearExploracion).
 * @typedef {Object} DatosDeExplorar
 * @property {string} padre
 * @property {string} tituloPadre
 * @property {GrupoHijo[]} hijos
 * @property {(hijo: GrupoHijo) => void} alAbrir
 * @property {() => void} alContar
 */

/** Cuántas ocupaciones tiene un grupo, dicho en una línea. @param {number} numero @returns {Traducible} */
function cuantasOcupaciones(numero) {
  return numero === 1
    ? traducible('recorrido.explorar.una-ocupacion')
    : traducible('recorrido.explorar.ocupaciones', { numero: formatearNumero(numero) });
}

/**
 * Un botón con el título oficial de un grupo o de una ocupación (un dato oficial) y, debajo, su `detalle` (un
 * traducible o un dato). Con `nombre`, el botón se llama así.
 * @param {{ titulo: Parte, detalle: Parte, alPulsar: () => void, nombre?: Parte }} boton
 */
function crearBoton({ titulo, detalle, alPulsar, nombre }) {
  // El espacio separa las dos líneas también en el texto del botón: sin él, su final y su principio se leerían como
  // una sola palabra («músicaOtros»), y lo que se ve dejaría de estar en el nombre.
  const boton = crear(
    'button',
    { type: 'button', className: 'rc-opcion' },
    escribir(crear('strong'), titulo),
    ' ',
    escribir(crear('small', { className: 'rc-grupo-isco' }), detalle),
  );
  if (nombre) {
    escribirAtributo(boton, 'aria-label', nombre);
  }
  boton.addEventListener('click', alPulsar);
  return boton;
}

/** El título (un h4) de un bloque. @param {Parte} titulo */
function crearTituloDeBloque(titulo) {
  return escribir(crear('h4', { className: 'rc-bloque-titulo' }), titulo);
}

/**
 * Una lista de botones con su título (un h4) para que se pueda recorrer por encabezados.
 * @param {Parte} titulo @param {HTMLElement[]} botones
 */
function crearBloque(titulo, botones) {
  return [crearTituloDeBloque(titulo), crear('div', { className: 'rc-opciones' }, ...botones)];
}

/**
 * El bloque de un nivel de la clasificación, en orden alfabético del título que se ve; sin grupos, lo dice.
 * @param {Pick<DatosDeExplorar, 'padre' | 'tituloPadre' | 'hijos' | 'alAbrir'>} jerarquia
 */
function crearJerarquia({ padre, tituloPadre, hijos, alAbrir }) {
  const titulo = padre
    ? traducible('recorrido.explorar.dentro', { titulo: datoOficial(tituloPadre) })
    : traducible('recorrido.explorar.clasificacion');
  if (!hijos.length) {
    return [
      crearTituloDeBloque(titulo),
      escribir(crear('p', { className: 'rc-vacio' }), traducible('recorrido.explorar.vacio')),
    ];
  }
  const enOrden = ordenarPorTitulo(hijos, (hijo) => resolver(datoOficial(hijo.titulo)));
  const botones = enOrden.map((hijo) =>
    crearBoton({
      titulo: datoOficial(hijo.titulo),
      detalle: cuantasOcupaciones(hijo.ocupaciones),
      alPulsar: () => alAbrir(hijo),
    }),
  );
  return crearBloque(titulo, botones);
}

/**
 * El contenido de la tarjeta de explorar. `padre` y `tituloPadre` dicen dónde se está (la raíz es ''); `hijos`, los
 * grupos de ese nivel; `alAbrir(hijo)`
 * `alContar` son lo que hace cada botón. Devuelve { nodos, foco }.
 * @param {DatosDeExplorar} datos @returns {{ nodos: HTMLElement[], foco: HTMLElement }}
 */
export function crearExploracion({ alContar, ...jerarquia }) {
  const contar = escribir(
    crear('button', { type: 'button', className: 'rc-boton-anadir' }),
    traducible('recorrido.explorar.contar'),
  );
  contar.addEventListener('click', alContar);
  const nodos = [...crearJerarquia(jerarquia), contar];
  const foco = nodos.find((nodo) => nodo.classList.contains('rc-opciones'))?.querySelector('button') ?? contar;
  return { nodos, foco };
}
