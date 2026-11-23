// Denominaciones oficiales de ocupaciones ligadas a un grupo de la CNO-11, como nombres de búsqueda de la ocupación
// ESCO que les corresponde:
//
// - **INE, Notas explicativas de la CNO-11** (denominaciones-cno11.json, generado por
//   plataforma_datos/ocupaciones/fuentes/clasificaciones/notas_cno11.py): los «ejemplos de ocupaciones incluidas» de cada grupo primario y las
//   «ocupaciones afines» que remiten a otro grupo («Limpiadores de oficinas», «Carretilleros almaceneros», «Camioneros
//   asalariados», «Dependientes empleados de comercio»). Fuente: INE, CNO-11, Notas explicativas (www.ine.es); aviso
//   legal del INE: reutilización citando la fuente y sin desnaturalizar.
// - **Idescat, CCO-2011** (catalan.json → grupos_cno11, ya en el paquete): el título catalán de cada grupo primario
//   («Personal de neteja d'oficines, hotels i altres establiments similars»), para el índice catalán. Font: Idescat.
// - **INE, CNO-11** (clasificaciones.json → cno11, ya en el paquete): el título castellano de cada grupo primario.
//
// Entra todo: no se elige ninguna denominación. Cada una se liga a **una** ocupación ESCO: entre las de los grupos
// CIUO-08 que corresponden a su grupo de la CNO-11 (correspondencia oficial del INE), la que más palabras comparte con
// ella; a igualdad, la que el SEPE enlaza con ese grupo (correspondencia-eures.json), y después la más general (código ESCO más
// corto). Solo sirven para encontrar: lo que se enseña sigue siendo el título oficial de ESCO.

import type { Datos } from '../../../../src/dominio/tipos-paquete.ts';
import { nombreDelSepe } from './denominaciones.ts';
import notasCno11 from './denominaciones-cno11.json' with { type: 'json' };
import { esGenerica } from './genericas.ts';
import { coincidencia, formaComun, palabrasDe } from './palabras.ts';

/** Qué fuentes oficiales entran en los índices. */
const FUENTES_OFICIALES = Object.freeze({
  /** Las denominaciones de las notas de la CNO-11, en el índice castellano. */
  notasIne: true,
  /** Los títulos catalanes de los grupos de la CCO-2011, en el índice catalán. */
  titulosCco: true,
  /** Los títulos castellanos de los grupos de la CNO-11, en el índice castellano. */
  titulosCno: false,
});

/** Cifras de un grupo primario de la CNO-11. */
const CIFRAS_CNO = 4;

/** Las ocupaciones ESCO de cada grupo primario de la CNO-11, preparadas una vez por paquete. */
const ocupacionesPorDatos = new WeakMap<Datos, ReadonlyMap<string, OcupacionesDeUnCno>>();

/** Añade un valor a la lista de la clave, sin repetir. */
function anotar(mapa: Map<string, string[]>, clave: string, valor: string): void {
  const lista = mapa.get(clave);
  if (!lista) {
    mapa.set(clave, [valor]);
  } else if (!lista.includes(valor)) {
    lista.push(valor);
  }
}

/** Las ocupaciones ESCO candidatas de un grupo de la CNO-11 y las que el SEPE enlaza con él. */
interface OcupacionesDeUnCno {
  /** Las de los grupos CIUO-08 que le corresponden según la correspondencia oficial del INE. */
  candidatas: readonly string[];
  /** De ellas, las que el SEPE enlaza con algún código de ese grupo (correspondencia-eures.json): ganan a igual parecido. */
  delSepe: ReadonlySet<string>;
}

/**
 * Las ocupaciones ESCO de cada grupo de la CNO-11: las de los grupos CIUO-08 que le corresponden (correspondencia
 * oficial del INE) y, de ellas, las que el SEPE enlaza con algún código de ese grupo.
 *
 * @param datos - El paquete de datos.
 * @returns Grupo de la CNO-11 (4 cifras) → sus ocupaciones ESCO.
 */
