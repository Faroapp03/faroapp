// Lo que cuenta cada capítulo de «Datos globales · Cataluña y países» (datos-globales.html), sin pantalla: los
// territorios, los indicadores de cada capítulo, la escala de cada tipo de dato y qué titular sostienen las cifras.
// Las reglas son las que la página explica en «Cómo comparamos»:
// - Cataluña se compara con España (que la incluye), Alemania, Francia e Italia, y con la media de la UE-27 como
//   referencia, nunca como un país más del ranking.
// - Las personas se cuentan sobre quienes usan internet en todos los territorios (Eurostat, unidad PC_IND_IU3; el
//   Idescat, para Cataluña): la misma base, edad y año en cada comparación.
// - Lo que la fuente marca como no comparable (otra definición, ruptura de serie) no se muestra ni entra en ningún
//   cálculo: las series de empresas empiezan en 2023.
// - Sin cifra oficial no se pone ninguna: no se estima.
// - Un titular afirma lo que se ve, solo si las cifras del archivo lo sostienen (variantesDelTitular): un primer
//   puesto exige al menos un punto de ventaja sobre el segundo. Así una edición nueva de los datos no deja un titular
//   falso.
// Lógica pura: recibe los datos ya comprobados (datos.js) y no toca el DOM.

import { resta, veces } from './cifras.js';
import { serieDe, territorioPorCodigo, valorDe } from './datos.js';

/**
 * @import { DatosGlobales, Valor } from './datos.js'
 * @typedef {'mas' | 'parecido' | 'menos'} Comparacion
 */

/** Cataluña, el territorio de Faro y del recorrido. */
export const CODIGO_PROPIO = 'ES51';
/** España, el país de Cataluña: su cifra la incluye. */
export const CODIGO_DE_ESPANA = 'ESP';
/** Francia no publica el cruce por ocupación manual y no manual (ni en Eurostat ni en el INSEE): lo dice una nota. */
export const CODIGO_DE_FRANCIA = 'FRA';
/** La media de la UE-27 (EU27_2020): la referencia de cada comparación. */
export const CODIGO_DE_LA_UE = 'EU27_2020';
/** Los territorios del dossier, en el orden de las tablas: Cataluña, España y los otros tres por orden alfabético. */
export const ORDEN_DE_LOS_TERRITORIOS = Object.freeze([
  CODIGO_PROPIO,
  CODIGO_DE_ESPANA,
  'DEU',
  CODIGO_DE_FRANCIA,
  'ITA',
]);

/**
 * Los capítulos de la página «Cataluña», en su orden: de su posición sale su número («01», «02»…), el mismo del índice
 * de preguntas y de la paginación. Método y Fuentes no son capítulos: van escritos en datos-globales.html, debajo de la
 * paginación, como desplegables sin número.
 */
export const CAPITULOS = Object.freeze([
  'empresas',
  'personas',
  'genero',
  'ocupacion',
  'formacion',
  'opinion',
  'dentro',
  'cuadro',
]);

/**
 * El número de un capítulo, con dos cifras, por su posición en CAPITULOS.
 * @param {string} id El id del capítulo.
 * @returns {string} Su número («01», «02»…).
 * @throws {RangeError} Si el id no es un capítulo del dossier.
 */
export function numeroDelCapitulo(id) {
  const posicion = CAPITULOS.indexOf(id);
  if (posicion < 0) {
    throw new RangeError(`«${id}» no es un capítulo del dossier`);
  }
  return String(posicion + 1).padStart(2, '0');
}

/**
 * Los indicadores del dossier, por su id en datos-globales.json. Los de personas son siempre los de base «usuarios de
 * internet». La ocupación de Cataluña, del Idescat, va en los mismos indicadores que la de Eurostat: es la misma
 * división en grandes grupos manuales (6 a 9) y no manuales (0 a 5).
 */
export const INDICADORES = Object.freeze({
  empresas: 'empresas-ia',
  personas: 'personas-ia-generativa-usuarios-internet',
  personasTrabajo: 'personas-ia-generativa-trabajo-usuarios-internet',
  mujeres: 'mujeres-ia-generativa-usuarios-internet',
  hombres: 'hombres-ia-generativa-usuarios-internet',
  mujeresTrabajo: 'mujeres-ia-generativa-trabajo-usuarios-internet',
  hombresTrabajo: 'hombres-ia-generativa-trabajo-usuarios-internet',
  manual: 'ia-generativa-trabajo-manual-usuarios-internet',
  noManual: 'ia-generativa-trabajo-no-manual-usuarios-internet',
  tic: 'ia-generativa-trabajo-tic-usuarios-internet',
  noSabe: 'ia-generativa-no-sabe-usarla',
  formacion: 'formacion-adultos',
  cualificado: 'establecimientos-ia-personal-cualificado',
  directivos: 'establecimientos-ia-directivos',
  pocoCualificado: 'establecimientos-ia-personal-poco-cualificado',
  competencias: 'establecimientos-competencias-digitales',
});

