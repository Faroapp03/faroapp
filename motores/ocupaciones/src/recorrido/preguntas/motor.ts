// Motor de preguntas adaptativas (estilo Akinator) del recorrido. Mantiene una distribución P(g) sobre los grupos
// CIUO-08 con tareas de la OIT, la actualiza con cada respuesta con una verosimilitud blanda (la persona puede
// equivocarse) y elige la pregunta con más ganancia de información esperada. «No lo sé» no cambia nada. Para cuando
// un grupo supera el umbral, al llegar al tope o cuando ya no hay nada útil que preguntar.
// Puro y determinista: sin red, sin estado (se le pasan todas las respuestas cada vez) y sin azar.

import {
  especificacionDeOcupacion,
  generoDeTexto,
  type OcupacionDelGrupo,
  ocupacionesPorGrupo,
  PREFIJO_OCUPACION,
  preguntaDeOcupacion,
  tituloEnGenero,
} from './ocupaciones.ts';
import {
  type Especificacion,
  enIdioma,
  especificacionDeGrupo,
  JUNTOS,
  MARCA_ULTIMA_LISTA,
  NO_LO_SE,
  preguntaDeCampo,
  preguntaDeGrupo,
  preguntaDeJerarquia,
  preguntaDeTareasPara,
  preguntasDeTareas,
  preguntasFijas,
  reconstruir,
} from './preguntas.ts';
import {
  type Decision,
  type LecturaDePropuestas,
  leerPropuestas,
  PREFIJO_PROPUESTA,
  pasoDePropuesta,
} from './propuesta.ts';
import { BUSCAR_YO, ENUNCIADO_DEL_AREA_CON_FRASE, ENUNCIADOS, OPCIONES_FIJAS, PALABRAS_GENERICAS } from './textos.ts';
import type {
  AreaDeTexto,
  Atributos,
  CandidataBusqueda,
  Configuracion,
  Entrada,
  Hipotesis,
  Idioma,
  MotivoClasico,
  MotivoDeResultado,
  OcupacionProbable,
  Opcion,
  Paso,
  PasoPregunta,
  PasoResultado,
  PistaSector,
  Pregunta,
  PreviaExplicita,
  TipoPregunta,
} from './tipos.ts';

/** Configuración del motor de preguntas calibrada con el banco de desarrollo. */
export const CONFIGURACION: Configuracion = {
  // Hasta catorce preguntas permiten distinguir grupos que empiezan fuera de las primeras candidatas.
  maxPreguntas: 14,
  // Umbrales de propuesta y límites de rechazo asociados a esta configuración.
  umbralProponer: 0.6,
  umbralProponerSinPreguntas: 0.6,
  umbralAfirmar: 2,
  maxPropuestas: 4,
  factorRechazo: 0.03,
  umbralOcupacion: 0,
  pMinimaOpcion: 0.05,
  pMinimaPropuesta: 0.15,
  error: 0.2,
  tau: 8,
  alfa: 0.3,
  pesoFondo: 3,
  pesoExtra: 0,
  alfaFondo: 1,
  gananciaMinima: 0.05,
};

/**
 * Lo que cuesta responder cada tipo de pregunta: la ganancia se divide por él, así que van antes las fáciles y
 * concretas
 * (tareas, «¿Cuál es tu puesto?») que las abstractas (gran grupo, subgrupo oficial). Coste ≈ 1 + tasa esperada de
 * «No lo sé» o de error del tipo (Golovin y otros); valores de diseño que deben contrastarse con el banco de
 * desarrollo.
 */
const COSTE: Readonly<Record<TipoPregunta, number>> = {
  area: 0.7,
  grupo: 0.8,
  ocupacion: 0.9,
  tarea: 1,
  precision: 1.2,
  nivel2: 2,
  cuenta_propia: 2,
  universidad: 2,
  campo: 2.5,
  trato: 2.5,
  nivel1: 3,
  nivel3: 3,
};
/**
 * Error de la persona por tipo de pregunta, relativo a `error`: tres niveles (concretas 0,5; normales 1; abstractas
 * 1,4). Va en la verosimilitud: una respuesta a una pregunta abstracta pesa menos.
 */
const ERROR_RELATIVO: Readonly<Record<TipoPregunta, number>> = {
  area: 0.5,
  grupo: 0.5,
  ocupacion: 0.5,
  cuenta_propia: 0.5,
  universidad: 0.5,
  tarea: 1,
  precision: 1,
  nivel2: 1,
  campo: 1.4,
  trato: 1.4,
  nivel1: 1.4,
  nivel3: 1.4,
};
const ERROR_MAXIMO = 0.6;
function errorDe(e: Especificacion, c: Configuracion): number {
  return Math.min(ERROR_MAXIMO, c.error * (ERROR_RELATIVO[e.tipo] ?? 1));
}
/** Opciones como mucho en la pregunta del área (más «Otra cosa» y «No lo sé»). */
const MAX_OPCIONES_DE_AREA = 5;
/** Títulos que nombran una opción del área que junta varios grupos. */
const TITULOS_POR_OPCION = 2;
/** Los profesionales (CIUO-08, gran grupo 2) van por grupo de 4 cifras en la pregunta del área. */
const GRAN_GRUPO_PROFESIONALES = '2';
/** Puntos de las ocupaciones del área cuando el buscador no trae ninguna candidata. */
const PUNTOS_SIN_CANDIDATAS = 50;
/** Separación mínima (variación total) para que una pregunta de contraste merezca la pena. */
const SEPARACION_MINIMA = 0.2;
/**
 * Veces que se puede repetir un tipo de pregunta, siempre con opciones distintas: tras «Otra cosa» la jerarquía puede
 * volver con las siguientes opciones (como Akinator); las demás, una vez.
 */
const VECES_POR_TIPO: Readonly<Partial<Record<TipoPregunta, number>>> = { tarea: 3, grupo: 2, nivel1: 2, nivel2: 2 };
/** Ocupados mínimos de un grupo para el punto de partida (los muy pequeños no se anulan). */
const MIN_OCUPADOS = 500;
/** Una pista del texto se aplica como una respuesta poco fiable. */
const ERROR_DE_PISTA = 0.5;
function palabraGenerica(entrada: Entrada): string | undefined {
  const clave = entrada.necesitaPrecision;
  return clave === undefined ? undefined : (PALABRAS_GENERICAS[clave]?.[entrada.idioma] ?? clave);
}
/** Alternativas que acompañan al resultado. */
const ALTERNATIVAS = 2;

type Distribucion = Map<string, number>;

function normalizar(p: Distribucion): Distribucion {
  let total = 0;
  for (const x of p.values()) {
    total += x;
  }
  return new Map([...p].map(([g, x]) => [g, total > 0 ? x / total : 0]));
}

function entropia(p: Iterable<number>): number {
  let h = 0;
  for (const x of p) {
    if (x > 0) {
      h -= x * Math.log2(x);
    }
  }
  return h;
}

