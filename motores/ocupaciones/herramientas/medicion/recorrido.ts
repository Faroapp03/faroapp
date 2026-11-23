// El recorrido de una persona: paso a paso, como la pantalla, hasta un final o el tope de pasos del simulador.

import { describir } from './pantalla.ts';
import type { Eleccion, Postura } from './propuestas.ts';
import { anotarPostura, elegirConPostura, posturaInicial } from './propuestas.ts';
import type { Persona, Simulacion } from './respuestas.ts';
import { responderConRuido } from './ruido.ts';
import type { Paso, PasoPropuesta, Respuesta, SalidaDePantalla } from './tipos.ts';
import { esDecidido, esPregunta, esPropuesta } from './tipos.ts';

/** Caracteres del id de la pregunta que se guardan en el texto de cada paso. */
const LARGO_DEL_PASO = 40;

/** Lo que hace la persona ante un paso: una respuesta, o el final del recorrido. */
export interface Accion {
  readonly respuesta?: Respuesta;
  readonly pasoTexto?: string;
  readonly pregunta?: boolean;
  readonly propuesta?: boolean;
  readonly rechazo?: boolean;
  readonly fin?: string;
  readonly grupo?: string | null;
  readonly esco?: string | null;
}

/** El estado con que empieza un recorrido: el texto, las respuestas ya dadas y lo añadido con «Lo cuento…». */
export interface Estado {
  readonly texto: string;
  readonly respuestas: readonly Respuesta[];
  readonly anadido: string;
}

export interface Recorrido {
  readonly final: string;
  readonly grupo: string | null | undefined;
  readonly preguntas: number;
  readonly propuestas: number;
  readonly pasos: readonly string[];
  readonly segundaConLaSuya: boolean | null;
  readonly esco?: string | null;
  readonly acciones?: number;
  readonly traza?: readonly object[];
}

const elegido = (paso: PasoPropuesta, e: Eleccion): string | null => {
  if (e.tipo === 'si') {
    return paso.mejor.grupo;
  }
  return e.tipo === 'alternativa' ? e.alternativa.hipotesis.grupo : null;
};

/** El texto del paso: «propuesta GRUPO=si», «=no» o «=GRUPO elegido»; «(pantalla)» si la decide la pantalla. */
function textoDeLaPropuesta(paso: PasoPropuesta, e: Eleccion, grupo: string | null): string {
  const respuestaCorta = e.tipo === 'no' ? 'no' : (grupo ?? '');
  return `propuesta ${paso.mejor.grupo}${paso.local ? ' (pantalla)' : ''}=${e.tipo === 'si' ? 'si' : respuestaCorta}`;
}

/** La pantalla decide sola: «Sí» o una alternativa llevan al resultado; «No», a las familias (buscar a mano). */
function finalEnLaPantalla(paso: PasoPropuesta, e: Eleccion, persona: Persona, pasoTexto: string): Accion {
  const grupo = elegido(paso, e);
  if (!grupo) {
    return { fin: 'a_familias', grupo: null, pasoTexto, propuesta: true };
  }
  const esco = e.tipo === 'alternativa' ? e.alternativa.hipotesis.ocupacion?.esco : paso.mejor.ocupacion?.esco;
  return { fin: grupo === persona.grupo ? 'bien' : 'mal', grupo, esco: esco ?? null, pasoTexto, propuesta: true };
}

function anteLaPropuesta(sim: Simulacion, paso: PasoPropuesta, persona: Persona, postura: Postura): Accion {
  const e = elegirConPostura(sim, paso, persona, postura);
  const pasoTexto = textoDeLaPropuesta(paso, e, elegido(paso, e));
  if (paso.local) {
    return finalEnLaPantalla(paso, e, persona, pasoTexto);
  }
  const opcion = e.tipo === 'alternativa' ? e.alternativa.id : e.tipo;
  return { respuesta: { pregunta: paso.id as string, opcion }, pasoTexto, propuesta: true, rechazo: e.tipo === 'no' };
}

/**
 * Lo que hace la persona ante un paso.
 *
 * @param sim - La simulación.
 * @param paso - El paso de la pantalla.
 * @param persona - La persona.
 * @param postura - Su postura ante las propuestas (con --respuesta-estable).
 * @returns La acción.
 */
export function actuar(sim: Simulacion, paso: Paso, persona: Persona, postura: Postura = new Map()): Accion {
  if (esPregunta(paso)) {
    const r = responderConRuido(sim, paso.pregunta, persona);
    const pasoTexto = `${paso.pregunta.id.slice(0, LARGO_DEL_PASO)}=${r}`;
    return { respuesta: { pregunta: paso.pregunta.id, opcion: r }, pasoTexto, pregunta: true };
  }
  if (esPropuesta(paso)) {
    return anteLaPropuesta(sim, paso, persona, postura);
  }
  if (esDecidido(paso)) {
    return { fin: paso.grupo === persona.grupo ? 'bien' : 'mal', grupo: paso.grupo, esco: paso.esco ?? null };
  }
  return { fin: 'sin_resultado', grupo: null };
}

