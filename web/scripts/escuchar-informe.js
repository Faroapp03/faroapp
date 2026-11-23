// «Escuchar mi informe»: lo lee en voz alta la síntesis de voz del navegador (Web Speech API, speechSynthesis) con una
// voz del propio dispositivo en la lengua del informe. Solo se ofrece si la hay: una voz con localService la pone el
// sistema, y el texto no sale del dispositivo; si en esa lengua solo hay voces remotas, o ninguna, no se ofrece y se
// dice por qué. Nada suena sin que la persona lo pida (WCAG 1.4.2): escuchar, pausar, seguir y parar son botones, y
// parar, preparar otro informe, borrarlo o salir de la página callan la voz. Se lee fragmento a fragmento
// (lectura-del-informe.js), cada uno con una voz local de su lengua si la hay y, si no, con la del informe. Pausar
// calla el fragmento en curso y seguir lo repite desde su principio: pause() y resume() no se comportan igual en todos
// los navegadores (en algunos, pausar calla del todo y seguir ya no vuelve a sonar).

import { crear } from './dom.js';
import { escribir } from './idioma.js';
import { fragmentosDe, informeDe } from './lectura-del-informe.js';
import { esIdioma, traducible } from './textos.js';

/** @import { Fragmento } from './lectura-del-informe.js' */
/** @import { Idioma } from './textos.js' */

/** Los ids de los controles que añade la lectura al informe. */
const ID_DEL_BOTON = 'escuchar';
const ID_DE_PARAR = 'parar-lectura';
const ID_DE_LA_AYUDA = 'escuchar-ayuda';
const ID_DE_SIN_VOZ = 'escuchar-sin-voz';
/** Entre varias voces locales de una lengua se prefiere la de España (es-ES, ca-ES). */
const REGION_PREFERIDA = 'es';
/** Lo que dice el error de una frase callada a propósito (cancel()): no es un fallo de la voz. */
const CALLADA_A_PROPOSITO = new Set(['canceled', 'interrupted']);
/** El punto medio entre palabras separa (se dice como una pausa) y entre cifras escribe una fecha (27·09·2026). */
const PUNTO_MEDIO_ENTRE_PALABRAS = / · /g;
const PUNTO_MEDIO_ENTRE_CIFRAS = /(\d)·(?=\d)/g;
/** Lo que dice el botón principal en cada estado de la lectura. */
const ROTULOS = {
  parado: 'informe.escuchar',
  leyendo: 'informe.escuchar.pausar',
  'en-pausa': 'informe.escuchar.seguir',
};

/** @typedef {keyof typeof ROTULOS} EstadoDeLaLectura */
/**
 * Los elementos que añade la lectura al cierre del informe.
 * @typedef {{ boton: HTMLButtonElement, parar: HTMLButtonElement, ayuda: HTMLElement, sinVoz: HTMLElement }} Controles
 */

/** Si el navegador tiene síntesis de voz. */
function haySintesisDeVoz() {
  return 'speechSynthesis' in globalThis && typeof SpeechSynthesisUtterance === 'function';
}

/**
 * La etiqueta BCP 47 con guion: Android escribe «ca_ES» y la norma, «ca-ES». Cambia solo el primer «_».
 * @param {string} etiqueta La etiqueta como la da el sistema.
 * @returns {string} La misma etiqueta con «-» donde el sistema puso el primer «_».
 */
function normalizarEtiqueta(etiqueta) {
  return etiqueta.replace('_', '-');
}

/**
 * Las partes de una etiqueta BCP 47 en minúsculas: la lengua («es» de «es-ES», «ca» de «ca_ES») y, si la tiene, la
 * región.
 * @param {string} etiqueta La etiqueta, con «-» o con «_».
 * @returns {string[]} [lengua, región?].
 */
function partesDeLaEtiqueta(etiqueta) {
  return normalizarEtiqueta(etiqueta).toLowerCase().split('-');
}

