// El idioma de la página: escribe en ella los textos del diccionario y la cambia de idioma sin recargar. Solo se carga
// el diccionario que se usa (idiomas/cargar.js): el del idioma en curso al empezar y el del otro la primera vez que se
// pide (el recorrido lo trae antes, en cuanto termina de cargar: scripts/recorrido.js). A partir de ahí no se vuelve a
// pedir ese diccionario; el recorrido puede pedir las traducciones de datos oficiales que falten.
//
// Antes de cargar un diccionario, `escribir` conserva el contenido existente: mientras no ha llegado ningún
// diccionario, lo que se pide escribir se apunta (la clave queda en el elemento) y no se toca lo que se ve; en cuanto
// llega, iniciarIdioma reescribe la página entera, también en castellano. Si el diccionario del idioma elegido no
// llega, la página sigue en castellano, y ese idioma se puede volver a pedir (idiomas/cargar.js lo pide con otra marca,
// porque el navegador recuerda el fallo).
//
// Cada texto traducible del HTML lleva su clave: data-texto="clave" para el contenido y data-texto-<atributo>="clave"
// para aria-label, alt, title, placeholder y content. Si el elemento tiene elementos dentro (un enlace, un icono), su
// texto es una plantilla y {0}, {1}… marcan dónde va cada uno, en su orden original: se vuelven a colocar los mismos
// elementos, sin interpretar HTML. Todo se escribe con textContent, setAttribute y replaceChildren. Lo que pintan los
// scripts se escribe con `escribir` y `escribirAtributo`, que dejan en el elemento la misma clave (y sus valores, aquí
// en memoria): al cambiar de idioma se reescribe igual que el HTML. Un dato con versiones por idioma (textos.js,
// `conVersiones`) deja la marca data-dato (data-dato-<atributo> en un atributo) y se reescribe igual, con el `lang` de
// la versión que se ve; `reescribirTextos` lo vuelve a hacer cuando llega una versión que faltaba. Lo que está escrito
// en otra lengua y no cabe en un elemento aparte lleva su idioma propio (`marcarIdiomaPropio`), que ningún cambio de
// idioma le quita.
//
// El idioma inicial lo decide scripts/idioma-inicial.js antes de pintar (data-idioma en <html>). La elección de la
// persona se recuerda en localStorage («faro-idioma») solo como comodidad: sin almacenamiento, vale mientras la página
// esté abierta. Cada cambio queda medido en el panel de rendimiento del navegador (MEDIDA_DEL_CAMBIO).

import { cargarDiccionario } from '../idiomas/cargar.js';
import {
  ATRIBUTOS_TRADUCIBLES,
  esConVersiones,
  esIdioma,
  esLiteralEnIdioma,
  esTraducible,
  fijarIdioma,
  hayDiccionario,
  IDIOMA_DE_PARTIDA,
  idiomaActual,
  idiomaDeLaVersion,
  resolver,
  texto,
} from './textos.js';
import { versionCambiada } from './version.js';

/** @import { ConVersiones, Idioma, Parte, Valores } from './textos.js' */

/** La misma clave que lee idioma-inicial.js al cargar cada página. */
const CLAVE_IDIOMA = 'faro-idioma';
/** Los selectores de todo lo que lleva clave o dato: el contenido y cada atributo traducible. */
const CON_CLAVE = [
  '[data-texto]',
  '[data-dato]',
  ...ATRIBUTOS_TRADUCIBLES.map((atributo) => `[data-texto-${atributo}]`),
  ...ATRIBUTOS_TRADUCIBLES.map((atributo) => `[data-dato-${atributo}]`),
].join(',');
/** {0}, {1}…: el hijo de esa posición. Separa la plantilla en textos y marcas de hijo. */
const MARCA_DE_HIJO = /(\{\d+\})/;
/** Una marca de hijo entera, con su posición capturada. */
const POSICION_DE_HIJO = /^\{(\d+)\}$/;
/** El nombre con que se mide cada cambio de idioma (performance.measure). */
const MEDIDA_DEL_CAMBIO = 'faro-cambio-de-idioma';
/**
 * El manifiesto de cada idioma, que es donde están el nombre y la descripción con que se instala Faro (los dos
 * manifiestos tienen el mismo `id`: para el sistema son la misma aplicación). La primera vez lo apunta, antes de
 * pintar, scripts/idioma-inicial.js, con la misma lista.
 * @type {Record<Idioma, string>}
 */
