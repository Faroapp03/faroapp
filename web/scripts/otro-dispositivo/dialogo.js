// «Pasar a otro dispositivo»: la entrada del menú y el botón al final del informe, que solo se ven con un informe a la
// vista, y el diálogo con el QR, el enlace copiable y una sola línea: quien escanee el código verá el informe. El
// código (formato.js) se escribe al abrir el diálogo y se olvida al cerrarlo: no se guarda en ningún sitio, ni en el
// navegador ni en un servidor. El QR es un trazado en el SVG del diálogo, sin HTML, y el enlace es su alternativa de
// texto.
// El diálogo es un <dialog> modal: lo cierra Escape y el foco vuelve a quien lo abrió. Tab no sale de él (el navegador
// dejaría pasar el foco a su propia barra): del último control vuelve al primero, y al revés con Mayúsculas.
// Las entradas están al final del informe, en el diálogo del recorrido («4 / 4», en su cabecera; la guía no se ve en el
// paso 4) y en el menú lateral de las páginas, que el recorrido no enseña. El diálogo solo está en recorrido.html: en
// las demás páginas, nada se conecta.

import qrcode from '../../terceros/qrcode-generator/qrcode.js';
import { porId, pulsaFuera } from '../dom.js';
import { escribir } from '../idioma.js';
import { traducible } from '../textos.js';
import { CodigoNoValido, codificar, enlaceConCodigo } from './formato.js';

/** @import { Resultado } from './formato.js' */
/** @import { Ocupacion, Tarea } from '../recorrido/estado.js' */

/** Los módulos de margen alrededor del QR, los que piden los lectores. */
const MARGEN = 4;
/** El id del diálogo, que solo tiene recorrido.html. */
const DIALOGO = 'dialogo-pasar';
/** El id del botón que abre el diálogo del recorrido (otro módulo): adonde vuelve el foco si se abrió desde él. */
const BOTON_DEL_RECORRIDO = 'ver-recorrido';

/**
 * El código del resultado que se puede pasar ahora, o null si no hay ninguno a la vista: lo ponen ofrecerPasar y
 * retirarPasar.
 * @type {string | null}
 */
let codigoParaPasar = null;
/** Si las entradas y el diálogo ya están conectados: iniciarPasar lo hace la primera vez que se ofrece un informe. */
let conectado = false;
/**
 * Quien abrió el diálogo, para devolverle el foco; si estaba en otro diálogo, ya cerrado, el botón que abre ese. Lo
 * pone abrir y lo suelta el cierre del diálogo. @type {HTMLElement | SVGElement | null}
 */
let quienAbrio = null;

/** El diálogo, si esta página lo tiene; si no, null. @returns {HTMLDialogElement | null} */
function elDialogo() {
  const dialogo = document.getElementById(DIALOGO);
  return dialogo instanceof HTMLDialogElement ? dialogo : null;
}

/**
 * El código del resultado, o null si no se puede pasar (sin tareas oficiales o con algo que el formato no admite).
 * @param {Resultado} paraPasar @returns {string | null}
 */
function codigoDe(paraPasar) {
  if (!paraPasar.tareas.length) {
    return null;
  }
  try {
    return codificar(paraPasar);
  } catch (error) {
    if (!(error instanceof CodigoNoValido)) {
      throw error;
    }
    return null;
  }
}

/** Enseña u oculta las dos entradas: la del menú y la del final del informe. @param {boolean} visibles */
function verEntradas(visibles) {
  for (const entrada of document.querySelectorAll('[data-pasar-entrada]')) {
    if (entrada instanceof HTMLElement) {
      entrada.hidden = !visibles;
    }
  }
}

/** Pinta el QR en el SVG del diálogo; sin enlace, lo deja vacío. @param {string} enlace */
function pintarQr(enlace) {
  const svg = porId('pasar-qr').querySelector('svg');
  const fondo = svg?.querySelector('rect');
  const modulos = svg?.querySelector('path');
  if (!svg || !fondo || !modulos) {
    throw new Error('#pasar-qr no tiene su <svg> con su <rect> y su <path>');
  }
  const { lado, trazado } = enlace ? dibujoDelQr(enlace) : { lado: 1, trazado: '' };
  svg.setAttribute('viewBox', `0 0 ${lado} ${lado}`);
  fondo.setAttribute('width', String(lado));
  fondo.setAttribute('height', String(lado));
  modulos.setAttribute('d', trazado);
}

/** Abre el diálogo con el QR y el enlace del resultado a la vista; antes cierra el del recorrido, si está abierto. */
function abrir() {
  const codigo = codigoParaPasar;
  if (!codigo) {
    return;
  }
  const enfocado = document.activeElement;
  quienAbrio = enfocado instanceof HTMLElement || enfocado instanceof SVGElement ? enfocado : null;
  const delRecorrido = document.querySelector(`dialog[open]:not(#${DIALOGO})`);
  if (delRecorrido instanceof HTMLDialogElement) {
    delRecorrido.close();
    quienAbrio = document.getElementById(BOTON_DEL_RECORRIDO);
  }
  const enlace = enlaceConCodigo(location.href, codigo);
  // El código lleva MAX_TAREAS tareas como mucho (formato.js): el enlace cabe de sobra en un QR y dibujoDelQr no falla.
  pintarQr(enlace);
  porId('pasar-enlace', HTMLInputElement).value = enlace;
  porId('pasar-estado').textContent = '';
  porId(DIALOGO, HTMLDialogElement).showModal();
}

/** Copia el enlace; si el navegador no deja, lo selecciona para copiarlo a mano. */
async function copiar() {
  const campo = porId('pasar-enlace', HTMLInputElement);
  try {
    await navigator.clipboard.writeText(campo.value);
    escribir(porId('pasar-estado'), traducible('recorrido.pasar.copiado'));
  } catch {
    campo.select();
    escribir(porId('pasar-estado'), traducible('recorrido.pasar.seleccionado'));
  }
}

