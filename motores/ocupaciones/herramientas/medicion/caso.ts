// La medición de un caso (una frase): sus candidatos antes de cualquier pregunta, la primera pantalla y una persona por
// cada grupo válido.

import type { Caso } from './bancos.ts';
import { grupoDe } from './bancos.ts';
import { claseDeLaFrase, describir } from './pantalla.ts';
import type { Primera, Recuperadores } from './persona.ts';
import { medirPersona } from './persona.ts';
import type { Simulacion } from './respuestas.ts';
import type { Busqueda, CandidataLexica, Previa } from './tipos.ts';

/** Candidatos que se guardan de cada caso. */
const CANDIDATOS = 5;
/** Candidatos que se guardan de cada buscador con --traza. */
const TOPE_TRAZA = 30;
/** Decimales de la probabilidad de cada candidato (4). */
const PRECISION = 10000;

type GrupoConP = { readonly isco08: string; readonly p: number };
const ordenDeLaPrevia = (a: GrupoConP, b: GrupoConP): number => b.p - a.p || (a.isco08 < b.isco08 ? -1 : 1);

/** Los grupos de las candidatas léxicas, sin repetir y en su orden. */
function gruposLexicos(sim: Simulacion, candidatas: readonly CandidataLexica[]): string[] {
  const vistos = new Set<string>();
  const grupos: string[] = [];
  for (const c of candidatas) {
    const g = c.isco08 ?? grupoDe(sim.motor.datos, c.esco);
    if (g && !vistos.has(g)) {
      vistos.add(g);
      grupos.push(g);
    }
  }
  return grupos;
}

function previaDe(sim: Simulacion, caso: Caso, busqueda: Busqueda): Previa {
  const contexto = { texto: caso.texto, idioma: caso.idioma, segundaOpinion: null, atributos: sim.motor.atributos };
  return sim.motor.previaCalibrada(sim.motor.datos, busqueda, contexto);
}

/** Candidatos ordenados: la búsqueda y la combinación, antes de cualquier pregunta. */
function candidatosDe(sim: Simulacion, caso: Caso): object {
  const entrada = previaDe(sim, caso, sim.motor.buscar(sim.motor.datos, caso.texto, caso.idioma));
  const orden: { g: string; p: number | null }[] = entrada.previa
    ? [...entrada.previa.grupos]
        .sort(ordenDeLaPrevia)
        .map((g) => ({ g: g.isco08, p: Math.round(g.p * PRECISION) / PRECISION }))
    : // Sin previa (no hay ningún candidato de la fusión): el orden de las candidatas léxicas.
      gruposLexicos(sim, entrada.candidatas).map((g) => ({ g, p: null }));
  const i = orden.findIndex((o) => caso.validas.grupos.includes(o.g));
  return {
    fuente: entrada.previa ? 'fusion' : 'lexica',
    candidatos: orden.slice(0, CANDIDATOS),
    rango: i >= 0 ? i + 1 : null,
  };
}

/**
 * Con --traza, los grupos que trae cada buscador antes de combinarse (los 30 primeros): el léxico, los vectores (con el
 * texto que les da la fusión), el clasificador (con su entrada exacta en el producto) y la combinación.
 */
function recuperadoresDe(sim: Simulacion, caso: Caso): Recuperadores {
  const m = sim.motor;
  const busqueda = m.buscar(m.datos, caso.texto, caso.idioma);
  const lexico = gruposLexicos(sim, busqueda.candidatas ?? []);
  const textoVectores = m.textoParaVectores?.(m.datos, caso.texto, busqueda) ?? caso.texto;
  const similitudes = m.vectores && !busqueda.soloSector ? m.vectores.similitudes(textoVectores, caso.idioma) : null;
  const vectores = similitudes
    ? [...similitudes.grupos]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOPE_TRAZA)
        .map(([g]) => g)
    : null;
  const clasificador = m.clasificador
    ? m.clasificador.predecir(m.entradaDelClasificador(caso.texto), TOPE_TRAZA).map((x) => x.grupo)
    : null;
  const entrada = previaDe(sim, caso, busqueda);
  const fusion = entrada.previa
    ? [...entrada.previa.grupos]
        .sort(ordenDeLaPrevia)
        .slice(0, TOPE_TRAZA)
        .map((g) => g.isco08)
    : lexico.slice(0, TOPE_TRAZA);
  return { lexico: lexico.slice(0, TOPE_TRAZA), vectores, clasificador, fusion };
}

function ordenDelClasificador(sim: Simulacion, caso: Caso): string[] | null {
  const c = sim.motor.clasificador;
  if (!(sim.opciones.traza && c)) {
    return null;
  }
  return c.predecir(sim.motor.entradaDelClasificador(caso.texto), c.clases.length).map((x) => x.grupo);
}

/**
 * La medición de un caso, con los campos en un orden fijo, porque la salida se compara byte a byte.
 *
 * @param sim - La simulación.
 * @param caso - El caso.
 * @returns El caso con sus candidatos, su primera pantalla y sus personas.
 */
export function medirCaso(sim: Simulacion, caso: Caso): object {
  const m = sim.motor;
  const salida = m.pasoDePantalla(m.datos, m.atributos, { texto: caso.texto, idioma: caso.idioma, respuestas: [] });
  const primera: Primera = { salida, vista: describir(m.datos, salida.paso, caso.idioma) };
  const grupos = caso.validas.grupos.length
    ? caso.validas.grupos
    : [caso.principal].filter((g): g is string => Boolean(g));
  const recuperadores = sim.opciones.traza ? recuperadoresDe(sim, caso) : null;
  const orden = ordenDelClasificador(sim, caso);
  const vista = primera.vista;
  return {
    ...caso,
    ...candidatosDe(sim, caso),
    ...(recuperadores ? { recuperadores, entradaDelClasificador: m.entradaDelClasificador(caso.texto) } : {}),
    pantalla: {
      ...vista,
      gruposDistintos: new Set(vista.grupos).size,
      clase: claseDeLaFrase(vista, caso, salida.lectura?.sinComprension),
    },
    personas: grupos.map((g) => ({
      ...medirPersona(sim, caso, g, { primera, recuperadores }),
      ...(orden ? { puestoEnElClasificador: orden.indexOf(g) + 1 } : {}),
    })),
  };
}
