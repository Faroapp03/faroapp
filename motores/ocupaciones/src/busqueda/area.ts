// Áreas sin puesto: «recursos humanos», «contabilidad», «marketing», «mantenimiento», «soldadura» nombran un área de
// trabajo, no un puesto. Se reconocen sin lista: la búsqueda es corta, ningún nombre del catálogo es ella misma, y sus
// palabras van juntas en los nombres de varias ocupaciones de grupos CIUO-08 distintos («responsable de recursos
// humanos», «ayudante de recursos humanos», «director de recursos humanos»). Entonces el motor devuelve aparte el área
// con sus ocupaciones, para que la interfaz pregunte qué hace la persona dentro de ella.
// Las ocupaciones del área salen de las relaciones oficiales de ESCO (© Unión Europea, ESCO v1.2.1):
// 1. las competencias del área: las de los grupos de la jerarquía de ESCO cuyo título lleva el área (S4.3.2 «gestionar
//    y administrar recursos humanos», con «gestionar nóminas» o «contratar personal»; grupos-de-competencias.json), las
//    que llevan el área en su nombre y las esenciales que comparten las ocupaciones que la llevan en el suyo;
// 2. cada ocupación suma la rareza de las competencias del área que tiene (esenciales enteras, opcionales a medias),
//    y las que llevan el área en su nombre van delante;
// 3. las ocupaciones más parecidas, por sus competencias, a las primeras del área también entran (el formador para
//    empresas, 2424, por su parecido con el director de formación, 1212). Así «recursos humanos» incluye nóminas
//    (4313), selección (2423.6), técnicos y responsables (2423), ayudantes (4416), directores (1212) y formación.
// 4. al quitar el género, «puerto» y «puerta» dan la misma forma común («puert»): «trabajo en el puerto» traía al
//    montador de puertas y al vendedor puerta a puerta. Si las ocupaciones cuyos nombres
//    llevan la palabra con su misma vocal de género bastan para ser un área, solo cuentan ellas, y las competencias del
//    área también se buscan con esa vocal. Si no bastan, se sigue con la forma común. Una palabra cuyo
//    género cambia dentro de los nombres de una misma ocupación («limpiador/limpiadora») no distingue la vocal.

import type { Datos } from '../../../../src/dominio/tipos-paquete.ts';
import { esGenerica } from './genericas.ts';
import jerarquia from './grupos-de-competencias.json' with { type: 'json' };
import { type Indice, nombresCastellanosDe } from './indice.ts';
import { formaComun, palabrasDe } from './palabras.ts';

/** Palabras que cuentan, como mucho, en una búsqueda que puede ser un área. */
const MAX_PALABRAS_DE_UN_AREA = 3;
/** Ocupaciones, como mínimo, que llevan el área en su nombre. */
const MIN_OCUPACIONES_DEL_AREA = 3;
/** Grupos CIUO-08 distintos, como mínimo, de esas ocupaciones. */
const MIN_GRUPOS_DEL_AREA = 3;
/** Ocupaciones del área que se devuelven, como mucho, de más a menos relacionadas. */
const MAX_OCUPACIONES_DEL_AREA = 40;
/** Grupos del área que se devuelven, como mucho. */
const MAX_GRUPOS_DEL_AREA = 10;
/** Peso de una competencia cuyo nombre lleva el área, frente a una esencial de una ocupación del área. */
const PESO_DE_LA_COMPETENCIA_DEL_AREA = 2;
/** Peso que suma una ocupación que lleva el área en su nombre: va delante de las que solo la tienen en sus competencias. */
const PESO_DEL_NOMBRE = 100;
/** Ocupaciones que llevan el área en su nombre, como mínimo, que han de compartir una competencia esencial. */
const MIN_OCUPACIONES_QUE_COMPARTEN = 2;
/** Y parte de ellas que ha de compartirla. */
const PARTE_QUE_COMPARTE = 0.25;
/** Primeras ocupaciones del área cuyas parecidas también entran. */
const PRIMERAS_PARA_PARECIDAS = 10;
/** Parecido mínimo (Jaccard de sus competencias) para que una ocupación entre por parecerse a una del área. */
const MIN_PARECIDO = 0.2;
/** Peso de una competencia opcional de la ocupación, frente a una esencial. */
const PESO_OPCIONAL = 0.5;
/** Se redondea a un decimal. */
const UN_DECIMAL = 10;

/** Una ocupación del área y su relación con ella. */
interface OcupacionDelArea {
  esco: string;
  isco08: string;
  /** Suma de la rareza de las competencias del área que tiene: más, más relacionada. No es una probabilidad. */
  peso: number;
}

