// El informe, como un documento dentro de la conversación: bajo el mensaje de Faro que lo presenta, una tarjeta con su
// título, cuántas hojas tiene (las que trae el HTML del motor) y dos acciones: leerlo, que lleva al informe pintado en
// esta misma página (#paso-4), y guardarlo en PDF o imprimirlo. El informe vive solo en la memoria de esta pestaña:
// nunca se abre en otra (enlaces-de-salida.js).

import { crear, porId } from '../dom.js';
import { escribir } from '../idioma.js';
import { traducible } from '../textos.js';
import { formatearNumero } from './formato.js';
import { imprimir } from './impresion.js';
import { irA, PASO_INFORME } from './navegacion.js';

/** @import { Parte } from '../textos.js' */

/** Cada hoja del informe breve es una <section class="hoja"> (src/presentacion/informe-breve/). */
const SELECTOR_DE_HOJA = 'section.hoja';
/** Las líneas que dibujan cada hoja en miniatura: un dibujo, sin texto. */
const LINEAS_POR_HOJA = 8;

/** Cuántas hojas tiene el informe pintado en #informe. @returns {number} */
export function hojasDelInforme() {
  return document.getElementById('informe')?.querySelectorAll(SELECTOR_DE_HOJA).length ?? 0;
}

/** «1 hoja» o «N hojas». @param {number} hojas */
function cuantasHojas(hojas) {
  return hojas === 1
    ? traducible('recorrido.documento.hoja')
    : traducible('recorrido.documento.hojas', { numero: formatearNumero(hojas) });
}

/** Las hojas en miniatura, solo a la vista. @param {number} hojas */
function vistaPrevia(hojas) {
  const miniaturas = Array.from({ length: hojas }, () =>
    crear('div', { className: 'rc-doc-hoja' }, ...Array.from({ length: LINEAS_POR_HOJA }, () => crear('i'))),
  );
  const vista = crear('div', { className: 'rc-doc-vista' }, ...miniaturas);
  vista.setAttribute('aria-hidden', 'true');
  return vista;
}

/**
 * Lleva al informe de esta página: pasa al paso 4, que lo enseña, y le da el foco a su título, que lo lee a
 * continuación. El informe se prepara en segundo plano y no se ve hasta que la persona lo pide.
 */
function irAlInforme() {
  irA(PASO_INFORME);
  const informe = porId('paso-4');
  // La vista del paso 4 enseña el informe, no la hoja de ruta (documento-hoja.js).
  delete informe.dataset.vista;
  /** @type {HTMLElement | null} */
  const titulo = informe.querySelector('#titulo');
  informe.scrollIntoView({ block: 'start' });
  titulo?.setAttribute('tabindex', '-1');
  titulo?.focus({ preventScroll: true });
}

/** Imprime solo el informe, aunque esté abierta la vista de la hoja de ruta. */
function imprimirSoloElInforme() {
  imprimir('informe');
}

/** «Leer el informe» y «Guardar en PDF o imprimir», que imprime solo el informe (impresion.js). */
function acciones() {
  const leer = escribir(
    crear('a', { className: 'rc-boton-principal', href: '#paso-4' }),
    traducible('recorrido.documento.leer'),
  );
  leer.addEventListener('click', (evento) => {
    evento.preventDefault();
    irAlInforme();
  });
  const guardar = escribir(
    crear('button', { type: 'button', className: 'rc-boton-secundario' }),
    traducible('recorrido.documento.imprimir'),
  );
  guardar.addEventListener('click', imprimirSoloElInforme);
  return crear('div', { className: 'rc-doc-acciones' }, leer, guardar);
}

/**
 * Añade bajo `mensaje` la tarjeta del informe ya pintado en #informe. `ocupacion` es el nombre que se enseña con él,
 * si se conoce. Sin hojas (el informe no ha llegado a pintarse), no añade nada.
 * @param {HTMLElement} mensaje @param {Parte | null} ocupacion @returns {void}
 */
export function mostrarDocumentoDelInforme(mensaje, ocupacion) {
  const documento = crearDocumentoDelInforme(ocupacion);
  if (documento) {
    mensaje.querySelector('.rc-texto')?.append(documento);
  }
}

/**
 * La tarjeta del informe ya pintado en #informe (la de «Tu carpeta», carpeta.js), o null si aún no tiene hojas.
 * @param {Parte | null} ocupacion @returns {HTMLElement | null}
 */
export function crearDocumentoDelInforme(ocupacion) {
  const hojas = hojasDelInforme();
  if (!hojas) {
    return null;
  }
  const detalle = crear(
    'span',
    {},
    escribir(crear('span'), cuantasHojas(hojas)),
    ...(ocupacion ? [document.createTextNode(' · '), escribir(crear('span'), ocupacion)] : []),
  );
  const icono = crear('span', { className: 'rc-doc-icono', textContent: 'A4' });
  icono.setAttribute('aria-hidden', 'true');
  const cabeza = crear(
    'div',
    { className: 'rc-doc-cabeza' },
    icono,
    crear('div', {}, escribir(crear('strong'), traducible('recorrido.documento.titulo')), detalle),
  );
  return crear('div', { className: 'rc-documento' }, cabeza, vistaPrevia(hojas), acciones());
}