/**
 * Tab no sale del diálogo: del último control al primero y, con Mayúsculas, del primero al último.
 * @param {HTMLDialogElement} dialogo @param {KeyboardEvent} evento
 */
function atraparElFoco(dialogo, evento) {
  if (evento.key !== 'Tab') {
    return;
  }
  const controles = [...dialogo.querySelectorAll('button, input')];
  const [primero, ultimo] = [controles[0], controles.at(-1)];
  const salta = evento.shiftKey ? document.activeElement === primero : document.activeElement === ultimo;
  if (!salta) {
    return;
  }
  evento.preventDefault();
  const destino = evento.shiftKey ? ultimo : primero;
  if (destino instanceof HTMLElement) {
    destino.focus();
  }
}

/** Conecta las entradas y el diálogo. Sin el diálogo en la página, no hay nada que conectar. */
function iniciarPasar() {
  const dialogo = elDialogo();
  if (!dialogo || conectado) {
    return;
  }
  conectado = true;
  document.addEventListener('click', (evento) => {
    const destino = evento.target;
    if (destino instanceof Element && destino.closest('[data-pasar-dispositivo]')) {
      abrir();
    }
  });
  // `copiar` captura su propio fallo: la promesa que devuelve no rechaza, y nadie la espera.
  porId('pasar-copiar').addEventListener('click', () => void copiar());
  porId('cerrar-pasar').addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('click', (evento) => {
    if (pulsaFuera(dialogo, evento)) {
      dialogo.close();
    }
  });
  dialogo.addEventListener('keydown', (evento) => atraparElFoco(dialogo, evento));
  // Cerrado, el enlace con el resultado no se queda en la página.
  dialogo.addEventListener('close', () => {
    pintarQr('');
    porId('pasar-enlace', HTMLInputElement).value = '';
    quienAbrio?.focus();
    quienAbrio = null;
  });
}

// ---------- Lo público ----------

/**
 * El tiempo que dedica la persona a una tarea que viaja. Solo se pasa un recorrido con el informe hecho, y el informe
 * exige el tiempo de cada tarea (revision.js, tareasListas): una tarea sin él es un error del programa, y no se le pone
 * un tiempo que la persona no ha dado.
 * @param {Tarea} tarea @returns {NonNullable<Tarea['tiempo']>}
 */
function tiempoQueViaja(tarea) {
  if (!tarea.tiempo) {
    throw new TypeError('Una tarea oficial sin tiempo no puede pasar a otro dispositivo.');
  }
  return tarea.tiempo;
}

/**
 * El resultado que viaja de un recorrido: la ocupación por sus códigos oficiales y las tareas con tarea oficial, con
 * su tiempo. Las que la persona contó con sus palabras sin tarea oficial no viajan: solo cuántas son.
 * @param {Pick<Ocupacion, 'isco08' | 'esco' | 'isco08Secundario'>} ocupacion
 * @param {Tarea[]} tareas
 * @param {{ idioma: 'es' | 'ca', fecha: string, sinIa?: boolean, propuestoPorIa?: boolean }} opciones
 * @returns {Resultado}
 * @throws {TypeError} Si una tarea oficial no tiene tiempo.
 */
export function resultadoDelRecorrido(ocupacion, tareas, { idioma, fecha, sinIa, propuestoPorIa }) {
  const oficiales = tareas.filter((tarea) => tarea.oficial);
  return {
    idioma,
    isco08: ocupacion.isco08,
    ...(ocupacion.esco ? { ocupacionEsco: ocupacion.esco } : {}),
    ...(ocupacion.isco08Secundario ? { isco08Secundario: ocupacion.isco08Secundario } : {}),
    ...(propuestoPorIa ? { grupoPropuestoPorIa: true } : {}),
    ...(sinIa ? { sinIa: true } : {}),
    fecha,
    tareas: oficiales.map((tarea) => ({ tareaOit: String(tarea.oficial), tiempo: tiempoQueViaja(tarea) })),
    sinViajar: tareas.length - oficiales.length,
  };
}

/**
 * Con un informe a la vista: se puede pasar a otro dispositivo si tiene alguna tarea oficial.
 * @param {Resultado} paraPasar
 */
export function ofrecerPasar(paraPasar) {
  iniciarPasar();
  codigoParaPasar = codigoDe(paraPasar);
  verEntradas(codigoParaPasar !== null);
}

/** El informe ya no está a la vista: no hay nada que pasar. */
export function retirarPasar() {
  codigoParaPasar = null;
  verEntradas(false);
  const dialogo = elDialogo();
  if (dialogo?.open) {
    dialogo.close();
  }
}

/**
 * El dibujo del QR del enlace: su lado en módulos, con el margen, y un trazado con un cuadrado por módulo oscuro, que
 * va en el SVG del diálogo (recorrido.html) sin HTML. Corrección de errores M: el enlace es corto y el código aguanta
 * una mancha o un reflejo.
 * @param {string} enlace @returns {{ lado: number, trazado: string }}
 */
export function dibujoDelQr(enlace) {
  const qr = qrcode(0, 'M');
  qr.addData(enlace, 'Byte');
  qr.make();
  const modulos = qr.getModuleCount();
  let trazado = '';
  for (let fila = 0; fila < modulos; fila++) {
    for (let columna = 0; columna < modulos; columna++) {
      if (qr.isDark(fila, columna)) {
        trazado += `M${columna + MARGEN} ${fila + MARGEN}h1v1h-1z`;
      }
    }
  }
  return { lado: modulos + MARGEN * 2, trazado };
}
