// La barra con que el aviso «Faro se está preparando…» del chat enseña la primera vez cuánto falta: la copia del paquete
// que hace el service worker y la carga del motor del dispositivo, en un solo porcentaje (avance-de-la-preparacion.js).
// - Escucha desde que se carga la página, para saber cómo va la copia antes de que la persona escriba.
// - La barra solo se mueve cuando llega un avance real: sin movimiento en bucle, y sin transición con
//   prefers-reduced-motion (estilos/recorrido/conversacion.css).
// - El lector de pantalla oye el porcentaje solo al 25, 50, 75 y 100 %: la línea que se ve cambia más a menudo y no se
//   lee (aria-hidden), y la barra (role="progressbar") lleva el valor para quien la consulte.
// - Si no llega ningún avance (por un fallo), el aviso se queda con su texto, sin barra.
// - Si el motor del dispositivo no se puede usar (un fallo que no es de paso), el aviso que dice que Faro se prepara se
//   retira de la conversación: ya no es verdad, y lo que ha pasado lo cuenta el fallo (detenerLaPreparacion).

import { crear } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { escucharLaCarga } from '../motor-local/cliente.js';
import { escucharLaCopia, prepararPaqueteSinConexion } from '../paquete-sin-conexion.js';
import { traducible } from '../textos.js';
import {
  CIEN,
  estadoDeLaCopia,
  porcentajeDeLaPreparacion,
  queSeEstaHaciendo,
  reintentosDeLaCopia,
  umbralPasado,
} from './avance-de-la-preparacion.js';

/** @import { Preparacion, CopiaContada } from './avance-de-la-preparacion.js' */

/** Lo que se sabe de la preparación en esta página; lo cambian los avances. */
const preparacion = {
  /** @type {CopiaContada | null} */
  copia: null,
  /** @type {Set<string>} */
  fases: new Set(),
  reintentando: false,
  listo: false,
  detenida: false,
  copiaDetenida: false,
};
/** Quienes siguen la preparación (la barra de cada aviso, la espera del primer paso). @type {Set<() => void>} */
const oyentes = new Set();

function avisar() {
  for (const oyente of [...oyentes]) {
    oyente();
  }
}

/** Lo que se hace con cada intento de la copia que acaba sin ella con el motor listo (reintentosDeLaCopia). */
const reintentarLaCopia = reintentosDeLaCopia({
  pedir: () => {
    prepararPaqueteSinConexion().catch(() => {
      // Sin service worker no hay copia que pedir ni motor que responda: lo cuenta la petición al motor (motor.js).
    });
  },
  enLinea: () => globalThis.navigator?.onLine !== false,
  alVolverLaRed: (pedir) => globalThis.addEventListener?.('online', pedir, { once: true }),
});

escucharLaCopia((avance) => {
  // ESTADO_DEL_PAQUETE solo dice si ha quedado completa: se conservan las cifras del último progreso.
  preparacion.copia =
    avance.archivos === null && preparacion.copia ? { ...preparacion.copia, completo: avance.completo } : avance;
  if (avance.archivos === null && !avance.completo && preparacion.listo && reintentarLaCopia() === 'detenida') {
    preparacion.copiaDetenida = true;
  }
  avisar();
});
escucharLaCarga((fase) => {
  preparacion.fases.add(fase);
  preparacion.reintentando = false;
  preparacion.detenida = false;
  avisar();
});

/**
 * Sigue la preparación hasta que se deja: `oyente` se llama con cada avance.
 * @param {() => void} oyente @returns {() => void} Deja de seguirla.
 */
function alAvanzar(oyente) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/**
 * Si la copia de lo que espera el primer análisis se está haciendo ahora: el service worker ha contado archivos y aún
 * faltan. Con lo del primer análisis ya guardado, el resto de la copia sigue, pero la conversación ya no lo espera.
 */
function copiandose() {
  const { copia } = preparacion;
  const esperada = copia?.primerAnalisis ?? copia;
  return Boolean(
    copia && !copia.completo && esperada?.archivos != null && (esperada.guardados ?? 0) < esperada.archivos,
  );
}

