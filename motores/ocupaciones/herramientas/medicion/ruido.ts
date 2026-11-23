// Personas que se equivocan. --ruido personas, con un modelo fijado a priori: en las preguntas abstractas (niveles,
// campo, trato, estudios, cuenta propia), 25 % «No lo sé», 15 % al azar y 20 % como su grupo vecino; en las concretas
// (tareas, opciones), 10 %, 5 % y 10 %. --ruido persistente: el 30 % de las personas (fijo por persona) cree que su
// trabajo es el de su grupo vecino y lo mantiene; responde las abstractas siempre como su vecino (salvo un 15 % «No lo
// sé») y las concretas como su vecino la mitad de las veces (10 % «No lo sé»). El otro 70 %, como en --ruido personas.

import type { Persona, Simulacion } from './respuestas.ts';
import { responder } from './respuestas.ts';
import type { Pregunta } from './tipos.ts';

/** Versión del modelo de ruido: cambia si cambia cualquier regla de este archivo o de las propuestas. No entra en el azar. */
export const VERSION_DEL_RUIDO = '1';

/** Proporción de personas con una confusión persistente. */
const CONFUNDIDAS = 0.3;
/** «No lo sé» de una persona confundida: en las preguntas abstractas y en las concretas. */
const NO_SE_CONFUNDIDA_ABSTRACTA = 0.15;
const NO_SE_CONFUNDIDA_CONCRETA = 0.1;
/** Una persona confundida responde las concretas como su vecino la mitad de las veces. */
const COMO_VECINO_CONFUNDIDA = 0.5;
/** El ruido habitual: «No lo sé», al azar y como el vecino, en las preguntas abstractas y en las concretas. */
const RUIDO_ABSTRACTAS = { noSe: 0.25, alAzar: 0.15, comoVecino: 0.2 } as const;
const RUIDO_CONCRETAS = { noSe: 0.1, alAzar: 0.05, comoVecino: 0.1 } as const;

const ABSTRACTAS = new Set([
  'nivel1',
  'nivel2',
  'nivel3',
  'campo',
  'precision',
  'trato',
  'universidad',
  'cuenta_propia',
]);
const NO_LO_SE = 'no_lo_se';

export const esPersistente = (sim: Simulacion): boolean => sim.opciones.ruido === 'persistente';
export const conRuido = (sim: Simulacion): boolean => sim.opciones.ruido === 'personas' || esPersistente(sim);
/** Si la persona tiene una confusión persistente (solo con --ruido persistente). */
export const confundida = (sim: Simulacion, persona: Persona): boolean =>
  esPersistente(sim) && sim.azar(persona.clave, 'confundida') < CONFUNDIDAS;

const comoSuVecino = (persona: Persona): Persona => ({ grupo: persona.vecino, esco: [], clave: '', vecino: '' });
const esAbstracta = (pregunta: Pregunta): boolean => ABSTRACTAS.has(pregunta.id.split(':')[0] ?? '');

function responderConfundida(sim: Simulacion, pregunta: Pregunta, persona: Persona): string {
  const abstracta = esAbstracta(pregunta);
  const ids = pregunta.opciones.map((o) => String(o.id));
  const k = [persona.clave, pregunta.id, 'persistente'];
  const noSe = abstracta ? NO_SE_CONFUNDIDA_ABSTRACTA : NO_SE_CONFUNDIDA_CONCRETA;
  if (ids.includes(NO_LO_SE) && sim.azar(...k, 'nose') < noSe) {
    return NO_LO_SE;
  }
  if (abstracta || sim.azar(...k, 'vecino') < COMO_VECINO_CONFUNDIDA) {
    return responder(sim, pregunta, comoSuVecino(persona));
  }
  return responder(sim, pregunta, persona);
}

/**
 * Lo que responde la persona a una pregunta, con el ruido de la medición.
 *
 * @param sim - La simulación.
 * @param pregunta - La pregunta.
 * @param persona - La persona.
 * @returns El id de la opción elegida.
 */
export function responderConRuido(sim: Simulacion, pregunta: Pregunta, persona: Persona): string {
  if (!conRuido(sim)) {
    return responder(sim, pregunta, persona);
  }
  if (confundida(sim, persona)) {
    return responderConfundida(sim, pregunta, persona);
  }
  const { noSe, alAzar, comoVecino } = esAbstracta(pregunta) ? RUIDO_ABSTRACTAS : RUIDO_CONCRETAS;
  const ids = pregunta.opciones.map((o) => String(o.id));
  const k = [persona.clave, pregunta.id];
  if (ids.includes(NO_LO_SE) && sim.azar(...k, 'nose') < noSe) {
    return NO_LO_SE;
  }
  const validas = ids.filter((i) => i !== NO_LO_SE);
  if (validas.length && sim.azar(...k, 'azar') < alAzar) {
    return validas[Math.floor(sim.azar(...k, 'cual') * validas.length)] as string;
  }
  if (sim.azar(...k, 'vecino') < comoVecino) {
    return responder(sim, pregunta, comoSuVecino(persona));
  }
  return responder(sim, pregunta, persona);
}