/** Las ocupaciones más probables: P(g) · P(o | g) (ocupaciones.ts), con las respuestas sobre el puesto aplicadas. */
function ocupacionesProbables(p: Distribucion, entrada: Entrada, c: Configuracion): OcupacionProbable[] {
  return ocupacionesPorGrupo(entrada, c)
    .flat()
    .map((o) => ({
      esco: o.esco,
      grupo: o.grupo,
      confianza: redondear((p.get(o.grupo) ?? 0) * o.peso),
      ...(o.titulo ? { titulo: o.titulo } : {}),
    }))
    .sort((a, b) => b.confianza - a.confianza || (a.esco < b.esco ? -1 : 1))
    .slice(0, MAX_OCUPACIONES);
}

const REDONDEO = 1000;
const MAX_OCUPACIONES = 5;
function redondear(x: number): number {
  return Math.round(x * REDONDEO) / REDONDEO;
}

/** Punto de partida: la previa explícita (fusión) o la de las candidatas del buscador, y los rechazos previos. */
export function distribucionInicial(a: Atributos, entrada: Entrada, c: Configuracion): Distribucion {
  const p = entrada.previa ? desdePrevia(a, entrada, entrada.previa, c) : desdeCandidatas(a, entrada, c);
  return (entrada.rechazados ?? []).reduce((q, g) => rechazar(q, g, c), p);
}

function universoDe(a: Atributos, propios: Iterable<string>): string[] {
  return [...new Set([...Object.keys(a.grupos), ...propios])].sort();
}

/**
 * Temple de la previa entre sus candidatas (p^(1/TEMPLE), con la misma masa total), solo tras un «No»
 * a una propuesta de ocupación, no a una tarea. Devuelve peso a las alternativas frente al fondo.
 * Se aplica una sola vez a la previa de búsqueda; después, el rechazo conserva toda su fuerza.
 * Recalcular desde la entrada evita que el temple se acumule entre pasos.
 */
const TEMPLE = 2;

/** Si la persona ya ha dicho «No» a alguna propuesta (en esta ruta o en una anterior). */
function huboUnNo(entrada: Entrada): boolean {
  return (
    (entrada.rechazados?.length ?? 0) > 0 ||
    entrada.respuestas.some((r) => r.pregunta.startsWith(PREFIJO_PROPUESTA) && r.opcion === 'no')
  );
}

function templadas(grupos: PreviaExplicita['grupos']): Map<string, number> {
  const total = grupos.reduce((s, g) => s + g.p, 0);
  const suaves = grupos.map((g) => [g.isco08, g.p ** (1 / TEMPLE)] as const);
  const suma = suaves.reduce((s, [, x]) => s + x, 0) || 1;
  return new Map(suaves.map(([g, x]) => [g, (x * total) / suma]));
}

/** La previa de la fusión, templada; `fondo` se reparte entre los demás grupos según los ocupados. */
function desdePrevia(a: Atributos, entrada: Entrada, previa: PreviaExplicita, c: Configuracion): Distribucion {
  const dadas = huboUnNo(entrada) ? templadas(previa.grupos) : new Map(previa.grupos.map((g) => [g.isco08, g.p]));
  const universo = universoDe(a, dadas.keys());
  const fondo = universo.filter((g) => !dadas.has(g));
  const ocupados = (g: string): number => Math.max(a.grupos[g]?.pr ?? 0, MIN_OCUPADOS) ** c.alfaFondo;
  const reparto = fondo.reduce((s, g) => s + ocupados(g), 0) || 1;
  return normalizar(new Map(universo.map((g) => [g, dadas.get(g) ?? (previa.fondo * ocupados(g)) / reparto])));
}

/**
 * Punto de partida. Las candidatas del buscador: P(g) ∝ exp(puntos/τ) · ocupados^α. Los grupos que no propuso (el
 * fondo) conservan la masa que les da esa fórmula (con puntos 0 y pesoFondo), pero repartida según los ocupados
 * (exponente alfaFondo): sin candidatas, las primeras opciones son los trabajos más frecuentes, no los grupos con más
 * subdivisiones.
 */
function desdeCandidatas(a: Atributos, entrada: Entrada, c: Configuracion): Distribucion {
  const puntos = new Map<string, number>();
  for (const cand of entrada.candidatas) {
    // Sin recorte en 0: unos puntos negativos (p. ej. ln p) se respetan.
    const efectivos = cand.puntos + c.pesoExtra * (cand.extra ?? 0);
    puntos.set(cand.isco08, Math.max(puntos.get(cand.isco08) ?? Number.NEGATIVE_INFINITY, efectivos));
  }
  const universo = universoDe(a, puntos.keys());
  const maximo = puntos.size ? Math.max(...puntos.values()) : 0;
  const ocupados = (g: string): number => Math.max(a.grupos[g]?.pr ?? 0, MIN_OCUPADOS);
  const p: Distribucion = new Map();
  let masaFondo = 0;
  let repartoFondo = 0;
  for (const g of universo) {
    const s = puntos.get(g);
    const w = Math.exp(((s ?? 0) - maximo) / c.tau) * ocupados(g) ** c.alfa;
    if (s === undefined) {
      masaFondo += c.pesoFondo * w;
      repartoFondo += ocupados(g) ** c.alfaFondo;
    } else {
      p.set(g, w);
    }
  }
  for (const g of universo) {
    if (!puntos.has(g)) {
      p.set(g, (masaFondo * ocupados(g) ** c.alfaFondo) / repartoFondo);
    }
  }
  return normalizar(p);
}

/** P(respuesta | grupo) para todas las respuestas, con el error de la persona repartido entre las opciones. */
function verosimilitudes(e: Especificacion, g: string, error: number): readonly number[] {
  const k = e.valores.length;
  const reparto = e.reparto(g);
  return e.valores.map((_, r) => (reparto ? (1 - error) * (reparto[r] ?? 0) + error / k : 1 / k));
}

export function actualizar(p: Distribucion, e: Especificacion, respuesta: number, error: number): Distribucion {
  return normalizar(new Map([...p].map(([g, x]) => [g, x * (verosimilitudes(e, g, error)[respuesta] ?? 0)])));
}

/** Por debajo de esta probabilidad un grupo no cambia la ganancia de forma apreciable y no se recorre. */
const MASA_DESPRECIABLE = 1e-7;

/**
 * Ganancia de información esperada (bits) de una pregunta: H(P) − Σₐ P(a) · H(P | a). Usa H(P | a) =
 * log₂ P(a) − Σ_g y·log₂ y / P(a), con y = P(g) · P(a | g), para no guardar las posteriores.
 */
export function ganancia(p: Distribucion, e: Especificacion, error: number): number {
  const k = e.valores.length;
  const masas = new Array<number>(k).fill(0);
  const sumas = new Array<number>(k).fill(0);
  for (const [g, x] of p) {
    if (x >= MASA_DESPRECIABLE) {
      acumular(masas, sumas, x, verosimilitudes(e, g, error));
    }
  }
  let esperada = 0;
  masas.forEach((m, r) => {
    if (m > 0) {
      esperada += m * Math.log2(m) - (sumas[r] ?? 0);
    }
  });
  return entropia(p.values()) - esperada;
}

function acumular(masas: number[], sumas: number[], x: number, l: readonly number[]): void {
  l.forEach((v, r) => {
    const y = x * v;
    if (y > 0) {
      masas[r] = (masas[r] ?? 0) + y;
      sumas[r] = (sumas[r] ?? 0) + y * Math.log2(y);
    }
  });
}

