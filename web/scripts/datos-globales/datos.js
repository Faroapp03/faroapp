// Lector compartido de datos globales para servicios y web, independiente de DOM, Node e IA.
// Valida el contrato completo antes de devolver estadísticas territoriales y sus metadatos de procedencia.
// Cada cifra conserva año, unidad y nota; las series van del año más reciente al más antiguo.
// Recuentos, metas, opiniones y cálculos permanecen en categorías distintas. Un campo inválido rechaza
// el archivo entero con DatosGlobalesNoValidos. La adquisición web recibe pedir como dependencia.
import { esBooleano, esNumero, esObjeto, esTexto, listaDe } from '../json.js';

import { leerCalculado } from './calculados.js';

import {
  DatosGlobalesNoValidos,
  enDosIdiomas,
  esAnio,
  esDireccionHttps,
  esTextoLleno,
  esTextoONulo,
  esUnoDe,
  exigir,
  metadatosOpcionales,
} from './contrato.js';

export { DatosGlobalesNoValidos };

/** Dónde se publica el archivo, desde la raíz de la web. */
export const DIRECCION_DE_LOS_DATOS = 'datos/datos-globales.json';
/** La versión del contrato que entiende esta página. */
const VERSION_DEL_CONTRATO = '1';
/**
 * Tope de lo que se lee del archivo, en caracteres (unidades UTF-16 de JavaScript): acota lo que recibe JSON.parse,
 * no la descarga, que ya está en memoria al medirlo. El archivo es de la propia web (DIRECCION_DE_LOS_DATOS) y el de la
 * cadena se lee con el mismo tope, sin acotar aquí el tamaño de descarga.
 */
const MAX_CARACTERES = 2_000_000;
/** Topes de las listas (regla 3 de Holzmann): más países que los del mundo o más indicadores no son este archivo. */
const MAX_TERRITORIOS = 300;
const MAX_INDICADORES = 200;
/** Cifras de un territorio: una por indicador y año, con series de pocos años. */
const MAX_VALORES = 1000;
/** Tope de los bloques aparte (recuentos, metas, encuestas): pocos, y cada uno con pocas cifras. */
const MAX_EN_UN_BLOQUE = 50;
/** Las unidades que la página sabe escribir y la escala de cada una. */
const UNIDADES = /** @type {const} */ (['porcentaje']);
const ESCALAS = Object.freeze({ porcentaje: Object.freeze({ minimo: 0, maximo: 100 }) });
/** La unidad de los recuentos: no es un porcentaje y nunca se pinta como tal. */
export const MILES_DE_PERSONAS = 'miles de personas';
const NATURALEZAS = /** @type {const} */ (['medido', 'estimado']);
const TIPOS = /** @type {const} */ (['region', 'pais', 'agregado']);
const COBERTURAS = /** @type {const} */ (['ue', 'mundo', 'cataluna']);
const ISO3 = /^[A-Z]{3}$/;
const ID_DE_INDICADOR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Los caracteres de una fecha AAAA-MM-DD al principio de una fecha ISO 8601 completa. */
const FECHA_AAAA_MM_DD = 10;

/**
 * Si el texto es una fecha AAAA-MM-DD de un día que existe: la forma sola deja pasar «2026-99-99», un día imposible
 * que la página escribiría tal cual como fecha de la edición.
 * @param {unknown} valor
 * @returns {valor is string}
 */
function esFechaReal(valor) {
  if (!esTexto(valor) || !FECHA.test(valor)) {
    return false;
  }
  // A mediodía en UTC: ningún huso horario la lleva a otro día al volver a escribirla.
  const instante = new Date(`${valor}T12:00:00Z`);
  return Number.isFinite(instante.getTime()) && instante.toISOString().slice(0, FECHA_AAAA_MM_DD) === valor;
}

