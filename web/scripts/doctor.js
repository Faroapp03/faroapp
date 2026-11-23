// La página «Comprobar Faro» (doctor.html): al abrirla comprueba Faro en este dispositivo (doctor/comprobaciones.js) y enseña
// cada resultado con su semáforo y qué hacer. Debajo, un resumen en texto de los resultados: la persona puede
// revisarlos antes de imprimir la página en PDF (la ventana de impresión del navegador, con la hoja de impresión de
// estilos/doctor.css) o de enviarlo por correo. El correo solo sale con el contacto de publicación configurado:
// abre el programa de correo de la persona con el asunto y el resumen, y el PDF lo adjunta ella. Al
// cambiar de idioma se reescribe todo y solo se recalcula la comprobación del idioma. Empieza importando sitio.js:
// espera a que termine el intento de cargar su diccionario antes de escribir textos.

import './sitio.js';
import { enlaceDeCorreo } from './contacto.js';
import { CONTACTO_PUBLICO } from './contacto-publico.js';
import { comprobarIdioma, comprobarTodo, entornoDelNavegador } from './doctor/comprobaciones.js';
import { crear, porId } from './dom.js';
import { conArticulo, fechaLargaConHora, partesLocales } from './fechas.js';
import { alCambiarIdioma } from './idioma.js';
import { idiomaActual, texto } from './textos.js';

/** @import { Resultado } from './doctor/comprobaciones.js' */

const lista = porId('doctor-lista', HTMLUListElement);
const estado = porId('doctor-estado');
const resultadoSeccion = porId('doctor-resultado');
const fecha = porId('doctor-fecha');
const version = porId('doctor-version');
const navegador = porId('doctor-navegador');
const textoInforme = porId('doctor-texto');
const repetir = porId('doctor-repetir', HTMLButtonElement);
const descargar = porId('doctor-pdf', HTMLButtonElement);
const correo = porId('doctor-correo', HTMLAnchorElement);
const ayudaCorreo = porId('doctor-correo-ayuda');

/**
 * La última comprobación: lo que se reescribe al cambiar de idioma. La sustituye cada `comprobar()` y la lee
 * `pintar()`.
 * @type {{ cuando: Date, version: string | null, resultados: Resultado[] } | null}
 */
let ultima = null;

/**
 * La fecha y la hora de la comprobación, en el idioma de la página.
 * @param {Date} cuando El instante de la comprobación.
 * @returns {string} La fecha larga y la hora corta.
 */
function fechaEscrita(cuando) {
  return fechaLargaConHora(partesLocales(cuando), idiomaActual() === 'ca' ? 'ca' : 'es');
}

/** Los textos de un resultado en el idioma en curso. @param {Resultado} comprobado */
function textosDe(comprobado) {
  return {
    nombre: texto(`doctor.${comprobado.id}.nombre`),
    semaforo: texto(`doctor.semaforo.${comprobado.semaforo}`),
    detalle: texto(`doctor.${comprobado.id}.${comprobado.caso}.detalle`, comprobado.valores),
    accion: texto(`doctor.${comprobado.id}.${comprobado.caso}.accion`, comprobado.valores),
  };
}

/** Una fila de la lista: la marca de color (solo adorno), su palabra, qué se ha mirado, lo visto y qué hacer.
 * @param {Resultado} comprobado
 */
function fila(comprobado) {
  const { nombre, semaforo, detalle, accion } = textosDe(comprobado);
  return crear(
    'li',
    { className: `doctor-fila doctor-${comprobado.semaforo}` },
    crear('span', { className: 'doctor-marca' }),
    crear('p', { className: 'doctor-semaforo', textContent: semaforo }),
    crear('h3', { textContent: nombre }),
    crear('p', { textContent: detalle }),
    crear('p', { className: 'doctor-accion', textContent: `${texto('doctor.que-hacer')} ${accion}` }),
  );
}

/** El informe como texto: lo que se ve en la página, lo que lleva el correo y lo que se imprime en el PDF. */
function informeEnTexto() {
  if (!ultima) {
    return '';
  }
  const lineas = [
    texto('doctor.informe.cabecera'),
    `${texto('doctor.fecha')} ${fechaEscrita(ultima.cuando)}`,
    `${texto('doctor.version')} ${ultima.version ?? texto('doctor.version.desconocida')}`,
    `${texto('doctor.navegador')} ${navigator.userAgent}`,
    '',
  ];
  for (const comprobado of ultima.resultados) {
    const { nombre, semaforo, detalle, accion } = textosDe(comprobado);
    lineas.push(`[${semaforo}] ${nombre}: ${detalle}`, `  ${texto('doctor.que-hacer')} ${accion}`);
  }
  return lineas.join('\n');
}

