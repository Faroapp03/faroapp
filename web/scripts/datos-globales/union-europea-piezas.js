// Las piezas de «Datos globales · Unión Europea» (datos-globales-ue.html): la cifra de la UE-27 (EU27_2020) en un
// indicador, las barras de sus grupos (el total en su color, el naranja de la UE, y los grupos en gris), su línea de
// evolución (protagonista: continua y con su cifra en cada año), la ficha técnica y el capítulo numerado 01 a 10, con
// su pregunta. La UE nunca se pone al lado de los países: su cifra incluye a España, Alemania, Francia e Italia. Las
// personas se cuentan sobre toda la población de 16 a 74 años (PC_IND), y la página lo dice.

import { traducible } from '../textos.js';
import { aniosNoComparables, cifraDe, comparar, entre, escalaPara, serieComparable } from './capitulos.js';
import { numeroEscrito, porcentajeEscrito } from './cifras.js';
import { conPuntoYComa, entero } from './comparacion.js';
import { valorDe } from './datos.js';
import { barras, grafico, lineas } from './dibujo.js';
import { fichaTecnica } from './ficha.js';
import { capitulo } from './seccion.js';

/**
 * @import { DatosGlobales } from './datos.js'
 * @import { FilaDeBarra } from './dibujo.js'
 * @import { Apartado } from './ficha.js'
 * @import { Parte, Valores } from '../textos.js'
 * @import { Frase } from './seccion.js'
 * @typedef {[id: string, clave: string, total?: boolean]} Fila una fila de un gráfico: indicador, nombre y si es el
 *   total (va en el color de la UE)
 * @typedef {{ id: string, orden: number, titular: Parte, entradilla: Parte[], figuras: HTMLElement[],
 *   lectura: Frase[], ficha: HTMLDetailsElement }} CapituloUe un capítulo de la UE
 */

/** El código de la UE-27 en el archivo. */
export const CODIGO_DE_LA_UE = 'EU27_2020';
/** Miles en un millón: las cifras de personas del archivo vienen en miles. */
const MILES_POR_MILLON = 1000;
/** La mitad, en porcentaje: por encima, «más de la mitad». */
export const MITAD_PCT = 50;

export { comparar, entero, entre };

/**
 * La cifra más reciente de la UE en un indicador, o null.
 * @param {DatosGlobales} datos @param {string} id @returns {number | null}
 */
export function ue(datos, id) {
  return cifraDe(datos, CODIGO_DE_LA_UE, id);
}

/**
 * El año de la cifra más reciente de la UE en un indicador, o null.
 * @param {DatosGlobales} datos @param {string} id @returns {number | null}
 */
export function anioUe(datos, id) {
  return valorDe(datos, CODIGO_DE_LA_UE, id)?.anio ?? null;
}

/** Un porcentaje con una decimal («24,0 %»). @param {number} cifra @returns {string} */
export function pct(cifra) {
  return porcentajeEscrito(cifra);
}

/**
 * Miles de personas en millones, con una decimal: 10 450,8 → «10,5».
 * @param {number} miles @param {number} [decimales] @returns {string}
 */
export function millones(miles, decimales = 1) {
  return numeroEscrito(miles / MILES_POR_MILLON, decimales);
}

/** «hallazgo» si se cumple; si no, «neutro». @param {boolean} cumple @returns {'hallazgo' | 'neutro'} */
export function variante(cumple) {
  return cumple ? 'hallazgo' : 'neutro';
}

/**
 * Las cifras de la UE de dos indicadores, o null si falta alguna.
 * @param {DatosGlobales} datos @param {string} idA @param {string} idB @returns {{ a: number, b: number } | null}
 */
export function dos(datos, idA, idB) {
  const a = ue(datos, idA);
  const b = ue(datos, idB);
  return a === null || b === null ? null : { a, b };
}

/**
 * Las filas de unas barras de la UE del año de la primera fila con cifra; las de otro año se quitan, para que el año
 * del subtítulo sea el de cada barra. El total va en el color de la UE; los grupos, en gris. Con `ordenar`, los grupos
 * van de mayor a menor (el total, siempre arriba); sin él, en su orden natural (edades, tamaños).
 * @param {DatosGlobales} datos @param {readonly Fila[]} filas @param {boolean} ordenar
 * @returns {{ anio: number | null, filas: FilaDeBarra[] }}
 */
export function filasUe(datos, filas, ordenar) {
  const conCifra = filas.filter(([id]) => anioUe(datos, id) !== null);
  const primera = conCifra[0];
  const anio = primera ? anioUe(datos, primera[0]) : null;
  const delAnio = conCifra.flatMap(([id, clave, total = false]) => {
    const valor = ue(datos, id);
    return anioUe(datos, id) === anio && valor !== null
      ? [
          {
            papel: /** @type {'ue' | 'resto'} */ (total ? 'ue' : 'resto'),
            nombre: traducible(clave),
            detalle: null,
            valor,
            total,
          },
        ]
      : [];
  });
  const totales = delAnio.filter(({ total }) => total);
  const grupos = delAnio.filter(({ total }) => !total);
  const ordenados = ordenar ? [...grupos].sort((a, b) => b.valor - a.valor) : grupos;
  return { anio, filas: [...totales, ...ordenados].map(({ total: _total, ...fila }) => fila) };
}