/** Un área sin puesto y sus ocupaciones. */
export interface Area {
  /** Las palabras del área, normalizadas («recursos humanos»). */
  texto: string;
  ocupaciones: OcupacionDelArea[];
  /** Los grupos CIUO-08 del área, con la suma del peso de sus ocupaciones, de más a menos. */
  grupos: { isco08: string; peso: number }[];
}

/** Competencias de cada ocupación, en un conjunto, y rareza de cada competencia (ln(N/df)), por paquete. */
interface CompetenciasDelPaquete {
  deCadaOcupacion: Map<string, Set<number>>;
  rareza: Map<number, number>;
}
const competenciasPorDatos = new WeakMap<Datos, CompetenciasDelPaquete>();

/** Las competencias de cada ocupación y la rareza de cada competencia: cuantas menos ocupaciones la tienen, más. */
function competenciasDelPaquete(datos: Datos): CompetenciasDelPaquete {
  const guardadas = competenciasPorDatos.get(datos);
  if (guardadas) {
    return guardadas;
  }
  const deCadaOcupacion = new Map<string, Set<number>>();
  const df = new Map<number, number>();
  for (const [esco, ocupacion] of Object.entries(datos.esco.ocupaciones)) {
    const suyas = new Set([...(ocupacion.competencias ?? [])].map(([indice]) => indice));
    deCadaOcupacion.set(esco, suyas);
    for (const indice of suyas) {
      df.set(indice, (df.get(indice) ?? 0) + 1);
    }
  }
  const total = deCadaOcupacion.size;
  const rareza = new Map([...df].map(([indice, cuantas]) => [indice, Math.log(total / cuantas)]));
  const preparadas = { deCadaOcupacion, rareza };
  competenciasPorDatos.set(datos, preparadas);
  return preparadas;
}

/** Si todas las palabras del área están en las palabras dadas. */
function llevaElArea(area: readonly string[], palabras: readonly string[]): boolean {
  return area.every((palabra) => palabras.includes(palabra));
}

/** La vocal de género de una palabra normalizada, sin la -s del plural: «puertos» → «o», «puerta» → «a», «hotel» → «». */
function vocalDeGenero(palabra: string): string {
  const singular = palabra.replace(/s$/u, '');
  return /[ao]$/u.test(singular) ? singular.slice(-1) : '';
}

/** La forma común de una palabra con su vocal de género: «puerto» y «puerta» comparten la forma común, no esta. */
function formaConGenero(palabra: string): string {
  return `${formaComun(palabra)}|${vocalDeGenero(palabra)}`;
}

/** Las formas comunes que cambian de género dentro de una misma ocupación, por paquete. */
const variablesPorDatos = new WeakMap<Datos, ReadonlySet<string>>();

/**
 * Las formas comunes cuyo género cambia dentro de los nombres de una misma ocupación («limpiador/limpiadora»,
 * «técnico/técnica sanitaria»): son la misma palabra en masculino y en femenino. Las demás que comparten forma común
 * con otra vocal son palabras distintas («puerto» y «puerta»: 102 raíces de los nombres castellanos de ESCO).
 */
function generoVariable(datos: Datos): ReadonlySet<string> {
  const guardadas = variablesPorDatos.get(datos);
  if (guardadas) {
    return guardadas;
  }
  const nombresDe = nombresDelPaquete(datos);
  const variables = new Set<string>();
  for (const esco of Object.keys(datos.esco.ocupaciones)) {
    const vocales = new Map<string, Set<string>>();
    for (const palabra of nombresDe(esco).flatMap(palabrasDe)) {
      const forma = formaComun(palabra);
      vocales.set(forma, (vocales.get(forma) ?? new Set<string>()).add(vocalDeGenero(palabra)));
    }
    for (const [forma, distintas] of vocales) {
      if (distintas.size > 1) {
        variables.add(forma);
      }
    }
  }
  variablesPorDatos.set(datos, variables);
  return variables;
}

/** Cómo se comparan las palabras del área con su género: igual que la forma común si su género cambia (generoVariable). */
function formaExacta(datos: Datos): (palabra: string) => string {
  const variables = generoVariable(datos);
  return (palabra) => (variables.has(formaComun(palabra)) ? formaComun(palabra) : formaConGenero(palabra));
}

/** Cómo se comparan las palabras del área con las de un texto: por su forma común o con su vocal de género. */
interface PalabrasDelArea {
  palabras: readonly string[];
  forma: (palabra: string) => string;
}

/** Si un texto del catálogo (un título, una competencia) lleva el área, comparado como dice `area`. */
function textoConElArea(area: PalabrasDelArea, texto: string): boolean {
  return llevaElArea(area.palabras, palabrasDe(texto).map(area.forma));
}

