// Fusión calibrada de léxico, vectores y ocupados por grupo en Cataluña: probabilidades por grupo CIUO-08
// y ocupación ESCO, decisión de propuesta y previa explícita para el motor de preguntas (Entrada.previa).
// Usa regresión logística condicional sobre candidatos y un fondo para el grupo ausente. comprobarModelo
// rechaza rasgos no admitidos por este contrato. Puro, síncrono, determinista y sin red: funciona en Worker y Node.

/** Ocupados mínimos de un grupo: por debajo, el censo de Cataluña no distingue y todos cuentan igual. */
const MIN_OCUPADOS = 500;
/** Puntos léxicos de lo que el buscador no propuso (su mínimo es 20). */
const LEX_AUSENTE = 0;
/** Escalas de los rasgos: puntos del buscador / 10 y similitud × 20, relativos a la 1.ª. */
const ESCALA_LEX = 10;
const ESCALA_VEC = 20;
/** Similitud que se da a lo que queda fuera del top-50 de un modelo: un poco menos que su último. */
const BAJO_EL_SUELO = 0.02;
/** Puntos del buscador de un nombre idéntico al de la ocupación. */
const PUNTOS_EXACTO = 100;
/** Textos de hasta 2 palabras son «cortos». */
const PALABRAS_CORTO = 2;
/** El rasgo `pr` es log10(ocupados) − 4. */
const CENTRO_PR = 4;
const FONDO_POR_DEFECTO = -5;
/** Probabilidad mínima del clasificador para el rasgo `clf` (lo que no está entre sus 30 primeros cuenta así). */
const P_MINIMA_CLF = 1e-4;
/** El rasgo `clf` es (ln p − ln p de su 1.º) / 2, para que su escala se parezca a la del léxico. */
const ESCALA_CLF = 2;
/**
 * La señal del clasificador cuenta entera solo si su 1.ª llega a esta probabilidad; por debajo, en proporción. Un
 * reparto casi plano sobre 426 grupos no ordena la cola: con «doctor» (su 1.ª con 0,03) castigaba al médico general
 * igual que si estuviera seguro. Fijado de antemano; en la validación por familias cuesta 0,1 puntos (77,7 frente a
 * 77,8 %).
 */
const P_INFORMATIVO = 0.2;

/** Los rasgos de cada grupo candidato, en orden. El modelo da un peso por rasgo (los que no estén pesan 0). */
const RASGOS = [
  'lex', // (puntos − puntos de la 1.ª) / 10
  'sinLex', // el buscador no propuso el grupo (habiendo candidatas)
  'lexExacto', // nombre idéntico (puntos ≥ 100)
  'lexCa', // léxico × catalán
  'lexCorto', // léxico × texto corto
  'lexGen', // léxico × palabra genérica («técnico»)
  'vec', // (similitud − la de la 1.ª) × 20, media de los modelos
  'sinVec', // fuera del top-50 de vectores (media de los modelos)
  'vecCa',
  'vecCorto',
  'vecGen',
  'sector', // encaja con una pista de sector del texto
  'pr', // log10 de los ocupados del grupo en Cataluña − 4
  // El clasificador aporta una señal independiente por grupo además de proponer candidatas.
  'clfG', // (ln p − ln p del 1.º del clasificador) / 2, atenuado si su 1.ª no llega a P_INFORMATIVO
  'sinClfG', // el grupo no está entre los 30 primeros del clasificador, con la misma atenuación
  'clfGCa', // clasificador × catalán
] as const;
type Rasgo = (typeof RASGOS)[number];

/** El modelo de fusión, entrenado fuera de este repositorio (modelos/*.json; procedencia en «entrenado»). */
export interface ModeloDeFusion {
  readonly diseno: string;
  /** Los modelos de vectores con que se entrenó, en orden; [] si es solo léxico. */
  readonly vectores: readonly string[];
  readonly pesos: Readonly<Partial<Record<Rasgo, number>>>;
  readonly fondo: number;
  readonly temperatura: number;
  /** P(o | g) ∝ exp(lex · léxico + vec · vectores). */
  readonly ocupacion: { readonly lex: number; readonly vec: number };
  /** Probabilidad mínima para «es esta». */
  readonly umbral: number;
  /** «Es esta» exige además que el léxico y cada modelo de vectores pongan el mismo grupo 1.º. */
  readonly acuerdo: boolean;
}

