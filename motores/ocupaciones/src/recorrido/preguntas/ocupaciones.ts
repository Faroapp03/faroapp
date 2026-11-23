// La ocupación dentro de cada grupo: P(o | g) con los puntos del buscador y, cuando el grupo ya está claro, la pregunta
// «¿Cuál de estos es tu puesto?» con sus ocupaciones ESCO (los títulos oficiales que ya enseña el recorrido).

import type { Especificacion } from './preguntas.ts';
import type { CandidataBusqueda, Configuracion, Entrada, Respuesta } from './tipos.ts';

export const PREFIJO_OCUPACION = 'ocupacion:';
const OTRA = 'otra';
const SEPARADOR_VALORES = ',';
/** Ocupaciones que se enseñan a la vez (más «Otra cosa» y «No lo sé»). */
const OPCIONES = 3;

export interface OcupacionDelGrupo {
  readonly esco: string;
  readonly grupo: string;
  readonly titulo?: string;
  readonly tituloCa?: string;
  /** P(o | g), suma 1 dentro del grupo. */
  readonly peso: number;
}

function puntosEfectivos(cand: CandidataBusqueda, c: Configuracion): number {
  return cand.puntos + c.pesoExtra * (cand.extra ?? 0);
}

function sinRepetir(candidatas: readonly CandidataBusqueda[]): CandidataBusqueda[] {
  const vistas = new Set<string>();
  return candidatas.filter((x) => {
    if (!x.esco || vistas.has(x.esco)) {
      return false;
    }
    vistas.add(x.esco);
    return true;
  });
}

/** Verosimilitud de una respuesta a «¿Cuál de estos es tu puesto?» para la ocupación `esco`. */
function verosimilitudOcupacion(valores: readonly string[], opcion: string, esco: string, error: number): number {
  const k = valores.length;
  const esperada = valores.includes(esco) ? esco : OTRA;
  return opcion === esperada ? 1 - error + error / k : error / k;
}

/** Ocupaciones de propuestas rechazadas («No» o «Se parece, pero no»): bajan, sin desaparecer. */
function rechazadas(respuestas: readonly Respuesta[]): Set<string> {
  return new Set(
    respuestas
      .filter((r) => r.pregunta.startsWith('propuesta:') && (r.opcion === 'no' || r.opcion === 'parecida'))
      .map((r) => r.pregunta.split(':')[2] ?? '')
      .filter(Boolean),
  );
}

function respuestasDeOcupacion(respuestas: readonly Respuesta[]): { valores: string[]; opcion: string }[] {
  return respuestas
    .filter((r) => r.pregunta.startsWith(PREFIJO_OCUPACION) && r.opcion !== 'no_lo_se')
    .map((r) => ({ valores: r.pregunta.slice(PREFIJO_OCUPACION.length).split(SEPARADOR_VALORES), opcion: r.opcion }));
}

/**
 * Las ocupaciones candidatas de cada grupo con P(o | g) ∝ exp(puntos/τ) y, si `conRespuestas`, multiplicada por las
 * respuestas a «¿Cuál de estos es tu puesto?».
 */
export function ocupacionesPorGrupo(entrada: Entrada, c: Configuracion, conRespuestas = true): OcupacionDelGrupo[][] {
  const respuestas = conRespuestas ? respuestasDeOcupacion(entrada.respuestas) : [];
  const fuera = conRespuestas ? rechazadas(entrada.respuestas) : new Set<string>();
  const porGrupo = new Map<string, { cand: CandidataBusqueda; w: number }[]>();
  const dePrevia = new Map((entrada.previa?.ocupaciones ?? []).map((o) => [o.esco, o]));
  const candidatas = dePrevia.size
    ? [...dePrevia.values()].map((o) => ({
        ...entrada.candidatas.find((x) => x.esco === o.esco),
        esco: o.esco,
        isco08: o.isco08,
        puntos: 0,
      }))
    : sinRepetir(entrada.candidatas);
  for (const cand of candidatas) {
    const esco = cand.esco ?? '';
    const base = dePrevia.size ? (dePrevia.get(esco)?.p ?? 0) : Math.exp(puntosEfectivos(cand, c) / c.tau);
    const w = respuestas.reduce(
      (x, r) => x * verosimilitudOcupacion(r.valores, r.opcion, esco, c.error),
      base * (fuera.has(esco) ? c.factorRechazo : 1),
    );
    porGrupo.set(cand.isco08, [...(porGrupo.get(cand.isco08) ?? []), { cand, w }]);
  }
  return [...porGrupo.values()].map((lista) => {
    const total = lista.reduce((s, x) => s + x.w, 0) || 1;
    return lista
      .map(({ cand, w }) => ({
        esco: cand.esco ?? '',
        grupo: cand.isco08,
        peso: w / total,
        ...(cand.titulo ? { titulo: cand.titulo } : {}),
        ...(cand.tituloCa ? { tituloCa: cand.tituloCa } : {}),
      }))
      .sort((a, b) => b.peso - a.peso || (a.esco < b.esco ? -1 : 1));
  });
}

