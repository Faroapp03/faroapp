// Lectura estricta del HTML que escribe el motor; no repara ni reconstruye el texto.

/** HTML que no pasa la lectura admitida del informe. */
export class HtmlNoAdmitido extends TypeError {}

/**
 * Las etiquetas que escribe el motor en el informe (HTML y el SVG de sus gráficos). La lista no incluye etiquetas de
 * MathML ni de texto crudo (script, style, textarea, title, noscript…).
 * Tampoco admite iframe, object, embed, base, meta, link, form, use, image ni foreignObject.
 * img sí se admite: comprobarImagen limita sus atributos src y srcset a las rutas propias aceptadas. header, footer y
 * line los usa el informe breve (presentacion/informe-breve/): la cabecera y el pie de cada hoja y el trazo de su
 * semicírculo.
 */
const ETIQUETAS = new Set([
  'a',
  'article',
  'aside',
  'b',
  'button',
  'caption',
  'circle',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'i',
  'img',
  'legend',
  'li',
  'line',
  'ol',
  'p',
  'path',
  'rect',
  'section',
  'small',
  'span',
  'strong',
  'summary',
  'svg',
  'table',
  'tbody',
  'td',
  'template',
  'text',
  'th',
  'thead',
  'tr',
  'ul',
]);
/**
 * Los atributos que escribe el motor, además de los data-*: ningún manejador (on…), ni style, srcdoc, name, action,
 * formaction ni xlink:href. Las direcciones (href, src, srcset) y target, rel, type y tabindex se revisan además por
 * su valor. Los de presentación de SVG (font-*, stroke-line*, x1…y2) los usan los gráficos del informe breve.
 */
const ATRIBUTOS = new Set([
  'alt',
  'aria-controls',
  'aria-describedby',
  'aria-expanded',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'aria-pressed',
  'class',
  'cx',
  'cy',
  'd',
  'fill',
  'focusable',
  'font-family',
  'font-size',
  'font-weight',
  'height',
  'hidden',
  'href',
  'hreflang',
  'id',
  'lang',
  'loading',
  'popover',
  'popovertarget',
  'r',
  'rel',
  'role',
  'rx',
  'scope',
  'sizes',
  'src',
  'srcset',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-width',
  'tabindex',
  'target',
  'text-anchor',
  'title',
  'type',
  'viewbox',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
]);
/**
 * Los esquemas que admite un enlace del informe; uno sin esquema explícito también se admite, sin comprobar su
 * anfitrión.
 */
const ESQUEMAS_DE_ENLACE = new Set(['https', 'http', 'mailto', 'tel']);
/** Una imagen del informe es siempre de la propia web: una ruta relativa sencilla, sin esquema ni otro anfitrión. */
const RUTA_PROPIA = /^[a-z0-9][a-z0-9._/-]*$/i;
/** Cada candidata de srcset: la ruta y, si lleva, su descriptor de ancho o de densidad. */
const CANDIDATA = /^(\S+)(?:\s+\d+(?:\.\d+)?[wx])?$/;
/**
 * Los valores fijos: un enlace que abre otra pestaña no le deja acceso a esta; un botón no envía un formulario por su
 * tipo; tabindex solo deja que el destino de un enlace de salto reciba el foco, sin cambiar el orden de Tab.
 * @type {Readonly<Record<string, string>>}
 */
const VALORES_FIJOS = {
  target: '_blank',
  rel: 'noopener noreferrer',
  type: 'button',
  tabindex: '-1',
};

// La sintaxis del motor. Espacio es el del HTML (ni \v ni los de Unicode); los nombres, sin «:» ni «/».
const ESPACIO = '[\\t\\n\\f\\r ]';
const NOMBRE = '[a-zA-Z][a-zA-Z0-9-]*';
const VALOR = '"[^"<]*"';
const APERTURA = new RegExp(`<(${NOMBRE})((?:${ESPACIO}+${NOMBRE}(?:=${VALOR})?)*)${ESPACIO}*/?>`, 'y');
const CIERRE = new RegExp(`</(${NOMBRE})${ESPACIO}*>`, 'y');
/** Los comentarios de sección del motor («<!-- 01 · Portada -->»): sin «-», «<» ni «>» dentro, nada que los alargue. */
const COMENTARIO = /<!--[^<>-]*-->/y;
const ATRIBUTO = new RegExp(`${ESPACIO}+(${NOMBRE})(?:="([^"<]*)")?`, 'g');
/** Una referencia de carácter completa: numérica o con nombre, siempre terminada en «;». */
const REFERENCIA = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y;
/**
 * Las únicas referencias con nombre que puede llevar una dirección, las de escapar() del motor.
 * @type {Readonly<Record<string, string>>}
 */