function ocupacionesDeCadaCno(datos: Datos): ReadonlyMap<string, OcupacionesDeUnCno> {
  const guardado = ocupacionesPorDatos.get(datos);
  if (guardado) {
    return guardado;
  }
  const porSepe = new Map<string, string[]>();
  for (const [esco, enlaces] of Object.entries(datos.eures?.ocupaciones ?? {})) {
    for (const [codigo] of enlaces) {
      if (datos.esco.ocupaciones[esco] && /^\d{4}/.test(codigo)) {
        anotar(porSepe, codigo.slice(0, CIFRAS_CNO), esco);
      }
    }
  }
  const porIsco = new Map<string, string[]>();
  for (const [esco, { isco08 }] of Object.entries(datos.esco.ocupaciones)) {
    anotar(porIsco, isco08, esco);
  }
  const porCno = new Map<string, string[]>();
  for (const [isco08, correspondencias] of Object.entries(datos.clasificaciones.isco08_a_cno11)) {
    for (const { cno11 } of correspondencias) {
      for (const esco of porIsco.get(isco08) ?? []) {
        anotar(porCno, cno11, esco);
      }
    }
  }
  const resultado = new Map(
    [...porCno].map(([cno11, candidatas]) => [cno11, { candidatas, delSepe: new Set(porSepe.get(cno11) ?? []) }]),
  );
  ocupacionesPorDatos.set(datos, resultado);
  return resultado;
}

/** Las palabras que cuentan para ligar una denominación con una ocupación: en forma común y sin las genéricas. */
function palabrasQueCuentan(texto: string): string[] {
  return palabrasDe(texto)
    .map(formaComun)
    .filter((palabra) => !esGenerica(palabra));
}

/** Cuánto se parece una denominación a los nombres de una ocupación: la suma de lo que respalda cada palabra suya. */
function parecido(palabras: readonly string[], deLaOcupacion: readonly string[]): number {
  return palabras.reduce(
    (suma, palabra) => suma + Math.max(0, ...deLaOcupacion.map((otra) => coincidencia(palabra, otra, false))),
    0,
  );
}

/** Puntos de una ocupación de los niveles de ESCO: cuantos menos, más general («9112.2» antes que «9112.2.1»). */
function nivel(esco: string): number {
  return esco.split('.').length;
}

/** Una ocupación candidata y lo que la hace ganar: su parecido, si el SEPE la enlaza con el grupo y su nivel. */
interface Candidata {
  esco: string;
  parecido: number;
  delSepe: boolean;
}

/** Más parecido gana; después, la que el SEPE enlaza con el grupo; después, la más general; después, el código. */
function gana(una: Candidata, otra: Candidata): boolean {
  if (una.parecido !== otra.parecido) {
    return una.parecido > otra.parecido;
  }
  if (una.delSepe !== otra.delSepe) {
    return una.delSepe;
  }
  return nivel(una.esco) !== nivel(otra.esco) ? nivel(una.esco) < nivel(otra.esco) : una.esco < otra.esco;
}

/** La ocupación del grupo a la que se liga una denominación (gana). */
function laQueCorresponde(
  denominacion: string,
  { candidatas, delSepe }: OcupacionesDeUnCno,
  nombresDe: (esco: string) => readonly string[],
): string | undefined {
  const palabras = palabrasQueCuentan(denominacion);
  let mejor: Candidata | undefined;
  for (const esco of candidatas) {
    const candidata = { esco, parecido: parecido(palabras, nombresDe(esco)), delSepe: delSepe.has(esco) };
    if (!mejor || gana(candidata, mejor)) {
      mejor = candidata;
    }
  }
  return mejor?.esco;
}

/** Liga cada denominación de cada grupo con su ocupación ESCO. */
function ligar(
  datos: Datos,
  porGrupo: Iterable<readonly [string, readonly string[]]>,
  nombresDe: (esco: string) => readonly string[],
): Map<string, string[]> {
  const ocupaciones = ocupacionesDeCadaCno(datos);
  const porOcupacion = new Map<string, string[]>();
  for (const [grupo, denominaciones] of porGrupo) {
    const delGrupo = ocupaciones.get(grupo);
    for (const denominacion of delGrupo ? denominaciones : []) {
      const esco = laQueCorresponde(denominacion, delGrupo as OcupacionesDeUnCno, nombresDe);
      if (esco) {
        anotar(porOcupacion, esco, denominacion);
      }
    }
  }
  return porOcupacion;
}