/**
 * @import { EnDosIdiomas } from './contrato.js'
 * @import { Calculado } from './calculados.js'
 * @typedef {typeof NATURALEZAS[number]} Naturaleza
 * @typedef {typeof TIPOS[number]} TipoDeTerritorio
 * @typedef {typeof COBERTURAS[number]} Cobertura
 * @typedef {{ id: string, nombre: EnDosIdiomas, definicion: EnDosIdiomas, unidad: 'porcentaje',
 *   naturaleza: Naturaleza, fuente: string, tabla: string | null, licencia: string, url: string,
 *   comparable: boolean, cobertura: Cobertura }} Indicador
 * @typedef {{ indicador: string, valor: number, anio: number, nota: string | null }} Valor
 * @typedef {{ codigo: string, iso3: string | null, tipo: TipoDeTerritorio, nombre: EnDosIdiomas,
 *   valores: readonly Valor[] }} Territorio
 * @typedef {{ territorio: string, valor: number, anio: number, nota: string | null }} Cifra una cifra de un bloque
 *   aparte (recuentos y encuestas), con su territorio
 * @typedef {{ id: string, nombre: EnDosIdiomas, unidad: string, naturaleza: Naturaleza, fuente: string,
 *   tabla: string | null, url: string, definicion?: EnDosIdiomas, licencia?: string, comparable?: boolean,
 *   cobertura?: Cobertura, valores: readonly Cifra[] }} Recuento una cifra que no es un porcentaje
 * @typedef {{ id: string, nombre: EnDosIdiomas, norma: string, articulo: string, texto: string, valor: number,
 *   unidad: string, anio: number, indicador: string, nota: EnDosIdiomas | null, url: string }} Meta una meta de la
 *   Década Digital (Decisión (UE) 2022/2481, art. 4), medida con un indicador o un recuento en su misma unidad
 * @typedef {{ id: string, nombre: EnDosIdiomas, pregunta: string, unidad: 'porcentaje', naturaleza: 'opinion',
 *   fuente: string, tabla: string | null, url: string, definicion?: EnDosIdiomas, licencia?: string,
 *   comparable?: boolean, cobertura?: Cobertura, respuesta?: string, base?: string, campo?: string,
 *   valores: readonly Cifra[] }} Encuesta una pregunta de una
 *   encuesta de opinión (nunca un indicador medido)
 * @typedef {{ muestra: boolean, version: string, generado: string, indicadores: readonly Indicador[],
 *   territorios: readonly Territorio[], recuentos: readonly Recuento[], metas: readonly Meta[],
 *   encuestas: readonly Encuesta[], calculados: readonly Calculado[] }} DatosGlobales `muestra`, si son cifras de
 *   prueba (nunca se publican)
 */

/** Los campos de metodología de una encuesta, opcionales en el contrato: si faltan, no se inventan textos.
 * @param {Record<string, unknown>} valor @param {string} donde
 * @returns {Pick<Encuesta, 'respuesta' | 'base' | 'campo'>} */
function textosDeEncuesta(valor, donde) {
  const { respuesta, base, campo } = valor;
  exigir(respuesta === undefined || esTextoLleno(respuesta), `${donde}.respuesta`);
  exigir(base === undefined || esTextoLleno(base), `${donde}.base`);
  exigir(campo === undefined || esTextoLleno(campo), `${donde}.campo`);
  return {
    ...(respuesta === undefined ? {} : { respuesta }),
    ...(base === undefined ? {} : { base }),
    ...(campo === undefined ? {} : { campo }),
  };
}

/** El archivo no ha llegado (sin red, 404) o no es JSON. */
export class DatosGlobalesNoDisponibles extends Error {}

/**
 * Un código ISO 3166-1 alfa-3, o null (Cataluña, la UE).
 * @param {unknown} valor
 * @returns {valor is string | null}
 */
function esIso3ONulo(valor) {
  return valor === null || (esTexto(valor) && ISO3.test(valor));
}

/**
 * Un indicador del contrato.
 * @param {unknown} valor
 * @param {number} posicion
 * @returns {Indicador}
 */
function leerIndicador(valor, posicion) {
  const donde = `indicadores[${posicion}]`;
  exigir(esObjeto(valor) && esTexto(valor.id) && ID_DE_INDICADOR.test(valor.id), `${donde}.id`);
  const { id, unidad, naturaleza, fuente, tabla, licencia, url, comparable, cobertura } = valor;
  exigir(esUnoDe(UNIDADES, unidad), `${id}.unidad`);
  exigir(esUnoDe(NATURALEZAS, naturaleza), `${id}.naturaleza`);
  exigir(esTextoLleno(fuente) && esTextoLleno(licencia), `${id}.fuente o .licencia`);
  exigir(esTextoONulo(tabla), `${id}.tabla`);
  exigir(esDireccionHttps(url), `${id}.url (https)`);
  exigir(esBooleano(comparable) && esUnoDe(COBERTURAS, cobertura), `${id}.comparable o .cobertura`);
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
  });
}