const MANIFIESTOS = Object.freeze({ es: 'manifest.webmanifest', ca: 'manifest-ca.webmanifest' });
/** El elemento <html> de la página. */
const raiz = document.documentElement;

/** Los valores de los textos que pintan los scripts, por elemento y por atributo ('' es el contenido).
 * @type {WeakMap<HTMLElement, Map<string, Valores>>}
 */
const valoresDe = new WeakMap();
/** Los elementos hijos de cada elemento con plantilla, tal como venían en el HTML.
 * @type {WeakMap<HTMLElement, Element[]>}
 */
const hijosDe = new WeakMap();
/** El dato con versiones que muestra cada elemento marcado con data-dato.
 * @type {WeakMap<HTMLElement, ConVersiones>}
 */
const datoDe = new WeakMap();
/** El dato con versiones de cada atributo marcado con data-dato-<atributo>, por elemento y por atributo.
 * @type {WeakMap<HTMLElement, Map<string, ConVersiones>>}
 */
const datosDeAtributos = new WeakMap();
/** @type {Set<(idioma: Idioma) => void>} */
const alCambiar = new Set();
/** El último idioma que ha pedido la persona: si pide otro mientras llega un diccionario, manda el último.
 * @type {string | null}
 */
let idiomaPedido = null;

/**
 * Lo que dice cambiarIdioma cuando el diccionario que falta ya no se puede pedir porque, desde que se abrió la página,
 * se ha activado una versión nueva de Faro: llegaría de esa versión, y sus claves pueden no ser las de esta página.
 */
export class VersionNueva extends Error {
  /** @override */
  name = 'VersionNueva';
}

/**
 * Lo que dice cambiarIdioma cuando el diccionario que falta no ha llegado (sin red, o con la descarga cortada): la
 * página se queda como estaba. `cause` es el fallo de la carga.
 */
export class DiccionarioNoCargado extends Error {
  /** @override */
  name = 'DiccionarioNoCargado';
}

/**
 * El atributo data-* donde se apunta la clave del texto de `atributo`.
 * @param {string} atributo El atributo traducible (aria-label, title…).
 * @returns {string} «data-texto-<atributo>».
 */
function atributoDeTexto(atributo) {
  return `data-texto-${atributo}`;
}
/**
 * El atributo data-* que marca que `atributo` lleva un dato con versiones.
 * @param {string} atributo El atributo traducible (aria-label, title…).
 * @returns {string} «data-dato-<atributo>».
 */
function atributoDeDato(atributo) {
  return `data-dato-${atributo}`;
}

/**
 * Hay textos que escribir: el diccionario del idioma en curso o, si falta, el de partida, que tiene las mismas
 * claves.
 */
function hayTextos() {
  return hayDiccionario(idiomaActual()) || hayDiccionario(IDIOMA_DE_PARTIDA);
}

/**
 * Apunta `valor` para el atributo de un elemento en un mapa por elemento y por atributo.
 * @template Valor
 * @param {WeakMap<HTMLElement, Map<string, Valor>>} mapa El mapa donde se apunta.
 * @param {HTMLElement} elemento El elemento.
 * @param {string} atributo El atributo ('' es el contenido).
 * @param {Valor} valor Lo que se apunta.
 * @returns {void}
 */
function guardarEnMapa(mapa, elemento, atributo, valor) {
  const delElemento = mapa.get(elemento) ?? new Map();
  delElemento.set(atributo, valor);
  mapa.set(elemento, delElemento);
}

