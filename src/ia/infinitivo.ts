// Del verbo copiado en primera persona al infinitivo. Solo se transforma la primera palabra cuando corresponde
// a la primera persona del presente de un verbo con tareas oficiales (verbos-de-las-tareas.ts), encaja un único
// infinitivo y lo que sigue no indica un nombre. Con cualquier duda, la tarea conserva su texto.

import { ErrorDeProcesamiento } from '../comun/error-de-procesamiento.ts';
import { empiezaPorInfinitivoEnSuIdioma, mayuscula } from './frases.ts';
import { NOMBRES, VERBOS_CA, VERBOS_ES } from './verbos-de-las-tareas.ts';

/** Una forma en plural catalán («-im», «-em») tiene que ser más larga que esto para que se le quite la terminación. */
const LARGO_MINIMO_DE_UN_PLURAL = 3;
/** Letras mínimas de una primera persona en «-o» (no más corta que esto) para sacar de ella un infinitivo. */
const LARGO_MINIMO_DE_UNA_PERSONA = 3;
/** Letras de «eix», la terminación de la raíz de los verbos catalanes como «servir». */
const LARGO_DE_EIX = 3;

/** Las terminaciones del infinitivo castellano. */
const TERMINACIONES_ES: readonly string[] = ['ar', 'er', 'ir'];
/** Las terminaciones del infinitivo catalán. */
const TERMINACIONES_CA: readonly string[] = ['ar', 'er', 're', 'ir'];
/** Las terminaciones que se prueban con las raíces de una primera persona del plural catalana («-em»). */
const TERMINACIONES_PLURAL_CA: readonly string[] = ['ar', 'er', 're'];

/** Los verbos oficiales en castellano y en catalán, por su forma de comparar (porClave). */
const OFICIALES_ES = porClave(VERBOS_ES);
const OFICIALES_CA = porClave(VERBOS_CA);

/**
 * Formas que no se convierten aunque sean de un verbo: presentan a la persona («Soy…», «Trabajo como…», «Sóc…»),
 * llevan otro verbo detrás («Puedo revisar», «Vaig fer», que en catalán es pasado; «Hem fet») o son también otra
 * palabra («sé»). En singular y en plural.
 */
const NO_SE_CONVIERTEN = new Set(
  ['soy', 'estoy', 'trabajo', 'puedo', 'debo', 'quiero', 'suelo', 'voy', 'se']
    .concat(['soc', 'estic', 'treballo', 'puc', 'dec', 'vull', 'solc', 'vaig'])
    .concat(['somos', 'estamos', 'trabajamos', 'podemos', 'debemos', 'queremos', 'solemos', 'vamos'])
    .concat(['som', 'estem', 'treballem', 'podem', 'devem', 'volem', 'solem', 'anem', 'hem'])
    .map(clave),
);

/** Primera persona del plural en castellano: la vocal dice la conjugación («revisamos», «atendemos», «servimos»). */
const PLURAL_ES: readonly (readonly [string, string])[] = [
  ['amos', 'ar'],
  ['emos', 'er'],
  ['imos', 'ir'],
];
/** Primera persona del plural catalana irregular → infinitivo («fem» → «fer», «prenem» → «prendre»). */
const PLURAL_IRREGULAR_CA = new Map(
  Object.entries({ fem: 'fer', prenem: 'prendre', aprenem: 'aprendre', atenem: 'atendre', entenem: 'entendre' }),
);

/**
 * Lo que sigue a «de» casi siempre es el complemento de un nombre («Reparto de paquetes», «Hago de camarero»). Solo
 * estos verbos llevan «de» detrás y no son nombres.
 */
const VERBOS_CON_DE = new Set(['cuido', 'dispongo', 'dependo']);
/** El «de» y sus formas («d'» se normaliza como «d»). */
const DE = new Set(['de', 'del', 'dels', 'd']);

/**
 * Palabras con que empieza lo que hace un verbo (artículos, posesivos, pronombres y preposiciones, sin «de»). Una
 * palabra que es nombre y verbo a la vez («registro», «cambio») solo se convierte con una de estas detrás.
 */