/**
 * Una cifra de un territorio: de un indicador que existe, en su escala y con su año.
 * @param {unknown} valor @param {string} donde @param {ReadonlyMap<string, Indicador>} indicadores @returns {Valor}
 */
function leerValor(valor, donde, indicadores) {
  exigir(esObjeto(valor) && esTexto(valor.indicador), `${donde}.indicador`);
  const indicador = indicadores.get(valor.indicador);
  exigir(indicador !== undefined, `${donde}: el indicador «${valor.indicador}» no está en la lista`);
  const escala = ESCALAS[indicador.unidad];
  const cifra = valor.valor;
  exigir(esNumero(cifra) && cifra >= escala.minimo && cifra <= escala.maximo, `${donde}.valor`);
  const anio = valor.anio;
  exigir(esAnio(anio), `${donde}.anio`);
  const nota = valor.nota;
  exigir(esTextoONulo(nota), `${donde}.nota`);
  return Object.freeze({ indicador: indicador.id, valor: cifra, anio, nota });
}

/**
 * La primera cifra mal colocada en su serie, o undefined si todas lo están. Bien colocada: la primera de su indicador,
 * o justo detrás de otra del mismo indicador y de un año posterior. Así cada serie va seguida y del año más reciente
 * al más antiguo. Un solo recorrido (O(n)): lleva los indicadores ya vistos en un conjunto.
 * @param {readonly Valor[]} valores
 * @returns {Valor | undefined}
 */
function primeraFueraDeSuSerie(valores) {
  /** @type {Set<string>} */
  const vistos = new Set();
  return valores.find((cifra, i) => {
    const anterior = valores[i - 1];
    const enSuSerie =
      anterior?.indicador === cifra.indicador ? cifra.anio < anterior.anio : !vistos.has(cifra.indicador);
    vistos.add(cifra.indicador);
    return !enSuSerie;
  });
}

/**
 * Un territorio con sus cifras: una por indicador o, si es una serie, una por año.
 * @param {unknown} valor @param {number} posicion @param {ReadonlyMap<string, Indicador>} indicadores
 * @returns {Territorio}
 */
function leerTerritorio(valor, posicion, indicadores) {
  exigir(esObjeto(valor) && esTextoLleno(valor.codigo), `territorios[${posicion}].codigo`);
  const { codigo, iso3, tipo } = valor;
  exigir(esIso3ONulo(iso3), `${codigo}.iso3`);
  exigir(esUnoDe(TIPOS, tipo), `${codigo}.tipo`);
  // Un país se sitúa en el mapa por su código ISO 3166-1 alfa-3 (el globo lo busca en sus fronteras).
  exigir(tipo !== 'pais' || iso3 !== null, `${codigo}: un país sin ISO 3166-1 alfa-3`);
  exigir(Array.isArray(valor.valores) && valor.valores.length <= MAX_VALORES, `${codigo}.valores`);
  const valores = listaDe(valor.valores).map((cifra, i) => leerValor(cifra, `${codigo}.valores[${i}]`, indicadores));
  const fuera = primeraFueraDeSuSerie(valores);
  exigir(!fuera, `${codigo}: la serie de «${fuera?.indicador}» no va seguida y del año más reciente al más antiguo`);
  return Object.freeze({ codigo, iso3, tipo, nombre: enDosIdiomas(valor.nombre, `${codigo}.nombre`), valores });
}

/**
 * Una cifra de un bloque aparte: territorio, valor finito en [minimo, maximo], año y nota.
 * @param {unknown} valor
 * @param {string} donde
 * @param {number} maximo
 * @returns {Cifra}
 */
function leerCifra(valor, donde, maximo) {
  exigir(esObjeto(valor) && esTextoLleno(valor.territorio), `${donde}.territorio`);
  const { territorio, anio, nota } = valor;
  exigir(esNumero(valor.valor) && valor.valor >= 0 && valor.valor <= maximo, `${donde}.valor`);
  exigir(esAnio(anio), `${donde}.anio`);
  exigir(esTextoONulo(nota), `${donde}.nota`);
  return Object.freeze({ territorio, valor: valor.valor, anio, nota });
}

