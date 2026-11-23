// Lo que el globo saca de los datos globales (datos-globales.json) ya comprobados por el único lector del contrato,
// el de la página (scripts/datos-globales/datos.js, `leerDatosGlobales`): el código de cada territorio en el mapa, los
// países que salen (solo los que tienen algún dato oficial de la IA: uso medido o exposición calculada) y los bloques
// de «La IA en {país}» de la ficha. Lógica pura, sin DOM: pruebas/web-globo/globo-datos.test.js.

import { serieDe } from '../datos-globales/datos.js';

/**
 * @import { DatosGlobales, Indicador, Territorio, Valor } from '../datos-globales/datos.js'
 * @import { Calculado, CifraCalculada } from '../datos-globales/calculados.js'
 * @import { Idioma } from '../textos.js'
 */

/**
 * Los indicadores de uso de la IA que enseña la ficha, todos con la misma base: toda la población de 16 a 74 años de
 * cada grupo, use o no internet (Eurostat, isoc_ai_iaiu, PC_IND), y las empresas con 10 o más trabajadores
 * (isoc_eb_ai).
 */
const IA = Object.freeze({
  empresas: 'empresas-ia',
  personas: 'personas-ia-generativa',
  personasTrabajo: 'personas-ia-generativa-trabajo',
  mujeres: 'mujeres-ia-generativa',
  hombres: 'hombres-ia-generativa',
  mujeresTrabajo: 'mujeres-ia-generativa-trabajo',
  hombresTrabajo: 'hombres-ia-generativa-trabajo',
  noManual: 'ia-generativa-trabajo-no-manual',
  manual: 'ia-generativa-trabajo-manual',
  tic: 'ia-generativa-trabajo-tic',
});

/**
 * La exposición calculada que enseña la ficha, en una sola tarjeta: la alta (gradiente 4 del índice de la OIT) y la
 * de alguna exposición (gradientes 1 a 4).
 */
const EXPOSICION = Object.freeze({ alta: 'exposicion-alta', alguna: 'exposicion-alguna' });

/**
 * Un bloque de «La IA en {país}», con sus cifras y el indicador que da la fuente, el año y el enlace.
 * @typedef {{ clave: 'empresas' | 'nacional' | 'nacional-personas', indicador: Indicador, serie: Valor[] }} BloqueDeSerie
 *   `nacional`, la medida de las empresas de la estadística del país; `nacional-personas`, la de las personas
 * @typedef {{ clave: 'personas', indicador: Indicador, total: Valor, trabajo: Valor | null }} BloquePersonas
 * @typedef {{ uso: 'cualquier-uso' | 'para-trabajar', mujeres: Valor, hombres: Valor }} Par
 * @typedef {{ clave: 'genero', indicador: Indicador, pares: Par[] }} BloqueGenero
 * @typedef {{ clave: 'trabajo', indicador: Indicador, noManual: Valor, manual: Valor, tic: Valor | null }} BloqueTrabajo
 * @typedef {{ indicador: Calculado, cifra: CifraCalculada }} Calculada
 * @typedef {{ clave: 'exposicion', indicador: Calculado, alta: Calculada, alguna: Calculada | null }} BloqueExposicion
 * @typedef {BloqueDeSerie | BloquePersonas | BloqueGenero | BloqueTrabajo | BloqueExposicion} Bloque
 */

// ---------- Lo público ----------

/**
 * El código con que un territorio está en las fronteras del globo: el ISO 3166-1 alfa-3 de un país; el suyo propio
 * para lo demás (ES51 para Cataluña; un agregado, como la UE, no tiene contorno).
 * @param {Territorio} territorio @returns {string}
 */
export function codigoEnElMapa({ codigo, iso3 }) {
  return iso3 ?? codigo;
}

/**
 * El id del indicador con la medida nacional del uso de la IA en las empresas de un país.
 * @param {string} iso3 @returns {string}
 */
export function idNacional(iso3) {
  return `empresas-ia-nacional-${iso3.toLowerCase()}`;
}

/**
 * El id del indicador con la medida nacional del uso de la IA por las personas de un país.
 * @param {string} iso3 @returns {string}
 */
export function idNacionalDePersonas(iso3) {
  return `personas-ia-nacional-${iso3.toLowerCase()}`;
}

/**
 * Lo que un bloque lee de un país: el indicador si es medido, y la cifra más reciente de un indicador medido.
 * @typedef {{ datos: DatosGlobales, territorio: Territorio, medido: (id: string) => Indicador | null,
 *   ultimo: (id: string) => Valor | null }} Lector
 */

/** @param {Lector} lector @returns {Bloque[]} */
function deEmpresas({ datos, territorio, medido }) {
  const indicador = medido(IA.empresas);
  const serie = serieDe(datos, territorio.codigo, IA.empresas);
  return indicador && serie.length > 0 ? [{ clave: 'empresas', indicador, serie }] : [];
}

/** @param {Lector} lector @returns {Bloque[]} */
function dePersonas({ medido, ultimo }) {
  const [indicador, total] = [medido(IA.personas), ultimo(IA.personas)];
  return indicador && total ? [{ clave: 'personas', indicador, total, trabajo: ultimo(IA.personasTrabajo) }] : [];
}

/** @param {Lector} lector @returns {Bloque[]} */
function deGenero({ medido, ultimo }) {
  const pares = /** @type {const} */ ([
    ['cualquier-uso', IA.mujeres, IA.hombres],
    ['para-trabajar', IA.mujeresTrabajo, IA.hombresTrabajo],
  ]).flatMap(([uso, deMujeres, deHombres]) => {
    const [mujeres, hombres] = [ultimo(deMujeres), ultimo(deHombres)];
    return mujeres && hombres ? [{ uso, mujeres, hombres }] : [];
  });
  const indicador = medido(IA.mujeres) ?? medido(IA.mujeresTrabajo);
  return indicador && pares.length > 0 ? [{ clave: 'genero', indicador, pares }] : [];
}

