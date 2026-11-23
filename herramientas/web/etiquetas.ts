// Cómo se leen las etiquetas de una página: cada etiqueta de apertura o de cierre con sus atributos, entre comillas
// dobles, simples o sin comillas, y sin valor. Lo usan las comprobaciones de la CSP, de las páginas y de las hojas.
//
// Límites: el analizador es léxico (expresiones regulares), no el del navegador. Dentro de un <script> o un <style>, un
// «<b» o un «</x>» se toma por una etiqueta; y los comentarios solo se quitan si quien llama usa sinComentariosHtml.

/** Una etiqueta de apertura o de cierre con sus atributos, en minúsculas; un atributo sin valor vale null. */
export interface Etiqueta {
  nombre: string;
  cierre: boolean;
  atributos: Map<string, string | null>;
  texto: string;
}

/**
 * Una etiqueta HTML con sus atributos: entre comillas dobles, simples o sin comillas, y sin valor. Grupos de captura:
 * 1 la barra de cierre («/» o nada); 2 el nombre; 3 todos los atributos juntos (leerAtributos los separa).
 */
const PATRON_ETIQUETA = /<(\/?)([a-z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/gi;
/**
 * Un atributo. Grupos de captura: 1 el nombre; 2, 3 y 4 el valor entre comillas dobles, entre simples o sin comillas
 * (a lo sumo uno); ninguno de los tres si el atributo no tiene valor.
 */
const PATRON_ATRIBUTO = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * La página sin sus comentarios HTML, que no cuentan como contenido.
 *
 * @param html - El texto de la página.
 * @returns El mismo texto sin cada «<!-- … -->».
 */
export function sinComentariosHtml(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Los atributos de una etiqueta. Si uno se repite vale el primero, como en el navegador (HTML Living Standard,
 * «attribute name state»: un atributo repetido se descarta), para comprobar lo mismo que se ejecuta.
 */
function leerAtributos(texto: string): Map<string, string | null> {
  const atributos = new Map<string, string | null>();
  for (const [, nombre = '', doble, simple, sinComillas] of texto.matchAll(PATRON_ATRIBUTO)) {
    const clave = nombre.toLowerCase();
    if (!atributos.has(clave)) {
      atributos.set(clave, doble ?? simple ?? sinComillas ?? null);
    }
  }
  return atributos;
}

/**
 * Todas las etiquetas de la página, de apertura y de cierre, en orden.
 *
 * @param html - El texto de la página (con o sin comentarios: quien llama decide si los quita antes).
 * @returns Cada etiqueta con su nombre y sus atributos en minúsculas.
 */
export function etiquetasDe(html: string): Etiqueta[] {
  return [...html.matchAll(PATRON_ETIQUETA)].map(([texto, barra, nombre = '', atributos = '']) => ({
    nombre: nombre.toLowerCase(),
    cierre: barra === '/',
    atributos: leerAtributos(atributos),
    texto,
  }));
}

/**
 * Las etiquetas de apertura; con `nombre`, solo las de ese elemento.
 *
 * @param etiquetas - Las etiquetas de una página (etiquetasDe).
 * @param nombre - El elemento, en minúsculas; sin él, todas las aperturas.
 * @returns Las aperturas, en el mismo orden.
 */
export function aperturas(etiquetas: readonly Etiqueta[], nombre?: string): Etiqueta[] {
  return etiquetas.filter((etiqueta) => !etiqueta.cierre && (!nombre || etiqueta.nombre === nombre));
}