const TRAS_UN_VERBO = new Set(
  ['el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'su', 'sus', 'este', 'esta', 'estos']
    .concat(['estas', 'todo', 'toda', 'todos', 'todas', 'cada', 'a', 'al', 'con', 'en', 'por', 'para', 'que', 'les'])
    .concat(['els', 'l', 'uns', 'unes', 'meu', 'meus', 'seu', 'seus', 'aquest', 'aquesta', 'tot', 'tota', 'tots'])
    .concat(['totes', 'als', 'amb', 'per', 'pels']),
);

/**
 * Primera persona irregular → infinitivo. En castellano valen también con prefijo («propongo» → «proponer», «mantengo»
 * → «mantener»); en catalán, tal cual.
 */
const IRREGULARES_ES: readonly (readonly [string, string])[] = [
  ['pongo', 'poner'],
  ['tengo', 'tener'],
  ['vengo', 'venir'],
  ['hago', 'hacer'],
  ['digo', 'decir'],
  ['salgo', 'salir'],
  ['traigo', 'traer'],
  ['caigo', 'caer'],
  ['doy', 'dar'],
  ['veo', 'ver'],
];
/** Las de catalán, tal cual. */
const IRREGULARES_CA = new Map(
  Object.entries({
    faig: 'fer',
    desfaig: 'desfer',
    prenc: 'prendre',
    aprenc: 'aprendre',
    comprenc: 'comprendre',
    tinc: 'tenir',
    mantinc: 'mantenir',
    obtinc: 'obtenir',
    retinc: 'retenir',
    sostinc: 'sostenir',
    atenc: 'atendre',
    entenc: 'entendre',
    estenc: 'estendre',
    encenc: 'encendre',
    vinc: 'venir',
    intervinc: 'intervenir',
    dic: 'dir',
    duc: 'dur',
    escric: 'escriure',
    descric: 'descriure',
    inscric: 'inscriure',
    visc: 'viure',
    conec: 'conèixer',
    reconec: 'reconèixer',
    crec: 'creure',
    moc: 'moure',
    responc: 'respondre',
    corresponc: 'correspondre',
    componc: 'compondre',
    cuso: 'cosir',
    cullo: 'collir',
    acullo: 'acollir',
    recullo: 'recollir',
    surto: 'sortir',
  }),
);

/**
 * Primeras personas que encajan con dos verbos de las listas, pero solo son de uno: «cobro» es de «cobrar» (la de
 * «cobrir» es «cobreixo»), y «aprendo», «respondo», «vendo» y «accedo» solo existen en castellano (en catalán son
 * «aprenc», «responc», «venc» y «accedeixo»).
 */
const DE_UN_SOLO_VERBO = new Map(
  Object.entries({ cobro: 'cobrar', aprendo: 'aprender', respondo: 'responder', vendo: 'vender', accedo: 'acceder' }),
);

/** La primera palabra de la tarea y lo que la sigue. */
const PRIMERA = /^(\s*)([\p{L}·]+)(.*)$/su;
/** Cambio de raíz en la última vocal: «atiendo» → «atend-», «muevo» → «mov-», «juego» → «jug-», «sirvo» → «serv-». */
const CAMBIOS_DE_RAIZ: readonly (readonly [string, string])[] = [
  ['ie', 'e'],
  ['ie', 'i'],
  ['ue', 'o'],
  ['ue', 'u'],
  ['i', 'e'],
];

/** Cada verbo de la lista por su forma de comparar, con su escritura oficial («reconèixer»). */
function porClave(verbos: ReadonlySet<string>): Map<string, string> {
  return new Map([...verbos].map((verbo) => [clave(verbo), verbo]));
}

/** Los infinitivos que puede tener una primera persona del plural, en las dos lenguas (sin mirar la lista). */
function posiblesDelPlural(forma: string): { es: string[]; ca: string[] } {
  const es = PLURAL_ES.filter(([final]) => forma.endsWith(final) && forma.length > final.length).map(
    ([final, infinitivo]) => forma.slice(0, -final.length) + infinitivo,
  );
  const irregular = PLURAL_IRREGULAR_CA.get(forma);
  const ca = irregular ? [clave(irregular)] : [];
  if (forma.endsWith('im') && forma.length > LARGO_MINIMO_DE_UN_PLURAL) {
    ca.push(`${forma.slice(0, -2)}ir`);
  }
  if (forma.endsWith('em') && forma.length > LARGO_MINIMO_DE_UN_PLURAL) {
    // La ortografía de la raíz: «descarreguem» → «descarreg-», «truquem» → «truc-», «mengem» → «menj-».
    const raiz = forma.slice(0, -2);
    const raices = [raiz];
    if (raiz.endsWith('gu')) {
      raices.push(raiz.slice(0, -1));
    }
    if (raiz.endsWith('qu')) {
      raices.push(`${raiz.slice(0, -2)}c`);
    }
    if (raiz.endsWith('g')) {
      raices.push(`${raiz.slice(0, -1)}j`);
    }
    ca.push(...raices.flatMap((una) => TERMINACIONES_PLURAL_CA.map((final) => una + final)));
  }
  return { es, ca };
}

/**
 * Raíces del castellano según la ortografía de la primera persona: «conozco», «dirijo», «venzo», «distingo»,
 * «construyo».
 */
function raicesEs(raiz: string): string[] {
  const raices = [raiz];
  if (raiz.endsWith('zc')) {
    raices.push(`${raiz.slice(0, -2)}c`);
  }
  if (raiz.endsWith('j')) {
    raices.push(`${raiz.slice(0, -1)}g`);
  }
  if (raiz.endsWith('z')) {
    raices.push(`${raiz.slice(0, -1)}c`);
  }
  if (raiz.endsWith('g')) {
    raices.push(`${raiz}u`);
  }
  if (raiz.endsWith('uy')) {
    raices.push(raiz.slice(0, -1));
  }
  for (const forma of [...raices]) {
    for (const [de, a] of CAMBIOS_DE_RAIZ) {
      const donde = forma.lastIndexOf(de);
      if (donde > 0) {
        raices.push(forma.slice(0, donde) + a + forma.slice(donde + de.length));
      }
    }
  }
  return raices;
}

/** Los infinitivos castellanos de la lista que pueden tener esta primera persona (ya en su forma de comparar). */
function posiblesEs(forma: string): string[] {
  const irregulares = IRREGULARES_ES.filter(([persona]) => forma.endsWith(persona)).map(
    ([persona, verbo]) => forma.slice(0, -persona.length) + verbo,
  );
  if (!forma.endsWith('o') || forma.length < LARGO_MINIMO_DE_UNA_PERSONA) {
    return irregulares;
  }
  return irregulares.concat(
    raicesEs(forma.slice(0, -1)).flatMap((raiz) => TERMINACIONES_ES.map((final) => raiz + final)),
  );
}

/** Los infinitivos catalanes que pueden tener esta primera persona: «reviso» → «revisar», «serveixo» → «servir». */
function posiblesCa(forma: string): string[] {
  const irregular = IRREGULARES_CA.get(forma);
  const posibles = irregular ? [clave(irregular)] : [];
  if (!forma.endsWith('o') || forma.length < LARGO_MINIMO_DE_UNA_PERSONA) {
    return posibles;
  }
  const raiz = forma.slice(0, -1);
  posibles.push(...TERMINACIONES_CA.map((final) => raiz + final));
  if (raiz.endsWith('eix')) {
    posibles.push(`${raiz.slice(0, -LARGO_DE_EIX)}ir`);
  }
  if (raiz.endsWith('j')) {
    posibles.push(`${raiz.slice(0, -1)}gir`);
  }
  return posibles;
}

/**
 * La primera persona del presente se escribe sin tilde, salvo en la «í» o la «ú» de «envío» o «continúo». Con otra
 * tilde es otra palabra: «cálculo», «técnico», «revisó».
 */
function tildeDeOtraPalabra(palabra: string): boolean {
  return /[áéóàèò]/.test(palabra.toLowerCase());
}

/** Las capturas obligatorias de la primera palabra; si la tarea no empieza por una palabra, no hay partes. */
function partesDeLaTarea(tarea: string): { antes: string; palabra: string; resto: string } | null {
  const partes = PRIMERA.exec(tarea);
  if (!partes) {
    return null;
  }
  const [, antes, palabra, resto] = partes;
  if (antes === undefined || palabra === undefined || resto === undefined) {
    throw new ErrorDeProcesamiento('salida_invalida', 'tarea sin las capturas obligatorias de su primera palabra');
  }
  return { antes, palabra, resto };
}

/**
 * La forma de comparar: minúsculas, sin acentos y sin el punto volado («col·laborar» → «collaborar»), pero con la «ñ»,
 * que distingue verbos («ordeno» de «ordenar», «ordeño» de «ordeñar»).
 *
 * @param palabra - La palabra.
 * @returns La forma de comparar.
 */
export function clave(palabra: string): string {
  return palabra
    .toLowerCase()
    .normalize('NFD')
    .replace(/n\u0303/g, 'ñ')
    .replace(/[\u0300-\u036f·]/g, '');
}

/**
 * Los verbos de la lista oficial (con su escritura) que pueden ser el de esta primera persona (singular o plural).
 *
 * @param palabra - La primera palabra de una tarea.
 * @returns Los verbos posibles.
 */
export function infinitivosPosibles(palabra: string): string[] {
  const forma = clave(palabra);
  const resuelta = DE_UN_SOLO_VERBO.get(forma);
  if (resuelta) {
    return [resuelta];
  }
  const plural = posiblesDelPlural(forma);
  const verbos = [
    ...[...posiblesEs(forma), ...plural.es].map((posible) => OFICIALES_ES.get(posible)),
    ...[...posiblesCa(forma), ...plural.ca].map((posible) => OFICIALES_CA.get(posible)),
  ];
  return [...new Set(verbos.filter((verbo): verbo is string => verbo !== undefined))];
}

/**
 * La tarea con su primera palabra en infinitivo, si es un verbo copiado en primera persona del presente y no hay
 * duda de cuál; si no (también si ya empieza por infinitivo), la tarea tal cual.
 *
 * @param tarea - La tarea de la persona.
 * @returns La tarea, con su primer verbo en infinitivo si no hay duda.
 * @throws {ErrorDeProcesamiento} Si faltan capturas obligatorias o el único infinitivo identificado.
 */
export function enInfinitivo(tarea: string): string {
  const partes = partesDeLaTarea(tarea);
  if (!partes || empiezaPorInfinitivoEnSuIdioma(tarea)) {
    return tarea;
  }
  const { antes, palabra, resto } = partes;
  const forma = clave(palabra);
  const siguiente = clave(resto.trim().split(/[^\p{L}·]+/u)[0] ?? '');
  if (NO_SE_CONVIERTEN.has(forma) || tildeDeOtraPalabra(palabra)) {
    return tarea;
  }
  if (DE.has(siguiente) && !VERBOS_CON_DE.has(forma)) {
    return tarea;
  }
  if (NOMBRES.has(forma) && !TRAS_UN_VERBO.has(siguiente)) {
    return tarea;
  }
  const verbos = infinitivosPosibles(palabra);
  if (verbos.length !== 1) {
    return tarea;
  }
  const [infinitivo] = verbos;
  if (infinitivo === undefined) {
    throw new ErrorDeProcesamiento('salida_invalida', 'tarea sin el único infinitivo identificado');
  }
  const primeraLetra = palabra.charAt(0);
  const verbo = primeraLetra === primeraLetra.toLowerCase() ? infinitivo : mayuscula(infinitivo);
  return antes + verbo + resto;
}