/**
 * Apunta los valores del texto de un elemento o de uno de sus atributos.
 * @param {HTMLElement} elemento El elemento.
 * @param {string} atributo El atributo ('' es el contenido).
 * @param {Valores} valores Los valores de la plantilla.
 * @returns {void}
 */
function guardarValores(elemento, atributo, valores) {
  guardarEnMapa(valoresDe, elemento, atributo, valores);
}

/** @param {HTMLElement} elemento @param {string} atributo @returns {Valores} */
function valoresGuardados(elemento, atributo) {
  return valoresDe.get(elemento)?.get(atributo) ?? {};
}

/** Los hijos originales del elemento: se toman la primera vez, antes de reescribirlo.
 * @param {HTMLElement} elemento @returns {Element[]}
 */
function hijosOriginales(elemento) {
  let hijos = hijosDe.get(elemento);
  if (!hijos) {
    hijos = [...elemento.children];
    hijosDe.set(elemento, hijos);
  }
  return hijos;
}

/** Los nodos de una plantilla con hijos: cada texto como texto y cada {posición}, el hijo de esa posición.
 * @param {string} plantilla @param {Element[]} hijos @returns {Node[]}
 */
function nodosDePlantilla(plantilla, hijos) {
  return plantilla
    .split(MARCA_DE_HIJO)
    .filter(Boolean)
    .map((parte) => {
      const posicion = POSICION_DE_HIJO.exec(parte);
      return posicion ? hijos[Number(posicion[1])] : document.createTextNode(parte);
    })
    .filter((nodo) => nodo !== undefined);
}

/**
 * El texto traducido va en el idioma de la página. Si el elemento está dentro de otro idioma (una cita en catalán),
 * se marca con el suyo, para que los lectores de pantalla lo lean bien. Un elemento con idioma propio
 * (data-idioma-propio, de `marcarIdiomaPropio`) guarda el suyo: su contenido no está en el idioma de la página aunque
 * lo escriba el diccionario (una tarea de la OIT que solo existe en inglés, WCAG 3.1.2).
 * @param {HTMLElement} elemento
 */
function marcarIdiomaSiHaceFalta(elemento) {
  const propio = elemento.dataset.idiomaPropio;
  if (propio) {
    elemento.lang = propio;
    return;
  }
  // El antecesor con lang es un elemento HTML; uno de SVG no tiene la propiedad, y entonces vale el de la página.
  const antecesor = elemento.parentElement?.closest('[lang]');
  const heredado = antecesor && 'lang' in antecesor && typeof antecesor.lang === 'string' ? antecesor.lang : raiz.lang;
  if (heredado !== idiomaActual() || elemento.hasAttribute('lang')) {
    elemento.lang = idiomaActual();
  }
}

/** @param {HTMLElement} elemento */
function escribirContenido(elemento) {
  // Sin diccionario, la clave se queda apuntada y lo que se ve no cambia: se escribe en cuanto llega (iniciarIdioma).
  const clave = elemento.dataset.texto;
  if (!hayTextos() || !clave) {
    return;
  }
  const valor = texto(clave, valoresGuardados(elemento, ''));
  const hijos = hijosOriginales(elemento);
  if (hijos.length) {
    elemento.replaceChildren(...nodosDePlantilla(valor, hijos));
  } else if (elemento.textContent !== valor) {
    elemento.textContent = valor;
  }
  marcarIdiomaSiHaceFalta(elemento);
}

/** El dato del elemento en la versión del idioma en curso (o en la de partida), marcado con el idioma que se ve.
 * @param {HTMLElement} elemento
 */
function escribirDato(elemento) {
  const dato = datoDe.get(elemento);
  if (!dato) {
    return;
  }
  const valor = resolver(dato);
  if (elemento.textContent !== valor) {
    elemento.textContent = valor;
  }
  elemento.lang = idiomaDeLaVersion(dato);
}

