// Comprobación de atributos.json y registro de la fuente y la fiabilidad de cada atributo. Un atributo sin fuente
// registrada aquí hace fallar la comprobación: el motor no usa nada que no tenga respaldo oficial.

import type { Atributos } from './tipos.ts';

type Fiabilidad = 'alta' | 'media' | 'baja';

interface FichaDeAtributo {
  /** Clave de atributos.json (por grupo) o nombre del atributo. */
  readonly clave: string;
  /** Clave de `fuentes` en atributos.json. */
  readonly fuente: string;
  readonly fiabilidad: Fiabilidad;
  readonly usado: boolean;
  readonly regla: string;
}

/** Todos los atributos considerados, con su fuente, su regla y si el motor los usa. */
export const FICHAS: readonly FichaDeAtributo[] = [
  {
    clave: 'jerarquia',
    fuente: 'jerarquia',
    fiabilidad: 'alta',
    usado: true,
    regla:
      'Gran grupo, subgrupo principal y subgrupo salen de las cifras del código CIUO-08; las opciones son paráfrasis llanas de los títulos oficiales.',
  },
  {
    clave: 'ta',
    fuente: 'tareas',
    fiabilidad: 'alta',
    usado: true,
    regla:
      'Cuatro tareas de la OIT por grupo, las más TÍPICAS: las primeras del orden oficial (el núcleo del trabajo), sin dos casi iguales; la rareza de sus palabras solo desempata. Con los grupos que tienen una tarea parecida (TF-IDF ≥ 0,35).',
  },
  {
    clave: 'pr',
    fuente: 'prior',
    fiabilidad: 'alta',
    usado: true,
    regla:
      'Ocupados del CNO de 3 cifras repartidos por igual entre sus CNO de 4 cifras enlazados y estos entre los grupos CIUO-08 que comparten cada uno (aproximación).',
  },
  {
    clave: 'un',
    fuente: 'censo',
    fiabilidad: 'alta',
    usado: true,
    regla:
      'Proporción de ocupados con estudios universitarios del CNO de 3 cifras (o de 2 si no hay perfil), ponderada por ocupados. Es una probabilidad, no un sí o un no.',
  },
  {
    clave: 'cp',
    fuente: 'censo',
    fiabilidad: 'alta',
    usado: true,
    regla: 'Proporción de ocupados por cuenta propia, igual que `un`.',
  },
  {
    clave: 'tr',
    fuente: 'esco',
    fiabilidad: 'media',
    usado: true,
    regla:
      'Reparto de las competencias esenciales de las ocupaciones ESCO del grupo entre los grupos del pilar S1+S3 (personas), S2+S4+S5 (información) y S6+S7+S8 (manos o máquinas); solo con 12 o más. Mide el perfil de competencias, no el tiempo dedicado.',
  },
  {
    clave: 'cm',
    fuente: 'esco',
    fiabilidad: 'media',
    usado: true,
    regla:
      'Reparto de los conocimientos esenciales del grupo entre los campos amplios ISCED-F (01-10); solo con 5 o más.',
  },
  {
    clave: 'sector',
    fuente: 'buscador',
    fiabilidad: 'media',
    usado: true,
    regla:
      'No está en atributos.json: lo da el buscador como pistas de sector (src/busqueda/contexto.ts) con sus prefijos CIUO-08; el motor lo aplica como una respuesta poco fiable (error 0,5), nunca como pregunta ni para descartar.',
  },
  {
    clave: 'entorno',
    fuente: 'ninguna',
    fiabilidad: 'baja',
    usado: false,
    regla:
      'Lugar de trabajo (oficina, obra, domicilios…): no hay un dato oficial por grupo en el paquete; las reglas de palabras sobre las tareas en inglés no tienen rigor suficiente. No se usa.',
  },
  {
    clave: 'mando',
    fuente: 'ninguna',
    fiabilidad: 'baja',
    usado: false,
    regla:
      '«¿Tienes personas a tu cargo?»: solo el gran grupo 1 lo implica; para los demás no hay dato. Ya lo cubre la pregunta de jerarquía. No se usa.',
  },
];

const CLAVES_DE_GRUPO = new Set(['pr', 'un', 'cp', 'tr', 'cm', 'ta']);
/** Atributos que no salen de atributos.json (los da otra pieza con su propia fuente). */
export const FUENTES_EXTERNAS = new Set(['buscador']);
const CATEGORIAS_TRATO = 3;

export class AtributosInvalidos extends Error {
  override name = 'AtributosInvalidos';
}

function exigir(condicion: boolean, mensaje: string): asserts condicion {
  if (!condicion) {
    throw new AtributosInvalidos(mensaje);
  }
}

function esProporcion(x: unknown): boolean {
  return typeof x === 'number' && x >= 0 && x <= 1;
}

function comprobarGrupo(a: Atributos, g: string): void {
  const fila = a.grupos[g];
  exigir(fila !== undefined && typeof fila.pr === 'number', `grupo ${g}: sin ocupados`);
  for (const clave of Object.keys(fila)) {
    exigir(CLAVES_DE_GRUPO.has(clave), `grupo ${g}: atributo sin ficha «${clave}»`);
  }
  exigir(fila.un === undefined || esProporcion(fila.un), `grupo ${g}: un`);
  exigir(fila.cp === undefined || esProporcion(fila.cp), `grupo ${g}: cp`);
  exigir(
    fila.tr === undefined || (fila.tr.length === CATEGORIAS_TRATO && fila.tr.every(esProporcion)),
    `grupo ${g}: tr`,
  );
  exigir(fila.cm === undefined || Object.values(fila.cm).every(esProporcion), `grupo ${g}: cm`);
  for (const t of fila.ta) {
    exigir(a.tareas[t] !== undefined && t.startsWith(`${g}-`), `grupo ${g}: tarea ${t}`);
  }
}

/**
 * Comprueba la forma de atributos.json y que cada atributo usado tenga una fuente declarada.
 *
 * @param datos - El JSON leído.
 * @returns Los mismos datos, ya tipados.
 */
export function comprobarAtributos(datos: unknown): Atributos {
  const a = datos as Atributos;
  exigir(typeof a === 'object' && a !== null && typeof a.grupos === 'object', 'atributos.json sin grupos');
  for (const ficha of FICHAS.filter((f) => f.usado && !FUENTES_EXTERNAS.has(f.fuente))) {
    exigir(typeof a.fuentes?.[ficha.fuente] === 'string', `atributo ${ficha.clave} sin fuente «${ficha.fuente}»`);
  }
  for (const g of Object.keys(a.grupos)) {
    comprobarGrupo(a, g);
  }
  return a;
}
