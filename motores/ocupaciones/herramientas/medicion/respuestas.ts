// La persona simulada ante una pregunta. Tiene UNA identidad (un grupo y sus ocupaciones ESCO) y responde como la
// persona típica de su grupo; las tareas las contesta con el mismo parecido que usa el motor, así que sin ruido el
// resultado es un techo: una persona real dudará más.

import type { Azar } from './azar.ts';
import { grupoDe } from './bancos.ts';
import type { Opciones } from './opciones.ts';
import type { Atributos, GrupoDeAtributos, Motor, Pregunta } from './tipos.ts';

/** Lo que comparten todas las piezas de la simulación. */
export interface Simulacion {
  readonly motor: Motor;
  readonly opciones: Opciones;
  readonly azar: Azar;
  /** La clave de ruido de cada banco, por su nombre en los resultados. */
  readonly clavesDeRuido: ReadonlyMap<string, string>;
}

/** La persona simulada. */
export interface Persona {
  readonly grupo: string;
  readonly esco: readonly string[];
  readonly clave: string;
  readonly vecino: string;
}

/** Parecido de tarea por debajo del cual la persona no la reconoce como suya. */
const PARECIDO_SIN_CONFUSION = 0.35;
/** Desde esta proporción la persona contesta «sí» (a una tarea, a la universidad, a la cuenta propia). */
const UMBRAL_DEL_SI = 0.5;
const TRATO = ['personas', 'informacion', 'manos'];
const NO_LO_SE = 'no_lo_se';

const siNo = (valor: number | undefined): string => {
  if (valor === undefined) {
    return NO_LO_SE;
  }
  return valor >= UMBRAL_DEL_SI ? 'si' : 'no';
};

/** La respuesta de quien no ve lo suyo: «otra», «ninguna» o «no lo sé», según lo que ofrezca la pregunta. */
function resto(ids: readonly string[]): string {
  if (ids.includes('otra')) {
    return 'otra';
  }
  return ids.includes('ninguna') ? 'ninguna' : NO_LO_SE;
}

function tarea(atributos: Atributos, pregunta: Pregunta, grupo: string): string {
  const t = pregunta.id.slice('tarea:'.length);
  const parecido = (atributos.tareas[t]?.ve ?? []).find(([h]) => h === grupo)?.[1] ?? 0;
  const si = t.startsWith(`${grupo}-`)
    ? 1
    : Math.max(0, (parecido - PARECIDO_SIN_CONFUSION) / (1 - PARECIDO_SIN_CONFUSION));
  return si >= UMBRAL_DEL_SI ? 'si' : 'no';
}

function campo(g: GrupoDeAtributos | undefined, ids: readonly string[]): string {
  if (!g?.cm) {
    return NO_LO_SE;
  }
  const top = Object.entries(g.cm).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return ids.includes(top) ? top : resto(ids);
}

function trato(g: GrupoDeAtributos | undefined): string {
  // Con una tabla vacía no hay respuesta (undefined): la referencia se midió así.
  return g?.tr ? (TRATO[g.tr.indexOf(Math.max(...g.tr))] as string) : NO_LO_SE;
}

function nivel(tipo: string, grupo: string, ids: readonly string[]): string {
  const v = grupo.slice(0, Number(tipo.slice(-1)));
  return ids.includes(v) ? v : resto(ids);
}

function opcionSuya(sim: Simulacion, ids: readonly string[], persona: Persona): string {
  const { grupo, esco } = persona;
  return ids.find((id) => esco.includes(id)) ?? ids.find((id) => grupoDe(sim.motor.datos, id) === grupo) ?? resto(ids);
}

/**
 * Lo que responde la persona, sin equivocarse, a una pregunta.
 *
 * @param sim - La simulación.
 * @param pregunta - La pregunta.
 * @param persona - La persona (o su vecino, si se confunde).
 * @returns El id de la opción elegida.
 */
export function responder(sim: Simulacion, pregunta: Pregunta, persona: Persona): string {
  const g = sim.motor.atributos.grupos[persona.grupo];
  const ids = pregunta.opciones.map((o) => String(o.id)).filter((id) => id !== NO_LO_SE);
  const tipo = pregunta.id.split(':')[0] ?? '';
  const porTipo: Record<string, () => string> = {
    grupo: () => ids.find((id) => id.split('+').includes(persona.grupo)) ?? resto(ids),
    ocupacion: () => opcionSuya(sim, ids, persona),
    nivel1: () => nivel(tipo, persona.grupo, ids),
    tarea: () => tarea(sim.motor.atributos, pregunta, persona.grupo),
    trato: () => trato(g),
    campo: () => campo(g, ids),
    universidad: () => siNo(g?.un),
    cuenta_propia: () => siNo(g?.cp),
  };
  porTipo.area = porTipo.grupo as () => string;
  porTipo.nivel2 = porTipo.nivel1 as () => string;
  porTipo.nivel3 = porTipo.nivel1 as () => string;
  porTipo.precision = porTipo.campo as () => string;
  return Object.hasOwn(porTipo, tipo) ? (porTipo[tipo] as () => string)() : NO_LO_SE;
}
