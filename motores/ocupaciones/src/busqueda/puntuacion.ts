// Los puntos de una ocupación con lo que se busca (consulta.ts): los de su mejor nombre, por la parte de la búsqueda
// que cubre y por la parte del nombre que explica, ponderadas por la rareza de cada palabra y por lo bien que coincide
// (palabras.ts); el máximo si el nombre es la búsqueda entera; y, solo si algún nombre encaja, algo más por la
// descripción.

import { estaEnLosOrdenados } from '../../../../src/comun/lista-ordenada.ts';
import type { Consulta } from './consulta.ts';
import { type OcupacionIndexada, pesoEnElNombre } from './indice.ts';
import { coincidencia } from './palabras.ts';

/** Contratos de los productores reales, limitados a los campos que se puntúan. */
export type ConsultaParaPuntuar = Pick<Consulta, 'palabras' | 'frase' | 'peso' | 'pesoTotal' | 'nombres'> &
  Partial<Pick<Consulta, 'oficio' | 'complemento' | 'expresiones'>>;
export type OcupacionParaPuntuar = Pick<OcupacionIndexada, 'nombres' | 'frases' | 'descripcion' | 'pesoNombres'> &
  Partial<Pick<OcupacionIndexada, 'inicioComplemento'>>;

/** Puntos de un nombre que coincide con toda la búsqueda; la descripción puede sumar hasta MAX_PUNTOS_DESCRIPCION. */
export const PUNTOS_FRASE_EXACTA = 100;
/** Puntos de un nombre cuya frase contiene la búsqueda como subcadena, antes de contar cobertura y explicación. */
const PUNTOS_FRASE_CONTENIDA = 80;
/** Puntos de un nombre que solo comparte palabras con la búsqueda, antes de contar las mismas partes. */
const PUNTOS_PALABRAS = 70;
/**
 * De los puntos de un nombre, la parte que depende de cuánto del nombre explica la búsqueda: un nombre que cubre la
 * búsqueda entera pero dice mucho más que ella se queda con el resto.
 */
const PARTE_POR_LO_QUE_EXPLICA = 0.5;
/** La descripción suma como mucho estos puntos, y solo a una ocupación que ya encaja por su nombre. */
const MAX_PUNTOS_DESCRIPCION = 10;
/**
 * Lo que conserva un nombre que solo coincide con el lugar de trabajo y con ninguna palabra del oficio
 * («farmacéutico de hospital» para «infermera a l'hospital»): el lugar no es el oficio (contexto.ts).
 */
const FACTOR_SOLO_LUGAR = 0.5;
/**
 * Lo que conserva un nombre que coincide con el complemento del oficio y con ninguna palabra de su núcleo («empleado de
 * oficina» para «neteja d'oficines»): la actividad pesa más que el objeto o el sitio. Elegido por validación cruzada.
 */
const FACTOR_SOLO_COMPLEMENTO = 0.75;
/**
 * Lo que conserva un nombre que lleva una sola palabra de una expresión fija de la búsqueda («derechos humanos» para
 * «recursos humanos», expresiones.ts). Elegido por validación cruzada.
 */
const FACTOR_EXPRESION_ROTA = 1;

/**
 * Lo que mejor respalda a `palabra` alguna de `otras`: 1 si está entre ellas, VALOR_DEL_PREFIJO (palabras.ts) si una
 * empieza por la otra (coincidencia, palabras.ts).
 */
function mejorCoincidencia(palabra: string, otras: string[], soloDerivadas: (otra: string) => boolean): number {
  let mejor = 0;
  for (const otra of otras) {
    const valor = coincidencia(palabra, otra, soloDerivadas(otra));
    if (valor > mejor) {
      mejor = valor;
    }
    if (mejor === 1) {
      return mejor;
    }
  }
  return mejor;
}

/**
 * Peso de las palabras de `unas` que respaldan las de `otras`, cada una por lo bien que la respalda la que mejor
 * encaja.
 */
function pesoRespaldado(unas: string[], otras: string[], consulta: ConsultaParaPuntuar, deLaBusqueda: boolean): number {
  return unas.reduce((suma, una) => {
    const soloDerivadas = (otra: string) => consulta.nombres.has(deLaBusqueda ? una : otra);
    return suma + consulta.peso(una) * mejorCoincidencia(una, otras, soloDerivadas);
  }, 0);
}

/**
 * Peso de las palabras del nombre que la búsqueda respalda (numerador de «explica»), con las de su complemento a
 * FACTOR_COMPLEMENTO_NOMBRE, como en su peso total (indice.ts).
 */
function explicado(nombre: string[], inicio: number, consulta: ConsultaParaPuntuar): number {
  return nombre.reduce((suma, una, j) => {
    const soloDerivadas = (otra: string) => consulta.nombres.has(otra);
    return (
      suma + consulta.peso(una) * mejorCoincidencia(una, consulta.palabras, soloDerivadas) * pesoEnElNombre(j, inicio)
    );
  }, 0);
}

