// Parecido entre tareas de la OIT (TF-IDF sobre las palabras en forma común del texto en castellano) para elegir las
// tareas características de cada grupo y saber qué otros grupos tienen una tarea casi igual.

/** Una tarea de la OIT con sus palabras y sus textos cortos. */
export interface TareaTexto {
  id: string;
  indice: number;
  palabras: string[];
  es: string;
  ca: string;
}

/** Tareas típicas que se guardan por grupo (las primeras del orden oficial, sin repetir casi lo mismo). */
const TAREAS_POR_GRUPO = 4;
/** Dos tareas elegidas del mismo grupo no pueden parecerse más que esto (para que digan cosas distintas). */
const MAX_PARECIDO_ENTRE_ELEGIDAS = 0.5;
/** Cuánto pesa el orden oficial de la tarea (las primeras suelen ser las centrales del grupo). */
const PESO_DEL_ORDEN = 0.15;
/** Parecido mínimo para guardar que otro grupo tiene una tarea como esta. */
export const MIN_PARECIDO_VECINO = 0.35;
/** Vecinos que se guardan como mucho por tarea. */
const MAX_VECINOS = 25;
const DECIMALES = 100;

type Vector = Map<string, number>;
const vectores = new WeakMap<TareaTexto, Vector>();
let idf = new Map<string, number>();

function prepararIdf(porGrupo: ReadonlyMap<string, TareaTexto[]>): Map<string, number> {
  const df = new Map<string, number>();
  let n = 0;
  for (const tareas of porGrupo.values()) {
    for (const t of tareas) {
      n++;
      for (const p of new Set(t.palabras)) {
        df.set(p, (df.get(p) ?? 0) + 1);
      }
    }
  }
  return new Map([...df].map(([p, d]) => [p, Math.log(n / d)]));
}

function vectorDe(t: TareaTexto): Vector {
  let v = vectores.get(t);
  if (!v) {
    const crudo = new Map<string, number>();
    for (const p of t.palabras) {
      crudo.set(p, (crudo.get(p) ?? 0) + (idf.get(p) ?? 0));
    }
    const norma = Math.sqrt([...crudo.values()].reduce((s, x) => s + x * x, 0)) || 1;
    v = new Map([...crudo].map(([p, x]) => [p, x / norma]));
    vectores.set(t, v);
  }
  return v;
}

/** Parecido coseno entre dos tareas. Exige haber calculado antes el IDF con tareasRepresentativas(). */
export function parecido(a: TareaTexto, b: TareaTexto): number {
  if (idf.size === 0) {
    throw new Error('similitud: falta el IDF; llama antes a tareasRepresentativas()');
  }
  const va = vectorDe(a);
  const vb = vectorDe(b);
  let s = 0;
  for (const [p, x] of va) {
    s += x * (vb.get(p) ?? 0);
  }
  return s;
}

/** Rareza media de las palabras de la tarea entre grupos (cuánto distingue a su grupo de los demás). */
function distintiva(t: TareaTexto, rarezaGrupo: ReadonlyMap<string, number>): number {
  const palabras = [...new Set(t.palabras)];
  if (!palabras.length) {
    return 0;
  }
  const media = palabras.reduce((s, p) => s + (rarezaGrupo.get(p) ?? 0), 0) / palabras.length;
  return media / (1 + PESO_DEL_ORDEN * (t.indice - 1));
}

function rarezaEntreGrupos(porGrupo: ReadonlyMap<string, TareaTexto[]>): Map<string, number> {
  const gdf = new Map<string, number>();
  for (const tareas of porGrupo.values()) {
    for (const p of new Set(tareas.flatMap((t) => t.palabras))) {
      gdf.set(p, (gdf.get(p) ?? 0) + 1);
    }
  }
  return new Map([...gdf].map(([p, d]) => [p, Math.log(porGrupo.size / d)]));
}

/** Hasta TAREAS_POR_GRUPO tareas por grupo: las más típicas (orden oficial) que no se parecen entre sí. */
export function tareasRepresentativas(porGrupo: ReadonlyMap<string, TareaTexto[]>): Map<string, TareaTexto[]> {
  idf = prepararIdf(porGrupo);
  const rareza = rarezaEntreGrupos(porGrupo);
  const salida = new Map<string, TareaTexto[]>();
  for (const [g, tareas] of porGrupo) {
    // Típicas primero: el orden oficial de la OIT pone delante el núcleo del trabajo. La rareza solo desempataría
    // dos tareas del mismo grupo con el mismo índice oficial.
    const orden = [...tareas].sort((a, b) => a.indice - b.indice || distintiva(b, rareza) - distintiva(a, rareza));
    const elegidas: TareaTexto[] = [];
    for (const t of orden) {
      if (elegidas.length < TAREAS_POR_GRUPO && elegidas.every((e) => parecido(e, t) < MAX_PARECIDO_ENTRE_ELEGIDAS)) {
        elegidas.push(t);
      }
    }
    salida.set(g, elegidas);
  }
  return salida;
}

/** Otros grupos con alguna tarea parecida a esta (parecido máximo), de más a menos parecido. */
export function vecinosDeTarea(
  tarea: TareaTexto,
  grupo: string,
  porGrupo: ReadonlyMap<string, TareaTexto[]>,
): [string, number][] {
  const vecinos: [string, number][] = [];
  for (const [g, tareas] of porGrupo) {
    if (g === grupo) {
      continue;
    }
    const max = Math.max(...tareas.map((t) => parecido(tarea, t)));
    if (max >= MIN_PARECIDO_VECINO) {
      vecinos.push([g, Math.round(max * DECIMALES) / DECIMALES]);
    }
  }
  return vecinos.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_VECINOS);
}
