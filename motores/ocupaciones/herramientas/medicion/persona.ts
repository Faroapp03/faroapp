// Una persona simulada (caso × grupo válido): su recorrido completo y dos caminos más tras rechazar la primera
// propuesta: «Atrás» (la pantalla debe volver a ser la misma) y «Lo cuento con mis palabras».

import { vecinoDe } from './azar.ts';
import type { Caso } from './bancos.ts';
import { grupoDe } from './bancos.ts';
import type { Vista } from './pantalla.ts';
import { claseDeLaPersona, describir } from './pantalla.ts';
import type { Recorrido } from './recorrido.ts';
import { actuar, recorrer } from './recorrido.ts';
import type { Persona, Simulacion } from './respuestas.ts';
import type { PasoPropuesta, Respuesta, SalidaDePantalla } from './tipos.ts';
import { esPropuesta } from './tipos.ts';

/** Con --traza, los grupos que trae cada buscador y la combinación, en orden. */
export type Recuperadores = Readonly<Record<string, readonly string[] | null>>;

/** La primera pantalla de un caso y lo que se ve en ella. */
export interface Primera {
  readonly salida: SalidaDePantalla;
  readonly vista: Vista;
}

type PersonaDelCaso = Persona & { readonly idioma: string };

/** Puesto de un grupo en una lista: 1 = primero; 0 = no está; null = no hay lista. */
function puesto(lista: readonly string[] | null, g: string): number | null {
  if (!lista) {
    return null;
  }
  const i = lista.indexOf(g);
  return i >= 0 ? i + 1 : 0;
}

/** El texto que añade la persona con «Lo cuento con mis palabras»: la primera tarea oficial de su grupo. */
function anadidoDe(sim: Simulacion, persona: PersonaDelCaso): string | null {
  const t = sim.motor.atributos.grupos[persona.grupo]?.ta?.[0];
  // El idioma del caso es siempre «es» o «ca» (casoDe lo normaliza): el texto corto de la tarea en ese idioma.
  const idioma: 'es' | 'ca' = persona.idioma === 'ca' ? 'ca' : 'es';
  const texto = t ? sim.motor.atributos.tareas[t]?.[idioma] : null;
  return texto ? String(texto) : null;
}

function loCuentoTrasNo(sim: Simulacion, caso: Caso, yo: PersonaDelCaso, no: Respuesta): object | null {
  const nuevo = anadidoDe(sim, yo);
  if (!nuevo) {
    return null;
  }
  const estado = { texto: `${caso.texto}. ${nuevo}`, respuestas: [no], anadido: nuevo };
  const m = sim.motor;
  const entrada = { texto: estado.texto, idioma: caso.idioma, respuestas: estado.respuestas, anadido: nuevo };
  const paso = m.pasoDePantalla(m.datos, m.atributos, entrada);
  const r = recorrer(sim, yo, estado, paso);
  const vista = describir(m.datos, paso.paso, caso.idioma);
  const { final, grupo, preguntas, propuestas } = r;
  return { final, grupo, preguntas, propuestas, pantalla: vista.texto, suyaALaVista: vista.grupos.includes(yo.grupo) };
}

/** Los caminos tras un «No» a la primera propuesta (solo si la persona la rechaza). */
function trasElNo(sim: Simulacion, caso: Caso, yo: PersonaDelCaso, primera: Primera): object {
  const paso = primera.salida.paso as PasoPropuesta;
  const no: Respuesta = { pregunta: paso.id as string, opcion: 'no' };
  const m = sim.motor;
  // «Atrás» tras el «No»: la web quita la última respuesta; la pantalla debe volver a ser la misma.
  const trasNo = m.pasoDePantalla(m.datos, m.atributos, { texto: caso.texto, idioma: caso.idioma, respuestas: [no] });
  const atras = m.pasoDePantalla(m.datos, m.atributos, { texto: caso.texto, idioma: caso.idioma, respuestas: [] });
  const caminos: Record<string, unknown> = {
    atrasDevuelveLaMisma: describir(m.datos, atras.paso, caso.idioma).texto === primera.vista.texto,
    trasNo: describir(m.datos, trasNo.paso, caso.idioma).texto,
  };
  // «Lo cuento con mis palabras» tras el «No»: el texto se suma y las respuestas se conservan.
  const loCuento = loCuentoTrasNo(sim, caso, yo, no);
  if (loCuento) {
    caminos.loCuentoTrasNo = loCuento;
  }
  return caminos;
}

function deLaTraza(recuperadores: Recuperadores | null, yo: PersonaDelCaso, recorrido: Recorrido): object {
  if (!recuperadores) {
    return {};
  }
  const bien = recorrido.final === 'bien' && yo.esco.length;
  return {
    // Puesto de su grupo en cada buscador y en la combinación (1 = primero; 0 = no está entre los 30; null = no hay).
    puestos: Object.fromEntries(Object.entries(recuperadores).map(([k, lista]) => [k, puesto(lista, yo.grupo)])),
    // La ocupación exacta: si acaba en su grupo, ¿con una de las ocupaciones ESCO que el banco da por buenas?
    escoBien: bien ? yo.esco.includes(recorrido.esco ?? '') : null,
  };
}

/**
 * Lo que vive una persona del caso.
 *
 * @param sim - La simulación.
 * @param caso - El caso.
 * @param g - El grupo de la persona.
 * @param contexto - La primera pantalla y los recuperadores (con --traza).
 * @returns El resultado de la persona, con sus campos en un orden fijo, porque la salida se compara byte a byte.
 */
export function medirPersona(
  sim: Simulacion,
  caso: Caso,
  g: string,
  contexto: { primera: Primera; recuperadores: Recuperadores | null },
): object {
  const { primera, recuperadores } = contexto;
  const claveDeRuido = sim.clavesDeRuido.get(caso.banco);
  if (claveDeRuido === undefined) {
    throw new Error(`el banco «${caso.banco}» no tiene clave de ruido`);
  }
  const clave = `${claveDeRuido}/${caso.id}#${g}`;
  const esco = caso.validas.esco.filter((e) => grupoDe(sim.motor.datos, e) === g);
  const yo: PersonaDelCaso = {
    grupo: g,
    esco,
    clave,
    vecino: vecinoDe(sim.motor.atributos, g, clave, sim.azar),
    idioma: caso.idioma,
  };
  const recorrido = recorrer(sim, yo, { texto: caso.texto, respuestas: [], anadido: '' }, primera.salida);
  const resultado = {
    grupo: g,
    principal: g === caso.principal,
    pantalla: claseDeLaPersona(primera.vista, g, primera.salida.lectura?.sinComprension),
    recorrido,
    ...deLaTraza(recuperadores, yo, recorrido),
  };
  const paso = primera.salida.paso;
  if (esPropuesta(paso) && !paso.local && actuar(sim, paso, yo).rechazo) {
    return { ...resultado, ...trasElNo(sim, caso, yo, primera) };
  }
  return resultado;
}