/** @param {HTMLElement} elemento @param {string} atributo */
function escribirAtributoConClave(elemento, atributo) {
  const clave = elemento.getAttribute(atributoDeTexto(atributo));
  if (!hayTextos() || !clave) {
    return;
  }
  elemento.setAttribute(atributo, texto(clave, valoresGuardados(elemento, atributo)));
}

/**
 * El dato del atributo en la versión del idioma en curso (o en la de partida). El elemento lleva el `lang` de esa
 * versión: un nombre accesible en castellano en una página en catalán se lee con su voz.
 * @param {HTMLElement} elemento @param {string} atributo
 */
function escribirAtributoConDato(elemento, atributo) {
  const dato = datosDeAtributos.get(elemento)?.get(atributo);
  if (!dato) {
    return;
  }
  elemento.setAttribute(atributo, resolver(dato));
  elemento.lang = idiomaDeLaVersion(dato);
}

/** Escribe en el idioma en curso todos los textos con clave de `elemento` (contenido y atributos).
 * @param {HTMLElement} elemento
 */
function traducirElemento(elemento) {
  if (elemento.dataset.texto) {
    escribirContenido(elemento);
  }
  if ('dato' in elemento.dataset) {
    escribirDato(elemento);
  }
  for (const atributo of ATRIBUTOS_TRADUCIBLES) {
    if (elemento.hasAttribute(atributoDeTexto(atributo))) {
      escribirAtributoConClave(elemento, atributo);
    }
    if (elemento.hasAttribute(atributoDeDato(atributo))) {
      escribirAtributoConDato(elemento, atributo);
    }
  }
}

/** Escribe en el idioma en curso todos los textos con clave de la página (también los de <head>). */
function traducirPagina() {
  for (const elemento of document.querySelectorAll(CON_CLAVE)) {
    if (elemento instanceof HTMLElement) {
      traducirElemento(elemento);
    }
  }
}

/** @param {Idioma} idioma */
function recordarIdioma(idioma) {
  try {
    localStorage.setItem(CLAVE_IDIOMA, idioma);
  } catch {
    // Sin almacenamiento, el idioma elegido vale mientras la página esté abierta.
  }
}

/**
 * Pone el idioma en curso en <html>: lang para los lectores de pantalla y data-idioma para las hojas de estilo, y
 * apunta el manifiesto de ese idioma (MANIFIESTOS).
 */
function marcarIdiomaDeLaPagina() {
  raiz.lang = idiomaActual();
  raiz.dataset.idioma = idiomaActual();
  const enlace = document.querySelector('link[rel=manifest]');
  const ruta = enlace?.getAttribute('href');
  if (enlace && ruta) {
    enlace.setAttribute('href', new URL(MANIFIESTOS[idiomaActual()], new URL(ruta, document.baseURI)).href);
  }
}

/** Pone la página entera en `idioma`, cuyo diccionario ya está cargado, y avisa a quien lo haya pedido.
 * @param {Idioma} idioma
 */
function aplicarIdioma(idioma) {
  const inicio = performance.now();
  fijarIdioma(idioma);
  marcarIdiomaDeLaPagina();
  traducirPagina();
  for (const funcion of alCambiar) {
    avisarConsumidor(funcion, idioma);
  }
  performance.measure(MEDIDA_DEL_CAMBIO, { start: inicio });
}

/**
 * Llama a un consumidor de alCambiarIdioma aislando su fallo: uno que lanza, o que devuelve una promesa que rechaza,
 * deja su error en la consola y no impide avisar a los siguientes ni terminar el cambio.
 * @param {(idioma: Idioma) => void} funcion @param {Idioma} idioma
 */
function avisarConsumidor(funcion, idioma) {
  try {
    Promise.resolve(funcion(idioma)).catch((error) => console.error(error));
  } catch (error) {
    console.error(error);
  }
}

/**
 * Trae el diccionario de `idioma` si falta; si ya no se puede traer de esta versión de Faro, lo dice (VersionNueva), y
 * si no llega, DiccionarioNoCargado.
 * @param {Idioma} idioma
 */