const REFERENCIAS_DE_DIRECCION = { amp: '&', quot: '"', lt: '<', gt: '>' };

/** La base de una referencia numérica «&#…;» y la de una «&#x…;». */
const BASE_DECIMAL = 10;
const BASE_HEXADECIMAL = 16;
/** El último punto de código de Unicode (U+10FFFF). */
const ULTIMO_PUNTO_DE_CODIGO = 0x10ffff;
/** Los sustitutos (U+D800 a U+DFFF) no son caracteres: una referencia a uno se lee como U+FFFD, como en HTML. */
const PRIMER_SUSTITUTO = 0xd800;
const ULTIMO_SUSTITUTO = 0xdfff;

/**
 * Rechaza el HTML del informe con un HtmlNoAdmitido que dice qué no encaja.
 * @param {string} detalle Qué no se admite, en pocas palabras.
 * @returns {never} Siempre lanza.
 */
function rechazar(detalle) {
  throw new HtmlNoAdmitido(`El informe trae HTML que la web no admite (${detalle})`);
}

/**
 * Las referencias de carácter bien formadas en todo el texto: un «&» suelto o sin «;» no se admite.
 * @param {string} texto
 */
function comprobarReferencias(texto) {
  for (let posicion = texto.indexOf('&'); posicion !== -1; posicion = texto.indexOf('&', posicion + 1)) {
    REFERENCIA.lastIndex = posicion;
    if (!REFERENCIA.test(texto)) {
      rechazar('referencia de carácter incompleta');
    }
  }
}

/**
 * La dirección como la leerá el navegador para buscar su esquema: con las referencias de carácter resueltas y sin
 * caracteres ASCII hasta el espacio ni DEL (el navegador quita los de los extremos y los saltos y tabuladores de en
 * medio; aquí se quitan todos, que es más estricto). Una referencia con nombre que no sea de escapar() no se admite.
 * @param {string} valor El valor del atributo, tal como llega.
 * @returns {string} La dirección que leería el navegador.
 */