/** Si el nombre coincide con alguna de las palabras. */
function coincideCon(palabras: readonly string[], nombre: string[], consulta: ConsultaParaPuntuar): boolean {
  return palabras.some((palabra) => mejorCoincidencia(palabra, nombre, () => consulta.nombres.has(palabra)) > 0);
}

/**
 * Lo que conserva un nombre según con qué parte de la búsqueda coincide: si la búsqueda tiene lugar de trabajo y el
 * nombre no coincide con ninguna palabra del oficio, FACTOR_SOLO_LUGAR; si el oficio tiene complemento y el nombre no
 * coincide con ninguna palabra de su núcleo, FACTOR_SOLO_COMPLEMENTO; si no, todo.
 */
function factorDeLoQueCubre(nombre: string[], consulta: ConsultaParaPuntuar): number {
  return factorDeLasPartes(nombre, consulta) * factorDeLasExpresiones(nombre, consulta);
}

/** FACTOR_EXPRESION_ROTA por cada expresión fija de la búsqueda de la que el nombre lleva una sola palabra. */
function factorDeLasExpresiones(nombre: string[], consulta: ConsultaParaPuntuar): number {
  let factor = 1;
  for (const [una, otra] of consulta.expresiones ?? []) {
    if (coincideCon([una], nombre, consulta) !== coincideCon([otra], nombre, consulta)) {
      factor *= FACTOR_EXPRESION_ROTA;
    }
  }
  return factor;
}

/** Lo que conserva un nombre según con qué parte de la búsqueda coincide (factorDeLoQueCubre). */
function factorDeLasPartes(nombre: string[], consulta: ConsultaParaPuntuar): number {
  const { oficio, complemento } = consulta;
  if (!oficio?.length) {
    return 1;
  }
  if (oficio.length !== consulta.palabras.length && !coincideCon(oficio, nombre, consulta)) {
    return FACTOR_SOLO_LUGAR;
  }
  const nucleo = oficio.filter((palabra) => !complemento?.has(palabra));
  return complemento?.size && nucleo.length && !coincideCon(nucleo, nombre, consulta) ? FACTOR_SOLO_COMPLEMENTO : 1;
}

/**
 * Puntos de un nombre: por la parte de la búsqueda que cubre y por la parte del nombre que explica, ambas ponderadas
 * por la rareza de las palabras y por lo bien que coincide cada una. Si el nombre es la búsqueda entera, el máximo.
 */
function puntosDelNombre(ocupacion: OcupacionParaPuntuar, i: number, consulta: ConsultaParaPuntuar): number {
  // indice.ts crea nombres, frases y pesoNombres con las mismas variantes y en el mismo orden; i recorre nombres.
  const nombre = ocupacion.nombres[i] as string[];
  if (!nombre.length) {
    return 0;
  }
  const frase = ocupacion.frases[i] as string;
  if (frase === consulta.frase) {
    return PUNTOS_FRASE_EXACTA;
  }
  const cubre = pesoRespaldado(consulta.palabras, nombre, consulta, true) / consulta.pesoTotal;
  if (cubre === 0) {
    return 0;
  }
  const inicio = ocupacion.inicioComplemento?.[i] ?? nombre.length;
  const explica = explicado(nombre, inicio, consulta) / (ocupacion.pesoNombres[i] as number);
  const base = frase.includes(consulta.frase) ? PUNTOS_FRASE_CONTENIDA : PUNTOS_PALABRAS;
  const puntos = base * cubre * (1 - PARTE_POR_LO_QUE_EXPLICA + PARTE_POR_LO_QUE_EXPLICA * explica);
  return puntos * factorDeLoQueCubre(nombre, consulta);
}

/** Puntos de una ocupación: los de su mejor nombre y, si alguno encaja, un poco más por la descripción. */
function puntuar(ocupacion: OcupacionParaPuntuar, consulta: ConsultaParaPuntuar): number {
  // consulta.ts descarta pesoTotal cero: hay palabras; indice.ts da peso positivo a todo nombre no vacío.
  let mejor = 0;
  for (let i = 0; i < ocupacion.nombres.length; i++) {
    mejor = Math.max(mejor, puntosDelNombre(ocupacion, i, consulta));
  }
  if (mejor === 0) {
    return 0;
  }
  const enDescripcion = consulta.palabras.filter((palabra) =>
    estaEnLosOrdenados(ocupacion.descripcion, palabra),
  ).length;
  return mejor + Math.min(MAX_PUNTOS_DESCRIPCION, (MAX_PUNTOS_DESCRIPCION * enDescripcion) / consulta.palabras.length);
}

/**
 * Puntos de una ocupación con las formas de una búsqueda (consultasDe): los de la forma con la que mejor encaja.
 *
 * @param ocupacion - La ocupación indexada.
 * @param formas - Las formas de la búsqueda.
 * @returns Los puntos de la mejor forma.
 */
export function puntuarFormas(ocupacion: OcupacionParaPuntuar, formas: ConsultaParaPuntuar[]): number {
  return Math.max(0, ...formas.map((forma) => puntuar(ocupacion, forma)));
}
