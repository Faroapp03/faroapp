// La lectura de un informe ya pintado: su texto en el orden en que se lee, en fragmentos (un título, un párrafo, un
// elemento de lista, una fila de tabla), sin la interfaz. La usan «Escuchar mi informe» (escuchar-informe.js), que dice
// cada fragmento con la voz del dispositivo, y «Compartir mi informe» (compartir-informe.js), que comparte el texto.
// Lo oculto no se lee; los apartados plegados sí, como al imprimir (informe.js los abre): el informe dice lo mismo en
// papel, en voz y en texto. No se leen los controles (botones, resúmenes de los desplegables, campos), los paneles
// emergentes, el globo de la franja, los enlaces de salto (llevan a otro punto del informe, no son parte de él) ni el
// cierre; lo que es una imagen se lee por su texto alternativo, y lo decorativo (aria-hidden, alt vacío), no.

/** Las etiquetas que el informe pinta como bloque: cada una empieza un fragmento nuevo. */
const BLOQUES = new Set([
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'SECTION',
  'UL',
]);
/** Los títulos: el texto compartido deja una línea en blanco antes de cada uno. */
const TITULOS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
/** Lo que se usa y no se lee: controles, plantillas y código. */
const CONTROLES = new Set([
  'BUTTON',
  'INPUT',
  'NOSCRIPT',
  'SCRIPT',
  'SELECT',
  'STYLE',
  'SUMMARY',
  'TEMPLATE',
  'TEXTAREA',
]);
/** Las partes del informe que son interfaz, por la marca que les pone el motor. */
const INTERFAZ = '.cierre, .salto, [popover], [role="tooltip"]';
/** Antes de estos signos no va espacio, y después de los de apertura tampoco. */
const ESPACIO_ANTES_DE_CIERRE = /\s+([.,;:!?)»])/g;
const ESPACIO_TRAS_APERTURA = /([(«])\s+/g;
/** Entre las celdas de una fila leída: una pausa. */
const SEPARADOR_DE_CELDAS = '; ';

/**
 * Un fragmento de la lectura: su texto, la lengua en que está escrito (la de su bloque) y si es un título.
 * @typedef {{ texto: string, idioma: string, titulo: boolean }} Fragmento
 */
/**
 * Lo que se va leyendo: los fragmentos ya cerrados y las partes del que está abierto.
 * @typedef {{ fragmentos: Fragmento[], partes: string[], idioma: string, titulo: boolean }} Lectura
 */

/** Las partes de un fragmento como texto: un espacio entre ellas, sin espacios dobles ni antes de un signo.
 * @param {string[]} partes @returns {string}
 */
function unir(partes) {
  return partes
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(ESPACIO_ANTES_DE_CIERRE, '$1')
    .replace(ESPACIO_TRAS_APERTURA, '$1')
    .trim();
}

/** Cierra el fragmento abierto, si tiene texto, y deja abierto uno nuevo en `idioma`.
 * @param {Lectura} lectura @param {string} idioma @param {boolean} [titulo]
 */
function cerrar(lectura, idioma, titulo = false) {
  const texto = unir(lectura.partes);
  if (texto) {
    lectura.fragmentos.push({ texto, idioma: lectura.idioma, titulo: lectura.titulo });
  }
  lectura.partes = [];
  lectura.idioma = idioma;
  lectura.titulo = titulo;
}

/** Si el elemento no se lee: oculto, decorativo, un control o una parte de la interfaz.
 * @param {Element} elemento @returns {boolean}
 */
function seOmite(elemento) {
  return (
    CONTROLES.has(elemento.tagName) ||
    elemento.hasAttribute('hidden') ||
    elemento.getAttribute('aria-hidden') === 'true' ||
    elemento.matches(INTERFAZ)
  );
}

/**
 * Lo que se lee de una imagen en lugar de su contenido: el `alt` de un <img>, el `aria-label` de lo que tiene role="img" (un
 * gráfico, los puntos del tiempo de una tarea; solo se lee `aria-label`, no aria-labelledby) y nada de un SVG sin ese papel. null si el elemento no es una imagen.
 * @param {Element} elemento @returns {string | null}
 */
function textoDeImagen(elemento) {
  if (elemento.tagName === 'IMG') {
    return elemento.getAttribute('alt') ?? '';
  }
  if (elemento.getAttribute('role') === 'img') {
    return elemento.getAttribute('aria-label') ?? '';
  }
  // En HTML `tagName` va en mayúsculas y en SVG tal cual se escribe, en minúsculas: de ahí el `toLowerCase`.
  if (elemento.tagName.toLowerCase() === 'svg') {
    return '';
  }
  return null;
}

/**
 * Una tabla, fila a fila: su título y, en cada fila del cuerpo, cada celda con el encabezado de su columna delante
 * («Nota: 0,735»), como la recorre un lector de pantalla. Las tablas del informe no combinan celdas.
 * @param {Element} tabla @param {Lectura} lectura
 */
function leerTabla(tabla, lectura) {
  const encabezados = [...tabla.querySelectorAll('thead th')].map((celda) => textoDe(celda));
  const titulo = tabla.querySelector('caption');
  if (titulo && !seOmite(titulo)) {
    cerrar(lectura, lectura.idioma, true);
    lectura.partes.push(textoDe(titulo));
  }
  for (const fila of tabla.querySelectorAll('tbody tr')) {
    if (seOmite(fila)) {
      continue;
    }
    cerrar(lectura, lectura.idioma);
    const celdas = [...fila.querySelectorAll('th, td')].map((celda, i) =>
      encabezados[i] ? `${encabezados[i]}: ${textoDe(celda)}` : textoDe(celda),
    );
    lectura.partes.push(celdas.join(SEPARADOR_DE_CELDAS));
  }
  cerrar(lectura, lectura.idioma);
}

/**
 * Lee un nodo y lo que tiene dentro. Un bloque cierra el fragmento anterior y abre el suyo, en su lengua. La recursión
 * baja por el informe que pintó el motor: su profundidad es la de ese HTML (unos pocos niveles, escritos por el motor,
 * nunca por la persona), que ya está entero en la página.
 * @param {Node} nodo @param {Lectura} lectura
 */
function leerNodo(nodo, lectura) {
  if (nodo instanceof Text) {
    lectura.partes.push(nodo.textContent ?? '');
    return;
  }
  // Un comentario del HTML no se lee.
  if (!(nodo instanceof Element) || seOmite(nodo)) {
    return;
  }
  const imagen = textoDeImagen(nodo);
  if (imagen !== null) {
    lectura.partes.push(imagen);
    return;
  }
  if (nodo.tagName === 'TABLE') {
    leerTabla(nodo, lectura);
    return;
  }
  if (!BLOQUES.has(nodo.tagName)) {
    for (const hijo of nodo.childNodes) {
      leerNodo(hijo, lectura);
    }
    return;
  }
  const deFuera = lectura.idioma;
  cerrar(lectura, nodo.getAttribute('lang') || deFuera, TITULOS.has(nodo.tagName));
  for (const hijo of nodo.childNodes) {
    leerNodo(hijo, lectura);
  }
  cerrar(lectura, deFuera);
}

/** El texto entero de un elemento en una línea, con las mismas reglas que la lectura.
 * @param {Element} elemento @returns {string}
 */
function textoDe(elemento) {
  return unir(fragmentosDe(elemento).map(({ texto }) => texto));
}

/**
 * El elemento raíz del informe dentro de `raiz` (o `raiz` misma, o la que la contiene): el que lleva las marcas del
 * informe, como el título del PDF (data-titulo-pdf) y su lengua (lang). null si `raiz` no tiene informe.
 * @param {Element} raiz @returns {HTMLElement | null}
 */
export function informeDe(raiz) {
  const informe = raiz.querySelector('[data-titulo-pdf]') ?? raiz.closest('[data-titulo-pdf]');
  return informe instanceof HTMLElement ? informe : null;
}

/**
 * La lectura de lo que hay dentro de `elemento`, en su orden y sin la interfaz. El propio elemento se lee aunque esté
 * oculto (la portada, para resumir, con la versión sencilla a la vista); lo oculto dentro de él, no.
 * @param {Element} elemento @returns {Fragmento[]}
 */
export function fragmentosDe(elemento) {
  const idioma = elemento.closest('[lang]')?.getAttribute('lang') ?? '';
  /** @type {Lectura} */
  const lectura = { fragmentos: [], partes: [], idioma, titulo: false };
  for (const hijo of elemento.childNodes) {
    leerNodo(hijo, lectura);
  }
  cerrar(lectura, idioma);
  return lectura.fragmentos;
}

/**
 * Los fragmentos como texto: uno por línea y una línea en blanco antes de cada título.
 * @param {readonly Fragmento[]} fragmentos @returns {string}
 */
export function comoTexto(fragmentos) {
  const lineas = fragmentos.map(({ texto, titulo }, i) => (titulo && i > 0 ? `\n${texto}` : texto));
  return `${lineas.join('\n')}\n`;
}
