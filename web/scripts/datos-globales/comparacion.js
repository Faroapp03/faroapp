// Las piezas de las comparaciones de «Datos globales · Cataluña y países» (datos-globales.html): el papel y el nombre de
// cada territorio en un gráfico («España (con Cataluña)», «UE-27 (media)»), las filas de las barras de mayor a menor
// con la media de la UE como referencia, las series de las líneas y de la tabla año a año (solo con las cifras
// comparables), las notas de lo que no se muestra y la alternativa en texto de cada gráfico. Cada comparación usa la
// misma base: el mismo indicador y el mismo año en todos los territorios; un territorio sin esa cifra no se pone, y se
// dice en una nota. Lo usan pintar.js, parejas.js, opinion.js y cuadro.js.

import { conVersiones, IDIOMAS, traducible } from '../textos.js';
import {
  aniosNoComparables,
  CODIGO_DE_ESPANA,
  CODIGO_DE_LA_UE,
  CODIGO_PROPIO,
  cifraDelAnio,
  comparar,
  ORDEN_DE_LOS_TERRITORIOS,
  serieComparable,
} from './capitulos.js';
import { numeroEscrito } from './cifras.js';
import { territorioPorCodigo } from './datos.js';
import { barras, grafico } from './dibujo.js';

export { anioDeLaComparacion, cifraDelAnio } from './capitulos.js';

/**
 * @import { DatosGlobales } from './datos.js'
 * @import { Parte } from '../textos.js'
 * @import { Papel, FilaDeBarra, Serie, FilaAnual } from './dibujo.js'
 * @import { Apartado } from './ficha.js'
 */

/** Todos los territorios de las comparaciones: los cinco del dossier y la media de la UE. */
export const CON_LA_UE = Object.freeze([...ORDEN_DE_LOS_TERRITORIOS, CODIGO_DE_LA_UE]);

/** El papel de un territorio en un gráfico: su color y su peso. @param {string} codigo @returns {Papel} */
export function papelDe(codigo) {
  if (codigo === CODIGO_PROPIO) {
    return 'cat';
  }
  if (codigo === CODIGO_DE_LA_UE) {
    return 'ue';
  }
  return codigo === CODIGO_DE_ESPANA ? 'esp' : 'resto';
}

/**
 * El nombre corto de un territorio, el de los rótulos de los gráficos: el oficial, y «UE-27» para la media de la UE.
 * @param {DatosGlobales} datos @param {string} codigo @returns {Parte}
 */
export function nombreCorto(datos, codigo) {
  if (codigo === CODIGO_DE_LA_UE) {
    return traducible('datos-globales.nombre.ue');
  }
  const territorio = territorioPorCodigo(datos, codigo);
  return territorio ? conVersiones(territorio.nombre) : codigo;
}

/**
 * El nombre de un territorio en los textos y las tablas: «España (con Cataluña)», porque su cifra incluye la de
 * Cataluña, y «UE-27 (media)». @param {DatosGlobales} datos @param {string} codigo @returns {Parte}
 */
export function nombreLargo(datos, codigo) {
  if (codigo === CODIGO_DE_ESPANA) {
    return traducible('datos-globales.nombre.espana');
  }
  if (codigo === CODIGO_DE_LA_UE) {
    return traducible('datos-globales.nombre.ue-media');
  }
  return nombreCorto(datos, codigo);
}

/** La segunda línea del nombre de España en las barras, «(con Cataluña)». @param {string} codigo @returns {Parte | null} */
export function detalleDe(codigo) {
  return codigo === CODIGO_DE_ESPANA ? traducible('datos-globales.nombre.con-cataluna') : null;
}

/** «24»: una cifra de cada 100, sin decimales, para las frases («24 de cada 100»). @param {number} cifra */
export function entero(cifra) {
  return numeroEscrito(cifra, 0);
}

/**
 * Los nombres de varios territorios, unidos como se escribe cada idioma («Alemania y Francia», «Alemanya i França»).
 * @param {DatosGlobales} datos @param {readonly string[]} codigos @returns {Parte}
 */
export function listaDeNombres(datos, codigos) {
  /** @type {Partial<Record<import('../textos.js').Idioma, string>>} */
  const versiones = {};
  for (const idioma of IDIOMAS) {
    const nombres = codigos.map((codigo) => {
      if (codigo === CODIGO_DE_LA_UE) {
        return 'UE-27';
      }
      return territorioPorCodigo(datos, codigo)?.nombre[idioma] ?? codigo;
    });
    versiones[idioma] = new Intl.ListFormat(idioma, { type: 'conjunction' }).format(nombres);
  }
  return conVersiones(versiones);
}

