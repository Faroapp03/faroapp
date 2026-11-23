// Las preguntas posibles en cada momento y lo que cada grupo CIUO-08 respondería a cada una (su reparto entre las
// opciones), sacado solo de atributos.json. Una pregunta se identifica por su id, que basta para reconstruirla al
// volver a aplicar las respuestas: el motor no guarda estado.

import { BUSCAR_YO, CAMPOS, ENUNCIADOS, NIVEL1, NIVEL2, OPCIONES_FIJAS, TRATO } from './textos.ts';
import type { Atributos, Idioma, Opcion, Pregunta, TipoPregunta } from './tipos.ts';

export const NO_LO_SE = 'no_lo_se';
const OTRA = 'otra';
/** Opciones con contenido por pregunta (más «Otra cosa» o «Ninguna de estas», y «No lo sé»). */
export const OPCIONES_POR_PREGUNTA = 3;
/** Parecido de tareas por debajo del cual otro grupo no elegiría esta tarea (el mínimo que guarda el generador). */
const PARECIDO_SIN_CONFUSION = 0.35;
const SEPARADOR = ':';
const SEPARADOR_VALORES = ',';

/** Una pregunta como la ve el motor: sus opciones y, para cada grupo, cómo repartiría su respuesta. */
export interface Especificacion {
  readonly id: string;
  readonly tipo: TipoPregunta;
  readonly valores: readonly string[];
  /** Reparto de la respuesta del grupo entre `valores` (suma 1), o null si el dato no lo dice (no informa). */
  reparto(grupo: string): readonly number[] | null;
}

type Distribucion = ReadonlyMap<string, number>;

function masaPorClave(p: Distribucion, clave: (g: string) => string | null): [string, number][] {
  const masa = new Map<string, number>();
  for (const [g, x] of p) {
    const k = clave(g);
    if (k !== null) {
      masa.set(k, (masa.get(k) ?? 0) + x);
    }
  }
  return [...masa].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function unoEn(valores: readonly string[], valor: string, resto: string): number[] {
  const i = valores.indexOf(valor);
  const indice = i < 0 ? valores.indexOf(resto) : i;
  return valores.map((_, j) => (j === indice ? 1 : 0));
}

// ---------- Jerarquía (gran grupo, subgrupo principal, subgrupo) ----------

const NIVELES: Readonly<Record<string, number>> = { nivel1: 1, nivel2: 2, nivel3: 3 };

function jerarquia(tipo: TipoPregunta, codigos: readonly string[]): Especificacion {
  const cifras = NIVELES[tipo] ?? 1;
  const valores = [...codigos, OTRA];
  return {
    id: `${tipo}${SEPARADOR}${codigos.join(SEPARADOR_VALORES)}`,
    tipo,
    valores,
    reparto: (g) => unoEn(valores, g.slice(0, cifras), OTRA),
  };
}

/**
 * Máximo de ramas por nivel de la clasificación. Evita una lista demasiado corta cuando la previa
 * no coloca la rama de la persona entre las primeras opciones.
 */
const RAMAS_POR_NIVEL: Readonly<Record<string, number>> = { nivel1: 10, nivel2: 7, nivel3: 7 };
/** Parte de la masa de la 1.ª rama que necesita otra para entrar en la lista: solo ramas con probabilidad real. */
const PROPORCION_MINIMA_DE_RAMA = 0.02;

export function preguntaDeJerarquia(tipo: TipoPregunta, p: Distribucion): Especificacion | null {
  const cifras = NIVELES[tipo] ?? 1;
  const masa = masaPorClave(p, (g) => g.slice(0, cifras));
  const primera = masa[0]?.[1] ?? 0;
  const ramas = masa
    .filter(([, x]) => x >= primera * PROPORCION_MINIMA_DE_RAMA)
    .slice(0, RAMAS_POR_NIVEL[tipo] ?? OPCIONES_POR_PREGUNTA);
  return ramas.length < 2
    ? null
    : jerarquia(
        tipo,
        ramas.map(([k]) => k),
      );
}

// ---------- Grupo: «¿Cuál de estos es tu trabajo?» ----------

/**
 * Una opción de grupo necesita al menos esta parte de la probabilidad del grupo líder. Con solo el mínimo absoluto
 * entraban residuos que una persona ve absurdos: ante «maestra», «maestro cervecero» (9 %
 * frente al 32 % de primaria); ante «limpiador», «limpiador de granos de cacao». «Otra cosa» sigue siempre disponible.
 */
const PROPORCION_MINIMA_DE_LA_LIDER = 0.33;

/**
 * Pregunta por el GRUPO de 4 cifras (lo que decide las tareas y la estimación), con una opción por grupo probable. El
 * texto de cada opción lo pone el motor: el título de la mejor ocupación del grupo (en el género de la persona) o el
 * título oficial del grupo. Solo entran grupos con probabilidad real (`pMinima`), de 2 a OPCIONES_POR_PREGUNTA + 1.
 */
export function preguntaDeGrupo(p: Distribucion, pMinima: number): Especificacion | null {
  const lider = Math.max(0, ...p.values());
  const grupos = [...p]
    .filter(([, x]) => x >= Math.max(pMinima, lider * PROPORCION_MINIMA_DE_LA_LIDER))
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, OPCIONES_POR_PREGUNTA + 1)
    .map(([g]) => g);
  return grupos.length < 2 ? null : especificacionDeGrupo(grupos);
}

