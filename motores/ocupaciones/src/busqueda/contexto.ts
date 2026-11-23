// El lugar de trabajo no es el oficio. En «Sóc infermera a l'hospital», «técnico laboral en la Generalitat» o «TCAE en
// una residencia», la palabra del lugar es rara en el catálogo y pesaba más que la del oficio: arrastraba a
// «farmacéutico de hospital» o dejaba la Generalitat sin ningún efecto. Aquí se separa, en cada frase, el oficio del
// tramo que dice dónde se trabaja, para que el buscador (consulta.ts) le dé poco peso, y se reconocen las palabras que
// apuntan a un sector (administración pública, sanidad, educación…), que el motor devuelve aparte como pistas: no son
// el oficio, y como mucho sirven para desempatar o para que el motor de preguntas no pregunte lo que ya se sabe.
// Sin IA y sin datos del banco de evaluación: preposición + determinante, y una lista corta de lugares e instituciones
// escrita a partir de los lugares de trabajo de las definiciones de la CIUO-08 y de las instituciones públicas de
// España y Cataluña. Cada lista va en su forma común (palabras.ts), así que vale para el singular y el plural.

import { normalizar } from '../../../../src/comun/texto.ts';
import { formaComun, palabrasDe } from './palabras.ts';

/** Sectores que el motor sabe reconocer; la clave es estable. */
export type Sector =
  | 'publico'
  | 'sanitario'
  | 'cuidados'
  | 'educativo'
  | 'comercio'
  | 'hosteleria'
  | 'financiero'
  | 'logistica'
  | 'construccion'
  | 'industrial'
  | 'domestico'
  | 'transporte'
  | 'telecomunicaciones'
  | 'servicios';

/** Una pista de sector que da el texto: no es el oficio. */
export interface PistaDeSector {
  sector: Sector;
  /** La palabra o expresión que la dispara, normalizada («generalitat»). */
  palabra: string;
  /** Prefijos CIUO-08 que ese sector hace más probables: verosimilitud blanda, nunca para descartar. */
  grupos: readonly string[];
  /** Si la pista sale de una empresa de la lista (marcas.ts): su nombre. */
  marca?: string;
  /** Y la clase CNAE-2009 de su actividad. */
  cnae?: string;
}

/** El texto partido: lo que dice el oficio y lo que dice dónde se trabaja. */
export interface TextoPartido {
  /** El oficio, con las palabras que no son del lugar, normalizado. */
  oficio: string;
  /** El tramo o tramos del lugar de trabajo, normalizados (minúsculas, sin tildes ni signos); vacío si no hay. */
  lugar: string;
}

/** Lo que separa frases: ahí acaba un tramo de lugar («soy informático en una empresa, arreglo ordenadores»). */
const SEPARADORES = /[,.;:!?¡¿()\n]+/;
/** Preposiciones que abren un lugar cuando las sigue un determinante («en una empresa», «dins l'hospital»). */
const ABREN_CON_DETERMINANTE = new Set(['en', 'dins']);
/** Preposiciones que abren un lugar solo si lo que sigue es un lugar conocido («a l'hospital», «al bar»). */
const ABREN_CON_LUGAR = new Set(['a', 'al', 'en', 'dins']);
/** Preposiciones de complemento: abren un lugar solo con determinante y lugar conocido («de un hospital», «d'un super»). */
const ABREN_CON_DETERMINANTE_Y_LUGAR = new Set(['de', 'd', 'del']);
/** Las que ya llevan el determinante («del ayuntamiento», «al bar»). */
const CON_DETERMINANTE = new Set(['del', 'al']);
/** Determinantes y posesivos, en castellano y en catalán («l» y «d» son restos del apóstrofo). */
const DETERMINANTES = new Set([
  ...[
    'el',
    'la',
    'los',
    'las',
    'lo',
    'un',
    'una',
    'unos',
    'unas',
    'mi',
    'mis',
    'su',
    'sus',
    'tu',
    'nuestro',
    'nuestra',
  ],
  ...[
    'l',
    'els',
    'les',
    'uns',
    'unes',
    'meu',
    'meva',
    'seu',
    'seva',
    'nostre',
    'nostra',
    'aquest',
    'aquesta',
    'este',
    'esta',
  ],
]);