function especificacionDePista(pista: PistaSector): Especificacion {
  const encaja = (g: string): boolean => pista.grupos.some((prefijo) => g.startsWith(prefijo));
  return { id: 'pista', tipo: 'campo', valores: ['si', 'no'], reparto: (g) => (encaja(g) ? [1, 0] : null) };
}

function aplicarPistas(p: Distribucion, pistas: readonly PistaSector[]): Distribucion {
  let q = p;
  for (const pista of pistas) {
    q = actualizar(q, especificacionDePista(pista), 0, ERROR_DE_PISTA);
  }
  return q;
}

interface Estado {
  p: Distribucion;
  hechas: Especificacion[];
  /** Líder antes de la última respuesta a una pregunta (para detectar que la última la contradice). */
  liderAntes: string | null;
  propuestas: LecturaDePropuestas;
}

function rechazar(p: Distribucion, grupo: string, c: Configuracion): Distribucion {
  return normalizar(new Map([...p].map(([g, x]) => [g, g === grupo ? x * c.factorRechazo : x])));
}

function especificacionDeRespuesta(a: Atributos, id: string, sinRespuestas: OcupacionDelGrupo[][]) {
  return id.startsWith(PREFIJO_OCUPACION) ? especificacionDeOcupacion(id, sinRespuestas) : reconstruir(a, id);
}

function reproducir(a: Atributos, entrada: Entrada, c: Configuracion): Estado {
  // Con previa explícita las pistas ya van dentro (la fusión las cuenta): no se aplican dos veces.
  let p = aplicarPistas(distribucionInicial(a, entrada, c), entrada.previa ? [] : (entrada.pistas ?? []));
  const hechas: Especificacion[] = [];
  const sinRespuestas = ocupacionesPorGrupo(entrada, c, false);
  let liderAntes: string | null = null;
  for (const r of entrada.respuestas) {
    if (r.pregunta.startsWith(PREFIJO_PROPUESTA)) {
      p = r.opcion === 'no' ? rechazar(p, r.pregunta.split(':')[1] ?? '', c) : p;
      continue;
    }
    const e = especificacionDeRespuesta(a, r.pregunta, sinRespuestas);
    if (e) {
      hechas.push(e);
      liderAntes = ordenar(p)[0]?.[0] ?? null;
      p = aplicarRespuesta(p, e, r.opcion, c);
    }
  }
  return { p, hechas, liderAntes, propuestas: leerPropuestas(entrada.respuestas) };
}

function aplicarRespuesta(p: Distribucion, e: Especificacion, opcion: string, c: Configuracion): Distribucion {
  const i = e.valores.indexOf(opcion);
  return opcion !== NO_LO_SE && i >= 0 ? actualizar(p, e, i, errorDe(e, c)) : p;
}

function yaHecha(hechas: readonly Especificacion[], e: Especificacion): boolean {
  const mismoTipo = hechas.filter(
    (h) =>
      h.tipo === e.tipo || (e.tipo === 'campo' && h.tipo === 'precision') || (e.tipo === 'grupo' && h.tipo === 'area'),
  );
  const mismas = mismoTipo.filter((h) => h.tipo === e.tipo).length;
  if (hechas.some((h) => h.id === e.id) || mismas >= (VECES_POR_TIPO[e.tipo] ?? 1)) {
    return true;
  }
  // La jerarquía solo vuelve con opciones nuevas (tras «Otra cosa»): nunca repite una ya ofrecida.
  const ofrecidas = new Set(
    mismoTipo.flatMap((h) => (h.tipo === 'tarea' ? [] : h.valores.filter((v) => v !== 'otra'))),
  );
  return e.valores.some((v) => ofrecidas.has(v));
}

function candidatasAPregunta(
  a: Atributos,
  entrada: Entrada,
  estado: Estado,
  opciones: { lideres: readonly string[]; c: Configuracion },
): Especificacion[] {
  const { lideres, c } = opciones;
  const { p, hechas } = estado;
  if (entrada.necesitaPrecision && hechas.length === 0) {
    return [preguntaDeCampo(a, p, 'precision'), preguntaDeJerarquia('nivel2', p)].filter((e) => e !== null);
  }
  const todas = [
    preguntaDeGrupo(p, c.pMinimaOpcion),
    ...preguntasDeTareas(a, p, c.pMinimaOpcion),
    lideres.length === 2 ? preguntaDeTareasPara(a, lideres) : null,
    preguntaDeJerarquia('nivel1', p),
    preguntaDeJerarquia('nivel2', p),
    preguntaDeJerarquia('nivel3', p),
    preguntaDeCampo(a, p, 'campo'),
    ...preguntasFijas(a),
  ];
  return todas.filter((e): e is Especificacion => e !== null && !yaHecha(hechas, e));
}

/** Cuánto separa una pregunta a dos grupos: variación total entre sus distribuciones de respuesta. */
function separacion(e: Especificacion, g1: string, g2: string, c: Configuracion): number {
  const l1 = verosimilitudes(e, g1, errorDe(e, c));
  const l2 = verosimilitudes(e, g2, errorDe(e, c));
  return l1.reduce((s, x, r) => s + Math.abs(x - (l2[r] ?? 0)), 0) / 2;
}

/**
 * La mejor pregunta: ganancia ÷ coste. En modo contraste (tras un «No» o cuando la última respuesta contradijo a la
 * líder) se elige la que más separa a la 1.ª de la 2.ª, para no quedarse pegado a una hipótesis falsa.
 */
function mejorPregunta(
  lista: readonly Especificacion[],
  p: Distribucion,
  c: Configuracion,
  contraste: string[] | null,
): Especificacion | null {
  let mejor: Especificacion | null = null;
  let valor = contraste ? SEPARACION_MINIMA : c.gananciaMinima;
  for (const e of lista) {
    const v = contraste
      ? separacion(e, contraste[0] ?? '', contraste[1] ?? '', c) / COSTE[e.tipo]
      : ganancia(p, e, errorDe(e, c)) / COSTE[e.tipo];
    if (v > valor) {
      valor = v;
      mejor = e;
    }
  }
  return mejor ?? (contraste ? mejorPregunta(lista, p, c, null) : null);
}

function ordenar(p: Distribucion): [string, number][] {
  return [...p].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}

function hipotesis(g: string, confianza: number, grupos: readonly OcupacionDelGrupo[][]): Hipotesis {
  // De lo genérico a lo específico: la ocupación general del grupo, salvo que el texto especifique y
  // una concreta pese mucho más («dependienta» → vendedora, no «vendedora especializada en mascotas»).
  const propia = representante(grupos.find((l) => l[0]?.grupo === g) ?? []);
  const base = { grupo: g, confianza: redondear(confianza) };
  if (!propia) {
    return base;
  }
  const extra = {
    ...(propia.titulo ? { titulo: propia.titulo } : {}),
    ...(propia.tituloCa ? { tituloCa: propia.tituloCa } : {}),
  };
  return { ...base, ocupacion: { esco: propia.esco, ...extra } };
}