/**
 * La voz del dispositivo para leer en `lengua`: solo voces locales (localService); entre ellas, la de España, después
 * la que el sistema tiene por defecto y, si no, la primera. null si no hay ninguna local en esa lengua.
 * @param {readonly SpeechSynthesisVoice[]} voces Las voces que da el sistema.
 * @param {string} lengua La lengua en que se lee.
 * @returns {SpeechSynthesisVoice | null} La voz elegida, o null si no hay ninguna local en esa lengua.
 */
function vozDelDispositivo(voces, lengua) {
  const buscada = partesDeLaEtiqueta(lengua)[0];
  const locales = voces
    .map((voz) => ({ voz, partes: partesDeLaEtiqueta(voz.lang) }))
    .filter(({ voz, partes }) => voz.localService && partes[0] === buscada);
  const deEspana = locales.find(({ partes }) => partes[1] === REGION_PREFERIDA);
  return (deEspana ?? locales.find(({ voz }) => voz.default) ?? locales[0])?.voz ?? null;
}

/** El texto de un fragmento tal como se dice. @param {string} texto */
function paraDecir(texto) {
  return texto.replace(PUNTO_MEDIO_ENTRE_PALABRAS, ', ').replace(PUNTO_MEDIO_ENTRE_CIFRAS, '$1/');
}

/**
 * La frase de un fragmento, con la voz local de su lengua o, si no la hay, con la del informe.
 * @param {Fragmento} fragmento El fragmento que se dice.
 * @param {readonly SpeechSynthesisVoice[]} voces Las voces que da el sistema.
 * @param {SpeechSynthesisVoice} delInforme La voz local de la lengua del informe.
 * @returns {SpeechSynthesisUtterance} La frase lista para `speak()`.
 */
function fraseDe(fragmento, voces, delInforme) {
  const frase = new SpeechSynthesisUtterance(paraDecir(fragmento.texto));
  frase.voice = vozDelDispositivo(voces, fragmento.idioma) ?? delInforme;
  // La lengua de la frase, en BCP 47: la de la voz, con guion aunque el sistema la escriba con «_».
  frase.lang = normalizarEtiqueta(frase.voice.lang);
  return frase;
}

/**
 * La lectura en voz alta de un informe, fragmento a fragmento, con una voz local de su lengua. `alCambiar` recibe cada
 * estado nuevo y `alFallar` se llama si la voz no puede seguir.
 */
class LecturaEnVoz {
  /** @type {EstadoDeLaLectura} */
  #estado = 'parado';
  /** El fragmento que suena, o el que sonará al seguir. */
  #indice = 0;
  /**
   * Cambia cada vez que se calla la voz: lo que avise una frase de un turno anterior (su «end», o su «error» tras
   * cancel()) ya no hace nada.
   */
  #turno = 0;
  /** @type {Fragmento[]} */
  #fragmentos = [];
  /** @type {SpeechSynthesisVoice[]} */
  #voces = [];
  /**
   * La frase que suena: sin ninguna referencia, Chromium puede soltarla antes de que avise de su final.
   * @type {SpeechSynthesisUtterance | null}
   */
  #enCurso = null;
  /** @type {HTMLElement} */
  #informe;
  /** @type {Idioma} */
  #idioma;
  /** @type {{ alCambiar: (estado: EstadoDeLaLectura) => void, alFallar: () => void }} */
  #avisos;

  /**
   * @param {HTMLElement} informe El informe pintado que se lee.
   * @param {Idioma} idioma La lengua del informe: la de la voz que lo lee.
   * @param {{ alCambiar: (estado: EstadoDeLaLectura) => void, alFallar: () => void }} avisos A quién se avisa.
   */
  constructor(informe, idioma, avisos) {
    this.#informe = informe;
    this.#idioma = idioma;
    this.#avisos = avisos;
  }

