// Lo que la política de seguridad de contenidos (CSP, src/plataforma/cabeceras-web.ts) no deja hacer a la web,
// para que falle aquí y no en el navegador de quien la usa: en las páginas, scripts y estilos en línea, manejadores,
// documentos incrustados, javascript: y recursos de otro origen; en los scripts (también el service worker), insertar
// HTML fuera del punto documentado, evaluar código, escribir un atributo style y pedir algo a otro origen.

import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { sinComentariosJs } from './comentarios-js.ts';
import { aperturas, type Etiqueta, etiquetasDe, sinComentariosHtml } from './etiquetas.ts';
import { CLASICOS_DE_LA_CABECERA, copiaConHuellaAdmitida } from './guiones-con-huella.ts';
import { leer, SERVICE_WORKER, WEB } from './publicados.ts';
import { OTRO_ORIGEN, rutasDeSrcset } from './referencias.ts';

// ---------- Las páginas ----------

/**
 * Las fuentes de los únicos scripts clásicos: ponen el tema y el idioma antes de pintar. Todos los demás son módulos
 * ES, también los diccionarios de idiomas/. En la web construida se publican con su huella en el nombre
 * (guiones-con-huella.ts).
 */
export const SCRIPTS_CLASICOS: ReadonlySet<string> = new Set(CLASICOS_DE_LA_CABECERA.map(({ fuente }) => fuente));
/** Una página que se recarga o se va sola a otra dirección, o que fija cookies desde el HTML. */
const META_PELIGROSA = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?(?:refresh|set-cookie)\b/i;
/** Atributos que cargan un recurso (los que la CSP limita a 'self'); los enlaces <a href> no cargan nada. */
const ATRIBUTOS_DE_RECURSO = new Set(['src', 'srcset', 'poster', 'data', 'action', 'formaction']);
/**
 * Etiquetas cuyo href carga un recurso: hojas, iconos y manifiesto (<link>) y dibujos de SVG (<use>, <image>). También
 * <base>: no carga nada, pero cambia la base de todas las direcciones relativas, y de otro origen las desviaría.
 */
const HREF_DE_RECURSO = new Set(['link', 'use', 'image', 'base']);