function preguntaDeOcupacionEnIdioma(
  e: Especificacion,
  grupos: readonly OcupacionDelGrupo[][],
  idioma: Idioma,
  genero: 'f' | 'm' | undefined,
): Pregunta {
  const todas = grupos.flat();
  const opciones: Opcion[] = e.valores.map((v) => {
    const o = todas.find((x) => x.esco === v);
    const titulo = idioma === 'ca' ? (o?.tituloCa ?? o?.titulo) : o?.titulo;
    const texto = titulo ? mayusculaInicial(tituloEnGenero(titulo, genero, idioma)) : undefined;
    return { id: v, texto: texto ?? OPCIONES_FIJAS[v]?.[idioma] ?? v };
  });
  opciones.push({ id: NO_LO_SE, texto: OPCIONES_FIJAS[NO_LO_SE]?.[idioma] ?? NO_LO_SE });
  return { id: e.id, tipo: 'ocupacion', texto: ENUNCIADOS.ocupacion[idioma], opciones, buscarYo: BUSCAR_YO[idioma] };
}

/**
 * Probabilidad mínima para aparecer como alternativa de una propuesta: 0,01. Es menor que el umbral
 * de las opciones de preguntas (0,05), para conservar alternativas cuando la primera candidata concentra la masa.
 */
const P_MINIMA_ALTERNATIVA = 0.01;

/**
 * Las 2 alternativas de una propuesta: lo que importa es el GRUPO, así que primero la mejor ocupación de los grupos
 * siguientes y, si faltan, otras del mismo grupo. Nunca una opción residual (grupo por debajo de P_MINIMA_ALTERNATIVA).
 */
/**
 * Si faltan alternativas, se toman grupos de Entrada.reserva que pertenezcan al universo actual,
 * sin repetir la propuesta ni las alternativas ya elegidas.
 */
function deLaReserva(propuesta: Hipotesis, otros: readonly Hipotesis[], x: Contexto): Hipotesis[] {
  if (!x.entrada.reservaEnAlternativas || otros.length >= ALTERNATIVAS) {
    return [];
  }
  const enElUniverso = new Set(x.orden.map(([g]) => g));
  return (x.entrada.reserva ?? [])
    .filter((g) => g !== propuesta.grupo && enElUniverso.has(g) && !otros.some((h) => h.grupo === g))
    .slice(0, ALTERNATIVAS - otros.length)
    .map((g) => hipotesis(g, x.estado.p.get(g) ?? 0, x.grupos));
}

function alternativasDe(propuesta: Hipotesis, x: Contexto): Hipotesis[] {
  const otrosGrupos = x.orden
    .filter(([g, v]) => g !== propuesta.grupo && v >= P_MINIMA_ALTERNATIVA)
    .map(([g, v]) => hipotesis(g, v, x.grupos));
  const delGrupo = x.grupos.find((l) => l[0]?.grupo === propuesta.grupo) ?? [];
  const pesoDeLaMejor = delGrupo[0]?.peso ?? 0;
  // Otras ocupaciones del mismo grupo solo si compiten de verdad: no se ofrecen especialidades sueltas («segunda mano»,
  // «antigüedades») a quien ha escrito algo general.
  const propia = propuesta.ocupacion?.esco ?? '';
  const mismoGrupo = delGrupo
    .filter(
      (o) =>
        o.esco !== propia &&
        // Las ramas de la propuesta no son alternativas: «cocinero especializado en parrilla» es un cocinero.
        !o.esco.startsWith(`${propia}.`) &&
        o.peso >= pesoDeLaMejor * CASI_COMO_LA_MEJOR,
    )
    .map((o) => ({
      grupo: o.grupo,
      confianza: redondear((x.estado.p.get(o.grupo) ?? 0) * o.peso),
      ocupacion: {
        esco: o.esco,
        ...(o.titulo ? { titulo: o.titulo } : {}),
        ...(o.tituloCa ? { tituloCa: o.tituloCa } : {}),
      },
    }));
  return [...otrosGrupos, ...deLaReserva(propuesta, otrosGrupos, x), ...mismoGrupo].slice(0, ALTERNATIVAS);
}

/** El contexto de un paso: lo que hace falta para construir la pregunta, la propuesta o el resultado. */
interface Contexto {
  a: Atributos;
  entrada: Entrada;
  c: Configuracion;
  estado: Estado;
  orden: [string, number][];
  grupos: OcupacionDelGrupo[][];
  n: number;
}

/** La hipótesis confirmada por la persona (grupo y, si la dio, ocupación). */
function confirmada(x: Contexto, d: Decision): Hipotesis {
  const o = d.esco ? x.grupos.flat().find((v) => v.esco === d.esco) : undefined;
  if (o) {
    return { grupo: d.grupo, confianza: 1, ocupacion: { esco: o.esco, ...(o.titulo ? { titulo: o.titulo } : {}) } };
  }
  const delGrupo = hipotesis(d.grupo, 1, x.grupos);
  return d.motivo === 'confirmada_grupo' ? delGrupo : { grupo: d.grupo, confianza: 1 };
}

function resultadoDe<M extends MotivoDeResultado>(x: Contexto, motivo: M): PasoResultado<M> {
  const d = x.estado.propuestas.decision;
  const hs = x.orden.slice(0, ALTERNATIVAS + 1).map(([g, v]) => hipotesis(g, v, x.grupos));
  const mejor = d ? confirmada(x, d) : (hs[0] ?? hipotesis('', 0, x.grupos));
  const ocupaciones = ocupacionesProbables(x.estado.p, x.entrada, x.c);
  const esco = mejor.ocupacion?.esco;
  return {
    tipo: 'resultado',
    mejor,
    alternativas: hs.filter((h) => h.grupo !== mejor.grupo).slice(0, ALTERNATIVAS),
    ocupaciones:
      d && esco
        ? [{ esco, grupo: d.grupo, confianza: 1 }, ...ocupaciones.filter((o) => o.esco !== esco)].slice(
            0,
            MAX_OCUPACIONES,
          )
        : ocupaciones,
    preguntasHechas: x.n,
    motivo,
    rechazos: x.estado.propuestas.rechazadas.length,
  };
}

/**
 * `sinAlternativas`: la confirmación de una elección en una lista es solo «Sí / No». La persona acaba de elegir entre
 * esas opciones; volver a ofrecerlas como alternativas sobra y abre la puerta a pulsar otra por error.
 */
function propuestaDe(x: Contexto, { sinAlternativas = false }: { sinAlternativas?: boolean } = {}): Paso {
  // Nunca se vuelve a proponer un grupo rechazado (sigue en las alternativas y en «No encuentro la mía»).
  const [g, v] = x.orden.find(([grupo]) => !x.estado.propuestas.rechazadas.includes(grupo)) ?? x.orden[0] ?? ['', 0];
  const lider = hipotesis(g, v, x.grupos);
  const paso = pasoDePropuesta(x.a, {
    propuesta: lider,
    alternativas: sinAlternativas ? [] : alternativasDe(lider, x),
    idioma: x.entrada.idioma,
    numero: x.estado.propuestas.rechazadas.length + 1,
    maximo: x.c.maxPropuestas,
    preguntasHechas: x.n,
    genero: generoDe(x),
  });
  // Un grupo que vuelve tras deshacer su rechazo es otra pregunta: lleva su marca en el id.
  const yaPropuesto = x.entrada.respuestas.some((r) => r.pregunta.startsWith(`${PREFIJO_PROPUESTA}${g}:`));
  return paso.tipo === 'propuesta' && yaPropuesto ? { ...paso, id: `${paso.id}${MARCA_DE_NUEVO}` } : paso;
}

