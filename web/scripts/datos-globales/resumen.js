// «Lo esencial», al principio de «Datos globales · Cataluña y países» (datos-globales.html): cuatro cifras clave de
// Cataluña, ni una más. Cada una lleva su tema y su año, la cifra con su unidad, su significado en una frase («Es decir,
// 24 de cada 100 empresas…»), la comparación con España (con Cataluña) y la media de la UE en tres barras finas a la
// misma escala, y su fuente o la definición que haga falta («Puntos: la resta…»). Todo sale de datos-globales.json:
// una cifra clave sin sus tres cifras del mismo año no se enseña. El aviso del margen de error va en la cabecera del
// bloque, escrito en la página.

import { traducible } from '../textos.js';
import {
  CODIGO_DE_ESPANA,
  CODIGO_DE_LA_UE,
  CODIGO_PROPIO,
  ESCALAS,
  escalaPara,
  INDICADORES as ID,
} from './capitulos.js';
import { distanciaEscrita, numeroEscrito, porcentajeEscrito, resta } from './cifras.js';
import { anioDeLaComparacion, cifraDelAnio, entero, nombreLargo, papelDe } from './comparacion.js';
import { grafico, mini } from './dibujo.js';
import { tarjetaEsencial } from './seccion.js';

/**
 * @import { DatosGlobales } from './datos.js'
 * @import { Parte } from '../textos.js'
 */

/** Los tres territorios de cada comparación: Cataluña, España (con Cataluña) y la media de la UE. */
const TRIO = Object.freeze([CODIGO_PROPIO, CODIGO_DE_ESPANA, CODIGO_DE_LA_UE]);

/**
 * Las tres cifras de un indicador en el año de Cataluña, o null si falta alguna.
 * @param {DatosGlobales} datos @param {string} id @returns {{ anio: number, cifras: number[] } | null}
 */
function trioDe(datos, id) {
  const anio = anioDeLaComparacion(datos, id);
  const cifras = anio === null ? [] : TRIO.map((codigo) => cifraDelAnio(datos, codigo, id, anio));
  return anio !== null && cifras.every((cifra) => cifra !== null)
    ? { anio, cifras: /** @type {number[]} */ (cifras) }
    : null;
}

/**
 * La comparación mínima de una tarjeta: las tres barras finas a la misma escala, con su cifra escrita.
 * @param {DatosGlobales} datos @param {number[]} cifras @param {{ maximo: number }} escala @param {(cifra: number) => string} escribir
 */
function comparacionMinima(datos, cifras, escala, escribir) {
  const filas = TRIO.map((codigo, i) => {
    const valor = cifras[i] ?? 0;
    return { papel: papelDe(codigo), nombre: nombreLargo(datos, codigo), valor, texto: escribir(valor) };
  });
  return grafico(mini({ filas, maximo: escala.maximo })).nodo;
}

/**
 * Una tarjeta de un porcentaje de Cataluña: su cifra, «Es decir, N de cada 100…» y la comparación.
 * @param {DatosGlobales} datos
 * @param {{ id: string, clave: string, escala: { maximo: number, paso: number }, pie: string }} tarjeta
 * @returns {HTMLLIElement[]}
 */
function tarjetaDePorcentaje(datos, { id, clave, escala, pie }) {
  const trio = trioDe(datos, id);
  if (!trio) {
    return [];
  }
  const [propia = 0] = trio.cifras;
  return [
    tarjetaEsencial({
      tema: traducible(`datos-globales.esencial.${clave}.tema`, { anio: trio.anio }),
      cifra: numeroEscrito(propia),
      unidad: '%',
      significado: traducible(`datos-globales.esencial.${clave}`, { cifra: entero(propia) }),
      comparacion: traducible(`datos-globales.esencial.${clave}.comparacion`),
      grafico: comparacionMinima(datos, trio.cifras, escalaPara(escala, trio.cifras), (cifra) =>
        porcentajeEscrito(cifra),
      ),
      pie: traducible(pie),
      ue: false,
    }),
  ];
}

/**
 * La tarjeta de mujeres y hombres: la diferencia en puntos de Cataluña, explicada, y la misma diferencia en España y en
 * la UE. @param {DatosGlobales} datos @returns {HTMLLIElement[]}
 */
function tarjetaDeGenero(datos) {
  const mujeres = trioDe(datos, ID.mujeres);
  const hombres = trioDe(datos, ID.hombres);
  if (!mujeres || !hombres || mujeres.anio !== hombres.anio) {
    return [];
  }
  const diferencias = TRIO.map((_, i) => resta(hombres.cifras[i] ?? 0, mujeres.cifras[i] ?? 0));
  const [m = 0] = mujeres.cifras;
  const [h = 0] = hombres.cifras;
  const valores = { hombres: entero(h), mujeres: entero(m), puntos: entero(Math.abs(resta(h, m))) };
  /** @type {Parte} */
  const significado = traducible('datos-globales.esencial.genero', valores);
  return [
    tarjetaEsencial({
      tema: traducible('datos-globales.esencial.genero.tema', { anio: mujeres.anio }),
      cifra: distanciaEscrita(h, m),
      unidad: traducible('datos-globales.unidad.puntos'),
      significado,
      comparacion: traducible('datos-globales.esencial.genero.comparacion'),
      grafico: comparacionMinima(
        datos,
        diferencias.map((diferencia) => Math.abs(diferencia)),
        escalaPara(ESCALAS.diferencia, diferencias.map(Math.abs)),
        (cifra) => numeroEscrito(cifra),
      ),
      pie: traducible('datos-globales.esencial.genero.pie', valores),
      ue: false,
    }),
  ];
}

/**
 * Las cuatro cifras clave de «Lo esencial», como elementos de su lista; las que no tienen sus cifras, fuera.
 * @param {DatosGlobales} datos @returns {HTMLLIElement[]}
 */
export function clavesDeLoEsencial(datos) {
  return [
    ...tarjetaDePorcentaje(datos, {
      id: ID.empresas,
      clave: 'empresas',
      escala: ESCALAS.empresas,
      pie: 'datos-globales.esencial.fuente.eurostat',
    }),
    ...tarjetaDePorcentaje(datos, {
      id: ID.personas,
      clave: 'personas',
      escala: ESCALAS.personas,
      pie: 'datos-globales.esencial.fuente.idescat',
    }),
    ...tarjetaDePorcentaje(datos, {
      id: ID.personasTrabajo,
      clave: 'trabajo',
      escala: ESCALAS.personas,
      pie: 'datos-globales.esencial.fuente.idescat',
    }),
    ...tarjetaDeGenero(datos),
  ];
}