async function traerDiccionario(idioma) {
  if (hayDiccionario(idioma)) {
    return;
  }
  if (versionCambiada()) {
    throw new VersionNueva(`El diccionario «${idioma}» llegaría de otra versión de Faro`);
  }
  try {
    await cargarDiccionario(idioma);
  } catch (error) {
    throw new DiccionarioNoCargado(`El diccionario «${idioma}» no ha llegado`, { cause: error });
  }
}

/** Carga el diccionario de `idioma` y dice si ha llegado.
 * @param {Idioma} idioma
 */
async function seHaCargado(idioma) {
  try {
    await cargarDiccionario(idioma);
    return true;
  } catch (error) {
    console.warn(`Faro no ha podido cargar el diccionario «${idioma}».`, error);
    return false;
  }
}

// ---------- Lo que usan los demás scripts ----------

/**
 * Escribe `parte` como contenido de `elemento`: un traducible (textos.js) en el idioma en curso, que se reescribe al
 * cambiar de idioma; un dato con versiones (conVersiones), en la del idioma en curso, que también se reescribe; un
 * literal con su idioma (enIdioma), tal cual y marcado con él; cualquier otro texto, tal cual.
 * @template {HTMLElement} Elemento
 * @param {Elemento} elemento @param {Parte} parte
 * @returns {Elemento} el mismo elemento, para encadenar
 */
export function escribir(elemento, parte) {
  elemento.removeAttribute('data-texto');
  elemento.removeAttribute('data-dato');
  if (esTraducible(parte)) {
    elemento.dataset.texto = parte.clave;
    guardarValores(elemento, '', parte.valores);
    escribirContenido(elemento);
    return elemento;
  }
  if (esConVersiones(parte)) {
    elemento.dataset.dato = '';
    datoDe.set(elemento, parte);
    escribirDato(elemento);
    return elemento;
  }
  if (esLiteralEnIdioma(parte)) {
    elemento.textContent = parte.literal;
    elemento.lang = parte.idioma;
    return elemento;
  }
  elemento.textContent = String(parte ?? '');
  return elemento;
}

/**
 * Marca `elemento` con un idioma propio, distinto del de la página, que no cambia al cambiar el de la página: lo que
 * está escrito en otra lengua (una tarea de la OIT que solo se publica en inglés) se lee con su voz (WCAG 3.1.2).
 * Hace falta cuando el texto no cabe en un elemento aparte: el rótulo de un `<option>`.
 * @template {HTMLElement} Elemento
 * @param {Elemento} elemento @param {string} idioma
 * @returns {Elemento} el mismo elemento, para encadenar
 */
export function marcarIdiomaPropio(elemento, idioma) {
  elemento.dataset.idiomaPropio = idioma;
  elemento.lang = idioma;
  return elemento;
}

/**
 * Escribe `parte` en el atributo `atributo` de `elemento`: un traducible o un dato con versiones se reescriben si el
 * atributo está en ATRIBUTOS_TRADUCIBLES. Los demás valores se convierten con String (null queda vacío).
 * @param {HTMLElement} elemento @param {string} atributo @param {Parte} parte @returns {void}
 */
export function escribirAtributo(elemento, atributo, parte) {
  elemento.removeAttribute(atributoDeTexto(atributo));
  elemento.removeAttribute(atributoDeDato(atributo));
  if (esConVersiones(parte)) {
    guardarEnMapa(datosDeAtributos, elemento, atributo, parte);
    elemento.setAttribute(atributoDeDato(atributo), '');
    escribirAtributoConDato(elemento, atributo);
    return;
  }
  if (!esTraducible(parte)) {
    elemento.setAttribute(atributo, String(parte ?? ''));
    return;
  }
  elemento.setAttribute(atributoDeTexto(atributo), parte.clave);
  guardarValores(elemento, atributo, parte.valores);
  escribirAtributoConClave(elemento, atributo);
}