/** Los nombres castellanos de cada ocupación tal como se escriben (nombresCastellanosDe), por paquete. */
const nombresPorDatos = new WeakMap<Datos, (esco: string) => string[]>();

/** Los nombres castellanos de cada ocupación del paquete, preparados una vez. */
function nombresDelPaquete(datos: Datos): (esco: string) => string[] {
  const nombresDe = nombresPorDatos.get(datos) ?? nombresCastellanosDe(datos);
  nombresPorDatos.set(datos, nombresDe);
  return nombresDe;
}

/** Si los nombres de la ocupación llevan el área solo con otra vocal de género («montador de puertas» para «puerto»). */
function laLlevaConOtroGenero(datos: Datos, esco: string, comun: PalabrasDelArea, exacta: PalabrasDelArea): boolean {
  const nombres = nombresDelPaquete(datos)(esco).filter((nombre) => textoConElArea(comun, nombre));
  return nombres.length > 0 && !nombres.some((nombre) => textoConElArea(exacta, nombre));
}

/** Si unas ocupaciones bastan para ser un área: MIN_OCUPACIONES_DEL_AREA y MIN_GRUPOS_DEL_AREA. */
function bastanParaUnArea(datos: Datos, ocupaciones: readonly string[]): boolean {
  const grupos = new Set(ocupaciones.map((esco) => datos.esco.ocupaciones[esco]?.isco08));
  return ocupaciones.length >= MIN_OCUPACIONES_DEL_AREA && grupos.size >= MIN_GRUPOS_DEL_AREA;
}

/** Los grupos de la jerarquía de ESCO cuyo título lleva el área. */
function gruposDelArea(area: PalabrasDelArea): Set<string> {
  return new Set(
    Object.entries(jerarquia.grupos)
      .filter(([, titulo]) => textoConElArea(area, titulo))
      .map(([codigo]) => codigo),
  );
}

/**
 * Las competencias del área con su peso: las de sus grupos de la jerarquía y las que la nombran
 * (PESO_DE_LA_COMPETENCIA_DEL_AREA), y las esenciales que comparten las ocupaciones que la nombran (1).
 */
function competenciasDelArea(datos: Datos, area: PalabrasDelArea, delNombre: readonly string[]): Map<number, number> {
  const competencias = new Map<number, number>();
  const compartidas = new Map<number, number>();
  for (const esco of delNombre) {
    for (const [indice, tipo] of datos.esco.ocupaciones[esco]?.competencias ?? []) {
      if (tipo === 'e') {
        compartidas.set(indice, (compartidas.get(indice) ?? 0) + 1);
      }
    }
  }
  const minimo = Math.max(MIN_OCUPACIONES_QUE_COMPARTEN, delNombre.length * PARTE_QUE_COMPARTE);
  for (const [indice, cuantas] of compartidas) {
    if (cuantas >= minimo) {
      competencias.set(indice, 1);
    }
  }
  const grupos = gruposDelArea(area);
  datos.esco.competencias.forEach((competencia, indice) => {
    const suyos = (jerarquia.competencias[indice] ?? '').split('|');
    if (suyos.some((grupo) => grupos.has(grupo)) || textoConElArea(area, competencia[1] ?? '')) {
      competencias.set(indice, PESO_DE_LA_COMPETENCIA_DEL_AREA);
    }
  });
  return competencias;
}

/** El parecido de dos ocupaciones por sus competencias (índice de Jaccard). */
function parecido(una: ReadonlySet<number>, otra: ReadonlySet<number>): number {
  let comunes = 0;
  for (const indice of una) {
    if (otra.has(indice)) {
      comunes += 1;
    }
  }
  const todas = una.size + otra.size - comunes;
  return todas ? comunes / todas : 0;
}

/** La suma de la rareza de las competencias del área que tiene la ocupación (esenciales enteras, opcionales a medias). */
function pesoDeSusCompetencias(
  ocupacion: Datos['esco']['ocupaciones'][string],
  competencias: Map<number, number>,
  rareza: Map<number, number>,
): number {
  let peso = 0;
  for (const [indice, tipo] of ocupacion.competencias ?? []) {
    const delArea = competencias.get(indice);
    if (delArea) {
      peso += delArea * (rareza.get(indice) ?? 0) * (tipo === 'e' ? 1 : PESO_OPCIONAL);
    }
  }
  return peso;
}

