// Estado del diálogo del recorrido con el motor local, sin DOM ni red: lo escrito y las respuestas a las preguntas.
// paso-ocupacion.js aplica las transiciones y pinta la conversación. El motor reconstruye cada paso con ese estado;
// «Atrás» quita la última respuesta.

import { MAX_RELATO } from '../protocolo-web.js';

/** @typedef {{ pregunta: string, opcion: string }} Respuesta */
/**
 * @typedef {{
 *   texto: string,
 *   respuestas: readonly Respuesta[],
 *   aclaraciones: number,
 *   anadido: string,
 *   sinAvance: number,
 * }} Estado
 */

/** Lo más que se escribe en la caja (MAX_RELATO del motor). */
export const MAX_LETRAS = MAX_RELATO;
/** @returns {Estado} */
export function estadoInicial() {
  return {
    texto: '',
    respuestas: [],
    aclaraciones: 0,
    anadido: '',
    sinAvance: 0,
  };
}

/**
 * Empieza con un texto nuevo: sin respuestas anteriores. `sinAvance` se conserva: si lo de antes tampoco
 * llevó a nada («hola» y otra vez «hola»), cuenta para pasar a los botones (destinoDelPaso).
 * @param {Estado} estado @param {string} texto @returns {Estado}
 */
export function empezar(estado, texto) {
  return {
    ...estado,
    texto: texto.trim().slice(0, MAX_LETRAS),
    respuestas: [],
    aclaraciones: 0,
    anadido: '',
  };
}

/**
 * «Lo cuento con mis palabras»: lo que escribe durante las preguntas se AÑADE a lo que ya había (nunca lo sustituye) y
 * se recalcula todo sin empezar de nuevo: las respuestas dadas se conservan.
 * @param {Estado} estado @param {string} nuevo @returns {Estado}
 */
export function anadirTexto(estado, nuevo) {
  const limpio = nuevo.trim();
  // Lo ya dicho no cuenta dos veces: la búsqueda no cambia y la pantalla lo trata como un «Lo cuento» sin cambios.
  if (esRepeticion(estado.texto, limpio)) {
    return { ...estado };
  }
  return {
    ...estado,
    texto: `${estado.texto}. ${limpio}`.slice(0, MAX_LETRAS),
    anadido: (estado.anadido ? `${estado.anadido}. ${limpio}` : limpio).slice(0, MAX_LETRAS),
  };
}

/**
 * Lo escrito era solo un saludo, un «gracias» o una pregunta sobre Faro (el motor lo dice en `lectura.cortesia`): se
 * vuelve a la entrada con la caja vacía y sin gastar la aclaración, que es para cuando no se entiende un trabajo.
 * @param {Estado} estado @returns {Estado}
 */
export function trasCortesia(estado) {
  return {
    ...estado,
    texto: '',
    respuestas: [],
    aclaraciones: 0,
    anadido: '',
    sinAvance: estado.sinAvance + 1,
  };
}

