// El desafío «¿Cuánto sabes de IA?» de la guía «Qué es la IA»: doce situaciones, una cada vez. Al tocar una respuesta
// se ve si es correcta (en verde, con ✓) o no (en rojo, con ✗, y la correcta en verde) y por qué, en una región que
// leen los lectores de pantalla; las opciones quedan bloqueadas hasta «Siguiente pregunta». Al final, «N de 12» y las
// partes de la guía que conviene releer, con su enlace. Se puede repetir. Cuenta la primera respuesta de cada
// pregunta, no tiene cronómetro y no guarda nada: ni almacenamiento, ni cookies, ni red. Todo vive en memoria mientras
// la página está abierta.
//
// El HTML trae el desafío como una lista que se lee sin JavaScript ([data-desafio-lista]): cada situación
// ([data-pregunta], con la parte que repasar en data-repaso y su nombre en data-repaso-texto) tiene su enunciado
// ([data-enunciado]), sus opciones ([data-opcion="a"], la buena con data-correcta) y, dentro de un <details>, el porqué
// de cada una ([data-porque="a"]). Todos llevan su clave en data-texto. El módulo lee esas claves, oculta la lista y
// arma el juego en [data-desafio-juego], con un fieldset por pregunta y botones; todo se escribe con su clave, así que
// cambia de idioma con la página. Si la lista no cumple ese contrato, lanza PaginaIncompleta y la lista se queda.

import './sitio.js';
import { crear, PaginaIncompleta } from './dom.js';
import { escribir } from './idioma.js';
import { traducible } from './textos.js';

/** Desde esta parte de aciertos, el resultado es «bueno» aunque haya fallos. */
const PARTE_PARA_BUEN_RESULTADO = 0.75;
/** Una pregunta necesita al menos dos opciones. */
const MINIMO_DE_OPCIONES = 2;
/** Claves de los textos que escribe el guion. */
const CLAVES = Object.freeze({
  progreso: 'entender-ia.desafio.progreso',
  siguiente: 'entender-ia.desafio.siguiente',
  verResultado: 'entender-ia.desafio.ver-resultado',
  correcto: 'entender-ia.desafio.correcto',
  incorrecto: 'entender-ia.desafio.incorrecto',
  marcaCorrecta: 'entender-ia.desafio.marca.correcta',
  marcaIncorrecta: 'entender-ia.desafio.marca.incorrecta',
  marcaTuya: 'entender-ia.desafio.marca.tuya',
  tituloResultado: 'entender-ia.desafio.resultado.titulo',
  resultado: 'entender-ia.desafio.resultado',
  todas: 'entender-ia.desafio.todas',
  bien: 'entender-ia.desafio.bien',
  repasar: 'entender-ia.desafio.repasar',
  cuentaUna: 'entender-ia.desafio.cuenta.una',
  cuentaVarias: 'entender-ia.desafio.cuenta.varias',
  repetir: 'entender-ia.desafio.repetir',
});

/**
 * Una opción de una pregunta, con las claves de su texto y de su porqué.
 * @typedef {{ letra: string, clave: string, porque: string, correcta: boolean }} Opcion
 */
/**
 * Una pregunta leída del HTML.
 * @typedef {{ enunciado: string, opciones: Opcion[], repaso: string, repasoTexto: string }} Pregunta
 */
/**
 * Las piezas del juego, creadas una vez.
 * @typedef {Object} Piezas
 * @property {HTMLElement} progreso
 * @property {HTMLFieldSetElement} pregunta
 * @property {HTMLElement} enunciado
 * @property {HTMLElement} opciones
 * @property {HTMLElement} explicacion
 * @property {HTMLButtonElement} siguiente
 * @property {HTMLElement} resultado
 * @property {HTMLElement} cifra
 * @property {HTMLElement} valoracion
 * @property {HTMLElement} repaso
 * @property {HTMLButtonElement} repetir
 */
/**
 * La partida en curso: solo en memoria.
 * @typedef {Object} Partida
 * @property {Pregunta[]} preguntas
 * @property {Piezas} piezas
 * @property {number} actual
 * @property {number} aciertos
 * @property {Pregunta[]} falladas
 * @property {boolean} respondida
 */

