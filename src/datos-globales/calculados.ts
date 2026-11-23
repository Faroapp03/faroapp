// Cifras calculadas de datos globales: porcentajes obtenidos de un índice y encuestas oficiales,
// con procedencia de cada país. Conservan IC95% y su método; un valor null requiere cotas y motivo.
// No son cifras publicadas directamente por un organismo ni un agregado mundial. Este lector puro
// valida el bloque calculados para servicios y web, sin DOM, I/O ni llamadas a modelos.
import { esBooleano, esNumero, esObjeto, esTexto, listaDe } from '../comun/json.ts';
import type { EnDosIdiomas } from './contrato.ts';
import { enDosIdiomas, esAnio, esDireccionHttps, esTextoLleno, esTextoONulo, esUnoDe, exigir } from './contrato.ts';

/** Cómo se calcula el intervalo del 95 %: el vocabulario de constantes_datos_globales.py (METODOS_DEL_INTERVALO). */
const METODOS = /** @type {const} */ (
  ['replicas_bootstrap', 'linealizacion_taylor', 'linealizacion_taylor_aproximada'] as const
);
/** Por qué una cifra va en cotas: el vocabulario de constantes_datos_globales.py (MOTIVOS_DE_LAS_COTAS). */
const MOTIVOS = /** @type {const} */ (['sin_correspondencia_4_digitos'] as const);
const ISO3 = /^[A-Z]{3}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Cifras de un indicador calculado: una por país, y los países del mundo no llegan a 300. */
const MAX_VALORES = 300;
/** El tope de un porcentaje: la parte de un todo, en cien. */
const PORCENTAJE_MAXIMO = 100;

/**
 * @import { EnDosIdiomas } from './contrato.ts'
 * @typedef {(typeof METODOS)[number]} Metodo
 * @typedef {{ desde: number, hasta: number, metodo: Metodo }} Intervalo el intervalo de confianza del 95 %
 * @typedef {{ inferior: number, superior: number, motivo: (typeof MOTIVOS)[number],
 *   parte_sin_correspondencia: number }} Cotas entre qué cifras está el valor, la razón y la parte del empleo (en %)
 *   que no se puede asignar con exactitud
 * @typedef {{ territorio: string, nombre: EnDosIdiomas, valor: number | null, intervalo: Intervalo,
 *   cotas: Cotas | null, anio: number, encuesta: string, licencia: string, cita: string, url: string }} CifraCalculada
 * @typedef {{ id: string, nombre: EnDosIdiomas, definicion: EnDosIdiomas, unidad: 'porcentaje',
 *   naturaleza: 'calculado', fuente: string, tabla: string | null, licencia: string, url: string,
 *   comparable: boolean, cobertura: 'mundo', valores: readonly CifraCalculada[] }} Calculado
 */

export type Metodo = (typeof METODOS)[number];
export interface Intervalo {
  desde: number;
  hasta: number;
  metodo: Metodo;
}
export interface Cotas {
  inferior: number;
  superior: number;
  motivo: (typeof MOTIVOS)[number];
  parte_sin_correspondencia: number;
}
export interface CifraCalculada {
  territorio: string;
  nombre: EnDosIdiomas;
  valor: number | null;
  intervalo: Intervalo;
  cotas: Cotas | null;
  anio: number;
  encuesta: string;
  licencia: string;
  cita: string;
  url: string;
}
export interface Calculado {
  id: string;
  nombre: EnDosIdiomas;
  definicion: EnDosIdiomas;
  unidad: 'porcentaje';
  naturaleza: 'calculado';
  fuente: string;
  tabla: string | null;
  licencia: string;
  url: string;
  comparable: boolean;
  cobertura: 'mundo';
  valores: readonly CifraCalculada[];
}

/** Las cotas de una cifra null: inferior < superior dentro del intervalo, su motivo y la parte del empleo en (0, 100].
 * @param {unknown} cotas @param {Intervalo} intervalo @param {string} donde @returns {Cotas} */