/** Marca del id de una propuesta que vuelve tras deshacer su rechazo. */
const MARCA_DE_NUEVO = ':de-nuevo';

/** «¿Es esta?» con Sí / No para la alternativa elegida, con la misma ocupación con que se ofreció. */
function confirmacionDeAlternativa(x: Contexto, elegida: { readonly grupo: string; readonly esco?: string }): Paso {
  const base = hipotesis(elegida.grupo, x.estado.p.get(elegida.grupo) ?? 0, x.grupos);
  const o = elegida.esco ? x.grupos.flat().find((v) => v.esco === elegida.esco) : undefined;
  const propuesta = o
    ? {
        grupo: base.grupo,
        confianza: base.confianza,
        ocupacion: {
          esco: o.esco,
          ...(o.titulo ? { titulo: o.titulo } : {}),
          ...(o.tituloCa ? { tituloCa: o.tituloCa } : {}),
        },
      }
    : base;
  return pasoDePropuesta(x.a, {
    propuesta,
    alternativas: [],
    idioma: x.entrada.idioma,
    numero: x.estado.propuestas.rechazadas.length + 1,
    maximo: x.c.maxPropuestas,
    preguntasHechas: x.n,
    genero: generoDe(x),
  });
}

function preguntaPaso(x: Contexto, pregunta: Pregunta): PasoPregunta {
  const provisional = x.orden.slice(0, ALTERNATIVAS + 1).map(([g, v]) => hipotesis(g, v, x.grupos));
  return { tipo: 'pregunta', pregunta, numero: x.n + 1, maximo: x.c.maxPreguntas, provisional };
}

/** El género de la persona: el que diga la entrada o el que se deduzca de su texto (en castellano o en catalán). */
function generoDe(x: Contexto): 'f' | 'm' | undefined {
  const titulos = x.grupos.flat().flatMap((o) => [o.titulo ?? '', o.tituloCa ?? '']);
  return x.entrada.genero ?? (x.entrada.texto ? generoDeTexto(x.entrada.texto, titulos) : undefined);
}

/**
 * Parte del peso de la mejor ocupación del grupo con que otra puede darle nombre en una pregunta: la mitad. Con la
 * previa calibrada, ante «profesor», «profesor de educación superior» pesa 0,059 y «de escuela de negocios» 0,111;
 * ante «profesor de bellas artes», la concreta pesa 0,96 y ninguna general llega.
 */
const CASI_COMO_LA_MEJOR = 0.5;

/**
 * La ocupación que nombra a un grupo en «¿Cuál de estos es tu trabajo?»: la más general del árbol de ESCO (menos niveles
 * en su código) entre las que puntúan casi como la mejor. Ante «profesor», «profesor de educación superior» (2310.1) y
 * no su rama «de escuela de negocios» (2310.1.7); ante «profesor de bellas artes», la concreta, que puntúa mucho más.
 */
function representante(lista: readonly OcupacionDelGrupo[]): OcupacionDelGrupo | undefined {
  const [mejor] = lista;
  const niveles = (o: OcupacionDelGrupo) => o.esco.split('.').length;
  return lista
    .filter((o) => mejor && o.peso >= mejor.peso * CASI_COMO_LA_MEJOR)
    .reduce<OcupacionDelGrupo | undefined>((a, o) => (a && niveles(a) <= niveles(o) ? a : o), undefined);
}

/** En la pregunta de grupo, cada opción con el título de la ocupación que lo representa, en el género de la persona. */
function conTitulos(x: Contexto, pregunta: Pregunta): Pregunta {
  if (pregunta.tipo !== 'grupo') {
    return pregunta;
  }
  const genero = generoDe(x);
  const opciones = pregunta.opciones.map((o) => {
    const mejor = representante(x.grupos.find((l) => l[0]?.grupo === o.id) ?? []);
    const titulo = x.entrada.idioma === 'ca' ? (mejor?.tituloCa ?? mejor?.titulo) : mejor?.titulo;
    return titulo ? { ...o, texto: mayusculaInicial(tituloEnGenero(titulo, genero, x.entrada.idioma)) } : o;
  });
  return { ...pregunta, opciones };
}

function mayusculaInicial(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase('es') + texto.slice(1);
}

/** Modo contraste: tras un «No», o si la última respuesta quitó el primer puesto a la líder. */
function contrasteDe(x: Contexto): string[] | null {
  const [g1, g2] = x.orden;
  const contradicha = x.estado.liderAntes !== null && x.estado.liderAntes !== g1?.[0];
  return g1 && g2 && (x.estado.propuestas.ultimaFueRechazo || contradicha) ? [g1[0], g2[0]] : null;
}

function siguientePregunta(x: Contexto): PasoPregunta | null {
  const contraste = contrasteDe(x);
  const lista = candidatasAPregunta(x.a, x.entrada, x.estado, { lideres: contraste ?? [], c: x.c });
  // Con una palabra genérica sola, «¿… de qué?» va primero aunque la previa parezca segura.
  const precisionPrimero = x.entrada.necesitaPrecision !== undefined && x.estado.hechas.length === 0;
  const e = mejorPregunta(lista, x.estado.p, x.c, contraste) ?? (precisionPrimero ? (lista[0] ?? null) : null);
  if (!e) {
    return null;
  }
  const palabra = palabraGenerica(x.entrada);
  const pregunta = conTitulos(x, enIdioma(x.a, e, x.entrada.idioma, palabra));
  const conPrecision =
    x.entrada.necesitaPrecision && x.n === 0
      ? { ...pregunta, texto: enIdioma(x.a, { ...e, tipo: 'precision' }, x.entrada.idioma, palabra).texto }
      : pregunta;
  return preguntaPaso(x, conPrecision);
}

/** La configuración efectiva: la de serie, con lo que cambie la entrada. */
export function configuracionDe(entrada: Entrada): Configuracion {
  return { ...CONFIGURACION, ...entrada.configuracion };
}

/**
 * Con un área («recursos humanos»), sus ocupaciones entran en juego aunque el buscador no las trajera: como candidatas
 * con los puntos de la peor candidata, o en la previa con la probabilidad de su grupo más baja. No dominan: solo están.
 */
function conArea(entrada: Entrada): Entrada {
  const area = entrada.area;
  if (!area) {
    return entrada;
  }
  const faltan = area.ocupaciones.filter((o) => !entrada.candidatas.some((c) => c.esco === o.esco));
  const minimo = entrada.candidatas.length
    ? Math.min(...entrada.candidatas.map((c) => c.puntos))
    : PUNTOS_SIN_CANDIDATAS;
  const candidatas = [
    ...entrada.candidatas,
    ...faltan.map(({ esco, isco08, titulo, tituloCa }) => ({
      esco,
      isco08,
      puntos: minimo,
      ...(titulo ? { titulo } : {}),
      ...(tituloCa ? { tituloCa } : {}),
    })),
  ];
  const previa = entrada.previa ? conGruposDelArea(entrada.previa, area) : undefined;
  return { ...entrada, candidatas, ...(previa ? { previa } : {}) };
}