/** La pregunta reconstruida desde su id: cada grupo reparte su respuesta según P(o | g) de las opciones. */
export function especificacionDeOcupacion(id: string, grupos: readonly OcupacionDelGrupo[][]): Especificacion {
  const opciones = id.slice(PREFIJO_OCUPACION.length).split(SEPARADOR_VALORES);
  const porGrupo = new Map(grupos.map((lista) => [lista[0]?.grupo ?? '', lista]));
  return {
    id,
    tipo: 'ocupacion',
    valores: [...opciones, OTRA],
    reparto: (g) => {
      const lista = porGrupo.get(g) ?? [];
      const partes = opciones.map((o) => lista.find((x) => x.esco === o)?.peso ?? 0);
      return [...partes, Math.max(0, 1 - partes.reduce((s, x) => s + x, 0))];
    },
  };
}

/**
 * «¿Cuál de estos es tu puesto?» dentro del grupo `grupo`, si tiene al menos dos ocupaciones y la primera no llega a
 * `umbralOcupacion`; null si no hace falta o ya se preguntó por ese grupo.
 */
export function preguntaDeOcupacion(
  grupo: string,
  grupos: readonly OcupacionDelGrupo[][],
  entrada: Entrada,
  c: Configuracion,
): Especificacion | null {
  const lista = grupos.find((l) => l[0]?.grupo === grupo) ?? [];
  const yaPreguntada = respuestasDeOcupacion(entrada.respuestas).some((r) =>
    r.valores.some((v) => lista.some((x) => x.esco === v)),
  );
  if (yaPreguntada || lista.length < 2 || (lista[0]?.peso ?? 1) >= c.umbralOcupacion) {
    return null;
  }
  const id = `${PREFIJO_OCUPACION}${lista
    .slice(0, OPCIONES)
    .map((x) => x.esco)
    .join(SEPARADOR_VALORES)}`;
  return especificacionDeOcupacion(id, grupos);
}

const SIN_TILDES = /[\u0300-\u036f]/g;
function palabras(texto: string): string[] {
  return texto
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(SIN_TILDES, '')
    .split(/[^a-z·]+/)
    .filter(Boolean);
}

/**
 * El género con que se expresa la persona: compara su texto con los títulos dobles de ESCO («maestro/maestra»). Si
 * alguna palabra solo está en la forma femenina, 'f'; si solo en la masculina, 'm'; si no, undefined.
 */
export function generoDeTexto(texto: string, titulos: readonly string[]): 'f' | 'm' | undefined {
  const dichas = new Set(palabras(texto));
  for (const titulo of titulos) {
    const [masculino = '', femenino = ''] = titulo.split('/');
    // Un título sin femenino («responsable de recursos humanos») no dice nada del género: antes contaba como masculino
    // y «recursos humanos» o «trabajo con gente mayor» salían solo en masculino.
    if (!femenino) {
      continue;
    }
    const m = new Set(palabras(masculino));
    const f = new Set(palabras(femenino));
    if ([...f].some((w) => !m.has(w) && dichas.has(w))) {
      return 'f';
    }
    if ([...m].some((w) => !f.has(w) && dichas.has(w))) {
      return 'm';
    }
  }
  return undefined;
}

/** Un título doble de ESCO («maestro/maestra») en el género de la persona; sin género, los dos («maestro o maestra»). */
export function tituloEnGenero(titulo: string, genero: 'f' | 'm' | undefined, idioma: 'es' | 'ca'): string {
  const [masculino = titulo, femenino] = titulo.split('/');
  if (!femenino) {
    return titulo;
  }
  if (genero) {
    return (genero === 'f' ? femenino : masculino).trim();
  }
  return `${masculino.trim()} ${idioma === 'ca' ? 'o' : 'o'} ${femenino.trim()}`;
}