/** Una candidata del buscador (buscarConContexto), en su orden. */
export interface CandidataLexica {
  readonly esco: string;
  readonly isco08: string;
  readonly puntos: number;
}

/** Las similitudes de un modelo de vectores para la consulta: las 50 ocupaciones y los 50 grupos más parecidos. */
export interface SimilitudesDeConsulta {
  readonly ocupaciones: readonly (readonly [string, number])[];
  readonly grupos: readonly (readonly [string, number])[];
}

interface EntradaDeFusion {
  readonly lexico: readonly CandidataLexica[];
  /** Un elemento por modelo de vectores, en el orden de `modelo.vectores`; [] sin vectores. */
  readonly vectores: readonly SimilitudesDeConsulta[];
  readonly pistas: readonly { readonly grupos: readonly string[] }[];
  /** La palabra genérica del buscador («técnico»), si la hay: entonces nunca se afirma. */
  readonly necesitaPrecision?: string | undefined;
  readonly idioma: 'es' | 'ca';
  /** El texto ya limpio, solo para contar palabras. */
  readonly texto: string;
  /** Quitado el lugar de trabajo, el buscador no da ninguna candidata («TCAE en una residencia»). */
  readonly oficioVacio?: boolean;
  /** Los 30 grupos más probables del clasificador de fragmentos, [grupo, p] de más a menos; [] o nada si no lo hay. */
  readonly clasificador?: readonly (readonly [string, number])[];
}

interface RecursosDeFusion {
  grupoDe(esco: string): string | undefined;
  /** Ocupados del grupo en Cataluña (atributos.json, campo `pr`). */
  ocupados(isco08: string): number | undefined;
}

interface OcupacionFusionada {
  readonly esco: string;
  /** P(o) = P(g) · P(o | g). */
  readonly p: number;
  readonly pEnGrupo: number;
}

interface GrupoFusionado {
  readonly isco08: string;
  readonly p: number;
  readonly ocupaciones: readonly OcupacionFusionada[];
}

interface ContextoDeFusion {
  readonly lexTop: string | null;
  readonly vecTops: readonly string[];
}

export interface DecisionDeFusion {
  /** Los grupos candidatos, del más probable al menos. */
  readonly grupos: readonly GrupoFusionado[];
  /** Probabilidad de que el grupo correcto no esté entre los candidatos. */
  readonly fondo: number;
  readonly contexto: ContextoDeFusion;
  /** Se puede afirmar sin preguntar (umbral, acuerdo de fuentes, sin palabra genérica ni oficio vacío). */
  readonly esEsta: boolean;
  readonly mejor: GrupoFusionado | null;
}

interface Modo {
  readonly ca: number;
  readonly corto: number;
  readonly gen: number;
}

interface ModeloDeVectores {
  readonly top: number;
  readonly suelo: number;
  readonly sueloO: number;
  readonly grupos: ReadonlyMap<string, number>;
  readonly ocupaciones: ReadonlyMap<string, number>;
}

interface Lexico {
  readonly porOcupacion: ReadonlyMap<string, number>;
  readonly porGrupo: ReadonlyMap<string, number>;
  readonly primero: string | null;
  readonly top: number;
  readonly hay: boolean;
}

interface GrupoConRasgos {
  readonly isco08: string;
  readonly x: Readonly<Record<Rasgo, number>>;
  readonly ocupaciones: readonly { readonly esco: string; readonly lex: number; readonly vec: number }[];
}