/**
 * Una denominación de las notas del INE como nombre de búsqueda: como un título del SEPE (nombreDelSepe), pero con lo
 * que va entre paréntesis, que en las notas precisa el oficio («Conductores (bomberos)», «Peones (construcción)»).
 */
function nombreDelIne(denominacion: string): string {
  return nombreDelSepe(denominacion.replace(/[()]/gu, ' '));
}

/** Las palabras de los nombres castellanos de cada ocupación, para ligar las denominaciones castellanas. */
function nombresCastellanos(datos: Datos): (esco: string) => readonly string[] {
  const cache = new Map<string, string[]>();
  return (esco) => {
    const guardado = cache.get(esco);
    if (guardado) {
      return guardado;
    }
    const ocupacion = datos.esco.ocupaciones[esco];
    const palabras = palabrasQueCuentan([ocupacion?.titulo ?? '', ...(ocupacion?.alternativos ?? [])].join(' '));
    cache.set(esco, palabras);
    return palabras;
  };
}

const castellanasPorDatos = new WeakMap<Datos, ReadonlyMap<string, readonly string[]>>();
const catalanasPorDatos = new WeakMap<Datos, ReadonlyMap<string, readonly string[]>>();

/** Los títulos de los grupos primarios (4 cifras) de una clasificación, por código. */
function titulosDeGruposPrimarios(titulos: Readonly<Record<string, string>>): [string, string[]][] {
  return Object.entries(titulos)
    .filter(([codigo, titulo]) => codigo.length === CIFRAS_CNO && titulo)
    .map(([codigo, titulo]) => [codigo, [titulo]]);
}

/**
 * Las denominaciones oficiales castellanas de cada ocupación ESCO: las de las notas de la CNO-11, en singular como los
 * títulos del SEPE («Limpiadores de oficinas» → «limpiador de oficina»), y los títulos de los grupos de la CNO-11.
 *
 * @param datos - El paquete de datos.
 * @returns Código ESCO → sus denominaciones.
 */
export function denominacionesCastellanas(datos: Datos): ReadonlyMap<string, readonly string[]> {
  const guardado = castellanasPorDatos.get(datos);
  if (guardado) {
    return guardado;
  }
  const grupos: [string, string[]][] = [];
  if (FUENTES_OFICIALES.notasIne) {
    grupos.push(
      ...Object.entries(notasCno11.grupos).map(
        ([grupo, nombres]) => [grupo, nombres.map(nombreDelIne).filter(Boolean)] as [string, string[]],
      ),
    );
  }
  if (FUENTES_OFICIALES.titulosCno) {
    const titulos = Object.fromEntries(
      Object.entries(datos.clasificaciones.cno11).map(([codigo, { titulo }]) => [codigo, titulo]),
    );
    grupos.push(...titulosDeGruposPrimarios(titulos));
  }
  const ligadas = ligar(datos, grupos, nombresCastellanos(datos));
  castellanasPorDatos.set(datos, ligadas);
  return ligadas;
}

/**
 * Las denominaciones oficiales catalanas de cada ocupación ESCO: los títulos de los grupos de la CCO-2011 (Idescat)
 * que el paquete trae en catalan.json, ligados con el título catalán de Faro de cada ocupación.
 *
 * @param datos - El paquete de datos.
 * @returns Código ESCO → sus denominaciones catalanas; vacío sin catalan.json.
 */
export function denominacionesCatalanas(datos: Datos): ReadonlyMap<string, readonly string[]> {
  const guardado = catalanasPorDatos.get(datos);
  if (guardado) {
    return guardado;
  }
  const catalan = datos.catalan;
  const grupos = FUENTES_OFICIALES.titulosCco && catalan ? titulosDeGruposPrimarios(catalan.grupos_cno11 ?? {}) : [];
  const nombresDe = (esco: string) => palabrasQueCuentan(catalan?.ocupaciones[esco] ?? '');
  const ligadas = ligar(datos, grupos, nombresDe);
  catalanasPorDatos.set(datos, ligadas);
  return ligadas;
}