/**
 * La clave de data-texto de un elemento, o PaginaIncompleta si falta.
 * @param {Element | null} elemento @param {string} que @returns {string}
 */
function claveDe(elemento, que) {
  const clave = elemento instanceof HTMLElement ? elemento.dataset.texto : undefined;
  if (!clave) {
    throw new PaginaIncompleta(`Al desafío le falta la clave de ${que}`);
  }
  return clave;
}

/**
 * Lee una situación de la lista del HTML y comprueba que tiene enunciado, opciones con su porqué y una sola correcta.
 * @param {HTMLElement} elemento @param {number} posicion @returns {Pregunta}
 */
export function leerPregunta(elemento, posicion) {
  const numero = posicion + 1;
  const opciones = [...elemento.querySelectorAll('[data-opcion]')].map((opcion) => {
    const letra = opcion instanceof HTMLElement ? (opcion.dataset.opcion ?? '') : '';
    return {
      letra,
      clave: claveDe(opcion, `la opción ${letra} de la pregunta ${numero}`),
      porque: claveDe(
        elemento.querySelector(`[data-porque="${letra}"]`),
        `el porqué ${letra} de la pregunta ${numero}`,
      ),
      correcta: opcion.hasAttribute('data-correcta'),
    };
  });
  const { repaso = '', repasoTexto = '' } = elemento.dataset;
  if (opciones.length < MINIMO_DE_OPCIONES || opciones.filter(({ correcta }) => correcta).length !== 1) {
    throw new PaginaIncompleta(`La pregunta ${numero} del desafío no tiene opciones o una sola correcta`);
  }
  if (!repaso || !repasoTexto) {
    throw new PaginaIncompleta(`La pregunta ${numero} del desafío no dice qué parte repasar`);
  }
  return {
    enunciado: claveDe(elemento.querySelector('[data-enunciado]'), `la pregunta ${numero}`),
    opciones,
    repaso,
    repasoTexto,
  };
}

/**
 * Las piezas del juego, vacías, ya dentro de su contenedor.
 * @param {HTMLElement} juego @returns {Piezas}
 */
function crearPiezas(juego) {
  const enunciado = crear('h3', { className: 'desafio-enunciado', tabIndex: -1 });
  const opciones = crear('div', { className: 'desafio-opciones' });
  const pregunta = crear('fieldset', { className: 'desafio-pregunta' }, crear('legend', {}, enunciado), opciones);
  const explicacion = crear('div', { className: 'desafio-explicacion' });
  explicacion.setAttribute('aria-live', 'polite');
  const siguiente = crear('button', { type: 'button', className: 'boton-accion', hidden: true });
  const cifra = crear('p', { className: 'desafio-cifra' });
  const valoracion = crear('p', { className: 'desafio-valoracion' });
  const repaso = crear('ul', { className: 'desafio-repaso' });
  const repetir = escribir(crear('button', { type: 'button', className: 'boton-accion' }), traducible(CLAVES.repetir));
  const titulo = escribir(crear('h3', { className: 'desafio-resultado-titulo' }), traducible(CLAVES.tituloResultado));
  const resultado = crear('div', { className: 'desafio-resultado', hidden: true, tabIndex: -1 });
  resultado.append(titulo, cifra, valoracion, repaso, repetir);
  const progreso = crear('p', { className: 'desafio-progreso' });
  juego.replaceChildren(progreso, pregunta, explicacion, siguiente, resultado);
  return {
    progreso,
    pregunta,
    enunciado,
    opciones,
    explicacion,
    siguiente,
    resultado,
    cifra,
    valoracion,
    repaso,
    repetir,
  };
}

/**
 * Lleva el foco a un elemento sin que la vista salte; solo si se ha quedado fuera de la pantalla, la vista va hasta él,
 * lo justo para verlo.
 * @param {HTMLElement} elemento
 */