function palabras(texto: string): number {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

function lexicoDe(lexico: readonly CandidataLexica[]): Lexico {
  const porOcupacion = new Map<string, number>();
  const porGrupo = new Map<string, number>();
  for (const c of lexico) {
    if (!porOcupacion.has(c.esco)) {
      porOcupacion.set(c.esco, c.puntos);
    }
    if ((porGrupo.get(c.isco08) ?? Number.NEGATIVE_INFINITY) < c.puntos) {
      porGrupo.set(c.isco08, c.puntos);
    }
  }
  const orden = [...porGrupo].sort((a, b) => b[1] - a[1]);
  const primero = orden[0];
  return {
    porOcupacion,
    porGrupo,
    primero: primero ? primero[0] : null,
    top: primero ? primero[1] : 0,
    hay: lexico.length > 0,
  };
}

function conDatos(vectores: readonly SimilitudesDeConsulta[]): SimilitudesDeConsulta[] {
  return vectores.filter((v) => v.grupos.length > 0);
}

function modeloDeVectores(v: SimilitudesDeConsulta): ModeloDeVectores {
  const top = v.grupos[0]?.[1] ?? 0;
  const suelo = v.grupos.at(-1)?.[1] ?? top;
  return {
    top,
    suelo,
    sueloO: v.ocupaciones.at(-1)?.[1] ?? suelo,
    grupos: new Map(v.grupos.map(([g, s]) => [g, s])),
    ocupaciones: new Map(v.ocupaciones.map(([e, s]) => [e, s])),
  };
}

/** Las ocupaciones candidatas de cada grupo: las del léxico y las de cada modelo de vectores. */
function ocupacionesPorGrupo(
  lexico: Lexico,
  vecs: readonly ModeloDeVectores[],
  recursos: RecursosDeFusion,
): Map<string, Set<string>> {
  const porGrupo = new Map<string, Set<string>>();
  const escos = [...lexico.porOcupacion.keys(), ...vecs.flatMap((v) => [...v.ocupaciones.keys()])];
  for (const esco of escos) {
    const g = recursos.grupoDe(esco);
    if (g) {
      porGrupo.set(g, (porGrupo.get(g) ?? new Set()).add(esco));
    }
  }
  return porGrupo;
}

/** Media sobre los modelos de (similitud − la de la 1.ª) × 20 y de «fuera del top-50». */
function rasgosDeVectores(g: string, vecs: readonly ModeloDeVectores[]): { vec: number; sinVec: number } {
  let vec = 0;
  let sinVec = 0;
  for (const v of vecs) {
    const s = v.grupos.get(g);
    vec += (((s ?? v.suelo - BAJO_EL_SUELO) - v.top) * ESCALA_VEC) / vecs.length;
    sinVec += s === undefined ? 1 / vecs.length : 0;
  }
  return { vec, sinVec };
}

/** Los rasgos del clasificador para un grupo: 0 si no hay clasificador. */
function rasgosDelClasificador(
  g: string,
  clf: ReadonlyMap<string, number>,
  top: number,
): { clfG: number; sinClfG: number } {
  if (clf.size === 0) {
    return { clfG: 0, sinClfG: 0 };
  }
  const p = clf.get(g);
  const relativa = Math.log(Math.max(p ?? P_MINIMA_CLF, P_MINIMA_CLF)) - Math.log(Math.max(top, P_MINIMA_CLF));
  const seguridad = Math.min(1, top / P_INFORMATIVO);
  return { clfG: (relativa / ESCALA_CLF) * seguridad, sinClfG: (p === undefined ? 1 : 0) * seguridad };
}

interface ContextoDeRasgos {
  readonly entrada: EntradaDeFusion;
  readonly lexico: Lexico;
  readonly vecs: readonly ModeloDeVectores[];
  readonly modo: Modo;
  readonly clf: ReadonlyMap<string, number>;
  readonly clfTop: number;
}

function rasgosDelGrupo(g: string, ctx: ContextoDeRasgos, ocupados: number | undefined): Record<Rasgo, number> {
  const { entrada, lexico, vecs, modo } = ctx;
  const lp = lexico.porGrupo.get(g);
  const lex = lexico.hay ? ((lp ?? LEX_AUSENTE) - lexico.top) / ESCALA_LEX : 0;
  const { vec, sinVec } = rasgosDeVectores(g, vecs);
  const { clfG, sinClfG } = rasgosDelClasificador(g, ctx.clf, ctx.clfTop);
  return {
    lex,
    sinLex: lexico.hay && lp === undefined ? 1 : 0,
    lexExacto: (lp ?? 0) >= PUNTOS_EXACTO ? 1 : 0,
    lexCa: lex * modo.ca,
    lexCorto: lex * modo.corto,
    lexGen: lex * modo.gen,
    vec,
    sinVec,
    vecCa: vec * modo.ca,
    vecCorto: vec * modo.corto,
    vecGen: vec * modo.gen,
    sector: entrada.pistas.some((p) => p.grupos.some((pre) => g.startsWith(pre))) ? 1 : 0,
    pr: Math.log10(Math.max(ocupados ?? 0, MIN_OCUPADOS)) - CENTRO_PR,
    clfG,
    sinClfG,
    clfGCa: clfG * modo.ca,
  };
}

function rasgosDeOcupacion(esco: string, lexico: Lexico, vecs: readonly ModeloDeVectores[]) {
  const lo = lexico.porOcupacion.get(esco);
  let vec = 0;
  for (const v of vecs) {
    vec += (((v.ocupaciones.get(esco) ?? v.sueloO - BAJO_EL_SUELO) - v.top) * ESCALA_VEC) / vecs.length;
  }
  return { esco, lex: lexico.hay ? ((lo ?? LEX_AUSENTE) - lexico.top) / ESCALA_LEX : 0, vec };
}

/** Los grupos candidatos (los del léxico y los de cada modelo de vectores) con sus rasgos y sus ocupaciones. */
export function rasgos(
  entrada: EntradaDeFusion,
  recursos: RecursosDeFusion,
): { grupos: GrupoConRasgos[]; contexto: ContextoDeFusion } {
  const lexico = lexicoDe(entrada.lexico);
  const conVectores = conDatos(entrada.vectores);
  const vecs = conVectores.map(modeloDeVectores);
  const modo: Modo = {
    ca: entrada.idioma === 'ca' ? 1 : 0,
    corto: palabras(entrada.texto) <= PALABRAS_CORTO ? 1 : 0,
    gen: entrada.necesitaPrecision ? 1 : 0,
  };
  const ocuPorGrupo = ocupacionesPorGrupo(lexico, vecs, recursos);
  const universo = new Set([
    ...lexico.porGrupo.keys(),
    ...ocuPorGrupo.keys(),
    ...vecs.flatMap((v) => [...v.grupos.keys()]),
  ]);
  const clf = new Map(entrada.clasificador ?? []);
  const clfTop = entrada.clasificador?.[0]?.[1] ?? 0;
  const grupos = [...universo].sort().map((g) => ({
    isco08: g,
    x: rasgosDelGrupo(g, { entrada, lexico, vecs, modo, clf, clfTop }, recursos.ocupados(g)),
    ocupaciones: [...(ocuPorGrupo.get(g) ?? [])].map((esco) => rasgosDeOcupacion(esco, lexico, vecs)),
  }));
  const vecTops = conVectores.map((v) => v.grupos[0]?.[0] ?? '');
  return { grupos, contexto: { lexTop: lexico.primero, vecTops } };
}

function softmax(z: readonly number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

function porProbabilidad<T extends { readonly p: number }>(clave: (x: T) => string) {
  return (a: T, b: T): number => b.p - a.p || (clave(a) < clave(b) ? -1 : 1);
}

/** Probabilidades calibradas de cada grupo candidato, de sus ocupaciones y del fondo. */
function probabilidades(
  r: { grupos: readonly GrupoConRasgos[]; contexto: ContextoDeFusion },
  modelo: ModeloDeFusion,
): Omit<DecisionDeFusion, 'esEsta' | 'mejor'> {
  const t = modelo.temperatura;
  const z = r.grupos.map(({ x }) => RASGOS.reduce((s, n) => s + x[n] * (modelo.pesos[n] ?? 0), 0) / t);
  const p = softmax([...z, modelo.fondo / t]);
  const grupos = r.grupos
    .map((g, i) => {
      const pg = p[i] ?? 0;
      const po = softmax(g.ocupaciones.map((o) => modelo.ocupacion.lex * o.lex + modelo.ocupacion.vec * o.vec));
      return {
        isco08: g.isco08,
        p: pg,
        ocupaciones: g.ocupaciones
          .map((o, j) => ({ esco: o.esco, p: pg * (po[j] ?? 0), pEnGrupo: po[j] ?? 0 }))
          .sort(porProbabilidad((o) => o.esco)),
      };
    })
    .sort(porProbabilidad((g) => g.isco08));
  return { grupos, fondo: p.at(-1) ?? 1, contexto: r.contexto };
}

/**
 * ¿Puede afirmarse sin preguntar? La 1.ª llega al umbral, la búsqueda no es una palabra genérica, el texto sin el lugar
 * de trabajo nombra algún puesto y, con `acuerdo`, el léxico y cada modelo de vectores ponen ese grupo 1.º.
 */
function puedeAfirmar(
  d: Omit<DecisionDeFusion, 'esEsta' | 'mejor'>,
  modelo: ModeloDeFusion,
  entrada: EntradaDeFusion,
): boolean {
  const top = d.grupos[0];
  if (!top || entrada.necesitaPrecision || entrada.oficioVacio || top.p < modelo.umbral) {
    return false;
  }
  // Con acuerdo, cada modelo de vectores del modelo tiene que haber dado su 1.º: una tabla que no reconoce ninguna
  // palabra no cuenta como un modelo que coincide (en el original, la lista vacía coincidía siempre).
  const { lexTop, vecTops } = d.contexto;
  const todos = vecTops.length === modelo.vectores.length;
  return !modelo.acuerdo || (lexTop === top.isco08 && todos && vecTops.every((g) => g === top.isco08));
}

/** Todo junto: rasgos → probabilidades → decisión. */
export function fusionar(
  entrada: EntradaDeFusion,
  modelo: ModeloDeFusion,
  recursos: RecursosDeFusion,
): DecisionDeFusion {
  const d = probabilidades(rasgos(entrada, recursos), modelo);
  return { ...d, esEsta: puedeAfirmar(d, modelo, entrada), mejor: d.grupos[0] ?? null };
}

/** La previa explícita del motor de preguntas (`Entrada.previa`): las probabilidades tal cual, sin recorte en 0. */
export interface PreviaDeFusion {
  readonly grupos: readonly { readonly isco08: string; readonly p: number }[];
  readonly fondo: number;
  readonly ocupaciones: readonly { readonly esco: string; readonly isco08: string; readonly p: number }[];
}

/**
 * La previa explícita para el motor de 1B. `fondoMinimo` deja siempre algo de masa a los grupos no candidatos para
 * que las preguntas puedan recuperarlos.
 */
export function previaParaElMotor(d: Pick<DecisionDeFusion, 'grupos' | 'fondo'>, fondoMinimo = 0): PreviaDeFusion {
  return {
    grupos: d.grupos.map((g) => ({ isco08: g.isco08, p: g.p })),
    fondo: Math.max(d.fondo, fondoMinimo),
    ocupaciones: d.grupos.flatMap((g) => g.ocupaciones.map((o) => ({ esco: o.esco, isco08: g.isco08, p: o.p }))),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// El modelo: se comprueba al cargarlo, para que un JSON mal formado no dé probabilidades sin sentido

class ModeloInvalido extends Error {
  override name = 'ModeloInvalido';
}

function numero(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new ModeloInvalido(`modelo de fusión: «${campo}» no es un número`);
  }
  return valor;
}

function pesos(valor: unknown): Partial<Record<Rasgo, number>> {
  if (typeof valor !== 'object' || valor === null) {
    throw new ModeloInvalido('modelo de fusión: faltan los pesos');
  }
  const salida: Partial<Record<Rasgo, number>> = {};
  for (const [n, w] of Object.entries(valor)) {
    if (!(RASGOS as readonly string[]).includes(n)) {
      throw new ModeloInvalido(`modelo de fusión: rasgo desconocido «${n}» (solo el diseño logístico)`);
    }
    salida[n as Rasgo] = numero(w, `pesos.${n}`);
  }
  return salida;
}

/**
 * El modelo de fusión (uno de modelos/*.json) comprobado. Falla con ModeloInvalido si faltan los pesos, si trae un
 * rasgo que no es del diseño logístico, si un campo numérico no es un número, si «vectores» no es una lista de
 * nombres o si la temperatura no es positiva. El texto de «diseno» no se valida.
 */
export function comprobarModelo(valor: unknown): ModeloDeFusion {
  const m = (typeof valor === 'object' && valor !== null ? valor : {}) as Record<string, unknown>;
  const ocupacion = (m.ocupacion ?? {}) as Record<string, unknown>;
  if (!(Array.isArray(m.vectores) && m.vectores.every((v) => typeof v === 'string'))) {
    throw new ModeloInvalido('modelo de fusión: «vectores» no es una lista de nombres');
  }
  const temperatura = numero(m.temperatura ?? 1, 'temperatura');
  if (temperatura <= 0) {
    throw new ModeloInvalido('modelo de fusión: la temperatura tiene que ser positiva');
  }
  return {
    diseno: typeof m.diseno === 'string' ? m.diseno : '',
    vectores: m.vectores,
    pesos: pesos(m.pesos),
    fondo: numero(m.fondo ?? FONDO_POR_DEFECTO, 'fondo'),
    temperatura,
    ocupacion: { lex: numero(ocupacion.lex ?? 1, 'ocupacion.lex'), vec: numero(ocupacion.vec ?? 0, 'ocupacion.vec') },
    umbral: numero(m.umbral, 'umbral'),
    acuerdo: m.acuerdo === true,
  };
}
