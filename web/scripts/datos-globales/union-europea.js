// «Lo esencial» de «Datos globales · Unión Europea» (datos-globales-ue.html): cuatro cifras clave de la UE-27, cada una
// con su tema y su año, la cifra con su unidad, su significado en una frase, una comparación en barras finas (los años
// comparables, las edades o la meta) y su fuente. Las personas se cuentan sobre toda la población de 16 a 74 años, y no
// sobre quienes usan internet como en «Cataluña y países»: lo dice la cabecera del bloque, escrita en la página. Una
// cifra clave sin sus cifras no se enseña.

import { traducible } from '../textos.js';
import { ESCALAS, escalaPara, serieComparable } from './capitulos.js';
import { numeroEscrito, porcentajeEscrito } from './cifras.js';
import { cifraDelBloque, territorioPorCodigo, valorDe } from './datos.js';
import { grafico, mini } from './dibujo.js';
import { tarjetaEsencial } from './seccion.js';
import { CODIGO_DE_LA_UE, entero, millones, ue } from './union-europea-piezas.js';

/**
 * @import { DatosGlobales } from './datos.js'
 * @import { FilaMinima } from './dibujo.js'
 */

/** Las edades de la comparación de personas: la más joven, una del medio y la mayor. */
const EDADES = Object.freeze(['16-24', '45-54', '65-74']);
/** Miles en un millón. */
const MILES_POR_MILLON = 1000;

/** Una comparación mínima. @param {FilaMinima[]} filas @param {number} maximo */
function comparacion(filas, maximo) {
  return grafico(mini({ filas, maximo })).nodo;
}

/** Las filas de una serie comparable de la UE, una por año. @param {DatosGlobales} datos @param {string} id @returns {FilaMinima[]} */
function filasDeAnios(datos, id) {
  return serieComparable(datos, CODIGO_DE_LA_UE, id).map(({ anio, valor }) => ({
    papel: 'ue',
    nombre: String(anio),
    valor,
    texto: porcentajeEscrito(valor),
  }));
}

/** La tarjeta de las empresas. @param {DatosGlobales} datos @returns {HTMLLIElement[]} */
function empresas(datos) {
  const ultimo = valorDe(datos, CODIGO_DE_LA_UE, 'empresas-ia');
  const filas = filasDeAnios(datos, 'empresas-ia');
  if (!ultimo || !filas.length) {
    return [];
  }
  return [
    tarjetaEsencial({
      tema: traducible('datos-globales.esencial.empresas.tema', { anio: ultimo.anio }),
      cifra: numeroEscrito(ultimo.valor),
      unidad: '%',
      significado: traducible('datos-globales.ue.esencial.empresas', { cifra: entero(ultimo.valor) }),
      comparacion: traducible('datos-globales.ue.esencial.empresas.comparacion'),
      grafico: comparacion(
        filas,
        escalaPara(
          ESCALAS.empresas,
          filas.map(({ valor }) => valor),
        ).maximo,
      ),
      pie: traducible('datos-globales.ue.esencial.empresas.pie', { desde: filas[0]?.nombre ?? '' }),
      ue: true,
    }),
  ];
}

/** La tarjeta de las personas, con tres edades. @param {DatosGlobales} datos @returns {HTMLLIElement[]} */
function personas(datos) {
  const ultimo = valorDe(datos, CODIGO_DE_LA_UE, 'personas-ia-generativa');
  /** @type {FilaMinima[]} */
  const filas = EDADES.flatMap((edad) => {
    const valor = ue(datos, `ia-generativa-${edad}`);
    return valor === null
      ? []
      : [{ papel: 'ue', nombre: traducible(`datos-globales.ue.edad.${edad}`), valor, texto: porcentajeEscrito(valor) }];
  });
  if (!ultimo || !filas.length) {
    return [];
  }
  return [
    tarjetaEsencial({
      tema: traducible('datos-globales.esencial.personas.tema', { anio: ultimo.anio }),
      cifra: numeroEscrito(ultimo.valor),
      unidad: '%',
      significado: traducible('datos-globales.ue.esencial.personas', { cifra: entero(ultimo.valor) }),
      comparacion: traducible('datos-globales.ue.esencial.personas.comparacion'),
      grafico: comparacion(
        filas,
        escalaPara(
          ESCALAS.personas,
          filas.map(({ valor }) => valor),
        ).maximo,
      ),
      pie: traducible('datos-globales.ue.esencial.personas.pie'),
      ue: true,
    }),
  ];
}

