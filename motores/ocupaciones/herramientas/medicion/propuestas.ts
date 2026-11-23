// La persona ante «¿Es esta?»: «Sí», una alternativa o «No», con el ruido de la medición, y la postura que mantiene
// con --respuesta-estable (la misma respuesta cada vez que le proponen el mismo grupo).

import type { Persona, Simulacion } from './respuestas.ts';
import { confundida, conRuido } from './ruido.ts';
import type { Alternativa, PasoPropuesta, Respuesta } from './tipos.ts';

export type Eleccion =
  | { readonly tipo: 'si' }
  | { readonly tipo: 'no' }
  | { readonly tipo: 'alternativa'; readonly alternativa: Alternativa };

/** Lo que una persona ya dijo a «¿Es esta?» de cada grupo en este recorrido ('si' o 'no'). */
export type Postura = Map<string, string>;

/** Error de botón fijo con --sensibilidad-alternativas (el que da la regla habitual con «Sí / No»). */
const DESLIZ_SENSIBLE = 0.025;
/** «Sí» al vecino aunque vea su propio grupo como alternativa, con --sensibilidad-alternativas. */
const SI_AL_VECINO_VISIBLE = 0.1;
/** Una persona confundida dice «Sí» a su vecino la mitad de las veces y «No» a su propio grupo un 20 %. */
const SI_AL_VECINO_CONFUNDIDA = 0.5;
const NO_AL_SUYO_CONFUNDIDA = 0.2;
/** Ruido habitual ante una propuesta: 5 % al azar y, si le proponen su vecino, «Sí» un 10 %. */
const PROPUESTA_AL_AZAR = 0.05;
const SI_AL_VECINO = 0.1;
/** Botones fijos antes de las alternativas: «Sí» y «No». */
const BOTONES_FIJOS = 2;

const SI: Eleccion = { tipo: 'si' };
const NO: Eleccion = { tipo: 'no' };

function eleccionSensible(paso: PasoPropuesta, persona: Persona, eleccion: Eleccion, sim: Simulacion): Eleccion {
  const k = [persona.clave, paso.id ?? 'local', paso.mejor.grupo];
  const botones: Eleccion[] = [
    SI,
    NO,
    ...paso.alternativas.map((alternativa) => ({ tipo: 'alternativa', alternativa }) as const),
  ];
  const elQueToca = (b: Eleccion): boolean =>
    b.tipo === eleccion.tipo &&
    (b.tipo !== 'alternativa' || eleccion.tipo !== 'alternativa' || b.alternativa === eleccion.alternativa);
  if (sim.azar(...k, 'desliz') < DESLIZ_SENSIBLE) {
    const otros = botones.filter((b) => !elQueToca(b));
    return otros[Math.floor(sim.azar(...k, 'cual-desliz') * otros.length)] as Eleccion;
  }
  if (
    eleccion.tipo !== 'si' &&
    paso.mejor.grupo === persona.vecino &&
    sim.azar(...k, 'vecino-visible') < SI_AL_VECINO_VISIBLE
  ) {
    return SI;
  }
  return eleccion;
}

function eleccionConfundida(paso: PasoPropuesta, persona: Persona, eleccion: Eleccion, sim: Simulacion): Eleccion {
  const k = [persona.clave, paso.id ?? 'local', paso.mejor.grupo, 'persistente'];
  if (paso.mejor.grupo === persona.vecino && sim.azar(...k, 'si') < SI_AL_VECINO_CONFUNDIDA) {
    return SI;
  }
  if (eleccion.tipo === 'si' && sim.azar(...k, 'no') < NO_AL_SUYO_CONFUNDIDA) {
    return NO;
  }
  return eleccion;
}

function botonAlAzar(paso: PasoPropuesta, i: number): Eleccion {
  if (i === 0) {
    return SI;
  }
  if (i === 1) {
    return NO;
  }
  return { tipo: 'alternativa', alternativa: paso.alternativas[i - BOTONES_FIJOS] as Alternativa };
}

function eleccionConRuido(paso: PasoPropuesta, persona: Persona, eleccion: Eleccion, sim: Simulacion): Eleccion {
  const k = [persona.clave, paso.id ?? 'local', paso.mejor.grupo];
  if (sim.azar(...k, 'azar') < PROPUESTA_AL_AZAR) {
    return botonAlAzar(paso, Math.floor(sim.azar(...k, 'cual') * (BOTONES_FIJOS + paso.alternativas.length)));
  }
  if (eleccion.tipo === 'no' && paso.mejor.grupo === persona.vecino && sim.azar(...k, 'vecino') < SI_AL_VECINO) {
    return SI;
  }
  return eleccion;
}

/** Qué elige la persona ante una propuesta: «sí», una alternativa o «no» (con ruido, a veces se equivoca). */
export function elegirEnPropuesta(sim: Simulacion, paso: PasoPropuesta, persona: Persona): Eleccion {
  const alternativa = paso.alternativas.find((a) => a.hipotesis.grupo === persona.grupo);
  let eleccion: Eleccion = alternativa ? { tipo: 'alternativa', alternativa } : NO;
  if (paso.mejor.grupo === persona.grupo) {
    eleccion = SI;
  }
  if (confundida(sim, persona)) {
    return eleccionConfundida(paso, persona, eleccion, sim);
  }
  if (conRuido(sim) && sim.opciones.sensibilidadAlternativas) {
    return eleccionSensible(paso, persona, eleccion, sim);
  }
  return conRuido(sim) ? eleccionConRuido(paso, persona, eleccion, sim) : eleccion;
}

/**
 * Anota la respuesta a «¿Es esta?» del grupo propuesto. Elegir una alternativa es un «No» a ese grupo y borra lo que
 * hubiera de la alternativa elegida.
 */
export function anotarPostura(postura: Postura, grupo: string, opcion: string): void {
  if (opcion === 'si' || opcion === 'no') {
    postura.set(grupo, opcion);
  } else if (String(opcion).startsWith('alt:')) {
    postura.set(grupo, 'no');
    postura.delete(String(opcion).split(':')[1] ?? '');
  }
}

/** La postura con que empieza un recorrido, leída de sus respuestas (p. ej. el «No» antes de «Lo cuento…»). */
export function posturaInicial(respuestas: readonly Respuesta[]): Postura {
  const postura: Postura = new Map();
  for (const r of respuestas.filter((x) => x.pregunta.startsWith('propuesta:'))) {
    anotarPostura(postura, r.pregunta.split(':')[1] ?? '', r.opcion);
  }
  return postura;
}

/** Qué elige la persona ante una propuesta, manteniendo con --respuesta-estable su «Sí» o «No» anterior a ese grupo. */
export function elegirConPostura(sim: Simulacion, paso: PasoPropuesta, persona: Persona, postura: Postura): Eleccion {
  const e = elegirEnPropuesta(sim, paso, persona);
  const antes = sim.opciones.respuestaEstable && !paso.local ? postura.get(paso.mejor.grupo) : undefined;
  if (antes === 'no' && e.tipo === 'si') {
    return NO;
  }
  if (antes === 'si' && e.tipo !== 'si') {
    return SI;
  }
  return e;
}