/**
 * Las cifras de un bloque aparte.
 * @param {unknown} valores
 * @param {string} donde
 * @param {number} maximo
 * @returns {readonly Cifra[]}
 */
function leerCifras(valores, donde, maximo) {
  exigir(Array.isArray(valores) && valores.length > 0 && valores.length <= MAX_VALORES, `${donde}.valores`);
  return Object.freeze(listaDe(valores).map((cifra, i) => leerCifra(cifra, `${donde}.valores[${i}]`, maximo)));
}

/**
 * Lo común de un recuento o una encuesta: id, nombre, fuente, tabla y url https. Lanza si `valor` no es un objeto.
 * @param {unknown} valor
 * @param {string} donde
 */
function leerCabecera(valor, donde) {
  exigir(esObjeto(valor) && esTexto(valor.id) && ID_DE_INDICADOR.test(valor.id), `${donde}.id`);
  const { id, fuente, tabla, url } = valor;
  exigir(esTextoLleno(fuente) && esTextoONulo(tabla), `${id}.fuente o .tabla`);
  exigir(esDireccionHttps(url), `${id}.url (https)`);
  return {
    id,
    nombre: enDosIdiomas(valor.nombre, `${id}.nombre`),
    fuente,
    tabla,
    url,
    ...metadatosOpcionales(valor, id),
  };
}

/**
 * Un recuento (miles de personas), medido o estimado.
 * @param {unknown} valor
 * @param {number} i
 * @returns {Recuento}
 */
function leerRecuento(valor, i) {
  const cabecera = leerCabecera(valor, `recuentos[${i}]`);
  // leerCabecera ya lanzó si `valor` no es un objeto (esObjeto), así que aquí lo es.
  const { unidad, naturaleza, valores } = /** @type {Record<string, unknown>} */ (valor);
  exigir(unidad === MILES_DE_PERSONAS && esUnoDe(NATURALEZAS, naturaleza), `${cabecera.id}.unidad o .naturaleza`);
  return Object.freeze({
    ...cabecera,
    unidad,
    naturaleza,
    valores: leerCifras(valores, cabecera.id, Number.MAX_VALUE),
  });
}

/**
 * Una pregunta de opinión: siempre «opinion» y en porcentaje.
 * @param {unknown} valor
 * @param {number} i
 * @returns {Encuesta}
 */
function leerEncuesta(valor, i) {
  const cabecera = leerCabecera(valor, `encuestas[${i}]`);
  // leerCabecera comprobó esObjeto y no hay ninguna mutación entre la guarda y este acceso.
  const campos = /** @type {Record<string, unknown>} */ (valor);
  const { unidad, naturaleza, pregunta, valores } = campos;
  exigir(unidad === 'porcentaje' && naturaleza === 'opinion', `${cabecera.id}.unidad o .naturaleza`);
  exigir(esTextoLleno(pregunta), `${cabecera.id}.pregunta`);
  const cifras = leerCifras(valores, cabecera.id, ESCALAS.porcentaje.maximo);
  return Object.freeze({
    ...cabecera,
    pregunta,
    unidad,
    naturaleza,
    valores: cifras,
    ...textosDeEncuesta(campos, cabecera.id),
  });
}

/**
 * Una meta: su texto literal, su valor y el indicador o recuento que la mide, en la misma unidad.
 * @param {unknown} valor @param {number} i @param {ReadonlyMap<string, string>} unidades la unidad de cada indicador
 *   y recuento, por su id @returns {Meta}
 */
function leerMeta(valor, i, unidades) {
  exigir(esObjeto(valor) && esTexto(valor.id) && ID_DE_INDICADOR.test(valor.id), `metas[${i}].id`);
  const { id, norma, articulo, texto, unidad, anio, indicador, url } = valor;
  exigir(esTextoLleno(norma) && esTextoLleno(articulo) && esTextoLleno(texto), `${id}.norma, .articulo o .texto`);
  exigir(esNumero(valor.valor) && Number.isFinite(valor.valor) && valor.valor > 0, `${id}.valor`);
  exigir(esAnio(anio), `${id}.anio`);
  exigir(esTexto(indicador) && esTexto(unidad) && unidades.get(indicador) === unidad, `${id}.indicador o .unidad`);
  exigir(esDireccionHttps(url), `${id}.url (https)`);
  const nota = valor.nota === null ? null : enDosIdiomas(valor.nota, `${id}.nota`);
  return Object.freeze({
    id,
    nombre: enDosIdiomas(valor.nombre, `${id}.nombre`),
    norma,
    articulo,
    texto,
    valor: valor.valor,
    unidad,
    anio,
    indicador,
    nota,
    url,
  });
}

