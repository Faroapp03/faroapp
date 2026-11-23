// Guardas comunes del contrato de datos globales: error de validación, textos bilingües, años,
// direcciones HTTPS y metadatos opcionales. Las usan datos.ts y calculados.ts; su JavaScript
// publicado conserva la misma API para la web. Sin DOM, I/O ni dependencias de plataforma.
import { esBooleano, esNumero, esObjeto, esTexto } from '../json.js';

/** Años admitidos para una cifra: las series oficiales que usa Faro empiezan en el siglo XX. */
const PRIMER_ANIO = 1900;
const ULTIMO_ANIO = 2100;

/**
 * @typedef {{ es: string, ca: string }} EnDosIdiomas
 */

/** @typedef {{ definicion?: EnDosIdiomas, licencia?: string, comparable?: boolean,
 *   cobertura?: 'ue' | 'mundo' | 'cataluna' }} MetadatosOpcionales */

/** El archivo no cumple el contrato: dice qué campo y dónde. */
export class DatosGlobalesNoValidos extends Error {}

/**
 * Comprueba una condición del contrato; si no se cumple, lanza DatosGlobalesNoValidos con `donde`.
 * @param {boolean} cumple @param {string} donde @returns {asserts cumple}
 * @throws {DatosGlobalesNoValidos} si la condición no se cumple
 */
export function exigir(cumple, donde) {
  if (!cumple) {
    throw new DatosGlobalesNoValidos(`datos-globales.json no cumple su contrato: ${donde}`);
  }
}

/** Uno de los valores admitidos. @template {string} Valor @param {readonly Valor[]} admitidos @param {unknown} valor
 * @returns {valor is Valor} */
export function esUnoDe(admitidos, valor) {
  return admitidos.some((admitido) => admitido === valor);
}

/** Un texto con algo escrito. @param {unknown} valor @returns {valor is string} */
export function esTextoLleno(valor) {
  return esTexto(valor) && valor.trim() !== '';
}

/** Un texto con algo escrito, o null. @param {unknown} valor @returns {valor is string | null} */
export function esTextoONulo(valor) {
  return valor === null || esTextoLleno(valor);
}

/** Un año entero entre PRIMER_ANIO y ULTIMO_ANIO. @param {unknown} valor @returns {valor is number} */
export function esAnio(valor) {
  return esNumero(valor) && Number.isInteger(valor) && valor >= PRIMER_ANIO && valor <= ULTIMO_ANIO;
}

/**
 * Una dirección absoluta con https. Se lee con `new URL` dentro de un `try`, y no con `URL.canParse`, que llegó a
 * Safari en la 17: el lector conserva compatibilidad con Safari 16.4.
 * @param {unknown} valor @returns {valor is string}
 */
export function esDireccionHttps(valor) {
  if (!esTexto(valor)) {
    return false;
  }
  try {
    return new URL(valor).protocol === 'https:';
  } catch {
    return false;
  }
}

/** El nombre o la definición en castellano y en catalán. @param {unknown} valor @param {string} donde
 * @returns {EnDosIdiomas} */
export function enDosIdiomas(valor, donde) {
  exigir(esObjeto(valor) && esTextoLleno(valor.es) && esTextoLleno(valor.ca), `${donde} sin castellano o catalán`);
  return Object.freeze({ es: valor.es, ca: valor.ca });
}

/** Metadatos presentes en el archivo publicado; los archivos anteriores pueden omitirlos.
 * @param {Record<string, unknown>} valor @param {string} donde @returns {MetadatosOpcionales} */
export function metadatosOpcionales(valor, donde) {
  const { licencia, comparable, cobertura, definicion } = valor;
  exigir(licencia === undefined || esTextoLleno(licencia), `${donde}.licencia`);
  exigir(comparable === undefined || esBooleano(comparable), `${donde}.comparable`);
  exigir(
    cobertura === undefined || esUnoDe(/** @type {const} */ (['ue', 'mundo', 'cataluna']), cobertura),
    `${donde}.cobertura`,
  );
  return {
    ...(definicion === undefined ? {} : { definicion: enDosIdiomas(definicion, `${donde}.definicion`) }),
    ...(licencia === undefined ? {} : { licencia }),
    ...(comparable === undefined ? {} : { comparable }),
    ...(cobertura === undefined ? {} : { cobertura }),
  };
}