/**
 * Llama a `alPreparar` en cuanto se sabe que la copia del paquete se está haciendo, ya o más tarde, para que el chat
 * diga que Faro se prepara mientras espera al motor. Devuelve con qué dejar de esperarlo.
 * @param {() => void} alPreparar @returns {() => void}
 */
export function alCopiarseElPaquete(alPreparar) {
  if (copiandose()) {
    alPreparar();
    return () => {};
  }
  const dejar = alAvanzar(() => {
    if (copiandose()) {
      dejar();
      alPreparar();
    }
  });
  return dejar;
}

/**
 * Un intento de pedir al motor ha fallado mientras se prepara y el recorrido lo va a repetir: la barra dice
 * «reintentando…» hasta el siguiente avance, en vez de quedarse parada sin explicación.
 */
export function anotarReintento() {
  if (!preparacion.listo) {
    preparacion.reintentando = true;
    avisar();
  }
}

/**
 * El motor del dispositivo no se puede usar en esta página, y volver a pedirlo no lo arregla: la preparación no va a
 * terminar, y el aviso que dice que Faro se prepara se retira.
 */
export function detenerLaPreparacion() {
  if (!preparacion.listo && !preparacion.detenida) {
    preparacion.detenida = true;
    avisar();
  }
}

/**
 * El motor del dispositivo ha respondido: la conversación ya no espera. La barra llega al 100 % solo con la copia sin
 * conexión completa y verificada (porcentajeDeLaPreparacion, conLaCopia).
 */
export function terminarLaPreparacion() {
  if (!preparacion.listo) {
    preparacion.listo = true;
    avisar();
  }
}

/** Lo que dice el porcentaje entre paréntesis. @param {Preparacion} estado */
function detalle(estado) {
  const haciendo = queSeEstaHaciendo(estado);
  if (haciendo.tipo === 'megas') {
    return traducible('recorrido.local.preparando.megas', { hechos: haciendo.hechos, total: haciendo.total });
  }
  return haciendo.tipo === 'archivos'
    ? traducible('recorrido.local.preparando.archivos', { guardados: haciendo.guardados, archivos: haciendo.archivos })
    : traducible(`recorrido.local.preparando.fase.${haciendo.tipo}`);
}

/** Lo que dice la línea, para no repintarla igual. @param {Preparacion} estado */
function claveDelDetalle(estado) {
  return JSON.stringify([estadoDeLaCopia(estado), queSeEstaHaciendo(estado)]);
}

/**
 * Los textos de los estados de la copia sin conexión, una vez que el motor ha respondido (estadoDeLaCopia).
 * @type {Readonly<Record<'empezar' | 'lista' | 'detenida', string>>}
 */
const TEXTO_DE_LA_COPIA = Object.freeze({
  empezar: 'copia-sin-conexion.empezar',
  detenida: 'copia-sin-conexion.detenida',
  lista: 'copia-sin-conexion.lista',
});

/**
 * Las piezas de la barra, dentro del texto del aviso: la línea que se ve (no se lee: aria-hidden), la barra con su
 * valor y el anuncio para el lector de pantalla, vacío hasta el primer umbral.
 * @param {Element} texto
 * @returns {{ linea: HTMLElement, barra: HTMLElement, anuncio: HTMLElement }}
 */
function crearPiezas(texto) {
  const linea = crear('p', { className: 'rc-preparacion-linea' });
  linea.setAttribute('aria-hidden', 'true');
  const barra = crear(
    'div',
    { className: 'rc-preparacion-barra' },
    crear('span', { className: 'rc-preparacion-relleno' }),
  );
  barra.setAttribute('role', 'progressbar');
  barra.setAttribute('aria-valuemin', '0');
  barra.setAttribute('aria-valuemax', String(CIEN));
  escribirAtributo(barra, 'aria-label', traducible('recorrido.local.preparando.barra'));
  const anuncio = crear('p', { className: 'solo-lectores' });
  texto.append(crear('div', { className: 'rc-preparacion' }, linea, barra, anuncio));
  return { linea, barra, anuncio };
}