/**
 * Un bloque aparte que un archivo puede no traer: entonces, vacío.
 * @template {{ id: string }} T @param {unknown} lista @param {string} nombre @param {(valor: unknown, i: number) => T} leer
 * @returns {readonly T[]}
 */
function leerBloque(lista, nombre, leer) {
  if (lista === undefined) {
    return Object.freeze([]);
  }
  exigir(Array.isArray(lista) && lista.length <= MAX_EN_UN_BLOQUE, nombre);
  const leidos = listaDe(lista).map(leer);
  exigir(
    // Cada `leer` de un bloque devuelve un objeto con `id` (texto): lo comprobó leyendo la cabecera o la meta.
    new Set(leidos.map((leido) => leido.id)).size === leidos.length,
    `${nombre}: dos con el mismo id`,
  );
  return Object.freeze(leidos);
}

/** Los bloques adicionales: las metas se leen tras los recuentos para comprobar sus unidades.
 * Los ids de indicadores, recuentos, encuestas y calculados no se repiten entre esas categorías.
 * @param {Record<string, unknown>} valor @param {readonly Indicador[]} indicadores
 * @returns {Pick<DatosGlobales, 'recuentos' | 'metas' | 'encuestas' | 'calculados'>} */
function leerBloquesDelArchivo(valor, indicadores) {
  const recuentos = leerBloque(valor.recuentos, 'recuentos', leerRecuento);
  const unidades = new Map([...indicadores, ...recuentos].map(({ id, unidad }) => [id, unidad]));
  exigir(unidades.size === indicadores.length + recuentos.length, 'un recuento con el id de un indicador');
  const metas = leerBloque(valor.metas, 'metas', (meta, i) => leerMeta(meta, i, unidades));
  const encuestas = leerBloque(valor.encuestas, 'encuestas', leerEncuesta);
  exigir(
    encuestas.every(({ id }) => !unidades.has(id)),
    'una encuesta con el id de un indicador',
  );
  const calculados = leerBloque(valor.calculados, 'calculados', leerCalculado);
  exigir(
    calculados.every(({ id }) => !unidades.has(id) && encuestas.every((encuesta) => encuesta.id !== id)),
    'una cifra calculada con el id de un indicador, un recuento o una encuesta',
  );
  return { recuentos, metas, encuestas, calculados };
}

/**
 * Lee el archivo ya convertido de JSON y lo devuelve comprobado y congelado; si no cumple el contrato, lanza
 * DatosGlobalesNoValidos. `muestra: true` marca las cifras de prueba (no forma parte de lo que publica la cadena).
 * @param {unknown} valor @returns {DatosGlobales}
 */
export function leerDatosGlobales(valor) {
  exigir(esObjeto(valor) && valor.version === VERSION_DEL_CONTRATO, `version distinta de «${VERSION_DEL_CONTRATO}»`);
  exigir(esFechaReal(valor.generado), 'generado (AAAA-MM-DD, un día que existe)');
  exigir(valor.muestra === undefined || esBooleano(valor.muestra), 'muestra');
  const listaDeIndicadores = valor.indicadores;
  const listaDeTerritorios = valor.territorios;
  exigir(Array.isArray(listaDeIndicadores) && listaDeIndicadores.length <= MAX_INDICADORES, 'indicadores');
  exigir(Array.isArray(listaDeTerritorios) && listaDeTerritorios.length <= MAX_TERRITORIOS, 'territorios');
  const indicadores = listaDe(listaDeIndicadores).map(leerIndicador);
  const indicadoresPorId = new Map(indicadores.map((indicador) => [indicador.id, indicador]));
  exigir(indicadoresPorId.size === indicadores.length, 'dos indicadores con el mismo id');
  const territorios = listaDe(listaDeTerritorios).map((territorio, i) =>
    leerTerritorio(territorio, i, indicadoresPorId),
  );
  exigir(new Set(territorios.map(({ codigo }) => codigo)).size === territorios.length, 'dos territorios iguales');
  const bloques = leerBloquesDelArchivo(valor, indicadores);
  return Object.freeze({
    muestra: valor.muestra === true,
    version: VERSION_DEL_CONTRATO,
    generado: valor.generado,
    indicadores: Object.freeze(indicadores),
    territorios: Object.freeze(territorios),
    ...bloques,
  });
}