function leerCotas(cotas: unknown, { desde, hasta }: Intervalo, donde: string): Cotas {
  exigir(esObjeto(cotas), `${donde}.cotas`);
  const { inferior, superior, motivo, parte_sin_correspondencia: parte } = cotas;
  exigir(esNumero(inferior) && esNumero(superior), `${donde}.cotas (cifras)`);
  exigir(desde <= inferior && inferior < superior && superior <= hasta, `${donde}.cotas fuera del intervalo`);
  exigir(esUnoDe(MOTIVOS, motivo), `${donde}.cotas.motivo`);
  exigir(esNumero(parte) && parte > 0 && parte <= PORCENTAJE_MAXIMO, `${donde}.cotas.parte_sin_correspondencia`);
  return Object.freeze({ inferior, superior, motivo, parte_sin_correspondencia: parte });
}

/** Una cifra calculada de un país. @param {unknown} valor @param {string} donde @returns {CifraCalculada} */
function leerCifraCalculada(valor: unknown, donde: string): CifraCalculada {
  exigir(esObjeto(valor) && esTexto(valor.territorio) && ISO3.test(valor.territorio), `${donde}.territorio`);
  const { territorio, intervalo, anio, encuesta, licencia, cita, url } = valor;
  const aqui = `${donde} · ${territorio}`;
  exigir(esObjeto(intervalo) && esUnoDe(METODOS, intervalo.metodo), `${aqui}.intervalo.metodo`);
  const { desde, hasta, metodo } = intervalo;
  exigir(
    esNumero(desde) && esNumero(hasta) && 0 <= desde && desde <= hasta && hasta <= PORCENTAJE_MAXIMO,
    `${aqui}.intervalo`,
  );
  const delIntervalo = Object.freeze({ desde, hasta, metodo });
  const cifra = valor.valor;
  const conValor = esNumero(cifra) && desde <= cifra && cifra <= hasta && valor.cotas === null;
  exigir(conValor || cifra === null, `${aqui}: una cifra dentro de su intervalo y sin cotas, o null con sus cotas`);
  const cotas = cifra === null ? leerCotas(valor.cotas, delIntervalo, aqui) : null;
  exigir(esAnio(anio), `${aqui}.anio`);
  exigir(esTextoLleno(encuesta) && esTextoLleno(licencia) && esTextoLleno(cita), `${aqui}: encuesta, licencia y cita`);
  exigir(esDireccionHttps(url), `${aqui}.url (https)`);
  const nombre = enDosIdiomas(valor.nombre, `${aqui}.nombre`);
  return Object.freeze({
    territorio,
    nombre,
    valor: cifra,
    intervalo: delIntervalo,
    cotas,
    anio,
    encuesta,
    licencia,
    cita,
    url,
  });
}

// ---------- Lo público ----------

/**
 * Un indicador calculado con sus cifras, un país por cifra.
 * @param {unknown} valor @param {number} i @returns {Calculado}
 */
export function leerCalculado(valor: unknown, i: number): Calculado {
  exigir(esObjeto(valor) && esTexto(valor.id) && ID.test(valor.id), `calculados[${i}].id`);
  const { id, unidad, naturaleza, fuente, tabla, licencia, url, comparable, cobertura, valores } = valor;
  exigir(unidad === 'porcentaje' && naturaleza === 'calculado', `${id}.unidad o .naturaleza`);
  exigir(esTextoLleno(fuente) && esTextoLleno(licencia) && esTextoONulo(tabla), `${id}.fuente, .licencia o .tabla`);
  exigir(esDireccionHttps(url), `${id}.url (https)`);
  exigir(esBooleano(comparable) && cobertura === 'mundo', `${id}.comparable o .cobertura`);
  exigir(Array.isArray(valores) && valores.length > 0 && valores.length <= MAX_VALORES, `${id}.valores`);
  const cifras = listaDe(valores).map((cifra, j) => leerCifraCalculada(cifra, `${id}.valores[${j}]`));
  exigir(new Set(cifras.map(({ territorio }) => territorio)).size === cifras.length, `${id}: un país dos veces`);
  return Object.freeze({
    id,
    nombre: enDosIdiomas(valor.nombre, `${id}.nombre`),
    definicion: enDosIdiomas(valor.definicion, `${id}.definicion`),
    unidad,
    naturaleza,
    fuente,
    tabla,
    licencia,
    url,
    comparable,
    cobertura,
    valores: Object.freeze(cifras),
  });
}