/** La clave del texto del estado de la copia (TEXTO_DE_LA_COPIA), o null si no tiene. @returns {string | null} */
function claveDelTextoDeLaCopia() {
  const estado = estadoDeLaCopia(preparacion);
  return estado ? TEXTO_DE_LA_COPIA[estado] : null;
}

/**
 * Escribe el porcentaje y lo que se está haciendo en la barra y en la línea que se ve.
 * @param {{ linea: HTMLElement, barra: HTMLElement }} piezas @param {number} porcentaje
 */
function escribirElAvance({ linea, barra }, porcentaje) {
  const clave = claveDelTextoDeLaCopia();
  const avance = clave
    ? traducible(clave)
    : traducible('recorrido.local.preparando.avance', { porcentaje, detalle: detalle(preparacion) });
  barra.setAttribute('aria-valuenow', String(porcentaje));
  escribirAtributo(barra, 'aria-valuetext', avance);
  barra.style.setProperty('--avance', String(porcentaje / CIEN));
  barra.dataset.avance = String(porcentaje);
  escribir(linea, avance);
}

/**
 * Avisa al lector de pantalla si se ha pasado un umbral (UMBRALES_ANUNCIADOS) o si la copia ha cambiado de estado
 * (estadoDeLaCopia); devuelve el último umbral anunciado.
 * @param {HTMLElement} anuncio @param {number} anunciado @param {number} porcentaje @param {boolean} cambiaLaCopia
 * @returns {number}
 */
function anunciar(anuncio, anunciado, porcentaje, cambiaLaCopia) {
  const clave = claveDelTextoDeLaCopia();
  const umbral = umbralPasado(anunciado, porcentaje);
  if (clave && cambiaLaCopia) {
    escribir(anuncio, traducible(clave));
  } else if (umbral !== null) {
    escribir(anuncio, traducible('recorrido.local.preparando.anuncio', { porcentaje: umbral }));
  }
  return umbral ?? anunciado;
}

/**
 * Añade la barra al aviso del chat que dice que Faro se prepara, en cuanto hay un avance que enseñar, y la mueve con
 * cada uno hasta el 100 %. Sin avances, el aviso no cambia. Si la preparación se detiene (detenerLaPreparacion), el
 * aviso se retira.
 * @param {HTMLElement} mensaje El aviso (conversacion.js, decirFaro). @returns {HTMLElement} El mismo aviso.
 */
export function mostrarLaPreparacion(mensaje) {
  const texto = mensaje.querySelector('.rc-texto') ?? mensaje;
  /** @type {{ linea: HTMLElement, barra: HTMLElement, anuncio: HTMLElement } | null} */
  let piezas = null;
  let pintado = -1;
  let anunciado = 0;
  /** @type {() => void} */
  let dejar = () => {};
  let dicho = '';
  /** @type {'empezar' | 'lista' | 'detenida' | null} */
  let estadoDicho = null;
  const pintar = () => {
    if (preparacion.detenida) {
      dejar();
      mensaje.remove();
      return;
    }
    const nuevo = porcentajeDeLaPreparacion(preparacion, { conLaCopia: true });
    // Nunca retrocede: si un intento falla, la barra se queda donde estaba y la línea dice que se reintenta.
    const calculado = nuevo === null ? null : Math.max(nuevo, pintado);
    const clave = claveDelDetalle(preparacion);
    if (calculado === null || (calculado === pintado && clave === dicho)) {
      return;
    }
    const cambiaLaCopia = estadoDeLaCopia(preparacion) !== estadoDicho;
    estadoDicho = estadoDeLaCopia(preparacion);
    pintado = calculado;
    dicho = clave;
    piezas ??= crearPiezas(texto);
    escribirElAvance(piezas, calculado);
    anunciado = anunciar(piezas.anuncio, anunciado, calculado, cambiaLaCopia);
    if (calculado === CIEN) {
      dejar();
    }
  };
  dejar = alAvanzar(pintar);
  pintar();
  return mensaje;
}