/** La tarjeta de las capacidades digitales, con su meta. @param {DatosGlobales} datos @returns {HTMLLIElement[]} */
function capacidades(datos) {
  const ultimo = valorDe(datos, CODIGO_DE_LA_UE, 'capacidades-digitales-basicas');
  const meta = datos.metas.find(({ indicador }) => indicador === 'capacidades-digitales-basicas');
  const filas = filasDeAnios(datos, 'capacidades-digitales-basicas');
  if (!ultimo || !meta || !filas.length) {
    return [];
  }
  return [
    tarjetaEsencial({
      tema: traducible('datos-globales.ue.esencial.capacidades.tema', { anio: ultimo.anio }),
      cifra: numeroEscrito(ultimo.valor),
      unidad: '%',
      significado: traducible('datos-globales.ue.esencial.capacidades', {
        cifra: entero(ultimo.valor),
        anio: meta.anio,
        meta: entero(meta.valor),
      }),
      comparacion: traducible('datos-globales.ue.esencial.capacidades.comparacion'),
      grafico: comparacion(filas, ESCALAS.opinion.maximo),
      pie: traducible('datos-globales.esencial.fuente.eurostat'),
      ue: true,
    }),
  ];
}

/** La tarjeta de los especialistas en TIC, frente a su meta. @param {DatosGlobales} datos @returns {HTMLLIElement[]} */
function especialistas(datos) {
  const recuento = datos.recuentos.find(({ id }) => id === 'especialistas-tic');
  const cifra = recuento ? cifraDelBloque(datos, recuento, CODIGO_DE_LA_UE) : null;
  const meta = datos.metas.find(({ indicador }) => indicador === 'especialistas-tic');
  const mujeres = ue(datos, 'especialistas-tic-mujeres');
  if (!cifra || !meta || mujeres === null) {
    return [];
  }
  /** @type {FilaMinima[]} */
  const filas = [
    { papel: 'ue', nombre: String(cifra.anio), valor: cifra.valor / MILES_POR_MILLON, texto: millones(cifra.valor) },
    {
      papel: 'meta',
      nombre: traducible('datos-globales.ue.esencial.meta', { anio: meta.anio }),
      valor: meta.valor / MILES_POR_MILLON,
      texto: millones(meta.valor),
    },
  ];
  return [
    tarjetaEsencial({
      tema: traducible('datos-globales.ue.esencial.especialistas.tema', { anio: cifra.anio }),
      cifra: millones(cifra.valor),
      unidad: traducible('datos-globales.ue.esencial.millones'),
      significado: traducible('datos-globales.ue.esencial.especialistas', {
        anio: meta.anio,
        meta: millones(meta.valor),
      }),
      comparacion: traducible('datos-globales.ue.esencial.especialistas.comparacion'),
      grafico: comparacion(
        filas,
        escalaPara(
          { maximo: 25, paso: 5 },
          filas.map(({ valor }) => valor),
        ).maximo,
      ),
      pie: traducible('datos-globales.ue.esencial.especialistas.pie', { mujeres: numeroEscrito(mujeres) }),
      ue: true,
    }),
  ];
}

/**
 * Las cuatro cifras clave de la UE, o ninguna si el archivo no trae la UE-27.
 * @param {DatosGlobales} datos @returns {HTMLLIElement[]}
 */
export function clavesDeLaUe(datos) {
  if (!territorioPorCodigo(datos, CODIGO_DE_LA_UE)) {
    return [];
  }
  return [...empresas(datos), ...personas(datos), ...capacidades(datos), ...especialistas(datos)];
}