function enfocar(elemento) {
  elemento.focus({ preventScroll: true });
  if (typeof elemento.getBoundingClientRect !== 'function') {
    return;
  }
  const { top, bottom } = elemento.getBoundingClientRect();
  if (top < 0 || bottom > window.innerHeight) {
    elemento.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Una opción como botón, con su texto; la marca ✓ o ✗ se le añade al responder.
 * @param {Partida} partida @param {Opcion} opcion @returns {HTMLButtonElement}
 */
function crearBoton(partida, opcion) {
  const boton = crear('button', { type: 'button', className: 'desafio-opcion' });
  boton.dataset.opcion = opcion.letra;
  boton.append(escribir(crear('span', { className: 'desafio-opcion-texto' }), traducible(opcion.clave)));
  boton.addEventListener('click', () => responder(partida, opcion));
  return boton;
}

/**
 * Pinta la pregunta en curso: su número, su enunciado y sus opciones, sin responder.
 * @param {Partida} partida
 */
function pintarPregunta(partida) {
  const { piezas, preguntas, actual } = partida;
  const pregunta = preguntas[actual];
  if (!pregunta) {
    return;
  }
  escribir(piezas.progreso, traducible(CLAVES.progreso, { numero: actual + 1, total: preguntas.length }));
  escribir(piezas.enunciado, traducible(pregunta.enunciado));
  piezas.opciones.replaceChildren(...pregunta.opciones.map((opcion) => crearBoton(partida, opcion)));
  piezas.explicacion.replaceChildren();
  piezas.siguiente.hidden = true;
  partida.respondida = false;
}

/**
 * Añade a un botón ya respondido su marca: el icono, que se ve, y la palabra, para los lectores de pantalla.
 * @param {HTMLElement} boton @param {boolean} correcta @param {boolean} elegida
 */
function marcar(boton, correcta, elegida) {
  boton.classList.add(correcta ? 'es-correcta' : 'es-incorrecta');
  const icono = crear('span', { className: 'desafio-marca', textContent: correcta ? '✓' : '✗' });
  icono.setAttribute('aria-hidden', 'true');
  const palabra = escribir(
    crear('span', { className: 'solo-lectores' }),
    traducible(correcta ? CLAVES.marcaCorrecta : CLAVES.marcaIncorrecta),
  );
  boton.append(icono, palabra);
  if (elegida) {
    boton.append(escribir(crear('span', { className: 'solo-lectores' }), traducible(CLAVES.marcaTuya)));
  }
}

/**
 * Responde la pregunta en curso con una opción, si aún no estaba respondida: marca la elegida y la correcta, bloquea
 * las opciones, explica la respuesta y deja ver el botón para seguir.
 * @param {Partida} partida @param {Opcion} elegida
 */
function responder(partida, elegida) {
  const pregunta = partida.preguntas[partida.actual];
  if (partida.respondida || !pregunta) {
    return;
  }
  partida.respondida = true;
  if (elegida.correcta) {
    partida.aciertos += 1;
  } else {
    partida.falladas.push(pregunta);
  }
  const { piezas } = partida;
  for (const boton of piezas.opciones.querySelectorAll('button')) {
    const opcion = pregunta.opciones.find(({ letra }) => letra === boton.dataset.opcion);
    boton.setAttribute('aria-disabled', 'true');
    if (opcion && (opcion.correcta || opcion === elegida)) {
      marcar(boton, opcion.correcta, opcion === elegida);
    }
  }
  const veredicto = escribir(crear('strong'), traducible(elegida.correcta ? CLAVES.correcto : CLAVES.incorrecto));
  const porque = escribir(crear('span'), traducible(elegida.porque));
  const clase = elegida.correcta ? 'es-correcta' : 'es-incorrecta';
  piezas.explicacion.replaceChildren(crear('p', { className: clase }, veredicto, ' ', porque));
  const esLaUltima = partida.actual === partida.preguntas.length - 1;
  escribir(piezas.siguiente, traducible(esLaUltima ? CLAVES.verResultado : CLAVES.siguiente));
  piezas.siguiente.hidden = false;
}

/**
 * Las partes que releer, en el orden de la guía, con cuántas preguntas se fallaron de cada una.
 * @param {Pregunta[]} falladas @returns {Map<string, { texto: string, n: number }>}
 */
export function partesQueReleer(falladas) {
  const partes = new Map();
  for (const { repaso, repasoTexto } of falladas) {
    partes.set(repaso, { texto: repasoTexto, n: (partes.get(repaso)?.n ?? 0) + 1 });
  }
  return partes;
}

/**
 * La valoración del resultado: todas bien, un buen resultado o conviene repasar.
 * @param {number} aciertos @param {number} total @returns {string}
 */
function claveDeValoracion(aciertos, total) {
  if (aciertos === total) {
    return CLAVES.todas;
  }
  return aciertos >= total * PARTE_PARA_BUEN_RESULTADO ? CLAVES.bien : CLAVES.repasar;
}

/**
 * Enseña el resultado: «N de 12», su valoración y las partes que releer, con su enlace; el foco va al resultado.
 * @param {Partida} partida
 */
function mostrarResultado(partida) {
  const { piezas, preguntas, aciertos } = partida;
  const total = preguntas.length;
  escribir(piezas.cifra, traducible(CLAVES.resultado, { aciertos, total }));
  escribir(piezas.valoracion, traducible(claveDeValoracion(aciertos, total)));
  const filas = [...partesQueReleer(partida.falladas)].map(([id, { texto, n }]) => {
    const enlace = escribir(crear('a', { href: `#${id}` }), traducible(texto));
    const cuenta = traducible(n === 1 ? CLAVES.cuentaUna : CLAVES.cuentaVarias, { n });
    return crear('li', {}, enlace, ' ', escribir(crear('span'), cuenta));
  });
  piezas.repaso.replaceChildren(...filas);
  piezas.repaso.hidden = filas.length === 0;
  for (const pieza of [piezas.progreso, piezas.pregunta, piezas.explicacion, piezas.siguiente]) {
    pieza.hidden = true;
  }
  piezas.resultado.hidden = false;
  enfocar(piezas.resultado);
}

/**
 * Vuelve a la primera pregunta, sin aciertos ni fallos, y le lleva el foco.
 * @param {Partida} partida
 */
function empezar(partida) {
  Object.assign(partida, { actual: 0, aciertos: 0, falladas: [], respondida: false });
  const { piezas } = partida;
  piezas.resultado.hidden = true;
  for (const pieza of [piezas.progreso, piezas.pregunta, piezas.explicacion]) {
    pieza.hidden = false;
  }
  pintarPregunta(partida);
}

/**
 * «Siguiente pregunta» o, en la última, «Ver el resultado».
 * @param {Partida} partida
 */
function seguir(partida) {
  if (!partida.respondida) {
    return;
  }
  if (partida.actual === partida.preguntas.length - 1) {
    mostrarResultado(partida);
    return;
  }
  partida.actual += 1;
  pintarPregunta(partida);
  enfocar(partida.piezas.enunciado);
}

/**
 * Pone en marcha el desafío de la página, si lo tiene: lee la lista, arma el juego y lo enseña en su lugar.
 * @throws {PaginaIncompleta} Si falta el contenedor del juego o una pregunta no cumple el contrato; la lista se queda.
 */
function iniciarDesafio() {
  const lista = document.querySelector('[data-desafio-lista]');
  if (!(lista instanceof HTMLElement)) {
    return;
  }
  const juego = document.querySelector('[data-desafio-juego]');
  if (!(juego instanceof HTMLElement)) {
    throw new PaginaIncompleta('Al desafío le falta su contenedor [data-desafio-juego]');
  }
  const preguntas = [...lista.querySelectorAll('[data-pregunta]')].map((elemento, posicion) => {
    if (!(elemento instanceof HTMLElement)) {
      throw new PaginaIncompleta('Una pregunta del desafío no es un elemento HTML');
    }
    return leerPregunta(elemento, posicion);
  });
  if (!preguntas.length) {
    throw new PaginaIncompleta('El desafío no tiene preguntas');
  }
  /** @type {Partida} */
  const partida = { preguntas, piezas: crearPiezas(juego), actual: 0, aciertos: 0, falladas: [], respondida: false };
  partida.piezas.siguiente.addEventListener('click', () => seguir(partida));
  partida.piezas.repetir.addEventListener('click', () => {
    empezar(partida);
    enfocar(partida.piezas.enunciado);
  });
  empezar(partida);
  lista.hidden = true;
  juego.hidden = false;
}

iniciarDesafio();