/**
 * Lugares e instituciones donde se trabaja (no oficios), por la forma común de sus palabras. Una expresión de varias
 * palabras va como una frase («centro de salud»).
 */
const LUGARES_ESCRITOS = [
  ...['generalitat', 'ajuntament', 'ayuntamiento', 'diputacion', 'diputacio', 'ministerio', 'ministeri', 'conselleria'],
  ...['consejeria', 'juzgado', 'jutjat', 'comisaria', 'comissaria', 'consell comarcal', 'consejo comarcal'],
  ...['hospital', 'cap', 'centro de salud', 'centre de salut', 'ambulatorio', 'ambulatori', 'clinica', 'consultorio'],
  ...['residencia', 'centro de dia', 'centre de dia', 'geriatrico', 'geriatric'],
  ...['escuela', 'escola', 'colegio', 'col legi', 'collegi', 'instituto', 'institut', 'universidad', 'universitat'],
  ...['guarderia', 'llar d infants', 'academia'],
  ...['tienda', 'botiga', 'supermercado', 'supermercat', 'super', 'hipermercado', 'hipermercat', 'centro comercial'],
  ...['centre comercial', 'mercado', 'mercat', 'gran superficie'],
  ...['hotel', 'bar', 'restaurante', 'restaurant', 'cafeteria', 'hostal', 'camping', 'discoteca'],
  ...['banco', 'banc', 'caja de ahorros', 'caixa d estalvis', 'aseguradora', 'asseguradora', 'gestoria'],
  ...['empresa', 'compania', 'companyia', 'entidad', 'entitat', 'organismo', 'multinacional', 'oficina', 'despacho'],
  ...['almacen', 'magatzem', 'puerto', 'port', 'aeropuerto', 'aeroport', 'centro logistico', 'centre logistic'],
  ...['obra', 'obras', 'fabrica', 'taller', 'nave', 'planta', 'cadena de montaje'],
  // «a domicilio» no es un lugar: dice cómo se trabaja («auxiliar de ayuda a domicilio»). Es una pista de sector.
  ...['casa', 'casas', 'call center', 'centro de llamadas', 'centre de trucades'],
];

/** Una palabra o expresión de las listas, en la forma común de cada palabra. */
function enForma(expresion: string): string[] {
  return normalizar(expresion).split(' ').map(formaComun);
}

/** Los lugares, cada uno en la forma común de sus palabras. */
const LUGARES: readonly string[][] = LUGARES_ESCRITOS.map(enForma);

/** Un sector, las expresiones que lo disparan, sus grupos CIUO-08 y las que solo cuentan dentro de un lugar. */
interface DefinicionDeSector {
  sector: Sector;
  expresiones: readonly string[];
  /** Expresiones que fuera de un lugar significan otra cosa («cap» es «ninguno» en catalán; «port», «llevo»). */
  soloEnLugar?: readonly string[];
  grupos: readonly string[];
}

/**
 * Los sectores y sus grupos. Los grupos salen de las definiciones de la CIUO-08: administración pública (1112
 * directores de la Administración, 242 especialistas en organización de la Administración (CNO-11 262), 335 profesionales de apoyo
 * de la Administración, 3343 y 4110 personal administrativo); sanidad (22 y 32 profesionales de la salud y de apoyo,
 * 5321 auxiliares de enfermería); cuidados (5321, 5322, 2635 y 3412); educación (23 y 5312); comercio (52); hostelería
 * (51, 94, 3434, 141); finanzas y seguros (241, 331, 332, 421, 4312); logística (432, 933, 834); construcción (71, 931,
 * 3123); industria (7, 8, 932); hogares (911, 5322, 5311).
 */