/**
 * Vuelve a escribir todos los textos con clave y todos los datos de la página en el idioma en curso. Lo usa quien
 * recibe una versión que faltaba (la traducción de un dato ya pintado), sin cambiar de idioma.
 * @returns {void}
 */
export function reescribirTextos() {
  traducirPagina();
}

/**
 * `funcion(idioma)` se llama después de cada cambio de idioma, una vez por función aunque se registre varias veces;
 * su fallo se queda en la consola (avisarConsumidor). Con `signal`, deja de llamarse cuando se aborta: quien pinta algo
 * que se sustituye (un informe) se da de baja con la misma señal que retira sus oyentes.
 * @param {(idioma: Idioma) => void} funcion Lo que se llama con el idioma nuevo, ya escrita la página.
 * @param {{ signal?: AbortSignal }} [opciones] `signal`, la que da de baja a `funcion`.
 * @returns {void}
 */
export function alCambiarIdioma(funcion, { signal } = {}) {
  if (signal?.aborted) {
    return;
  }
  alCambiar.add(funcion);
  signal?.addEventListener('abort', () => alCambiar.delete(funcion), { once: true });
}

/**
 * Cambia la página entera a `idioma` y lo recuerda. Un idioma que no es de la web no cambia nada. La función espera su
 * diccionario si falta; después reescribe el DOM y llama a los consumidores registrados, sin aguardar sus promesas. Si
 * mientras llega la persona pide otro idioma, manda el último: este ya no se aplica. Si no llega (sin red, o con una
 * versión nueva ya activa), la página se queda como estaba y el fallo se propaga, para que quien lo pidió lo diga; si
 * entretanto se pidió otro idioma, el fallo ya no importa y no se propaga. La elección se recuerda antes de avisar a
 * los consumidores, cuyos fallos no interrumpen el cambio.
 * @param {string} idioma El idioma pedido; uno que no es de la web se ignora.
 * @returns {Promise<void>} Se cumple con la página ya escrita en `idioma` (o sin cambios, si no aplica).
 * @throws {DiccionarioNoCargado} Si el diccionario no llega (la promesa rechaza).
 * @throws {VersionNueva} Si el diccionario llegaría de una versión de Faro activada después de abrir la página.
 */
export async function cambiarIdioma(idioma) {
  if (!esIdioma(idioma)) {
    return;
  }
  idiomaPedido = idioma;
  if (idioma === idiomaActual()) {
    return;
  }
  try {
    await traerDiccionario(idioma);
  } catch (error) {
    if (idiomaPedido === idioma) {
      throw error;
    }
    return;
  }
  if (idiomaPedido !== idioma) {
    return;
  }
  recordarIdioma(idioma);
  aplicarIdioma(idioma);
}

/**
 * Escribe la página en el idioma que decidió idioma-inicial.js y la deja ver. La reescribe entera también en
 * castellano: lo que un script haya pintado antes de que llegara el diccionario solo tiene su clave apuntada. Si el
 * diccionario elegido no llega, se pide el castellano (o se vuelve a pedir, si era ese) y la página sigue en
 * castellano, el de su HTML; si tampoco llega, se queda con su HTML, sin ninguna clave a la vista. Absorbe los fallos
 * de carga de diccionarios y devuelve si llegó el elegido; los fallos posteriores de reescritura no se capturan aquí.
 * @returns {Promise<boolean>}
 */
export async function iniciarIdioma() {
  const elegido = esIdioma(raiz.dataset.idioma) ? raiz.dataset.idioma : IDIOMA_DE_PARTIDA;
  const conElElegido = await seHaCargado(elegido);
  if (!conElElegido) {
    await seHaCargado(IDIOMA_DE_PARTIDA);
  }
  fijarIdioma(conElElegido ? elegido : IDIOMA_DE_PARTIDA);
  marcarIdiomaDeLaPagina();
  traducirPagina();
  delete raiz.dataset.traduciendo;
  return conElElegido;
}