/**
 * Pide el archivo y lo lee. Sin respuesta, con un estado que no es 200 o con algo que no es JSON (o que pasa del tope),
 * lanza DatosGlobalesNoDisponibles; si no cumple el contrato, DatosGlobalesNoValidos.
 * @param {(direccion: URL) => Promise<Response>} pedir Cómo se pide (fetch en la página).
 * @param {URL} raiz La raíz de la web.
 * @returns {Promise<DatosGlobales>} Los datos, ya comprobados y congelados.
 * @throws {DatosGlobalesNoDisponibles} Sin respuesta, con otro estado, sin JSON o por encima de MAX_CARACTERES.
 * @throws {DatosGlobalesNoValidos} Si el archivo no cumple el contrato (lo lanza leerDatosGlobales).
 */
export async function pedirDatosGlobales(pedir, raiz) {
  const direccion = new URL(DIRECCION_DE_LOS_DATOS, raiz);
  let texto = '';
  try {
    const respuesta = await pedir(direccion);
    if (!respuesta.ok) {
      throw new DatosGlobalesNoDisponibles(`${direccion.pathname}: estado ${respuesta.status}`);
    }
    texto = await respuesta.text();
  } catch (error) {
    if (error instanceof DatosGlobalesNoDisponibles) {
      throw error;
    }
    throw new DatosGlobalesNoDisponibles(`${direccion.pathname}: sin respuesta`, { cause: error });
  }
  if (texto.length > MAX_CARACTERES) {
    throw new DatosGlobalesNoDisponibles(`${direccion.pathname}: pasa de ${MAX_CARACTERES} caracteres`);
  }
  try {
    return leerDatosGlobales(JSON.parse(texto));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DatosGlobalesNoDisponibles('No es JSON', { cause: error });
    }
    throw error;
  }
}

/**
 * El territorio con ese código: el de la cadena («ES51», «EU27_2020») o, si es un país, su ISO 3166-1 alfa-3.
 * @param {DatosGlobales} datos @param {string} codigo @returns {Territorio | null}
 */
export function territorioPorCodigo(datos, codigo) {
  return datos.territorios.find((territorio) => territorio.codigo === codigo || territorio.iso3 === codigo) ?? null;
}

/**
 * La cifra más reciente de un indicador en un territorio (la primera de su serie), o null si no la tiene.
 * @param {DatosGlobales} datos @param {string} codigo @param {string} id @returns {Valor | null}
 */
export function valorDe(datos, codigo, id) {
  const territorio = territorioPorCodigo(datos, codigo);
  return territorio?.valores.find((valor) => valor.indicador === id) ?? null;
}

/**
 * La cifra más reciente de una encuesta o un recuento en un territorio (por su código de la cadena o su ISO3), o null.
 * @param {DatosGlobales} datos @param {{ valores: readonly Cifra[] }} bloque @param {string} codigo
 * @returns {Cifra | null}
 */
export function cifraDelBloque(datos, { valores }, codigo) {
  const territorio = territorioPorCodigo(datos, codigo);
  const codigos = territorio ? [territorio.codigo, territorio.iso3] : [codigo];
  return valores.filter((cifra) => codigos.includes(cifra.territorio)).sort((a, b) => b.anio - a.anio)[0] ?? null;
}

/**
 * La serie de un indicador en un territorio, del año más antiguo al más reciente
 * (para dibujarla de izquierda a derecha).
 * @param {DatosGlobales} datos @param {string} codigo @param {string} id @returns {Valor[]}
 */
export function serieDe(datos, codigo, id) {
  const territorio = territorioPorCodigo(datos, codigo);
  return (territorio?.valores ?? []).filter((valor) => valor.indicador === id).sort((a, b) => a.anio - b.anio);
}