const SECTORES: readonly DefinicionDeSector[] = [
  {
    sector: 'publico',
    expresiones: [
      ...['generalitat', 'ajuntament', 'ayuntamiento', 'diputacion', 'diputacio', 'ministerio', 'ministeri'],
      ...['conselleria', 'consejeria', 'consell comarcal', 'consejo comarcal', 'administracion publica'],
      ...['administracio publica', 'seguridad social', 'seguretat social', 'funcionario', 'funcionari'],
      ...['oficina de empleo', 'oficina de treball', 'agencia tributaria', 'hacienda', 'juzgado', 'jutjat'],
    ],
    grupos: ['1112', '242', '335', '3343', '4110'],
  },
  {
    sector: 'sanitario',
    expresiones: [
      ...['hospital', 'centro de salud', 'centre de salut', 'ambulatorio', 'ambulatori', 'clinica', 'consultorio'],
      ...['urgencias', 'urgencies', 'quirofano', 'quirofan'],
    ],
    soloEnLugar: ['cap'],
    grupos: ['22', '32', '5321'],
  },
  {
    sector: 'cuidados',
    expresiones: ['residencia', 'centro de dia', 'centre de dia', 'geriatrico', 'geriatric'],
    grupos: ['5321', '5322', '2635', '3412'],
  },
  {
    sector: 'educativo',
    expresiones: [
      ...['escuela', 'escola', 'colegio', 'col legi', 'collegi', 'instituto', 'institut', 'universidad'],
      ...['universitat', 'guarderia', 'llar d infants'],
    ],
    grupos: ['23', '5312'],
  },
  {
    sector: 'comercio',
    expresiones: [
      ...['tienda', 'botiga', 'supermercado', 'supermercat', 'hipermercado', 'hipermercat', 'centro comercial'],
      ...['centre comercial', 'gran superficie'],
    ],
    grupos: ['52'],
  },
  {
    sector: 'hosteleria',
    expresiones: ['hotel', 'restaurante', 'restaurant', 'cafeteria', 'hostal', 'camping', 'hosteleria', 'hostaleria'],
    soloEnLugar: ['bar'],
    grupos: ['51', '94', '3434', '141'],
  },
  {
    sector: 'financiero',
    expresiones: [
      ...['banco', 'banca', 'banc', 'caja de ahorros', 'caixa d estalvis', 'aseguradora', 'asseguradora'],
      ...['compania de seguros', 'companyia d assegurances', 'entidad bancaria', 'entitat bancaria'],
    ],
    grupos: ['241', '331', '332', '421', '4312'],
  },
  {
    sector: 'logistica',
    expresiones: ['almacen', 'magatzem', 'aeropuerto', 'aeroport', 'centro logistico', 'centre logistic'],
    soloEnLugar: ['puerto', 'port'],
    grupos: ['432', '933', '834'],
  },
  {
    sector: 'construccion',
    expresiones: ['obra', 'obras', 'construccion', 'construccio', 'constructora'],
    grupos: ['71', '931', '3123'],
  },
  {
    sector: 'industrial',
    expresiones: ['fabrica', 'nave industrial', 'cadena de montaje', 'industria'],
    soloEnLugar: ['planta', 'taller'],
    grupos: ['7', '8', '932'],
  },
  {
    sector: 'domestico',
    expresiones: ['casas particulares', 'casa particular', 'cases particulars', 'domicilio', 'domicilios', 'domicili'],
    grupos: ['911', '5322', '5311'],
  },
];

/** Las expresiones de cada sector, ya en su forma común. */
const SECTORES_EN_FORMA = SECTORES.map((definicion) => ({
  ...definicion,
  formas: definicion.expresiones.map((expresion) => ({ expresion, palabras: enForma(expresion) })),
  formasEnLugar: (definicion.soloEnLugar ?? []).map((expresion) => ({ expresion, palabras: enForma(expresion) })),
}));

/** Si en `formas`, desde `desde`, empieza alguna de las expresiones (cada una en forma común). */
function empiezaAlguna(formas: readonly string[], desde: number, expresiones: readonly (readonly string[])[]): boolean {
  return expresiones.some((expresion) => expresion.every((palabra, i) => formas[desde + i] === palabra));
}