/**
 * Escribe la última comprobación en el idioma en curso. Antes vuelve a calcular el resultado «idioma», que depende
 * del idioma de la página, y actualiza `ultima.resultados` con él; las demás comprobaciones se conservan.
 */
function pintar() {
  if (!ultima) {
    return;
  }
  // Solo se recalcula el resultado del idioma; las demás comprobaciones conservan su observación anterior.
  ultima.resultados = ultima.resultados.map((comprobado) =>
    comprobado.id === 'idioma' ? comprobarIdioma(idiomaActual(), navigator.language) : comprobado,
  );
  const { resultados } = ultima;
  const cuantos = (/** @type {string} */ semaforo) =>
    String(resultados.filter((comprobado) => comprobado.semaforo === semaforo).length);
  estado.textContent = texto('doctor.estado.hecho', {
    bien: cuantos('bien'),
    atencion: cuantos('atencion'),
    fallo: cuantos('fallo'),
  });
  fecha.textContent = fechaEscrita(ultima.cuando);
  version.textContent = ultima.version ?? texto('doctor.version.desconocida');
  navegador.textContent = navigator.userAgent;
  lista.replaceChildren(...resultados.map(fila));
  const informe = informeEnTexto();
  textoInforme.textContent = informe;
  correo.hidden = !CONTACTO_PUBLICO.correo;
  ayudaCorreo.hidden = !CONTACTO_PUBLICO.correo;
  if (CONTACTO_PUBLICO.correo) {
    const idioma = idiomaActual() === 'ca' ? 'ca' : 'es';
    const dia = partesLocales(ultima.cuando).dia;
    const asunto = texto('doctor.correo.asunto', {
      fecha: conArticulo(fechaEscrita(ultima.cuando), dia, idioma, 'de'),
    });
    const cuerpo = `${informe}\n\n${texto('doctor.correo.adjunto')}`;
    correo.href = enlaceDeCorreo(CONTACTO_PUBLICO.correo, { asunto, cuerpo }) ?? '';
  } else {
    correo.removeAttribute('href');
  }
  resultadoSeccion.hidden = false;
}

/** El día de la comprobación para el nombre del archivo (AAAA-MM-DD, hora local). @param {Date} cuando */
function diaDeArchivo(cuando) {
  return [cuando.getFullYear(), cuando.getMonth() + 1, cuando.getDate()]
    .map((numero) => String(numero).padStart(2, '0'))
    .join('-');
}

/**
 * Abre la ventana de impresión para guardar el PDF. Se facilita al navegador el título de la página: mientras imprime,
 * el título es «Comprobar Faro · informe AAAA-MM-DD» y, al cerrar la ventana, vuelve a ser el de siempre.
 */
function descargarPdf() {
  const titulo = document.title;
  document.title = texto('doctor.pdf.archivo', { fecha: diaDeArchivo(ultima?.cuando ?? new Date()) });
  globalThis.addEventListener(
    'afterprint',
    () => {
      document.title = titulo;
    },
    { once: true },
  );
  globalThis.print();
}

/**
 * Comprueba todo y lo enseña; mientras, el botón espera y el estado lo dice. Si algo falla por el camino, el fallo
 * llega a la consola y «Repetir» vuelve a estar disponible: nunca se queda deshabilitado.
 * @returns {Promise<void>}
 */
async function comprobar() {
  repetir.disabled = true;
  estado.textContent = texto('doctor.estado.comprobando');
  try {
    const hecho = await comprobarTodo(entornoDelNavegador(), idiomaActual());
    ultima = { cuando: new Date(), ...hecho };
    pintar();
  } finally {
    repetir.disabled = false;
  }
}

repetir.addEventListener('click', comprobar);
descargar.addEventListener('click', descargarPdf);
alCambiarIdioma(pintar);
// Sin await: la página ya está entera y la comprobación escribe su resultado al terminar; un fallo sale en la consola
// como promesa rechazada y deja «Repetir» disponible (finally de comprobar).
void comprobar();