  /** @returns {EstadoDeLaLectura} Si está parada, leyendo o en pausa: lo único que se lee desde fuera. */
  get estado() {
    return this.#estado;
  }

  /** Lee el informe desde el principio, tal como se ve ahora. */
  escuchar() {
    this.#fragmentos = fragmentosDe(this.#informe);
    this.#voces = speechSynthesis.getVoices();
    this.#indice = 0;
    this.#leer();
  }

  /** Calla la voz y recuerda el fragmento en que iba. */
  pausar() {
    this.#callar();
    this.#cambiar('en-pausa');
  }

  /** Sigue desde el principio del fragmento en que se pausó. */
  seguir() {
    this.#leer();
  }

  /** Calla la voz y vuelve al principio; sin nada que parar, no toca la síntesis de voz. */
  parar() {
    if (this.#estado !== 'parado') {
      this.#terminar();
    }
  }

  #leer() {
    const delInforme = vozDelDispositivo(this.#voces, this.#idioma);
    // La voz local que se ofreció ya no está (el sistema la ha quitado): no se lee con otra.
    if (!delInforme) {
      this.#terminar();
      this.#avisos.alFallar();
      return;
    }
    this.#callar();
    this.#cambiar('leyendo');
    this.#decir(this.#turno, delInforme);
  }

  /** Dice el fragmento en curso y, al acabar, el siguiente; tras el último, la lectura termina.
   * @param {number} turno @param {SpeechSynthesisVoice} delInforme
   */
  #decir(turno, delInforme) {
    const fragmento = this.#fragmentos[this.#indice];
    if (!fragmento) {
      this.#terminar();
      return;
    }
    const frase = fraseDe(fragmento, this.#voces, delInforme);
    frase.addEventListener('end', () => {
      // Solo avanza la frase que suena en este turno: una de un turno anterior ya no es la que está en curso.
      if (turno !== this.#turno || frase !== this.#enCurso) {
        return;
      }
      this.#indice += 1;
      this.#decir(turno, delInforme);
    });
    frase.addEventListener('error', ({ error }) => {
      if (turno !== this.#turno || CALLADA_A_PROPOSITO.has(error)) {
        return;
      }
      this.#terminar();
      this.#avisos.alFallar();
    });
    this.#enCurso = frase;
    speechSynthesis.speak(frase);
  }

  #callar() {
    this.#turno += 1;
    this.#enCurso = null;
    speechSynthesis.cancel();
  }

  #terminar() {
    this.#callar();
    this.#indice = 0;
    this.#cambiar('parado');
  }

  /** @param {EstadoDeLaLectura} estado */
  #cambiar(estado) {
    this.#estado = estado;
    this.#avisos.alCambiar(estado);
  }
}

/**
 * Los botones de la lectura, antes de «Borrar», y su ayuda y lo que se dice si no hay voz, antes de la marca final;
 * todos ocultos hasta saber si hay voz. Se escriben ya dentro del informe: si está en otra lengua que la página,
 * `escribir` les pone la suya (WCAG 3.1.2).
 * @param {Element} borrar @param {Element} marcaFinal @returns {Controles}
 */
function crearControles(borrar, marcaFinal) {
  const boton = crear('button', { type: 'button', className: 'secundaria', id: ID_DEL_BOTON, hidden: true });
  const parar = crear('button', { type: 'button', className: 'secundaria', id: ID_DE_PARAR, hidden: true });
  const ayuda = crear('p', { className: 'ayuda-de-accion', id: ID_DE_LA_AYUDA, hidden: true });
  const sinVoz = crear('p', { className: 'ayuda-de-accion', id: ID_DE_SIN_VOZ, hidden: true });
  boton.setAttribute('aria-describedby', ID_DE_LA_AYUDA);
  borrar.before(boton, parar);
  marcaFinal.before(ayuda, sinVoz);
  escribir(parar, traducible('informe.escuchar.parar'));
  escribir(ayuda, traducible('informe.escuchar.ayuda'));
  return { boton, parar, ayuda, sinVoz };
}