/** Separa los grupos de una misma opción («4416+4313»): una opción puede juntar varios grupos del mismo tipo de trabajo. */
export const JUNTOS = '+';

export function especificacionDeGrupo(grupos: readonly string[], tipo: 'grupo' | 'area' = 'grupo'): Especificacion {
  const valores = [...grupos, OTRA];
  const opcionDe = (g: string): string => grupos.find((o) => o.split(JUNTOS).includes(g)) ?? OTRA;
  return {
    id: `${tipo}${SEPARADOR}${grupos.join(SEPARADOR_VALORES)}`,
    tipo,
    valores,
    reparto: (g) => unoEn(valores, opcionDe(g), OTRA),
  };
}

// ---------- Tareas típicas, de sí o no ----------

function parecidoCon(a: Atributos, tarea: string, grupo: string): number {
  const vecino = a.tareas[tarea]?.ve.find(([g]) => g === grupo);
  return vecino ? vecino[1] : 0;
}

function grupoDeTarea(tareaId: string): string {
  return tareaId.slice(0, tareaId.indexOf('-'));
}

/**
 * «¿Esto forma parte de tu trabajo? «Planificar menús»» → Sí / No. Una persona hace muchas tareas a la vez, así que no se
 * le pide elegir una: se pregunta por una sola. Dice que sí quien es del grupo de la tarea y, a medias, quien tiene una
 * tarea parecida (parecido TF-IDF por encima de PARECIDO_SIN_CONFUSION).
 */
function especificacionDeTarea(a: Atributos, tarea: string): Especificacion {
  return {
    id: `tarea${SEPARADOR}${tarea}`,
    tipo: 'tarea',
    valores: ['si', 'no'],
    reparto: (g) => {
      const si =
        grupoDeTarea(tarea) === g
          ? 1
          : Math.max(0, (parecidoCon(a, tarea, g) - PARECIDO_SIN_CONFUSION) / (1 - PARECIDO_SIN_CONFUSION));
      return [si, 1 - si];
    },
  };
}

/** Las preguntas de tareas posibles: las típicas de los grupos con probabilidad real (`pMinima`), las primeras antes. */
export function preguntasDeTareas(a: Atributos, p: Distribucion, pMinima: number): Especificacion[] {
  return [...p]
    .filter(([, x]) => x >= pMinima)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, OPCIONES_POR_PREGUNTA)
    .flatMap(([g]) => (a.grupos[g]?.ta ?? []).map((t) => especificacionDeTarea(a, t)));
}

/** La tarea típica de `grupo` que mejor lo separa de `otro` (para el contraste). */
export function preguntaDeTareasPara(a: Atributos, grupos: readonly string[]): Especificacion | null {
  const [g1 = '', g2 = ''] = grupos;
  const tareas = a.grupos[g1]?.ta ?? [];
  let mejor: string | null = null;
  let menor = Number.POSITIVE_INFINITY;
  for (const t of tareas) {
    const choque = parecidoCon(a, t, g2);
    if (choque < menor) {
      menor = choque;
      mejor = t;
    }
  }
  return mejor ? especificacionDeTarea(a, mejor) : null;
}

// ---------- Atributos de ESCO y del censo ----------

function preguntaDeTrato(a: Atributos): Especificacion {
  return { id: 'trato', tipo: 'trato', valores: TRATO.map(([k]) => k), reparto: (g) => a.grupos[g]?.tr ?? null };
}

function campos(a: Atributos, tipo: TipoPregunta, codigos: readonly string[]): Especificacion {
  return {
    id: `${tipo}${SEPARADOR}${codigos.join(SEPARADOR_VALORES)}`,
    tipo,
    valores: [...codigos, OTRA],
    reparto: (g) => {
      const cm = a.grupos[g]?.cm;
      if (!cm) {
        return null;
      }
      const elegidos = codigos.map((c) => cm[c] ?? 0);
      return [...elegidos, Math.max(0, 1 - elegidos.reduce((s, x) => s + x, 0))];
    },
  };
}

