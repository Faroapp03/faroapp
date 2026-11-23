// «Todas las cifras en una tabla», el capítulo «cuadro» de «Datos globales · Cataluña y países» (datos-globales.html;
// su número sale de CAPITULOS, capitulos.js): una fila por territorio, en el orden de las tablas (Cataluña primero y
// resaltada; España, «con Cataluña»), la media de la UE al final como referencia, y una columna por indicador principal,
// cada una con su año. Lo que no tiene cifra oficial comparable se escribe «—¹», con su nota debajo: nunca se estima.

import { crear } from '../dom.js';
import { traducible } from '../textos.js';
import { anioDe, CODIGO_DE_LA_UE, CODIGO_PROPIO, INDICADORES, numeroDelCapitulo } from './capitulos.js';
import { numeroEscrito } from './cifras.js';
import { CON_LA_UE, cifraDelAnio, nombreLargo } from './comparacion.js';
import { conTexto } from './ficha.js';
import { parrafo, recuadroSinCifra, seccion } from './seccion.js';

/**
 * @import { DatosGlobales } from './datos.js'
 */

/** Las columnas del cuadro: el indicador y la clave de su encabezado (con su detalle debajo). */
const COLUMNAS = Object.freeze(
  /** @type {const} */ ([
    [INDICADORES.empresas, 'empresas'],
    [INDICADORES.personas, 'personas'],
    [INDICADORES.personasTrabajo, 'trabajo'],
    [INDICADORES.formacion, 'formacion'],
  ]),
);
/** Lo que se escribe donde no hay cifra oficial comparable; la nota «¹» lo explica debajo de la tabla. */
const SIN_CIFRA = '—¹';
/** El id de la leyenda del cuadro, que da nombre a su marco desplazable. */
const LEYENDA = 'dg-cuadro-leyenda';

/**
 * Una celda con una cifra o «—¹».
 * @param {number | null} cifra
 */
function celda(cifra) {
  return cifra === null
    ? crear('td', { className: 'dg-sin', textContent: SIN_CIFRA })
    : crear('td', { textContent: numeroEscrito(cifra) });
}

/**
 * El encabezado de una columna, con su detalle y su año.
 * @param {string} clave @param {number | null} anio
 */
function encabezado(clave, anio) {
  return crear(
    'th',
    { scope: 'col' },
    conTexto('span', { className: 'dg-cuadro-indicador' }, traducible(`datos-globales.cuadro.${clave}`)),
    conTexto(
      'span',
      { className: 'dg-cuadro-detalle' },
      traducible(`datos-globales.cuadro.${clave}.detalle`, { anio: anio ?? '' }),
    ),
  );
}

/**
 * La tabla del cuadro, o null si ningún territorio tiene ninguna cifra.
 * @param {DatosGlobales} datos @returns {{ tabla: HTMLTableElement, conHuecos: boolean } | null}
 */
function tabla(datos) {
  const anios = COLUMNAS.map(([id]) => anioDe(datos, [id]));
  const cifrasDe = (/** @type {string} */ codigo) =>
    COLUMNAS.map(([id], i) => {
      const anio = anios[i];
      return anio === null || anio === undefined ? null : cifraDelAnio(datos, codigo, id, anio);
    });
  const todas = CON_LA_UE.flatMap((codigo) => cifrasDe(codigo));
  if (todas.every((cifra) => cifra === null)) {
    return null;
  }
  const filas = CON_LA_UE.map((codigo) => {
    const clase =
      (codigo === CODIGO_PROPIO && 'dg-cuadro-propia') || (codigo === CODIGO_DE_LA_UE && 'dg-cuadro-ue') || '';
    return crear(
      'tr',
      { className: clase },
      conTexto('th', { scope: 'row' }, nombreLargo(datos, codigo)),
      ...cifrasDe(codigo).map(celda),
    );
  });
  const cabecera = crear(
    'tr',
    {},
    conTexto('th', { scope: 'col' }, traducible('datos-globales.cuadro.territorio')),
    ...COLUMNAS.map(([, clave], i) => encabezado(clave, anios[i] ?? null)),
  );
  return {
    tabla: crear(
      'table',
      { className: 'dg-tabla dg-cuadro' },
      conTexto('caption', { id: LEYENDA }, traducible('datos-globales.cuadro.leyenda')),
      crear('thead', {}, cabecera),
      crear('tbody', {}, ...filas),
    ),
    conHuecos: todas.includes(null),
  };
}

/**
 * El marco del cuadro, que se desplaza a lo ancho cuando no cabe: se puede enfocar y desplazar con el teclado (WCAG
 * 2.1.1; Safari no enfoca solo un desplazable) y se anuncia como región con la leyenda del cuadro.
 * @param {HTMLTableElement} cuadro @returns {HTMLDivElement}
 */
function marcoDesplazable(cuadro) {
  const marco = crear('div', { className: 'dg-tabla-marco dg-cuadro-marco' }, cuadro);
  marco.setAttribute('tabindex', '0');
  marco.setAttribute('role', 'region');
  marco.setAttribute('aria-labelledby', LEYENDA);
  return marco;
}

/**
 * El capítulo del cuadro (su número sale de CAPITULOS, capitulos.js): el cuadro, su nota de lo que no tiene cifra (si
 * hace falta) y sus fuentes con la fecha de consulta.
 * @param {DatosGlobales} datos
 * @param {string} fecha la de la consulta, dd/mm/aaaa
 * @returns {HTMLElement}
 */
export function capituloDelCuadro(datos, fecha) {
  const cuadro = tabla(datos);
  const cuerpo = cuadro
    ? [
        marcoDesplazable(cuadro.tabla),
        ...(cuadro.conHuecos
          ? [conTexto('p', { className: 'dg-cuadro-nota' }, traducible('datos-globales.cuadro.sin-cifra'))]
          : []),
        conTexto('p', { className: 'dg-cuadro-nota' }, traducible('datos-globales.cuadro.nota', { fecha })),
      ]
    : [recuadroSinCifra(traducible('datos-globales.sin-cifra'))];
  const cabecera = {
    id: 'cuadro',
    numero: numeroDelCapitulo('cuadro'),
    tema: traducible('datos-globales.cuadro.tema'),
    pregunta: traducible('datos-globales.cuadro.pregunta'),
    titular: traducible('datos-globales.cuadro.titular'),
  };
  return seccion(cabecera, [parrafo('dg-entradilla', [traducible('datos-globales.cuadro.texto')]), ...cuerpo]);
}