/**
 * Las filas de unas barras de un indicador en un año: los cinco territorios con cifra comparable de ese año, de mayor
 * a menor (`orden`, si se da, fija el de otro panel: los paneles hermanos van en el mismo orden), y los que no la
 * tienen, aparte.
 * @param {DatosGlobales} datos @param {{ id: string, anio: number, orden?: readonly string[] }} barras
 * @returns {{ filas: (FilaDeBarra & { codigo: string })[], sinCifra: string[] }}
 */
export function filasDeBarras(datos, { id, anio, orden }) {
  const conCifra = ORDEN_DE_LOS_TERRITORIOS.flatMap((codigo) => {
    const valor = cifraDelAnio(datos, codigo, id, anio);
    return valor === null ? [] : [{ codigo, valor }];
  });
  const posicion = (/** @type {string} */ codigo) => orden?.indexOf(codigo) ?? -1;
  const ordenadas = orden
    ? [...conCifra].sort((a, b) => posicion(a.codigo) - posicion(b.codigo))
    : [...conCifra].sort((a, b) => b.valor - a.valor);
  return {
    filas: ordenadas.map(({ codigo, valor }) => ({
      codigo,
      papel: papelDe(codigo),
      nombre: nombreCorto(datos, codigo),
      detalle: detalleDe(codigo),
      valor,
    })),
    sinCifra: ORDEN_DE_LOS_TERRITORIOS.filter((codigo) => !conCifra.some((fila) => fila.codigo === codigo)),
  };
}

/**
 * La media de la UE como referencia de unas barras: su cifra del mismo año y su rótulo («Media de la UE: 34,8»).
 * @param {DatosGlobales} datos @param {string} id @param {number} anio
 * @returns {{ valor: number, rotulo: Parte } | null}
 */
export function referenciaDeLaUe(datos, id, anio) {
  const valor = cifraDelAnio(datos, CODIGO_DE_LA_UE, id, anio);
  return valor === null
    ? null
    : { valor, rotulo: traducible('datos-globales.media-ue', { cifra: numeroEscrito(valor) }) };
}

/**
 * La alternativa en texto de unas barras: cada territorio con su cifra y, al final, la media de la UE.
 * @param {DatosGlobales} datos @param {{ codigo: string, valor: number }[]} filas
 * @param {{ valor: number } | null} referencia @param {number} [decimales] @returns {Parte[]}
 */
export function alternativaDeBarras(datos, filas, referencia, decimales = 1) {
  return [
    ...filas.map(({ codigo, valor }) =>
      traducible('datos-globales.alternativa.cifra', {
        territorio: nombreLargo(datos, codigo),
        cifra: numeroEscrito(valor, decimales),
      }),
    ),
    ...(referencia
      ? [traducible('datos-globales.alternativa.media', { cifra: numeroEscrito(referencia.valor, decimales) })]
      : []),
  ];
}

/**
 * Las series de las líneas de un indicador: cada territorio con sus cifras comparables y los años que no lo son
 * (no se dibujan ni se unen por encima), y los años del eje, del primero comparable al último.
 * @param {DatosGlobales} datos @param {string} id
 * @returns {{ series: (Serie & { codigo: string })[], anios: number[] }}
 */
export function seriesDeLineas(datos, id) {
  const series = CON_LA_UE.flatMap((codigo) => {
    const puntos = serieComparable(datos, codigo, id).map(({ anio, valor }) => ({ anio, valor }));
    return puntos.length
      ? [
          {
            codigo,
            papel: papelDe(codigo),
            nombre: nombreCorto(datos, codigo),
            puntos,
            ocultos: aniosNoComparables(datos, codigo, id),
            protagonista: false,
          },
        ]
      : [];
  });
  const anios = [...new Set(series.flatMap(({ puntos }) => puntos.map(({ anio }) => anio)))].sort((a, b) => a - b);
  return { series, anios };
}

/**
 * Las filas de la tabla año a año: los seis territorios en el orden de las tablas, cada uno con sus cifras comparables.
 * @param {DatosGlobales} datos @param {(Serie & { codigo: string })[]} series @returns {FilaAnual[]}
 */
export function filasAnuales(datos, series) {
  return series.map(({ codigo, papel, puntos }) => ({
    papel,
    nombre: nombreLargo(datos, codigo),
    valores: new Map(puntos.map(({ anio, valor }) => [anio, valor])),
  }));
}

/**
 * La alternativa en texto de unas líneas: cada territorio con su cifra de cada año.
 * @param {DatosGlobales} datos @param {(Serie & { codigo: string })[]} series @returns {Parte[]}
 */
export function alternativaDeLineas(datos, series) {
  return series.map(({ codigo, puntos }) =>
    traducible('datos-globales.alternativa.cifra', {
      territorio: nombreLargo(datos, codigo),
      cifra: puntos.map(({ anio, valor }) => `${anio}, ${numeroEscrito(valor)}`).join('; '),
    }),
  );
}