/**
 * La ventaja mínima, en puntos, para decir que una cifra es mayor que otra («más que», «el más alto»): con la muestra
 * de una región, una diferencia menor puede no ser real.
 */
const MARGEN_MINIMO = 1;
/** Las notas de un valor que dicen que no es comparable con el resto de su serie: no se muestra. */
const NO_COMPARABLES = Object.freeze(['definicion_anterior', 'ruptura_de_serie']);

/**
 * La escala de cada tipo de dato, la misma en toda la página (y en los paneles hermanos): personas, de 0 a 50;
 * empresas, de 0 a 30; formación y establecimientos, de 0 a 20; opinión, de 0 a 100. Si una edición nueva trae una
 * cifra mayor, el eje crece de paso en paso, sin tramos vacíos.
 */
export const ESCALAS = Object.freeze({
  personas: Object.freeze({ maximo: 50, paso: 10 }),
  empresas: Object.freeze({ maximo: 30, paso: 10 }),
  formacion: Object.freeze({ maximo: 20, paso: 5 }),
  establecimientos: Object.freeze({ maximo: 20, paso: 5 }),
  opinion: Object.freeze({ maximo: 100, paso: 20 }),
  diferencia: Object.freeze({ maximo: 10, paso: 5 }),
});

/**
 * La escala de un tipo de dato, crecida de paso en paso hasta cubrir la mayor cifra, sin tramos vacíos.
 * @param {{ maximo: number, paso: number }} base @param {number[]} cifras @returns {{ maximo: number, paso: number }}
 */
export function escalaPara({ maximo, paso }, cifras) {
  const mayor = Math.max(0, ...cifras);
  return { maximo: Math.max(maximo, Math.ceil(mayor / paso) * paso), paso };
}

/** «Casi una de cada cuatro» (empresas) y «casi la mitad» (personas): de 22,5 a 25 y de 45 a 50 de cada 100. */
const CASI_UNA_DE_CADA_CUATRO = Object.freeze({ desde: 22.5, hasta: 25 });
const CASI_LA_MITAD = Object.freeze({ desde: 45, hasta: 50 });
/**
 * El doble: cuántas veces una cifra es otra para decir «más del doble» (empresas) o «mucho más» (las ocupaciones no
 * manuales frente a las manuales).
 */
export const DOBLE = 2;

/**
 * La cifra comparable de un indicador en un territorio en un año dado, o null si no la hay (o la fuente la marca como
 * no comparable).
 * @param {DatosGlobales} datos @param {string} codigo @param {string} id @param {number} anio @returns {number | null}
 */
export function cifraDelAnio(datos, codigo, id, anio) {
  const territorio = territorioPorCodigo(datos, codigo);
  const valor = territorio?.valores.find((candidato) => candidato.indicador === id && candidato.anio === anio);
  return valor && esComparable(valor) ? valor.valor : null;
}

/**
 * El año de una comparación: el de la cifra más reciente de Cataluña o, sin ella, el más reciente de los demás.
 * @param {DatosGlobales} datos @param {string} id @returns {number | null}
 */
export function anioDeLaComparacion(datos, id) {
  const propio = valorDe(datos, CODIGO_PROPIO, id);
  if (propio) {
    return propio.anio;
  }
  const anios = [...ORDEN_DE_LOS_TERRITORIOS, CODIGO_DE_LA_UE].flatMap((codigo) => {
    const valor = valorDe(datos, codigo, id);
    return valor ? [valor.anio] : [];
  });
  return anios.length ? Math.max(...anios) : null;
}

/**
 * La cifra más reciente de un indicador para su periodo, o null si falta; no acredita comparabilidad.
 * @param {DatosGlobales} datos @param {string} codigo @param {string} id @returns {number | null}
 */
export function cifraDe(datos, codigo, id) {
  return valorDe(datos, codigo, id)?.valor ?? null;
}

/**
 * El año de un indicador en el dossier: el más reciente de los territorios. null si nadie lo tiene.
 * @param {DatosGlobales} datos @param {readonly string[]} ids @returns {number | null}
 */