/** Un manejador pegado a lo anterior, sin espacio: tras una barra o una comilla («<svg/onload=…>», «"x"onerror=…»). */
const MANEJADOR_PEGADO = /[\s/"']on[a-z]+\s*=/i;
/** Los valores de los atributos de una etiqueta, con comillas o sin ellas. */
const VALOR_DE_ATRIBUTO = /=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
/** Esquemas de dirección que ejecutan código o pintan otro documento. */
const ESQUEMA_PELIGROSO = /^(?:javascript|vbscript):|^data:text\/html/i;
/** Las entidades con nombre que el navegador quita de una dirección (tabulador, salto de línea y dos puntos). */
const ENTIDADES_CON_NOMBRE: Readonly<Record<string, string>> = { tab: '\t', newline: '\n', colon: ':' };

/** El mayor punto de código de Unicode (U+10FFFF). */
const MAYOR_PUNTO_DE_CODIGO = 0x10ffff;

/** El problema de una etiqueta <script>, si lo tiene: en línea, de otro origen o clásica sin serlo. */
function problemaDeScript(pagina: string, { atributos, texto }: Etiqueta, web: string): string | null {
  const src = atributos.get('src');
  // El mapa de módulos es el único en línea: la CSP lo admite por su huella (integridad.ts la comprueba).
  if (!src && atributos.get('type') === 'importmap') {
    return null;
  }
  if (!src) {
    return `${pagina}: script en línea (${texto})`;
  }
  if (OTRO_ORIGEN.test(src)) {
    return `${pagina}: script de otro origen (${src})`;
  }
  const rutaPropia = decodeURIComponent(new URL(src, new URL(pagina, 'https://faro.invalid/')).pathname.slice(1));
  // En la web construida, los clásicos y la barrera de versión (el tercero, solo en las páginas con versión) se cargan
  // por su copia con la huella de sus bytes en el nombre.
  const clasico = SCRIPTS_CLASICOS.has(rutaPropia) || copiaConHuellaAdmitida(pagina, rutaPropia, web);
  if (!clasico && atributos.get('type') !== 'module') {
    return `${pagina}: ${src} no es un módulo`;
  }
  return null;
}

/** Atributos que la CSP no deja ejecutar: estilos y manejadores en línea, documentos incrustados y javascript:. */
function problemasDeAtributos(pagina: string, { nombre, atributos }: Etiqueta): string[] {
  const problemas: string[] = [];
  for (const [atributo, valor] of atributos) {
    if (atributo === 'style') {
      problemas.push(`${pagina}: atributo style en <${nombre}> (la CSP no lo admite)`);
    }
    if (atributo.startsWith('on')) {
      problemas.push(`${pagina}: manejador en línea (${atributo}) en <${nombre}>`);
    }
    if (atributo === 'srcdoc') {
      problemas.push(`${pagina}: documento incrustado con srcdoc en <${nombre}>`);
    }
    if (/^\s*javascript:/i.test(valor ?? '')) {
      problemas.push(`${pagina}: ${atributo}="javascript:…" en <${nombre}>`);
    }
  }
  return problemas;
}

/** Los recursos que carga una etiqueta: src, srcset, poster… y el href de <link>, <use> o <image>. */
function recursosDe({ nombre, atributos }: Etiqueta): string[] {
  const recursos: string[] = [];
  for (const [atributo, valor] of atributos) {
    if (valor === null) {
      continue;
    }
    if (atributo === 'srcset') {
      recursos.push(...rutasDeSrcset(valor));
    } else if (ATRIBUTOS_DE_RECURSO.has(atributo)) {
      recursos.push(valor);
    } else if ((atributo === 'href' || atributo === 'xlink:href') && HREF_DE_RECURSO.has(nombre)) {
      recursos.push(valor);
    }
  }
  return recursos;
}

/** Un carácter de una entidad numérica, o nada si no es un carácter válido. */
function caracter(codigo: number): string {
  return codigo > 0 && codigo <= MAYOR_PUNTO_DE_CODIGO ? String.fromCodePoint(codigo) : '';
}

/**
 * Un valor como lo lee el navegador al decidir a qué dirección lleva: con las entidades resueltas y sin los espacios ni
 * los caracteres de control, que el navegador quita de la dirección («java&#x09;script:» es «javascript:»).
 */
function comoDireccion(valor: string): string {
  return valor
    .replace(/&#x([0-9a-f]+);?/gi, (_, hexadecimal: string) => caracter(Number.parseInt(hexadecimal, 16)))
    .replace(/&#(\d+);?/g, (_, decimal: string) => caracter(Number(decimal)))
    .replace(/&(tab|newline|colon);/gi, (_, nombre: string) => ENTIDADES_CON_NOMBRE[nombre.toLowerCase()] ?? '')
    .replace(/[\s\p{Cc}]/gu, '');
}

/**
 * Red de seguridad para lo que el analizador de etiquetas no ve y el navegador sí: atributos pegados sin espacio y
 * esquemas escondidos con entidades o caracteres de control. Solo se mira si el análisis normal no encontró nada.
 */
function problemasEscondidos(pagina: string, html: string): string[] {
  const problemas: string[] = [];
  for (const [etiqueta] of sinComentariosHtml(html).matchAll(/<[a-z][^>]*>/gi)) {
    if (MANEJADOR_PEGADO.test(etiqueta)) {
      problemas.push(`${pagina}: manejador en línea escondido en ${etiqueta}`);
    }
    const valores = [...etiqueta.matchAll(VALOR_DE_ATRIBUTO)].map(([, doble, simple, sin]) => doble ?? simple ?? sin);
    if (valores.some((valor) => ESQUEMA_PELIGROSO.test(comoDireccion(valor ?? '')))) {
      problemas.push(`${pagina}: dirección que ejecuta código escondida en ${etiqueta}`);
    }
  }
  return problemas;
}

/**
 * Los problemas de CSP de una página: scripts y estilos en línea, atributos peligrosos y recursos de otro origen. Todo
 * se mira sobre la página sin comentarios HTML, como la ve el navegador: una etiqueta comentada no se ejecuta.
 *
 * @param pagina - La ruta de la página, desde web/, para los mensajes.
 * @param html - Su texto.
 * @returns Un problema por incumplimiento; vacío si la CSP no bloquearía nada.
 */
export function comprobarCspHtml(pagina: string, html: string, web: string = WEB): string[] {
  const visible = sinComentariosHtml(html);
  const etiquetas = aperturas(etiquetasDe(visible));
  const problemas = etiquetas.flatMap((etiqueta) => problemasDeAtributos(pagina, etiqueta));
  if (/<style[\s>]/i.test(visible)) {
    problemas.push(`${pagina}: bloque <style> en línea`);
  }
  if (META_PELIGROSA.test(visible)) {
    problemas.push(`${pagina}: <meta http-equiv> que recarga, redirige o fija cookies`);
  }
  for (const script of etiquetas.filter((etiqueta) => etiqueta.nombre === 'script')) {
    const problema = problemaDeScript(pagina, script, web);
    if (problema) {
      problemas.push(problema);
    }
  }
  const externos = etiquetas
    .filter((etiqueta) => etiqueta.nombre !== 'script')
    .flatMap((etiqueta) => recursosDe(etiqueta).map((recurso) => ({ etiqueta: etiqueta.nombre, recurso })))
    .filter(({ recurso }) => OTRO_ORIGEN.test(recurso));
  for (const { etiqueta, recurso } of externos) {
    problemas.push(`${pagina}: <${etiqueta}> carga un recurso de otro origen (${recurso})`);
  }
  return problemas.length ? problemas : problemasEscondidos(pagina, html);
}

// ---------- Los scripts ----------

/** Carpetas con JavaScript de la web: los scripts y los diccionarios, que son módulos, y las que declara cada extensión. */
const CARPETAS_DE_JAVASCRIPT: readonly string[] = [
  'scripts/',
  'idiomas/',
  'administracion/',
  ...EXTENSIONES.flatMap(({ excepcionesCsp }) => excepcionesCsp.carpetasDeJavaScript),
];
/**
 * Los únicos scripts que nombran una forma de insertar HTML, y cuántas veces (sin contar los comentarios): el informe
 * que pinta el motor, ya escapado (pintarInformeDelMotor, en el recorrido, con htmlDeConfianza), y la lista de
 * lo que se rechaza: las propiedades que
 * `crear` no admite (dom.js). La política de Trusted Types del informe (confianza.js) no nombra ninguna: admite solo
 * una lista cerrada de etiquetas y atributos.
 */
const HTML_INSERTADO: Readonly<Record<string, number>> = {
  'scripts/recorrido/paso-informe.js': 1,
  'scripts/dom.js': 3,
  ...Object.fromEntries(EXTENSIONES.flatMap(({ excepcionesCsp }) => Object.entries(excepcionesCsp.htmlInsertado))),
};
/**
 * Formas de convertir texto en HTML o en documento desde un script. Cada aparición del nombre cuenta, se escriba como
 * se escriba: una asignación, una lectura, entre corchetes (`e['innerHTML']`) o como propiedad de un objeto
 * (`crear('div', { innerHTML })`). Si alguna hace falta, se documenta en HTML_INSERTADO.
 */
const INSERCIONES_DE_HTML = new RegExp(
  [
    '\\b(?:inner|outer)HTML\\b',
    'insertAdjacentHTML',
    '\\bDOMParser\\b',
    'createContextualFragment',
    'setHTMLUnsafe',
    'parseHTMLUnsafe',
    '\\bsrcdoc\\b',
    'document\\.write',
  ].join('|'),
  'g',
);
/**
 * El nombre del atributo style escrito en un script, en cualquier comilla: con setAttribute (también a través de una
 * constante) la CSP lo bloquea. Las medidas van por CSSOM (`elemento.style.setProperty`), que sí se permite.
 */
const ATRIBUTO_STYLE = /['"`]style['"`]/;
/**
 * Lo que un script no puede hacer: evaluar código (la CSP no lo admite) ni cargar guiones; tampoco el SW, que se
 * publica en un solo archivo (herramientas/web/servicio). Cubre eval e importScripts llamados (también entre corchetes, `window['eval']`), Function con o sin new y
 * setTimeout/setInterval con una cadena como primer argumento, con espacios o sin ellos antes del paréntesis.
 */
const EVALUA_CODIGO =
  /\b(?:eval|importScripts)\s*\(|\[\s*['"`](?:eval|importScripts|Function)['"`]\s*\]|\bFunction\s*\(|\bnew\s+Function\b|\bset(?:Timeout|Interval)\s*\(\s*['"`]/;
/** Una dirección de otro origen escrita en un script, en una constante o en la propia petición. */
const DIRECCION_EXTERNA = /['"`]((?:[a-z][a-z0-9+.-]*:)?\/\/[^'"`]*)['"`]/gi;
/**
 * Los espacios de nombres de XML que un script puede escribir: tienen forma de dirección pero no se piden a nadie
 * (Namespaces in XML 1.0, apartado 2; DOM, createElementNS). El de SVG lo usa la línea de evolución de «Datos
 * globales».
 */
const ESPACIOS_DE_NOMBRES = new Set(['http://www.w3.org/2000/svg']);
/** Un sumidero, por qué es un problema usarlo sin su política y, si no es siempre, cuándo cuenta. */
interface Sumidero {
  patron: RegExp;
  motivo: string;
  cuenta?: (script: string, codigo: string) => boolean;
}
/**
 * Lo que Trusted Types (la directiva require-trusted-types-for de la CSP) solo admite a través de una política de
 * scripts/confianza.js: la dirección de un Worker, del service worker o de una etiqueta <script> creada desde
 * un script pasa por urlDeGuion, y el HTML que se inserta, por htmlDeConfianza. Sin ellas, el navegador lo bloquea.
 */
const SUMIDEROS_SIN_POLITICA: readonly Sumidero[] = [
  { patron: /new\s+(?:Shared)?Worker\((?!\s*urlDeGuion\()/, motivo: 'arranca un Worker sin urlDeGuion' },
  { patron: /serviceWorker\.register\((?!\s*urlDeGuion\()/, motivo: 'registra el service worker sin urlDeGuion' },
  {
    // .src solo es un sumidero en un <script>: cuenta en los scripts que crean uno.
    patron: /\.src\s*=(?!=|\s*urlDeGuion\()/,
    motivo: 'da dirección a un guion sin urlDeGuion',
    cuenta: (_script, codigo) => /createElement\(\s*['"`]script['"`]/.test(codigo),
  },
  {
    // Fuera de los puntos documentados ya falla HTML_INSERTADO; aquí se mira que esos puntos usen la política.
    patron: /\b(?:inner|outer)HTML\s*=(?!=|\s*htmlDeConfianza\()/,
    motivo: 'inserta HTML sin htmlDeConfianza',
    cuenta: (script) => Object.hasOwn(HTML_INSERTADO, script),
  },
];

/** Enlaces informativos cerrados que declara cada extensión para sus guiones; no autorizan conexiones de red. */
const ENLACES_INFORMATIVOS: Readonly<Record<string, readonly string[]>> = {
  'scripts/recorrido/plan-formacion/contactos-proveedores.js': [
    'https://www.cibervoluntarios.org/es/contacto',
    'https://cibernarium.barcelonactiva.cat/contacte',
    'https://www.life-global.org/es/help',
    'https://ciber.be/introduccion-ecommerce',
  ],
  ...Object.fromEntries(
    EXTENSIONES.flatMap(({ excepcionesCsp }) => Object.entries(excepcionesCsp.enlacesInformativos)),
  ),
};
const ACCESO_DE_RED = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|\bimport\s*\(/;

/** Las direcciones de recursos de otro origen no están permitidas en los guiones del producto. */
function problemasDeOtroOrigen(script: string, js: string): string[] {
  const enlaces = ACCESO_DE_RED.test(sinComentariosJs(js)) ? [] : (ENLACES_INFORMATIVOS[script] ?? []);
  const externas = [...js.matchAll(DIRECCION_EXTERNA)]
    .map(([, direccion = '']) => direccion)
    .filter((direccion) => !ESPACIOS_DE_NOMBRES.has(direccion) && !enlaces.includes(direccion));
  return externas.length ? [`${script}: pide un recurso de otro origen (${externas.join(', ')})`] : [];
}

/** Los sumideros de Trusted Types que un script usa sin su política (scripts/confianza.js). */
function problemasDeConfianza(script: string, js: string): string[] {
  const codigo = sinComentariosJs(js);
  return SUMIDEROS_SIN_POLITICA.filter(
    ({ patron, cuenta }) => patron.test(codigo) && (cuenta?.(script, codigo) ?? true),
  ).map(({ motivo }) => `${script}: ${motivo} (scripts/confianza.js)`);
}

/**
 * Los problemas de CSP de un script: HTML insertado, código evaluado, style y otros orígenes. Las inserciones de HTML
 * y la evaluación de código se buscan sin los comentarios del script; el atributo style y las direcciones de otro
 * origen, sobre el texto entero (más estricto: la CSP no distingue un comentario de código, y un falso positivo se
 * arregla quitando la cadena, mientras que un falso negativo dejaría pasar un bloqueo en el navegador).
 *
 * @param script - La ruta del script, desde web/.
 * @param js - Su contenido.
 * @returns Un problema por incumplimiento; vacío si la CSP no bloquearía nada.
 */
export function comprobarCspScript(script: string, js: string): string[] {
  const problemas: string[] = [];
  const inserciones = [...sinComentariosJs(js).matchAll(INSERCIONES_DE_HTML)].length;
  if (inserciones !== (HTML_INSERTADO[script] ?? 0)) {
    problemas.push(`${script}: inserta HTML fuera del punto documentado`);
  }
  if (EVALUA_CODIGO.test(sinComentariosJs(js))) {
    problemas.push(`${script}: evalúa código o carga guiones (la CSP no lo admite)`);
  }
  if (ATRIBUTO_STYLE.test(js)) {
    problemas.push(`${script}: escribe un atributo style`);
  }
  return [...problemas, ...problemasDeConfianza(script, js), ...problemasDeOtroOrigen(script, js)];
}

/**
 * Los scripts que se revisan: los de scripts/ y los diccionarios, y también el service worker y sus piezas.
 *
 * @param publicados - Lo publicado de web/, con su ruta desde web/.
 * @returns Los scripts, en el mismo orden.
 */
export function scriptsRevisados(publicados: readonly string[]): string[] {
  return publicados.filter(
    (archivo) =>
      archivo === SERVICE_WORKER ||
      (CARPETAS_DE_JAVASCRIPT.some((carpeta) => archivo.startsWith(carpeta)) && archivo.endsWith('.js')),
  );
}

/**
 * Los problemas de CSP de todos los scripts revisados (scriptsRevisados). Las reglas de cada archivo son de sus
 * fuentes: la construcción las comprueba antes de empaquetar, y en la web ya preparada no se aplican a las salidas
 * minificadas del paquete, que ya no conservan los nombres de sus fuentes.
 *
 * @param publicados - Lo publicado de web/, con su ruta desde web/.
 * @param web - La carpeta de la web.
 * @param paquete - Las salidas del paquete del navegador, por su ruta desde web/, que no se revisan aquí.
 * @returns Los problemas de cada script, en orden.
 */
export function comprobarCspScripts(
  publicados: readonly string[],
  web: string = WEB,
  paquete?: ReadonlyMap<string, Uint8Array>,
): string[] {
  return scriptsRevisados(publicados.filter((archivo) => !paquete?.has(archivo))).flatMap((script) =>
    comprobarCspScript(script, leer(script, web)),
  );
}