/** Palabras de un texto para compararlas: minúsculas, sin tildes y sin puntuación. @param {string} texto */
function palabras(texto) {
  return (
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * Si lo nuevo no trae ninguna palabra que no estuviera ya en lo escrito («hago las nóminas» dos veces): entonces no se
 * añade, para que lo repetido no pese el doble en la búsqueda.
 * @param {string} texto @param {string} nuevo
 */
function esRepeticion(texto, nuevo) {
  const ya = new Set(palabras(texto));
  const nuevas = palabras(nuevo);
  return nuevas.length > 0 && nuevas.every((p) => ya.has(p));
}

/** Veces que Faro pide que se cuente un día normal antes de pasar a «No encuentro la mía». */
const MAX_ACLARACIONES = 1;

/**
 * Faro no ha entendido el texto y la persona cuenta su día con otras palabras: se busca con las dos cosas juntas.
 * @param {Estado} estado @param {string} nuevo @returns {Estado}
 */
export function aclarar(estado, nuevo) {
  const texto = esRepeticion(estado.texto, nuevo)
    ? estado.texto
    : `${estado.texto}. ${nuevo.trim()}`.slice(0, MAX_LETRAS);
  return {
    ...estado,
    texto,
    respuestas: [],
    aclaraciones: estado.aclaraciones + 1,
  };
}

/** Si ya se ha pedido aclarar todas las veces previstas. @param {Estado} estado */
function sinMasAclaraciones(estado) {
  return estado.aclaraciones >= MAX_ACLARACIONES;
}

/**
 * @typedef {{ tipo: 'pregunta', pregunta: { id: string, tipo?: string, texto: string, opciones: readonly { id: string }[] } }
 *   | { tipo: 'propuesta', mejor: { grupo: string, ocupacion?: { esco: string } },
 *       alternativas: readonly { id: string }[] }
 *   | { tipo: 'decidida' | 'no_encontrada' }} PasoVisto
 */
/**
 * Lo que distingue un paso de otro: su pregunta (identidad, texto y opciones) o su propuesta. Si no cambia tras «Lo
 * cuento con mis palabras», lo contado no ha servido.
 * @param {{ paso: PasoVisto } | null} u
 */
export function huellaDelPaso(u) {
  if (!u) {
    return '';
  }
  const { paso } = u;
  if (paso.tipo === 'pregunta') {
    const { id, tipo, texto, opciones } = paso.pregunta;
    return JSON.stringify(['pregunta', id, tipo, texto, opciones.map((o) => o.id)]);
  }
  if (paso.tipo === 'propuesta') {
    return JSON.stringify([
      'propuesta',
      paso.mejor.grupo,
      paso.mejor.ocupacion?.esco,
      ...paso.alternativas.map((a) => a.id),
    ]);
  }
  return paso.tipo;
}

/**
 * Textos libres seguidos que no hacen avanzar (solo cortesía o algo que Faro no entiende) antes de dejar de pedir otro
 * texto y pasar a los botones de las familias. Con dos, «hola» y otra vez «hola» ya no vuelven a la caja vacía.
 */
const TOPE_SIN_AVANCE = 2;

/**
 * @typedef {'cortesia' | 'aclarar' | 'guiado' | 'pregunta' | 'confirmar' | 'decidida' | 'familias'} Destino
 * `guiado`: las familias con un aviso propio y, si había una pregunta o propuesta, la vuelta a ella.
 */
/**
 * @typedef {{ cortesia?: readonly string[], sinComprension: boolean }} LecturaDelPaso
 * @typedef {{ tipo: string }} PasoDelMotor
 */

/**
 * Adónde lleva lo que ha dicho el motor, con reglas fijas para que el texto libre no se repita en bucle:
 * - solo cortesía, sin respuestas: respuesta amable en la entrada; a la segunda seguida (TOPE_SIN_AVANCE), los botones;
 * - sin entender nada, sin respuestas: una aclaración; si ya se gastó o se llega al tope, las familias;
 * - un «Lo cuento con mis palabras» que no cambia nada (`sinCambios`): los botones, en vez de pedir otro texto igual;
 * - lo demás, la pregunta, la propuesta o la decisión, y el contador vuelve a cero.
 * @param {Estado} estado @param {{ lectura: LecturaDelPaso, paso: PasoDelMotor }} respuesta
 * @param {{ sinCambios?: boolean }} [opciones]
 * @returns {{ estado: Estado, destino: Destino, aviso?: string }}
 */
export function destinoDelPaso(estado, { lectura, paso }, { sinCambios = false } = {}) {
  const sinRespuestas = estado.respuestas.length === 0;
  if (lectura.cortesia?.length && sinRespuestas) {
    const tras = trasCortesia(estado);
    return tras.sinAvance >= TOPE_SIN_AVANCE
      ? { estado: tras, destino: 'guiado', aviso: 'recorrido.local.guiado.cortesia' }
      : { estado: tras, destino: 'cortesia' };
  }
  if (lectura.sinComprension && sinRespuestas) {
    const fallido = { ...estado, sinAvance: estado.sinAvance + 1 };
    return sinMasAclaraciones(estado) || fallido.sinAvance >= TOPE_SIN_AVANCE
      ? { estado: fallido, destino: 'familias', aviso: 'recorrido.local.familias.sin-entender' }
      : { estado: fallido, destino: 'aclarar' };
  }
  if (sinCambios) {
    const fallido = { ...estado, sinAvance: estado.sinAvance + 1 };
    return { estado: fallido, destino: 'guiado', aviso: 'recorrido.local.guiado.sin-cambios' };
  }
  const avanza = { ...estado, sinAvance: 0 };
  switch (paso.tipo) {
    case 'pregunta':
      return { estado: avanza, destino: 'pregunta' };
    case 'propuesta':
      return { estado: avanza, destino: 'confirmar' };
    case 'decidida':
      return { estado: avanza, destino: 'decidida' };
    default:
      return { estado: avanza, destino: 'familias', aviso: 'recorrido.local.familias.tras-rechazos' };
  }
}

/**
 * Añade la respuesta a una pregunta. Si ya había una a esa misma pregunta (dos pulsaciones seguidas), se cambia.
 * @param {Estado} estado @param {string} pregunta @param {string} opcion @returns {Estado}
 */
export function responder(estado, pregunta, opcion) {
  const sinEsa = estado.respuestas.filter((r) => r.pregunta !== pregunta);
  return { ...estado, respuestas: [...sinEsa, { pregunta, opcion }] };
}

/**
 * Quita la última respuesta: «Volver a la pregunta anterior». Las respuestas a las propuestas («Sí», «No», una
 * alternativa) son respuestas como las demás: «Atrás» también deshace un «No».
 * @param {Estado} estado @returns {Estado}
 */
export function deshacer(estado) {
  return { ...estado, respuestas: estado.respuestas.slice(0, -1) };
}
