// «Compartir mi informe»: abre el menú de compartir del propio dispositivo (Web Share API del W3C, navigator.share)
// con el resumen del informe en texto (su portada) y, si el navegador admite compartir archivos (navigator.canShare),
// el informe entero en un archivo de texto hecho en el dispositivo (lectura-del-informe.js). Solo a petición: nada se
// comparte sin pulsar el botón, y Faro no envía nada a ningún sitio; es el sistema el que lo pasa a la aplicación que
// elige la persona. Donde el navegador no ofrece Web Share, el botón no aparece y el informe sigue igual. Lo compartido
// empieza por el título del PDF (data-titulo-pdf), que dice si el informe contiene texto generado con IA.

import { crear } from './dom.js';
import { escribir } from './idioma.js';
import { comoTexto, fragmentosDe, informeDe } from './lectura-del-informe.js';
import { traducible } from './textos.js';

/** El archivo compartido se llama igual en castellano y en catalán. */
const NOMBRE_DEL_ARCHIVO = 'informe-de-faro.txt';
/** Texto llano: los navegadores dicen con canShare si lo pueden compartir como archivo. */
const TIPO_DEL_ARCHIVO = 'text/plain';
/** El id del botón de compartir, único en la página. */
const ID_BOTON = 'compartir';
/** El id de la ayuda del botón de compartir, único en la página. */
const ID_AYUDA = 'compartir-ayuda';

/** Si este navegador ofrece el menú de compartir del dispositivo. */
function hayWebShare() {
  return typeof navigator.share === 'function';
}

/**
 * Lo que se comparte: el título y el resumen (la portada) en texto y, si el navegador lo admite, el informe entero,
 * de la versión que se ve, en un archivo de texto. Todo sale del informe ya pintado en la página.
 * @param {HTMLElement} informe @returns {ShareData}
 */
function datosParaCompartir(informe) {
  const titulo = informe.dataset.tituloPdf ?? '';
  const portada = informe.querySelector('.portada');
  const resumen = `${titulo}\n\n${comoTexto(portada ? fragmentosDe(portada) : [])}`;
  const entero = `${titulo}\n\n${comoTexto(fragmentosDe(informe))}`;
  const datos = { title: titulo, text: resumen };
  const conArchivo = { ...datos, files: [new File([entero], NOMBRE_DEL_ARCHIVO, { type: TIPO_DEL_ARCHIVO })] };
  return typeof navigator.canShare === 'function' && navigator.canShare(conArchivo) ? conArchivo : datos;
}

/**
 * Abre el menú de compartir. Cerrarlo sin elegir nada no es un fallo; cualquier otro rechazo se dice en el estado del
 * informe, sin detalles técnicos.
 * @param {HTMLElement} informe @param {Element | null} estado @param {AbortSignal} signal @returns {Promise<void>}
 */
async function compartir(informe, estado, signal) {
  try {
    await navigator.share(datosParaCompartir(informe));
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return;
    }
    if (estado instanceof HTMLElement) {
      escribir(estado, traducible('informe.compartir.fallo'));
    }
  }
}

/**
 * Añade «Compartir mi informe» y su ayuda al cierre de un informe ya pintado, antes de «Borrar», si el navegador
 * ofrece Web Share; si no, no hace nada. Los dos se retiran con `signal`, cuando se prepara otro informe.
 * @param {Element} raiz @param {AbortSignal} signal @returns {void}
 */
export function prepararCompartir(raiz, signal) {
  const informe = informeDe(raiz);
  const borrar = raiz.querySelector('#borrar');
  const marcaFinal = raiz.querySelector('.marca-final');
  if (signal.aborted || !hayWebShare() || !informe || !borrar || !marcaFinal) {
    return;
  }
  const boton = crear('button', { type: 'button', className: 'secundaria', id: ID_BOTON });
  const ayuda = crear('p', { className: 'ayuda-de-accion', id: ID_AYUDA });
  boton.setAttribute('aria-describedby', ID_AYUDA);
  borrar.before(boton);
  marcaFinal.before(ayuda);
  // Ya dentro del informe: si está en otra lengua que la página, `escribir` les pone la suya (WCAG 3.1.2).
  escribir(boton, traducible('informe.compartir'));
  escribir(ayuda, traducible('informe.compartir.ayuda'));
  // Mientras el menú está abierto, otra pulsación no abre otro: el navegador la rechazaría como un fallo.
  let abierto = false;
  const alPulsar = () => {
    if (abierto) {
      return;
    }
    abierto = true;
    // compartir no lanza: sus fallos se dicen en el estado del informe.
    void compartir(informe, raiz.querySelector('#estado'), signal).finally(() => {
      abierto = false;
    });
  };
  boton.addEventListener('click', alPulsar, { signal });
  signal.addEventListener(
    'abort',
    () => {
      boton.remove();
      ayuda.remove();
    },
    { once: true },
  );
}