function conGruposDelArea(previa: PreviaExplicita, area: AreaDeTexto): PreviaExplicita {
  const minimo = Math.min(...previa.grupos.map((g) => g.p));
  const nuevos = [...new Set(area.ocupaciones.map((o) => o.isco08))].filter(
    (g) => !previa.grupos.some((x) => x.isco08 === g),
  );
  return { ...previa, grupos: [...previa.grupos, ...nuevos.map((isco08) => ({ isco08, p: minimo }))] };
}

function contexto(a: Atributos, entradaOriginal: Entrada): Contexto {
  const entrada = conArea(entradaOriginal);
  const c = configuracionDe(entrada);
  const estado = reproducir(a, entrada, c);
  const grupos = ocupacionesPorGrupo(entrada, c);
  return { a, entrada, c, estado, orden: ordenar(estado.p), grupos, n: estado.hechas.length };
}

/** Grupos del área en su orden, cada uno con la primera ocupación que el léxico dio para él. */
interface OpcionDeArea {
  /** Los grupos de la opción, unidos por «+». */
  clave: string;
  /** Las ocupaciones que la nombran (la primera de cada grupo, de más a menos relacionada). */
  ocupaciones: AreaDeTexto['ocupaciones'][number][];
}

/**
 * Las opciones de la pregunta del área cubren sus GRUPOS, no solo las primeras ocupaciones: los profesionales (gran
 * grupo 2) van por separado, porque su grupo de 4 cifras cambia las tareas (selección frente a formación); los demás se
 * juntan por gran grupo (dirección; técnicos; empleados de oficina…), así que «nóminas» sale aunque el léxico la ponga
 * la 13.ª. Se ordenan por el peso del área y se nombran con los títulos de sus ocupaciones.
 */
type OcupacionDeArea = AreaDeTexto['ocupaciones'][number];