export function anioDe(datos, ids) {
  const anios = ORDEN_DE_LOS_TERRITORIOS.flatMap((codigo) =>
    ids.flatMap((id) => {
      const valor = valorDe(datos, codigo, id);
      return valor ? [valor.anio] : [];
    }),
  );
  return anios.length ? Math.max(...anios) : null;
}

/** Si una cifra es comparable con el resto de su serie (la fuente no la marca como otra definición o ruptura).
 * @param {{ nota: string | null }} valor @returns {boolean} */
export function esComparable({ nota }) {
  return nota === null || !NO_COMPARABLES.includes(nota);
}

/**
 * La serie comparable de un indicador en un territorio, del año más antiguo al más reciente: sin las cifras que la
 * fuente marca como no comparables.
 * @param {DatosGlobales} datos @param {string} codigo @param {string} id @returns {Valor[]}
 */
export function serieComparable(datos, codigo, id) {
  return serieDe(datos, codigo, id).filter(esComparable);
}

/**
 * Los años de una serie con una cifra no comparable, que no se muestra.
 * @param {DatosGlobales} datos @param {string} codigo @param {string} id @returns {number[]}
 */
export function aniosNoComparables(datos, codigo, id) {
  return serieDe(datos, codigo, id)
    .filter((valor) => !esComparable(valor))
    .map(({ anio }) => anio);
}

/**
 * Cómo es una cifra frente a otra, con el margen mínimo: «más» o «menos» solo con un punto de diferencia o más.
 * @param {number} cifra @param {number} otra @returns {Comparacion}
 */
export function comparar(cifra, otra) {
  const diferencia = resta(cifra, otra);
  if (diferencia >= MARGEN_MINIMO) {
    return 'mas';
  }
  return diferencia <= -MARGEN_MINIMO ? 'menos' : 'parecido';
}

/**
 * Dónde queda Cataluña entre los territorios del dossier en un indicador: los que la superan en un punto o más (de
 * mayor a menor), si ella supera a todos en un punto o más y quién va segundo. null sin la cifra de Cataluña o sin
 * ninguna otra. Un puesto exige los cinco territorios en el mismo año y sin notas excluidas.
 * @param {DatosGlobales} datos @param {string} id
 * @returns {{ propia: number, delante: { codigo: string, cifra: number }[], primera: boolean,
 *   segundo: { codigo: string, cifra: number } } | null}
 */
export function posicionDeCataluna(datos, id) {
  const anio = anioDeLaComparacion(datos, id);
  if (anio === null) {
    return null;
  }
  const propia = cifraDelAnio(datos, CODIGO_PROPIO, id, anio);
  const otras = ORDEN_DE_LOS_TERRITORIOS.filter((codigo) => codigo !== CODIGO_PROPIO)
    .flatMap((codigo) => {
      const cifra = cifraDelAnio(datos, codigo, id, anio);
      return cifra === null ? [] : [{ codigo, cifra }];
    })
    .sort((a, b) => b.cifra - a.cifra);
  const [segundo] = otras;
  if (propia === null || !segundo || otras.length !== ORDEN_DE_LOS_TERRITORIOS.length - 1) {
    return null;
  }
  return {
    propia,
    delante: otras.filter(({ cifra }) => comparar(cifra, propia) === 'mas'),
    primera: otras.every(({ cifra }) => comparar(propia, cifra) === 'mas'),
    segundo,
  };
}

/**
 * Si una cifra está en [desde, hasta): el tramo que sostiene un titular («casi la mitad»).
 * @param {number | null} cifra La cifra, o null si falta (entonces no está en ningún tramo).
 * @param {{ desde: number, hasta: number }} tramo
 * @returns {boolean}
 */
export function entre(cifra, { desde, hasta }) {
  return cifra !== null && cifra >= desde && cifra < hasta;
}

/**
 * Si la serie comparable de las empresas catalanas se ha más que duplicado: dos años comparables o más, y el último
 * más del doble que el primero (con las cifras sin redondear).
 * @param {DatosGlobales} datos @returns {boolean}
 */
export function empresasMasDelDoble(datos) {
  const serie = serieComparable(datos, CODIGO_PROPIO, INDICADORES.empresas);
  const primera = serie[0];
  const ultima = serie.at(-1);
  return !!primera && !!ultima && primera !== ultima && (veces(ultima.valor, primera.valor) ?? 0) > DOBLE;
}