function direccionLeida(valor) {
  const resuelta = valor.replace(
    /&(#[xX]?)?([0-9a-zA-Z]+);/g,
    /**
     * @param {string} _ La referencia entera.
     * @param {string | undefined} numerica «#» o «#x» si es numérica; undefined si lleva nombre.
     * @param {string} cuerpo El nombre o el número, sin «&», «#» ni «;».
     */
    (_, numerica, cuerpo) => {
      if (!numerica) {
        return Object.hasOwn(REFERENCIAS_DE_DIRECCION, cuerpo)
          ? (REFERENCIAS_DE_DIRECCION[cuerpo] ?? rechazar('referencia en una dirección'))
          : rechazar('referencia en una dirección');
      }
      const codigo = Number.parseInt(cuerpo, numerica === '#' ? BASE_DECIMAL : BASE_HEXADECIMAL);
      return codigo > 0 && codigo <= ULTIMO_PUNTO_DE_CODIGO && (codigo < PRIMER_SUSTITUTO || codigo > ULTIMO_SUSTITUTO)
        ? String.fromCodePoint(codigo)
        : '\ufffd';
    },
  );
  return Array.from(resuelta)
    .filter((caracter) => caracter > ' ' && caracter !== '\u007f')
    .join('');
}

/**
 * Un enlace: con un esquema de la lista o relativo.
 * @param {string} valor El valor de href.
 */
function comprobarEnlace(valor) {
  const esquema = /^([a-z][a-z0-9+.-]*):/i.exec(direccionLeida(valor))?.[1]?.toLowerCase();
  if (esquema !== undefined && !ESQUEMAS_DE_ENLACE.has(esquema)) {
    rechazar(`esquema ${esquema}`);
  }
}

/**
 * Una imagen o cada candidata de srcset: solo rutas de la propia web.
 * @param {string} nombre «src» o «srcset».
 * @param {string} valor El valor del atributo.
 */
function comprobarImagen(nombre, valor) {
  const candidatas = nombre === 'srcset' ? valor.split(',').map((candidata) => candidata.trim()) : [valor];
  for (const candidata of candidatas) {
    const ruta = nombre === 'srcset' ? CANDIDATA.exec(candidata)?.[1] : candidata;
    if (ruta === undefined || !RUTA_PROPIA.test(direccionLeida(ruta))) {
      rechazar(`dirección de ${nombre}`);
    }
  }
}

/**
 * El valor de un atributo admitido: referencias completas, y las direcciones y los valores fijos, como deben.
 * @param {string} nombre El nombre del atributo, en minúsculas.
 * @param {string} valor El valor, sin comillas.
 */
function comprobarValor(nombre, valor) {
  comprobarReferencias(valor);
  if (nombre === 'href') {
    comprobarEnlace(valor);
  }
  if (nombre === 'src' || nombre === 'srcset') {
    comprobarImagen(nombre, valor);
  }
  if (Object.hasOwn(VALORES_FIJOS, nombre) && valor !== VALORES_FIJOS[nombre]) {
    rechazar(`valor de ${nombre}`);
  }
}

/**
 * Los atributos de una etiqueta: de la lista (o data-*), cada uno con su valor.
 * @param {string} texto Lo que sigue al nombre de la etiqueta, hasta el «>».
 */
function comprobarAtributos(texto) {
  /** @type {Set<string>} */
  const vistos = new Set();
  for (const [, nombreLeido, valor = ''] of texto.matchAll(ATRIBUTO)) {
    const nombre = (nombreLeido ?? rechazar('nombre de atributo')).toLowerCase();
    if (!ATRIBUTOS.has(nombre) && !/^data-[a-z0-9-]+$/.test(nombre)) {
      rechazar(`atributo ${nombre}`);
    }
    comprobarValor(nombre, valor);
    vistos.add(nombre);
  }
  if (vistos.has('target') && !vistos.has('rel')) {
    rechazar('target sin rel');
  }
}

/** El nombre leído por APERTURA o CIERRE pertenece a la lista del informe.
 * @param {string | undefined} leido
 */
function comprobarEtiqueta(leido) {
  const nombre = (leido ?? rechazar('nombre de etiqueta')).toLowerCase();
  if (!ETIQUETAS.has(nombre)) {
    rechazar(`etiqueta ${nombre}`);
  }
}

/**
 * El HTML del informe, si todo pasa esta lectura; si no, un error y no se pinta. Recorre el texto de etiqueta en
 * etiqueta: entre ellas solo hay texto con referencias completas, y cada «<» abre una etiqueta de la lista, con
 * atributos de la lista, o cierra una, o es un comentario de sección del motor.
 * @param {string} html
 * @returns {string}
 */
export function informeAdmitido(html) {
  let posicion = 0;
  // Cada vuelta avanza `posicion` al menos un carácter (una etiqueta o un comentario no están vacíos) o rechaza el
  // informe: el bucle termina en html.length.
  while (posicion < html.length) {
    const siguiente = html.indexOf('<', posicion);
    const fin = siguiente === -1 ? html.length : siguiente;
    comprobarReferencias(html.slice(posicion, fin));
    if (siguiente === -1) {
      break;
    }
    COMENTARIO.lastIndex = siguiente;
    APERTURA.lastIndex = siguiente;
    CIERRE.lastIndex = siguiente;
    const comentario = COMENTARIO.exec(html);
    if (comentario) {
      posicion = siguiente + comentario[0].length;
      continue;
    }
    const apertura = APERTURA.exec(html);
    const etiqueta = apertura ?? CIERRE.exec(html) ?? rechazar('«<» que no abre ni cierra una etiqueta');
    comprobarEtiqueta(etiqueta[1]);
    if (apertura) {
      comprobarAtributos(apertura[2] ?? rechazar('atributos de etiqueta'));
    }
    posicion = siguiente + etiqueta[0].length;
  }
  return html;
}