/** Minúsculas y sin tildes, para ver si un título contiene el nombre del área. */
function sinTildes(texto: string): string {
  return texto
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Si el título de la ocupación contiene el nombre del área («ayudante de recursos humanos» en «recursos humanos»). */
function nombraElArea(o: OcupacionDeArea, area: AreaDeTexto): boolean {
  const nombre = sinTildes(area.nombre ?? area.texto ?? '').trim();
  return nombre.length > 0 && sinTildes(`${o.titulo ?? ''} ${o.tituloCa ?? ''}`).includes(nombre);
}

/**
 * La ocupación que nombra un grupo en la pregunta de área: la primera cuyo título contiene el área;
 * si no existe, se usa la primera relacionada del grupo.
 */
function ocupacionQueNombra(area: AreaDeTexto, grupo: string): OcupacionDeArea | undefined {
  const delGrupo = area.ocupaciones.filter((o) => o.isco08 === grupo);
  return delGrupo.find((o) => nombraElArea(o, area)) ?? delGrupo[0];
}

function opcionesDelArea(area: AreaDeTexto): OpcionDeArea[] {
  const orden = area.grupos?.map((g) => g.isco08) ?? [...new Set(area.ocupaciones.map((o) => o.isco08))];
  const porClave = new Map<string, string[]>();
  for (const g of orden) {
    const clave =
      orden.length <= MAX_OPCIONES_DE_AREA || g.startsWith(GRAN_GRUPO_PROFESIONALES) ? g : `gran${g.charAt(0)}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), g]);
  }
  return [...porClave.values()].slice(0, MAX_OPCIONES_DE_AREA).map((grupos) => {
    const ocupaciones = grupos
      .map((g) => ocupacionQueNombra(area, g))
      .filter((o): o is OcupacionDeArea => o !== undefined);
    // Una opción que junta grupos se nombra con las ocupaciones que contienen el área; si ninguna, con la más
    // relacionada de todas («agente de empleo» en «recursos humanos», no «supervisor de procesos de impresión»).
    const nombran = ocupaciones.filter((o) => nombraElArea(o, area));
    const masRelacionada = [...ocupaciones].sort((x, y) => (y.peso ?? 0) - (x.peso ?? 0)).slice(0, 1);
    return {
      clave: grupos.join(JUNTOS),
      ocupaciones: (nombran.length ? nombran : masRelacionada).slice(0, TITULOS_POR_OPCION),
    };
  });
}

/** Raíz de una palabra sin género ni número («maestra», «maestros» → «maestr»). */
function raizSinGenero(palabra: string): string {
  return palabra
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(as|os|es|a|o|e)$/, '');
}

/** El «área» es en realidad un puesto si un título candidato empieza por la misma palabra («maestra» → «maestro de…»). */
function esUnPuesto(nombre: string, candidatas: readonly CandidataBusqueda[]): boolean {
  const primera = raizSinGenero(nombre.split(/\s+/)[0] ?? '');
  return candidatas.some((c) =>
    (c.titulo ?? '').split('/').some((t) => raizSinGenero(t.trim().split(/\s+/)[0] ?? '') === primera),
  );
}

/** «¿Qué haces sobre todo en recursos humanos?»: la primera pregunta cuando el texto nombra un área y no un puesto. */
function preguntaDeArea(x: Contexto): Pregunta | null {
  const area = x.entrada.area;
  if (!area || x.estado.hechas.some((h) => h.tipo === 'area') || x.n >= x.c.maxPreguntas) {
    return null;
  }
  const opcionesArea = opcionesDelArea(area);
  if (opcionesArea.length < 2 || esUnPuesto(area.nombre ?? area.texto ?? '', x.entrada.candidatas)) {
    return null;
  }
  const idioma = x.entrada.idioma;
  const base = enIdioma(
    x.a,
    especificacionDeGrupo(
      opcionesArea.map((o) => o.clave),
      'area',
    ),
    idioma,
  );
  const genero = generoDe(x);
  const opciones = base.opciones.map((o) => {
    const titulos = (opcionesArea.find((v) => v.clave === o.id)?.ocupaciones ?? [])
      .map((v) => (idioma === 'ca' ? (v.tituloCa ?? v.titulo) : v.titulo))
      .filter((t): t is string => !!t)
      .map((t) => tituloEnGenero(t, genero, idioma));
    return titulos.length ? { ...o, texto: mayusculaInicial(titulos.join(idioma === 'ca' ? ' o ' : ' o ')) } : o;
  });
  const texto = area.frase
    ? ENUNCIADO_DEL_AREA_CON_FRASE[idioma].replace('{frase}', area.frase[idioma])
    : ENUNCIADOS.area[idioma].replace('{area}', area.nombre ?? area.texto ?? '');
  return { ...base, texto, opciones };
}

/**
 * Elegir una opción de «¿Cuál de estos es tu trabajo?» o de la pregunta del área es ya una confirmación: la persona
 * ha reconocido su trabajo. Si esa opción encabeza ahora la distribución, no se le vuelve a preguntar «¿Es esta?».
 */
function eleccionDirecta(x: Contexto): Decision | null {
  const ultima = x.entrada.respuestas.at(-1);
  const tipo = ultima?.pregunta.split(':')[0];
  // Solo si la opción elegida es un único grupo (una opción que junta varios necesita otra pregunta).
  if (!ultima || (tipo !== 'grupo' && tipo !== 'area') || ultima.opcion !== x.orden[0]?.[0]) {
    return null;
  }
  // La misma ocupación con que se nombró la opción (ocupacionQueNombra).
  const delArea = tipo === 'area' && x.entrada.area ? ocupacionQueNombra(x.entrada.area, ultima.opcion) : undefined;
  const esco = delArea?.esco ?? x.grupos.find((l) => l[0]?.grupo === ultima.opcion)?.[0]?.esco;
  return { grupo: ultima.opcion, ...(esco ? { esco } : {}), motivo: 'confirmada' };
}

/**
 * Se propone cuando la primera candidata supera el umbral, la última propuesta no fue rechazada y no
 * queda pendiente precisar una palabra genérica como «gerente» o «técnico».
 */
function tocaProponer(x: Contexto, p1: number, umbral: number): boolean {
  const precisionPendiente = x.entrada.necesitaPrecision !== undefined && x.n === 0;
  return p1 >= umbralEfectivo(x, umbral) && !x.estado.propuestas.ultimaFueRechazo && !precisionPendiente;
}

/** El umbral de proponer: el más bajo (`umbralProponerSinRival`) si el 2.º grupo no es un rival cercano. */
function umbralEfectivo(x: Contexto, umbral: number): number {
  const sinRival = x.c.umbralProponerSinRival;
  const segundo = x.orden[1]?.[1] ?? 0;
  return sinRival !== undefined && segundo < (x.c.rivalCercano ?? 0) ? Math.min(umbral, sinRival) : umbral;
}

/** Lo que toca ahora, sin mirar las propuestas: una pregunta, o «parar» con el motivo clásico. */
function pasoDePregunta(x: Contexto): PasoPregunta | MotivoClasico {
  const area = preguntaDeArea(x);
  if (area) {
    return preguntaPaso(x, area);
  }
  const p1 = x.orden[0]?.[1] ?? 0;
  const umbral = x.n === 0 ? Math.max(x.c.umbralProponer, x.c.umbralProponerSinPreguntas) : x.c.umbralProponer;
  if (tocaProponer(x, p1, umbral)) {
    const eo = x.n < x.c.maxPreguntas ? preguntaDeOcupacion(x.orden[0]?.[0] ?? '', x.grupos, x.entrada, x.c) : null;
    return eo ? preguntaPaso(x, preguntaDeOcupacionEnIdioma(eo, x.grupos, x.entrada.idioma, generoDe(x))) : 'confianza';
  }
  if (x.n >= x.c.maxPreguntas) {
    return 'tope';
  }
  return siguientePregunta(x) ?? 'sin_preguntas';
}

/**
 * Completa la última lista hasta cinco grupos con la reserva del clasificador, sin repetir grupos ofrecidos
 * ni modificar la previa. Solo admite grupos del universo actual.
 */
function conReserva(x: Contexto, probables: readonly string[], ofrecidos: ReadonlySet<string>): string[] {
  const enElUniverso = new Set(x.orden.map(([g]) => g));
  const extra = (x.entrada.reserva ?? []).filter(
    (g) => enElUniverso.has(g) && !ofrecidos.has(g) && !probables.includes(g),
  );
  return [...probables, ...extra].slice(0, GRUPOS_DE_LA_ULTIMA_LISTA);
}

/** Grupos como mucho en la última lista, y probabilidad mínima para entrar en ella. */
const GRUPOS_DE_LA_ULTIMA_LISTA = 5;
const P_MINIMA_DE_LA_ULTIMA_LISTA = 0.005;
/**
 * Cada tanda de la última lista se ofrece solo tras «Otra cosa» o «No lo sé» en la anterior.
 * Se permiten hasta doce tandas, sometidas también al límite global de respuestas.
 */
const TANDAS_DE_LA_ULTIMA_LISTA = 12;

/**
 * Máximo de respuestas de un recorrido, compartido con ruta-local.ts. Desde la penúltima respuesta no se
 * abren pasos nuevos: queda sitio para una confirmación pendiente y se evita exceder el contrato de petición.
 */
export const MAX_RESPUESTAS_DEL_RECORRIDO = 30;

/** Los grupos de una tanda de la última lista, leídos de su id. */
function gruposDeLaTanda(id: string): string[] {
  return id.slice(0, -MARCA_ULTIMA_LISTA.length).split(':')[1]?.split(',') ?? [];
}

/**
 * Tras «No lo sé» en la última lista, se pregunta la tarea que mejor separa a sus dos grupos más probables.
 * La incertidumbre no descarta grupos; «Otra cosa» sí lo hace.
 */
function aclaracionTrasNoLoSe(x: Contexto): PasoPregunta | null {
  const ultima = x.entrada.respuestas.at(-1);
  if (ultima?.opcion !== NO_LO_SE || !ultima.pregunta.endsWith(MARCA_ULTIMA_LISTA)) {
    return null;
  }
  const tanda = new Set(gruposDeLaTanda(ultima.pregunta));
  const dos = x.orden
    .filter(([g]) => tanda.has(g))
    .slice(0, 2)
    .map(([g]) => g);
  const e = dos.length === 2 ? preguntaDeTareasPara(x.a, dos) : null;
  // Solo una tarea que separe de verdad a esos dos (la misma separación mínima que las preguntas de contraste), y nunca
  // la misma dos veces: si no la hay, sigue la siguiente tanda.
  if (
    !e ||
    x.estado.hechas.some((h) => h.id === e.id) ||
    separacion(e, dos[0] ?? '', dos[1] ?? '', x.c) < SEPARACION_MINIMA
  ) {
    return null;
  }
  const paso = preguntaPaso(x, conTitulos(x, enIdioma(x.a, e, x.entrada.idioma)));
  return { ...paso, maximo: Math.max(paso.maximo, paso.numero) };
}

/**
 * Antes de rendirse («No encuentro la mía»): «¿Cuál de estos es tu trabajo?» con los grupos más probables, también los
 * rechazados, en tandas. Quien dijo «No» por error a su grupo, o lo vio en una lista y no lo eligió, tiene otra
 * oportunidad; si no está, sigue a «No encuentro la mía» con un toque más.
 */
function ultimaLista(x: Contexto): PasoPregunta | null {
  // Hasta TANDAS_DE_LA_ULTIMA_LISTA tandas: tras «Otra cosa», las siguientes, sin repetir las ya ofrecidas.
  const hechas = x.entrada.respuestas.filter((r) => r.pregunta.endsWith(MARCA_ULTIMA_LISTA));
  if (hechas.length >= TANDAS_DE_LA_ULTIMA_LISTA) {
    return null;
  }
  const aclaracion = aclaracionTrasNoLoSe(x);
  if (aclaracion) {
    return aclaracion;
  }
  // Tras «No lo sé», los grupos de esa tanda siguen disponibles: no los ha descartado. Una tanda no se
  // repite nunca idéntica: si saldría igual que otra ya hecha, se excluyen también los de las tandas inciertas.
  const descartados = new Set(hechas.filter((r) => r.opcion !== NO_LO_SE).flatMap((r) => gruposDeLaTanda(r.pregunta)));
  const todos = new Set(hechas.flatMap((r) => gruposDeLaTanda(r.pregunta)));
  const tandaSin = (fuera: ReadonlySet<string>): string[] =>
    conReserva(
      x,
      x.orden
        .filter(([g]) => !fuera.has(g))
        .filter(([, v]) => v >= P_MINIMA_DE_LA_ULTIMA_LISTA)
        .slice(0, GRUPOS_DE_LA_ULTIMA_LISTA)
        .map(([g]) => g),
      fuera,
    );
  const candidata = tandaSin(descartados);
  const repetida = hechas.some((r) => gruposDeLaTanda(r.pregunta).join(',') === candidata.join(','));
  const grupos = repetida ? tandaSin(todos) : candidata;
  if (grupos.length < 2) {
    return null;
  }
  const pregunta = conTitulos(x, enIdioma(x.a, especificacionDeGrupo(grupos), x.entrada.idioma));
  const paso = preguntaPaso(x, { ...pregunta, id: `${pregunta.id}${MARCA_ULTIMA_LISTA}` });
  return { ...paso, maximo: Math.max(paso.maximo, paso.numero) };
}

/**
 * El siguiente paso con propuestas (el patrón de Akinator): si la persona ya confirmó, el resultado; si rechazó todas
 * las propuestas, «no encontrada»; si la líder pasa el umbral de afirmar (por defecto nunca), el resultado; si pasa el
 * de proponer, o se acabaron las preguntas útiles, «¿Tu ocupación es X?»; si no, la siguiente pregunta (tras un «No»,
 * la que más separa a las dos primeras).
 */
/**
 * Antes de seguir, lo que hay que confirmar: una alternativa pulsada en una propuesta o una elección en una
 * lista. Devuelve el paso de confirmación o el contexto con que seguir.
 */
/**
 * Al límite de respuestas, sin nada que confirmar, se acaba como al agotar las tandas: «No encuentro la
 * mía» si hubo algún «No» a una propuesta y, si no, la propuesta de la pantalla.
 */
function alLimiteDeRespuestas(x: Contexto): { readonly paso: Paso } | null {
  if (x.entrada.respuestas.length < MAX_RESPUESTAS_DEL_RECORRIDO - 1) {
    return null;
  }
  return { paso: resultadoDe(x, x.estado.propuestas.rechazadas.length > 0 ? 'no_encontrada' : 'tope') };
}

function antesDeSeguir(x0: Contexto): { readonly paso: Paso } | { readonly x: Contexto } {
  const { decision, alternativaPorConfirmar, rechazadas } = x0.estado.propuestas;
  if (decision) {
    return { x: x0 };
  }
  if (alternativaPorConfirmar) {
    return { paso: confirmacionDeAlternativa(x0, alternativaPorConfirmar) };
  }
  const directa = eleccionDirecta(x0);
  if (!directa) {
    return alLimiteDeRespuestas(x0) ?? { x: x0 };
  }
  // Confirmar siempre: toda elección en una lista se confirma con «Sí / No», con la misma ocupación
  // que la persona acaba de pulsar (no con la representativa del grupo); quien pulsa otra por error lo ve y lo corrige.
  // Elegir en una lista un grupo que antes se rechazó ya es la corrección de aquel «No»: vale sin volver a preguntar
  // (propuestaDe nunca vuelve a proponer un rechazado y propondría otro grupo).
  if (!rechazadas.includes(directa.grupo)) {
    return { paso: confirmacionDeAlternativa(x0, directa) };
  }
  return { x: { ...x0, estado: { ...x0.estado, propuestas: { ...x0.estado.propuestas, decision: directa } } } };
}

export function siguientePasoConPropuestas(a: Atributos, entrada: Entrada): Paso {
  const previo = antesDeSeguir(contexto(a, entrada));
  if ('paso' in previo) {
    return previo.paso;
  }
  const { x } = previo;
  const { decision, rechazadas } = x.estado.propuestas;
  if (decision) {
    return resultadoDe(x, decision.motivo);
  }
  if (rechazadas.length >= x.c.maxPropuestas) {
    return ultimaLista(x) ?? resultadoDe(x, rechazadas.length > 0 ? 'no_encontrada' : 'tope');
  }
  if ((x.orden[0]?.[1] ?? 0) >= x.c.umbralAfirmar) {
    return resultadoDe(x, 'confianza');
  }
  const paso = repropuestaOPregunta(x);
  if (typeof paso !== 'string') {
    return paso;
  }
  // Nunca se propone algo residual: si ya no queda nada probable, se pasa a «No encuentro la mía».
  const lider = x.orden.find(([g]) => !rechazadas.includes(g));
  return (lider?.[1] ?? 0) >= x.c.pMinimaPropuesta
    ? propuestaDe(x)
    : (ultimaLista(x) ?? resultadoDe(x, 'no_encontrada'));
}

/** Probabilidad desde la que un grupo rechazado vuelve a proponerse, y preguntas contestadas desde su «No». */
const UMBRAL_REPROPONER = 0.5;
const PREGUNTAS_TRAS_EL_NO = 2;
/** Marca del id de la propuesta repetida: cuenta como otra pregunta y solo se hace una vez. */
const MARCA_OTRA_VEZ = ':otra-vez';

/**
 * Un grupo rechazado puede proponerse una sola vez más si, tras su «No», al menos dos respuestas lo sitúan
 * claramente en cabeza. Permite corregir un rechazo accidental sin repetir indefinidamente la propuesta.
 */
/** Lo siguiente cuando no hay decisión: la propuesta repetida de un rechazado (si toca) o la siguiente pregunta. */
function repropuestaOPregunta(x: Contexto): Paso | MotivoClasico {
  return repropuesta(x) ?? pasoDePregunta(x);
}

/** Preguntas contestadas desde el último «No» a ese grupo; −1 si nunca se rechazó. */
function preguntasDesdeSuNo(respuestas: Entrada['respuestas'], grupo: string): number {
  const deEse = `${PREFIJO_PROPUESTA}${grupo}:`;
  const ultimoNo = respuestas.findLastIndex((r) => r.pregunta.startsWith(deEse) && r.opcion === 'no');
  return ultimoNo < 0
    ? -1
    : respuestas.slice(ultimoNo + 1).filter((r) => !r.pregunta.startsWith(PREFIJO_PROPUESTA)).length;
}

function repropuesta(x: Contexto): Paso | null {
  const respuestas = x.entrada.respuestas;
  const [primero] = x.orden;
  const rechazadoEnCabeza =
    primero !== undefined && primero[1] >= UMBRAL_REPROPONER && x.estado.propuestas.rechazadas.includes(primero[0]);
  if (!rechazadoEnCabeza || respuestas.some((r) => r.pregunta.endsWith(MARCA_OTRA_VEZ))) {
    return null;
  }
  if (preguntasDesdeSuNo(respuestas, primero[0]) < PREGUNTAS_TRAS_EL_NO) {
    return null;
  }
  const paso = pasoDePropuesta(x.a, {
    propuesta: hipotesis(primero[0], primero[1], x.grupos),
    alternativas: [],
    idioma: x.entrada.idioma,
    numero: x.estado.propuestas.rechazadas.length + 1,
    maximo: x.c.maxPropuestas,
    preguntasHechas: x.n,
    genero: generoDe(x),
  });
  return paso.tipo === 'propuesta' ? { ...paso, id: `${paso.id}${MARCA_OTRA_VEZ}` } : paso;
}