/** La variante del titular de 01 · Empresas. @param {DatosGlobales} datos @returns {string} */
function varianteDeEmpresas(datos) {
  const propia = cifraDe(datos, CODIGO_PROPIO, INDICADORES.empresas);
  if (propia === null) {
    return 'neutro';
  }
  const base = entre(propia, CASI_UNA_DE_CADA_CUATRO) ? 'cuarto' : 'cifra';
  return empresasMasDelDoble(datos) ? `${base}-doble` : base;
}

/** La variante de una pareja de Cataluña: cuál de las dos es mayor, con el margen mínimo.
 * @param {DatosGlobales} datos @param {[string, string]} ids @param {[string, string, string]} nombres las variantes
 *   «b mayor», «a mayor» y «parecido» @param {string} [referencia] Indicador que fija el año del gráfico.
 * @returns {string} */
function varianteDePareja(datos, [idA, idB], [bMayor, aMayor, parecido], referencia = idB) {
  const anio = anioDeLaComparacion(datos, referencia);
  if (anio === null) {
    return 'neutro';
  }
  const a = cifraDelAnio(datos, CODIGO_PROPIO, idA, anio);
  const b = cifraDelAnio(datos, CODIGO_PROPIO, idB, anio);
  if (a === null || b === null) {
    return 'neutro';
  }
  const comparacion = comparar(b, a);
  if (comparacion === 'mas') {
    return bMayor;
  }
  return comparacion === 'menos' ? aMayor : parecido;
}

/** La variante del titular de 04 · Tipo de trabajo. @param {DatosGlobales} datos @returns {string} */
function varianteDeOcupacion(datos) {
  const anio = anioDeLaComparacion(datos, INDICADORES.noManual);
  if (anio === null) {
    return 'neutro';
  }
  const manual = cifraDelAnio(datos, CODIGO_PROPIO, INDICADORES.manual, anio);
  const noManual = cifraDelAnio(datos, CODIGO_PROPIO, INDICADORES.noManual, anio);
  if (manual !== null && noManual !== null && (veces(noManual, manual) ?? 0) >= DOBLE) {
    return 'mucho-mas';
  }
  return varianteDePareja(datos, [INDICADORES.manual, INDICADORES.noManual], ['mas', 'menos', 'parecido']);
}

/** La variante del titular de 05 · Formación. @param {DatosGlobales} datos @returns {string} */
function varianteDeFormacion(datos) {
  const posicion = posicionDeCataluna(datos, INDICADORES.formacion);
  if (posicion === null) {
    return cifraDe(datos, CODIGO_PROPIO, INDICADORES.formacion) === null ? 'neutro' : 'cifra';
  }
  return posicion.primera ? 'primera' : 'cifra';
}

/**
 * La variante del titular de cada capítulo que sostienen las cifras de Cataluña; «neutro» si falta su cifra.
 * - empresas: «cuarto» (casi 1 de cada 4) o «cifra», con «-doble» si se ha más que duplicado desde el primer año
 *   comparable;
 * - personas: «mitad» (casi la mitad) o «cifra»;
 * - genero: «hombres», «mujeres» (quién la usa más, por un punto o más) o «parecido»;
 * - ocupacion: «mucho-mas» (el doble o más en los no manuales), «mas», «menos» o «parecido»;
 * - formacion: «primera» (un punto o más por encima de todos) o «cifra»;
 * - dentro: «cualificado» o «poco» (quién la usa en más establecimientos, por un punto o más) o «parecido».
 * @param {DatosGlobales} datos
 * @returns {Record<'empresas' | 'personas' | 'genero' | 'ocupacion' | 'formacion' | 'dentro', string>}
 */
export function variantesDelTitular(datos) {
  const personas = cifraDe(datos, CODIGO_PROPIO, INDICADORES.personas);
  const dentro = varianteDePareja(
    datos,
    [INDICADORES.pocoCualificado, INDICADORES.cualificado],
    ['cualificado', 'poco', 'parecido'],
  );
  return {
    empresas: varianteDeEmpresas(datos),
    personas: personas === null ? 'neutro' : (entre(personas, CASI_LA_MITAD) && 'mitad') || 'cifra',
    genero: varianteDePareja(
      datos,
      [INDICADORES.mujeres, INDICADORES.hombres],
      ['hombres', 'mujeres', 'parecido'],
      INDICADORES.mujeres,
    ),
    ocupacion: varianteDeOcupacion(datos),
    formacion: varianteDeFormacion(datos),
    dentro,
  };
}