/** @param {Lector} lector @returns {Bloque[]} */
function deTrabajo({ medido, ultimo }) {
  const [indicador, noManual, manual] = [medido(IA.noManual), ultimo(IA.noManual), ultimo(IA.manual)];
  return indicador && noManual && manual
    ? [{ clave: 'trabajo', indicador, noManual, manual, tic: ultimo(IA.tic) }]
    : [];
}

/**
 * La cifra calculada de un indicador en un país, por su ISO 3166-1 alfa-3, o null.
 * @param {DatosGlobales} datos @param {string} id @param {string | null} iso3 @returns {Calculada | null}
 */
function calculada({ calculados }, id, iso3) {
  const indicador = calculados.find((uno) => uno.id === id);
  const cifra = indicador?.valores.find(({ territorio }) => territorio === iso3);
  return indicador && cifra ? { indicador, cifra } : null;
}

/** @param {Lector} lector @returns {Bloque[]} */
function deExposicion({ datos, territorio }) {
  const alta = calculada(datos, EXPOSICION.alta, territorio.iso3);
  return alta
    ? [
        {
          clave: 'exposicion',
          indicador: alta.indicador,
          alta,
          alguna: calculada(datos, EXPOSICION.alguna, territorio.iso3),
        },
      ]
    : [];
}

/**
 * Una medida nacional (la de las empresas o la de las personas): sale si el país tiene el indicador medido con su id
 * (por su ISO 3166-1 alfa-3) y alguna cifra. Cualquier país del archivo con ese indicador la tiene: no hay lista.
 * @param {'nacional' | 'nacional-personas'} clave @param {(iso3: string) => string} idDe
 */
function deMedidaNacional(clave, idDe) {
  return /** @param {Lector} lector @returns {Bloque[]} */ ({ datos, territorio, medido }) => {
    const indicador = territorio.iso3 ? medido(idDe(territorio.iso3)) : null;
    const serie = indicador ? serieDe(datos, territorio.codigo, indicador.id) : [];
    return indicador && serie.length > 0 ? [{ clave, indicador, serie }] : [];
  };
}
const deNacional = deMedidaNacional('nacional', idNacional);
const deNacionalDePersonas = deMedidaNacional('nacional-personas', idNacionalDePersonas);

/**
 * Los bloques de «La IA en {país}», en su orden: empresas, personas, mujeres y hombres, tipo de trabajo, las medidas
 * nacionales (empresas y personas, cada una en su tarjeta) y, al final, la exposición calculada. Los bloques medidos
 * exigen su indicador de naturaleza «medido» y sus cifras principales; las complementarias pueden faltar. La
 * exposición exige la cifra calculada de alta exposición del país (o sus cotas): nada se estima ni se rellena.
 * @param {DatosGlobales} datos @param {Territorio} territorio @returns {Bloque[]}
 */
export function bloquesDeIa(datos, territorio) {
  /** @param {string} id */
  const medido = (id) => datos.indicadores.find((uno) => uno.id === id && uno.naturaleza === 'medido') ?? null;
  /** La cifra más reciente (la primera de la serie en el archivo). @param {string} id */
  const ultimo = (id) => (medido(id) ? (territorio.valores.find((uno) => uno.indicador === id) ?? null) : null);
  const lector = { datos, territorio, medido, ultimo };
  return [deEmpresas, dePersonas, deGenero, deTrabajo, deNacional, deNacionalDePersonas, deExposicion].flatMap(
    (bloque) => bloque(lector),
  );
}

/**
 * Los territorios que salen en «El mundo» (en la lista y con su marca en el globo): los países y las regiones (Cataluña)
 * que tienen algún dato oficial de la IA, es decir, algún bloque de «La IA en {territorio}». Cataluña sale con lo que
 * mide con la misma definición que los países (las empresas que usan IA, de Eurostat); lo demás, que el archivo solo
 * trae con otra base o no trae, no sale en su ficha (ficha.js lo dice). Un país con exposición calculada que no está
 * entre los territorios (la OIT no publica su empleo) entra con su código y el nombre de su cifra, sin más valores. La
 * UE no sale: no tiene contorno y tiene su página.
 * @param {DatosGlobales} datos @returns {Territorio[]}
 */
export function paisesConIa(datos) {
  const conIa = datos.territorios.filter(
    (territorio) =>
      (territorio.tipo === 'pais' || territorio.tipo === 'region') && bloquesDeIa(datos, territorio).length > 0,
  );
  const yaEstan = new Set(datos.territorios.map(({ iso3 }) => iso3));
  /** @type {Map<string, Territorio>} */
  const soloCalculados = new Map();
  for (const { territorio: iso3, nombre } of datos.calculados.find(({ id }) => id === EXPOSICION.alta)?.valores ?? []) {
    if (!yaEstan.has(iso3)) {
      soloCalculados.set(iso3, Object.freeze({ codigo: iso3, iso3, tipo: 'pais', nombre, valores: Object.freeze([]) }));
    }
  }
  return [...conIa, ...soloCalculados.values()];
}

/**
 * Los países de la lista, de `paisesConIa`, por orden alfabético en el idioma de la página.
 * @param {readonly Territorio[]} paises @param {Idioma} idioma @returns {Territorio[]}
 */
export function paisesDeLaLista(paises, idioma) {
  const alfabetico = new Intl.Collator(idioma, { sensitivity: 'base' });
  return [...paises].sort((a, b) => alfabetico.compare(a.nombre[idioma], b.nombre[idioma]));
}