/** El paso de la traza: qué vio y qué respondió la persona. */
function pasoDeLaTraza(sim: Simulacion, paso: Paso, persona: Persona & { idioma: string }, a: Accion): object {
  const vista = describir(sim.motor.datos, paso, persona.idioma);
  return {
    tipo: paso.tipo,
    ...(esPregunta(paso)
      ? { pregunta: paso.pregunta.tipo, id: paso.pregunta.id }
      : { id: (paso as { id?: string }).id ?? null }),
    mostrados: vista.grupos,
    suyo: vista.grupos.includes(persona.grupo),
    respuesta: a.respuesta?.opcion ?? null,
    ...(a.fin ? { fin: a.fin } : {}),
    ...(paso.motivo ? { motivo: paso.motivo } : {}),
  };
}

function actualizarPostura(postura: Postura, paso: Paso, a: Accion): void {
  if (a.respuesta && esPropuesta(paso)) {
    anotarPostura(postura, paso.mejor.grupo, a.respuesta.opcion);
  } else if (a.respuesta && ['grupo', 'area'].includes(a.respuesta.pregunta.split(':')[0] ?? '')) {
    postura.delete(a.respuesta.opcion);
  }
}

interface Cuenta {
  preguntas: number;
  propuestas: number;
  segundaConLaSuya: boolean | null;
  readonly pasos: string[];
  readonly traza: object[];
}

/** Suma el paso a la cuenta del recorrido: su texto, si fue pregunta o propuesta, y su traza (con --traza). */
function contar(cuenta: Cuenta, a: Accion, traza: object | null): void {
  if (traza) {
    cuenta.traza.push(traza);
  }
  if (a.pasoTexto) {
    cuenta.pasos.push(a.pasoTexto);
  }
  cuenta.preguntas += a.pregunta ? 1 : 0;
  cuenta.propuestas += a.propuesta ? 1 : 0;
}

function cierre(
  sim: Simulacion,
  cuenta: Cuenta,
  fin: { final: string; grupo: string | null | undefined },
  extra: {
    esco: string | null;
    acciones: number;
  },
): Recorrido {
  const { preguntas, propuestas, pasos, segundaConLaSuya } = cuenta;
  return {
    ...fin,
    preguntas,
    propuestas,
    pasos,
    segundaConLaSuya,
    ...(sim.opciones.traza ? { ...extra, traza: cuenta.traza } : {}),
  };
}

/**
 * Sigue el recorrido desde `estado` hasta el final, como la pantalla. Guarda también si el grupo de la persona estuvo
 * a la vista en la segunda pantalla.
 *
 * @param sim - La simulación.
 * @param persona - La persona y el idioma de su frase.
 * @param estado - El texto, las respuestas ya dadas y lo añadido.
 * @param primero - El primer paso, ya calculado.
 * @returns El recorrido.
 */
export function recorrer(
  sim: Simulacion,
  persona: Persona & { idioma: string },
  estado: Estado,
  primero: SalidaDePantalla,
): Recorrido {
  const respuestas = [...estado.respuestas];
  const cuenta: Cuenta = { preguntas: 0, propuestas: 0, segundaConLaSuya: null, pasos: [], traza: [] };
  const postura = posturaInicial(respuestas);
  let actual = primero;
  for (let n = 0; n < sim.opciones.maxPasos; n++) {
    const { paso } = actual;
    if (n === 1) {
      cuenta.segundaConLaSuya = describir(sim.motor.datos, paso, persona.idioma).grupos.includes(persona.grupo);
    }
    const a = actuar(sim, paso, persona, postura);
    actualizarPostura(postura, paso, a);
    contar(cuenta, a, sim.opciones.traza ? pasoDeLaTraza(sim, paso, persona, a) : null);
    if (a.fin) {
      return cierre(sim, cuenta, { final: a.fin, grupo: a.grupo }, { esco: a.esco ?? null, acciones: n + 1 });
    }
    respuestas.push(a.respuesta as Respuesta);
    const anadido = estado.anadido ? { anadido: estado.anadido } : {};
    actual = sim.motor.pasoDePantalla(sim.motor.datos, sim.motor.atributos, {
      texto: estado.texto,
      idioma: persona.idioma,
      respuestas,
      ...anadido,
    });
  }
  return cierre(sim, cuenta, { final: 'tope', grupo: null }, { esco: null, acciones: sim.opciones.maxPasos });
}
