// Piezas pequeñas para trabajar con el DOM que comparten varios scripts: pedir un elemento de la página comprobado,
// crear elementos sin HTML y saber si un clic cayó fuera de un diálogo modal.

/**
 * Las propiedades que convierten un texto en HTML: `crear` no las acepta, para que nadie las use sin darse cuenta (la
 * única inserción de HTML está documentada en herramientas/web/csp.ts, HTML_INSERTADO). Solo vigila el HTML y los
 * manejadores en línea; lo que ejecutaría código por otras vías (el `text` de un <script>, un `href` con `javascript:`)
 * lo frena la política de contenidos de la página, no esta lista.
 */
const PROPIEDADES_PROHIBIDAS = new Set(['innerHTML', 'outerHTML', 'srcdoc']);

/**
 * Las etiquetas que se crean en un documento sin política de contenidos y se adoptan después. En una página con
 * `style-src 'self'`, WebKit registra una infracción de style-src-attr («inline») al crear cada <select>, aunque nadie
 * le escriba estilo y se pinte igual: sale en la consola y, con report-to, va al punto de avisos. Creado en un
 * documento de createHTMLDocument, que no tiene CSP, y adoptado después, no registra ninguna.
 */
const CREADAS_FUERA_DE_LA_PAGINA = new Set(['select']);

/** El documento sin política de contenidos donde se crean las de CREADAS_FUERA_DE_LA_PAGINA; uno por página. */
let documentoSinPolitica = /** @type {Document | null} */ (null);

/** `crear` ha recibido una propiedad que interpretaría HTML (PROPIEDADES_PROHIBIDAS) o un manejador en línea (on…). */
export class PropiedadProhibida extends TypeError {
  /** @override */
  name = 'PropiedadProhibida';
}

/**
 * A la página le falta un elemento que su script da por hecho, o lo tiene de otra clase: el script está en otra
 * página o el HTML ha cambiado. Es un error del programa, no de la persona.
 */
export class PaginaIncompleta extends Error {
  /** @override */
  name = 'PaginaIncompleta';
}

/**
 * El elemento de la página con ese id. La página lo tiene siempre (es su HTML el que lo pone), así que, si falta o no
 * es de la clase pedida (un <dialog>, un <textarea>), lanza PaginaIncompleta y dice cuál, en vez de fallar más tarde
 * con un null. Para un elemento que puede no estar, getElementById.
 * @overload
 * @param {string} id
 * @returns {HTMLElement}
 */
/**
 * @template {HTMLElement} Elemento
 * @overload
 * @param {string} id
 * @param {abstract new () => Elemento} Clase
 * @returns {Elemento}
 */
/**
 * @param {string} id El id del elemento, sin «#».
 * @param {abstract new () => HTMLElement} [Clase] La clase que debe tener; sin ella, cualquier HTMLElement.
 * @returns {HTMLElement} El elemento de la página.
 * @throws {PaginaIncompleta} Si la página no tiene ese id o el elemento no es de la clase pedida.
 */
export function porId(id, Clase) {
  const elemento = document.getElementById(id);
  if (!elemento) {
    throw new PaginaIncompleta(`La página no tiene #${id}`);
  }
  if (Clase && !(elemento instanceof Clase)) {
    throw new PaginaIncompleta(`#${id} no es un ${Clase.name}`);
  }
  return elemento;
}

/**
 * Un elemento nuevo de la página, todavía sin propiedades; los de CREADAS_FUERA_DE_LA_PAGINA, adoptados de un documento
 * sin política de contenidos.
 * @template {keyof HTMLElementTagNameMap} Etiqueta
 * @param {Etiqueta} etiqueta
 * @returns {HTMLElementTagNameMap[Etiqueta]}
 */
function elementoNuevo(etiqueta) {
  if (!CREADAS_FUERA_DE_LA_PAGINA.has(etiqueta)) {
    return document.createElement(etiqueta);
  }
  documentoSinPolitica ??= document.implementation.createHTMLDocument('');
  return document.adoptNode(documentoSinPolitica.createElement(etiqueta));
}

/**
 * Crea un elemento con sus propiedades (textContent, className, id…) y sus hijos. Nunca interpreta HTML: el texto de
 * la persona y el de la API entran siempre como texto, y una propiedad que interpretaría HTML (innerHTML, outerHTML,
 * srcdoc) o un manejador en línea (onclick…) lanza PropiedadProhibida.
 * @template {keyof HTMLElementTagNameMap} Etiqueta
 * @param {Etiqueta} etiqueta La etiqueta HTML del elemento.
 * @param {Partial<HTMLElementTagNameMap[Etiqueta]>} propiedades Las propiedades que se le asignan, tal cual.
 * @param {...(Node | string)} hijos Los nodos y textos que se le añaden, en orden; un texto entra como texto.
 * @returns {HTMLElementTagNameMap[Etiqueta]} El elemento, todavía fuera de la página.
 * @throws {PropiedadProhibida} Si una propiedad interpretaría HTML (innerHTML, outerHTML, srcdoc) o es un manejador on….
 */
export function crear(etiqueta, propiedades = {}, ...hijos) {
  const prohibida = Object.keys(propiedades).find(
    (nombre) => PROPIEDADES_PROHIBIDAS.has(nombre) || nombre.toLowerCase().startsWith('on'),
  );
  if (prohibida) {
    throw new PropiedadProhibida(`crear(): la propiedad «${prohibida}» interpretaría HTML o código`);
  }
  const elemento = Object.assign(elementoNuevo(etiqueta), propiedades);
  elemento.append(...hijos);
  return elemento;
}

/**
 * El clic en el velo de un diálogo modal llega al propio diálogo, con coordenadas fuera de su caja. Un clic en el
 * relleno del diálogo también llega al diálogo, pero dentro de su caja: ese no lo cierra.
 * @param {HTMLDialogElement} dialogo El diálogo abierto como modal.
 * @param {MouseEvent} evento El clic.
 * @returns {boolean} Si el clic cayó en el velo, fuera de la caja del diálogo.
 */
export function pulsaFuera(dialogo, evento) {
  if (evento.target !== dialogo) {
    return false;
  }
  const caja = dialogo.getBoundingClientRect();
  const fueraEnHorizontal = evento.clientX < caja.left || evento.clientX > caja.right;
  const fueraEnVertical = evento.clientY < caja.top || evento.clientY > caja.bottom;
  return fueraEnHorizontal || fueraEnVertical;
}