/**
 * Un panel de barras de la UE: su dibujo y su alternativa en texto.
 * @param {FilaDeBarra[]} filas @param {{ maximo: number, paso: number }} escala
 * @param {{ opinion?: boolean, decimales?: number }} [opciones]
 */
export function panelUe(filas, escala, { opinion = false, decimales = 1 } = {}) {
  return {
    nodo: grafico(barras({ filas, escala, referencia: null, opinion, decimales })).nodo,
    alternativa: filas.map(({ nombre, valor }) =>
      traducible('datos-globales.alternativa.cifra', { territorio: nombre, cifra: numeroEscrito(valor, decimales) }),
    ),
  };
}

/**
 * La escala común de unos paneles hermanos: la de su tipo de dato, crecida hasta cubrir la mayor cifra de todos.
 * @param {{ maximo: number, paso: number }} base @param {FilaDeBarra[][]} paneles
 */
export function escalaComun(base, paneles) {
  return escalaPara(
    base,
    paneles.flat().map(({ valor }) => valor),
  );
}

/**
 * La línea de evolución de un indicador de la UE, sola y protagonista (continua, con su cifra en cada año), con las
 * cifras comparables; con menos de dos años, nada.
 * @param {DatosGlobales} datos @param {string} id @param {{ maximo: number, paso: number }} base
 * @returns {{ nodo: HTMLElement, alternativa: Parte[], desde: number, hasta: number,
 *   primera: { anio: number, valor: number }, ultima: { anio: number, valor: number } } | null}
 */
export function lineaUe(datos, id, base) {
  const puntos = serieComparable(datos, CODIGO_DE_LA_UE, id).map(({ anio, valor }) => ({ anio, valor }));
  const primera = puntos[0];
  const ultima = puntos.at(-1);
  if (!primera || !ultima || puntos.length < 2) {
    return null;
  }
  const escala = escalaPara(
    base,
    puntos.map(({ valor }) => valor),
  );
  const serie = {
    papel: /** @type {const} */ ('ue'),
    nombre: traducible('datos-globales.nombre.ue'),
    puntos,
    ocultos: aniosNoComparables(datos, CODIGO_DE_LA_UE, id),
    protagonista: true,
  };
  return {
    nodo: grafico(lineas({ series: [serie], desde: primera.anio, hasta: ultima.anio, escala })).nodo,
    alternativa: [
      traducible('datos-globales.alternativa.cifra', {
        territorio: traducible('datos-globales.nombre.ue'),
        cifra: puntos.map(({ anio, valor }) => `${anio}, ${numeroEscrito(valor)}`).join('; '),
      }),
    ],
    desde: primera.anio,
    hasta: ultima.anio,
    primera,
    ultima,
  };
}

/**
 * Lo que no se muestra de una serie de la UE: los años que la fuente marca como no comparables.
 * @param {DatosGlobales} datos @param {string} id @returns {Parte[]}
 */
export function noComparablesUe(datos, id) {
  return aniosNoComparables(datos, CODIGO_DE_LA_UE, id).map((anio) =>
    traducible('datos-globales.ue.no-comparable', { anio }),
  );
}

/**
 * El apartado «Datos que no se muestran» de una ficha de la UE, o ninguno si la serie no oculta nada.
 * @param {Parte[]} fuera @returns {[Apartado, Parte][]}
 */
export function apartadoNoComparables(fuera) {
  return fuera.length
    ? [['no-se-muestran', traducible('datos-globales.no-comparable.ficha', { lista: conPuntoYComa(fuera) })]]
    : [];
}

/**
 * La ficha técnica de un capítulo de la UE: cada apartado con su texto (`datos-globales.ue.<capitulo>.ficha.<apartado>`)
 * o, si ya viene hecho, tal cual; después, el margen de error y el tipo.
 * @param {string} capitulo @param {(Apartado | [Apartado, Parte])[]} apartados
 * @param {{ valores: Valores, tipo: HTMLElement, margen?: string }} opciones `margen`, la clave del margen de error
 * @returns {HTMLDetailsElement}
 */
export function fichaUe(capitulo, apartados, { valores, tipo, margen = 'datos-globales.ue.margen' }) {
  return fichaTecnica([
    ...apartados.map((apartado) =>
      Array.isArray(apartado)
        ? apartado
        : /** @satisfies {[Apartado, Parte]} */ ([
            apartado,
            traducible(`datos-globales.ue.${capitulo}.ficha.${apartado}`, valores),
          ]),
    ),
    ['margen', traducible(margen)],
    ['tipo', tipo],
  ]);
}

/**
 * Un capítulo de la página «Unión Europea», numerado 01 a 10, con su pregunta, su tema y su contenido; sin figuras,
 * nada. @param {CapituloUe} capituloUe @returns {HTMLElement[]}
 */
export function capituloUe({ id, orden, titular, entradilla, figuras, lectura, ficha }) {
  if (!figuras.length) {
    return [];
  }
  const seccion = capitulo({
    id: `ue-${id}`,
    numero: String(orden).padStart(2, '0'),
    tema: traducible(`datos-globales.ue.${id}.tema`),
    pregunta: traducible(`datos-globales.ue.${id}.pregunta`),
    titular,
    entradilla,
    figuras,
    lectura,
    ficha,
  });
  seccion.classList.add('dg-capitulo--ue');
  return [seccion];
}