/** Si en la posición `i` de la frase empieza el tramo de un lugar, según la preposición y lo que la sigue. */
function abreUnLugar(palabras: readonly string[], formas: readonly string[], i: number): boolean {
  const preposicion = palabras[i] as string;
  let siguiente = i + 1;
  let conDeterminante = CON_DETERMINANTE.has(preposicion);
  if (DETERMINANTES.has(palabras[siguiente] ?? '')) {
    conDeterminante = true;
    siguiente += 1;
  }
  const lugarConocido = empiezaAlguna(formas, siguiente, LUGARES);
  if (ABREN_CON_DETERMINANTE_Y_LUGAR.has(preposicion)) {
    return conDeterminante && lugarConocido;
  }
  return (
    (ABREN_CON_DETERMINANTE.has(preposicion) && conDeterminante) || (ABREN_CON_LUGAR.has(preposicion) && lugarConocido)
  );
}

/**
 * Parte el texto en oficio y lugar de trabajo. En cada frase, el lugar empieza en la primera preposición que lo abre
 * («en un/una/el/la…», «a l'…» o «al» + lugar conocido, «de un/del/d'un» + lugar conocido) **después de alguna palabra
 * del oficio**, y llega hasta el final de la frase: «trabajo en la limpieza de un hospital» no abre el lugar en «en la
 * limpieza», porque antes solo está «trabajo». «de» + lugar sin determinante es parte del oficio («mestra d'escola»,
 * «profesor de instituto», «limpiador de oficinas»).
 *
 * @param texto - El texto ya limpio de datos personales.
 * @returns El oficio y el lugar, normalizados.
 */
export function partirOficioYLugar(texto: string): TextoPartido {
  const oficio: string[] = [];
  const lugar: string[] = [];
  for (const frase of texto.split(SEPARADORES)) {
    const palabras = normalizar(frase).split(' ').filter(Boolean);
    const formas = palabras.map(formaComun);
    let desde = -1;
    for (let i = 1; i < palabras.length && desde < 0; i++) {
      if (palabrasDe(palabras.slice(0, i).join(' ')).length > 0 && abreUnLugar(palabras, formas, i)) {
        desde = i;
      }
    }
    if (desde < 0) {
      oficio.push(palabras.join(' '));
      continue;
    }
    oficio.push(palabras.slice(0, desde).join(' '));
    lugar.push(palabras.slice(desde).join(' '));
  }
  const unir = (partes: string[]) => partes.filter(Boolean).join(' ');
  return { oficio: unir(oficio), lugar: unir(lugar) };
}

/**
 * Las pistas de sector del texto: cada sector una vez, con la primera expresión que lo dispara. Las expresiones
 * ambiguas («cap», «bar», «port», «planta») solo cuentan dentro del lugar.
 *
 * @param partido - El texto partido (partirOficioYLugar).
 * @returns Las pistas, en el orden de SECTORES.
 */
export function pistasDeSector(partido: TextoPartido): PistaDeSector[] {
  const todo = `${partido.oficio} ${partido.lugar}`.split(' ').filter(Boolean).map(formaComun);
  const enLugar = partido.lugar.split(' ').filter(Boolean).map(formaComun);
  const pistas: PistaDeSector[] = [];
  for (const definicion of SECTORES_EN_FORMA) {
    const encontrada =
      definicion.formas.find(({ palabras }) => todo.some((_, i) => empiezaAlguna(todo, i, [palabras]))) ??
      definicion.formasEnLugar.find(({ palabras }) => enLugar.some((_, i) => empiezaAlguna(enLugar, i, [palabras])));
    if (encontrada) {
      pistas.push({ sector: definicion.sector, palabra: encontrada.expresion, grupos: definicion.grupos });
    }
  }
  return pistas;
}

/**
 * Si un grupo CIUO-08 es de alguno de los sectores de las pistas.
 *
 * @param isco08 - Grupo de 4 cifras.
 * @param pistas - Las pistas del texto.
 * @returns Si empieza por alguno de sus prefijos.
 */
export function delSector(isco08: string, pistas: readonly PistaDeSector[]): boolean {
  return pistas.some((pista) => pista.grupos.some((prefijo) => isco08.startsWith(prefijo)));
}