/**
 * Lo que no se muestra de una serie, agrupado por año: «2021, en todos los territorios» o «2023, en Francia». Solo los
 * años desde `desde` (los anteriores van en la ficha) si se da.
 * @param {DatosGlobales} datos @param {string} id @param {number} [desde] @returns {Parte[]}
 */
export function noComparables(datos, id, desde = Number.NEGATIVE_INFINITY) {
  const conCifraEn = (/** @type {number} */ anio) =>
    CON_LA_UE.filter((codigo) =>
      territorioPorCodigo(datos, codigo)?.valores.some((v) => v.indicador === id && v.anio === anio),
    );
  /** @type {Map<number, string[]>} */
  const porAnio = new Map();
  for (const codigo of CON_LA_UE) {
    for (const anio of aniosNoComparables(datos, codigo, id).filter((candidato) => candidato >= desde)) {
      porAnio.set(anio, [...(porAnio.get(anio) ?? []), codigo]);
    }
  }
  return [...porAnio]
    .sort(([a], [b]) => a - b)
    .map(([anio, codigos]) =>
      codigos.length >= conCifraEn(anio).length
        ? traducible('datos-globales.no-comparable.todos', { anio })
        : traducible('datos-globales.no-comparable.algunos', { anio, territorios: listaDeNombres(datos, codigos) }),
    );
}

/**
 * Varias frases (o partes) seguidas en un solo texto, separadas por un espacio: cada una se traduce por su cuenta.
 * @param {...Parte} partes @returns {Parte}
 */
export function juntas(...partes) {
  const [primera = '', ...resto] = partes;
  return resto.reduce((todas, parte) => traducible('datos-globales.dos-frases', { a: todas, b: parte }), primera);
}

/**
 * Varias partes en una enumeración separada por punto y coma («2021, en todos los territorios; 2023, en Francia»).
 * @param {Parte[]} partes @returns {Parte}
 */
export function conPuntoYComa(partes) {
  const [primera = '', ...resto] = partes;
  return resto.reduce((todas, parte) => traducible('datos-globales.punto-y-coma', { a: todas, b: parte }), primera);
}

/**
 * Los apartados de la ficha que comparten los capítulos: los datos que no se muestran (o «ninguno») y el margen de
 * error. @param {Parte[] | null} fuera lo que no se muestra, agrupado por año (null en un capítulo sin serie, que no
 *   oculta nada) @param {string} margen la clave del margen
 * @returns {[Apartado, Parte][]}
 */
export function apartadosDeMetodo(fuera, margen = 'datos-globales.margen') {
  /** @type {[Apartado, Parte][]} */
  const noSeMuestran =
    fuera === null
      ? []
      : [
          [
            'no-se-muestran',
            fuera.length
              ? traducible('datos-globales.no-comparable.ficha', { lista: conPuntoYComa(fuera) })
              : traducible('datos-globales.no-comparable.ninguno'),
          ],
        ];
  return [...noSeMuestran, ['margen', traducible(margen)]];
}

/**
 * La nota de una figura con lo que no se muestra dentro de los años que enseña, o ninguna.
 * @param {Parte[]} fuera @returns {Parte[]}
 */
export function notaDeNoComparables(fuera) {
  return fuera.length ? [traducible('datos-globales.no-comparable.nota', { lista: conPuntoYComa(fuera) })] : [];
}

/**
 * La nota de los territorios sin cifra en el año de una comparación, o ninguna.
 * @param {DatosGlobales} datos @param {string[]} codigos @param {number} anio @returns {Parte[]}
 */
export function notaSinCifra(datos, codigos, anio) {
  return codigos.length
    ? [traducible('datos-globales.sin-cifra.nota', { territorios: listaDeNombres(datos, codigos), anio })]
    : [];
}

/**
 * La frase de la lectura frente a un territorio de referencia (España o la media de la UE): «Más que en España»,
 * «Parecido a España» o «Menos que en España», con un punto de diferencia como mínimo.
 * @param {'espana' | 'ue'} referencia @param {number} propia @param {number} otra @returns {Parte}
 */
export function tituloFrenteA(referencia, propia, otra) {
  return traducible(`datos-globales.lectura.${referencia}.${comparar(propia, otra)}`);
}

/**
 * Las barras de un indicador en un año, con la media de la UE como referencia, en el orden dado (el del primer panel).
 * @param {DatosGlobales} datos
 * @param {{ id: string, anio: number, escala: { maximo: number, paso: number }, orden?: readonly string[] }} panel
 */
export function panelDeBarras(datos, { id, anio, escala, orden }) {
  const { filas, sinCifra } = filasDeBarras(datos, orden ? { id, anio, orden } : { id, anio });
  const referencia = referenciaDeLaUe(datos, id, anio);
  const dibujo = grafico(barras({ filas, escala, referencia, opinion: false, decimales: 1 }));
  return { filas, sinCifra, referencia, nodo: dibujo.nodo, alternativa: alternativaDeBarras(datos, filas, referencia) };
}