/**
 * Ofrece la lectura si el dispositivo tiene una voz local de `idioma`; si tiene voces, pero ninguna local de esa
 * lengua, lo dice. Sin ninguna voz todavía (el navegador las carga después y avisa con voiceschanged), no dice nada.
 * @param {Controles} controles @param {Idioma} idioma
 */
function ofrecer({ boton, ayuda, sinVoz }, idioma) {
  const voces = speechSynthesis.getVoices();
  const hayVoz = vozDelDispositivo(voces, idioma) !== null;
  boton.hidden = !hayVoz;
  ayuda.hidden = !hayVoz;
  sinVoz.hidden = hayVoz || voces.length === 0;
  const lengua = traducible(`comun.idioma.nombre.${idioma}`);
  if (!sinVoz.hidden) {
    escribir(sinVoz, traducible('informe.escuchar.sin-voz', { lengua }));
  }
}

/**
 * El botón principal dice lo que hará (escuchar, pausar o seguir), y «Parar» solo está mientras hay algo que parar. Si
 * el foco estaba en «Parar» cuando desaparece, pasa al botón principal, que sigue en su sitio.
 * @param {Controles} controles @param {EstadoDeLaLectura} estado
 */
function pintar({ boton, parar }, estado) {
  escribir(boton, traducible(ROTULOS[estado]));
  const conElFoco = document.activeElement === parar;
  parar.hidden = estado === 'parado';
  if (parar.hidden && conElFoco) {
    boton.focus();
  }
}

/** Calla la voz y quita los controles del informe. @param {Controles} controles @param {LecturaEnVoz} lectura */
function retirar(controles, lectura) {
  lectura.parar();
  for (const elemento of Object.values(controles)) {
    elemento.remove();
  }
}

/**
 * Añade «Escuchar mi informe» al cierre de un informe ya pintado, antes de «Borrar», si el navegador tiene síntesis de
 * voz y el informe está en una lengua de la web. Con `signal` (otro informe, o este borrado) la voz calla y los
 * controles se retiran; al salir de la página, la voz calla.
 * @param {Element} raiz @param {AbortSignal} signal @returns {void}
 */
export function prepararEscucha(raiz, signal) {
  const informe = informeDe(raiz);
  const idioma = informe?.getAttribute('lang');
  const borrar = raiz.querySelector('#borrar');
  const marcaFinal = raiz.querySelector('.marca-final');
  if (signal.aborted || !haySintesisDeVoz() || !informe || !esIdioma(idioma) || !borrar || !marcaFinal) {
    return;
  }
  const controles = crearControles(borrar, marcaFinal);
  const estado = raiz.querySelector('#estado');
  const lectura = new LecturaEnVoz(informe, idioma, {
    alCambiar: (nuevo) => pintar(controles, nuevo),
    alFallar: () => {
      if (estado instanceof HTMLElement) {
        escribir(estado, traducible('informe.escuchar.fallo'));
      }
    },
  });
  const alPulsar = {
    parado: () => lectura.escuchar(),
    leyendo: () => lectura.pausar(),
    'en-pausa': () => lectura.seguir(),
  };
  const parar = () => lectura.parar();
  pintar(controles, 'parado');
  ofrecer(controles, idioma);
  controles.boton.addEventListener('click', () => alPulsar[lectura.estado](), { signal });
  controles.parar.addEventListener('click', parar, { signal });
  const alCambiarLasVoces = () => {
    if (lectura.estado === 'parado') {
      ofrecer(controles, idioma);
    }
  };
  speechSynthesis.addEventListener('voiceschanged', alCambiarLasVoces, { signal });
  window.addEventListener('pagehide', parar, { signal });
  signal.addEventListener('abort', () => retirar(controles, lectura), { once: true });
}