export function preguntaDeCampo(a: Atributos, p: Distribucion, tipo: TipoPregunta): Especificacion | null {
  const masa = new Map<string, number>();
  for (const [g, x] of p) {
    for (const [c, parte] of Object.entries(a.grupos[g]?.cm ?? {})) {
      masa.set(c, (masa.get(c) ?? 0) + x * parte);
    }
  }
  const orden = [...masa].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  return orden.length < 2
    ? null
    : campos(
        a,
        tipo,
        orden.slice(0, OPCIONES_POR_PREGUNTA).map(([c]) => c),
      );
}

function siNo(a: Atributos, tipo: 'universidad' | 'cuenta_propia'): Especificacion {
  const campo = tipo === 'universidad' ? 'un' : 'cp';
  return {
    id: tipo,
    tipo,
    valores: ['si', 'no'],
    reparto: (g) => {
      const x = a.grupos[g]?.[campo];
      return x === undefined ? null : [x, 1 - x];
    },
  };
}

/** Las preguntas que no dependen de la distribución. */
export function preguntasFijas(a: Atributos): Especificacion[] {
  return [preguntaDeTrato(a), siNo(a, 'universidad'), siNo(a, 'cuenta_propia')];
}

/** Marca, al final del id de una pregunta de grupo, de la última lista que se ofrece antes de rendirse (motor.ts). */
export const MARCA_ULTIMA_LISTA = ':ultima';

/** Reconstruye una pregunta a partir de su id (para volver a aplicar una respuesta). */
export function reconstruir(a: Atributos, idConMarca: string): Especificacion | null {
  const id = idConMarca.endsWith(MARCA_ULTIMA_LISTA) ? idConMarca.slice(0, -MARCA_ULTIMA_LISTA.length) : idConMarca;
  const corte = id.indexOf(SEPARADOR);
  const cabeza = corte < 0 ? id : id.slice(0, corte);
  const valores = corte < 0 ? [] : id.slice(corte + 1).split(SEPARADOR_VALORES);
  if (cabeza in NIVELES) {
    return jerarquia(cabeza as TipoPregunta, valores);
  }
  if (cabeza === 'tarea') {
    return especificacionDeTarea(a, valores[0] ?? '');
  }
  if (cabeza === 'grupo' || cabeza === 'area') {
    return especificacionDeGrupo(valores, cabeza);
  }
  if (cabeza === 'campo' || cabeza === 'precision') {
    return campos(a, cabeza, valores);
  }
  return preguntasFijas(a).find((e) => e.id === cabeza) ?? null;
}

// ---------- Textos ----------

function textoDeValor(a: Atributos, e: Especificacion, valor: string, idioma: Idioma): string {
  const fija = OPCIONES_FIJAS[valor];
  if (fija) {
    return fija[idioma];
  }
  if (e.tipo === 'grupo' || e.tipo === 'area') {
    return a.etiquetas4[valor]?.[idioma] ?? valor;
  }
  if (e.tipo === 'campo' || e.tipo === 'precision') {
    return CAMPOS[valor]?.[idioma] ?? valor;
  }
  if (e.tipo === 'trato') {
    return TRATO.find(([k]) => k === valor)?.[1][idioma] ?? valor;
  }
  const tablas: Readonly<Record<string, Readonly<Record<string, Readonly<Record<Idioma, string>>>>>> = {
    nivel1: NIVEL1,
    nivel2: NIVEL2,
  };
  return (tablas[e.tipo] ?? a.etiquetas3)[valor]?.[idioma] ?? valor;
}

/** La pregunta lista para la interfaz, en el idioma pedido, con «No lo sé» al final. */
export function enIdioma(a: Atributos, e: Especificacion, idioma: Idioma, palabra?: string): Pregunta {
  const opciones: Opcion[] = e.valores.map((v) => ({ id: v, texto: textoDeValor(a, e, v, idioma) }));
  opciones.push({ id: NO_LO_SE, texto: OPCIONES_FIJAS[NO_LO_SE]?.[idioma] ?? NO_LO_SE });
  const tarea = e.tipo === 'tarea' ? (a.tareas[e.id.split(SEPARADOR)[1] ?? '']?.[idioma] ?? '') : '';
  const enunciado = ENUNCIADOS[e.tipo][idioma].replace('{tarea}', tarea);
  const conPalabra = palabra ? enunciado.replace('{palabra}', mayuscula(palabra)) : enunciado.replace('{palabra}', '');
  return { id: e.id, tipo: e.tipo, texto: conPalabra, opciones, buscarYo: BUSCAR_YO[idioma] };
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase('es') + texto.slice(1);
}