/** Los pesos de las ocupaciones por las competencias del área, con las que la nombran delante. */
function pesosPorCompetencias(
  datos: Datos,
  competencias: Map<number, number>,
  delNombre: ReadonlySet<string>,
): Map<string, number> {
  const { rareza } = competenciasDelPaquete(datos);
  const pesos = new Map<string, number>();
  for (const [esco, ocupacion] of Object.entries(datos.esco.ocupaciones)) {
    const peso = (delNombre.has(esco) ? PESO_DEL_NOMBRE : 0) + pesoDeSusCompetencias(ocupacion, competencias, rareza);
    if (peso > 0) {
      pesos.set(esco, peso);
    }
  }
  return pesos;
}

/** Añade a los pesos las ocupaciones parecidas a las primeras del área, con el peso de la primera por su parecido. */
function conLasParecidas(datos: Datos, pesos: Map<string, number>): Map<string, number> {
  const { deCadaOcupacion } = competenciasDelPaquete(datos);
  const primeras = [...pesos].sort((a, b) => b[1] - a[1]).slice(0, PRIMERAS_PARA_PARECIDAS);
  const conParecidas = new Map(pesos);
  for (const [esco, peso] of primeras) {
    const suyas = deCadaOcupacion.get(esco) ?? new Set<number>();
    for (const [otra, deLaOtra] of deCadaOcupacion) {
      const cuanto = otra === esco ? 0 : parecido(suyas, deLaOtra);
      if (cuanto >= MIN_PARECIDO) {
        conParecidas.set(otra, Math.max(conParecidas.get(otra) ?? 0, peso * cuanto));
      }
    }
  }
  return conParecidas;
}

/** Las ocupaciones del área, de más a menos relacionadas. */
function ocupacionesDelArea(
  datos: Datos,
  competencias: Map<number, number>,
  delNombre: ReadonlySet<string>,
): OcupacionDelArea[] {
  const pesos = conLasParecidas(datos, pesosPorCompetencias(datos, competencias, delNombre));
  return [...pesos]
    .map(([esco, peso]) => ({
      esco,
      isco08: datos.esco.ocupaciones[esco]?.isco08 ?? '',
      peso: Math.round(peso * UN_DECIMAL) / UN_DECIMAL,
    }))
    .sort((a, b) => b.peso - a.peso || (a.esco < b.esco ? -1 : 1))
    .slice(0, MAX_OCUPACIONES_DEL_AREA);
}

/**
 * El área sin puesto que nombra la búsqueda, si la nombra.
 *
 * @param datos - El paquete de datos.
 * @param indice - El índice castellano del catálogo.
 * @param oficio - El oficio de la búsqueda, sin la fórmula de presentación.
 * @param hayNombreIdentico - Si algún nombre del catálogo es la búsqueda entera (entonces es un puesto).
 * @returns El área, o undefined.
 */
export function areaDeLaBusqueda(
  datos: Datos,
  indice: Indice,
  oficio: string,
  hayNombreIdentico: boolean,
): Area | undefined {
  const area = [...new Set(palabrasDe(oficio).map(formaComun))];
  if (hayNombreIdentico || !area.length || area.length > MAX_PALABRAS_DE_UN_AREA || area.every(esGenerica)) {
    return undefined;
  }
  const conTodas = indice.ocupaciones
    .filter((ocupacion) => ocupacion.nombres.some((nombre) => llevaElArea(area, nombre)))
    .map((ocupacion) => ocupacion.esco);
  if (!bastanParaUnArea(datos, conTodas)) {
    return undefined;
  }
  const comun: PalabrasDelArea = { palabras: area, forma: formaComun };
  const forma = formaExacta(datos);
  const exacta: PalabrasDelArea = { palabras: [...new Set(palabrasDe(oficio).map(forma))], forma };
  const conSuGenero = conTodas.filter((esco) => !laLlevaConOtroGenero(datos, esco, comun, exacta));
  const soloSuGenero = conSuGenero.length < conTodas.length && bastanParaUnArea(datos, conSuGenero);
  const delNombre = soloSuGenero ? conSuGenero : conTodas;
  const ocupaciones = ocupacionesDelArea(
    datos,
    competenciasDelArea(datos, soloSuGenero ? exacta : comun, delNombre),
    new Set(delNombre),
  );
  const porGrupo = new Map<string, number>();
  for (const { isco08, peso } of ocupaciones) {
    porGrupo.set(isco08, (porGrupo.get(isco08) ?? 0) + peso);
  }
  return {
    texto: palabrasDe(oficio).join(' '),
    ocupaciones,
    grupos: [...porGrupo]
      .map(([isco08, peso]) => ({ isco08, peso: Math.round(peso * UN_DECIMAL) / UN_DECIMAL }))
      .sort((a, b) => b.peso - a.peso)
      .slice(0, MAX_GRUPOS_DEL_AREA),
  };
}
