// Una sola copia de cada texto corto que se repite en un valor leído de JSON. JSON.parse crea una cadena nueva para
// cada valor, aunque sea igual a otra («Presencial», «capacidad_competencia», el nombre de una familia profesional): en
// los archivos grandes del paquete, miles de copias del mismo texto. Una cadena de JavaScript no se puede cambiar y se
// compara por su contenido, así que sustituir una copia por otra igual no cambia nada de lo que el código puede ver;
// solo deja de ocupar memoria la copia sobrante.

/**
 * La longitud máxima de los textos que se comparten. Los que se repiten son valores cortos: categorías, tipos, unidades
 * y nombres. Los largos (descripciones, enlaces) casi nunca se repiten, y guardarlos en el mapa de las vistas solo
 * agrandaría el pico de memoria mientras se recorre el valor.
 */
export const LARGO_MAXIMO_COMPARTIDO = 64;

/** Si un valor es un objeto simple, de los que crea JSON.parse (ni una lista ni un objeto de otra clase). */
function esObjetoSimple(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && Object.getPrototypeOf(valor) === Object.prototype;
}

/** Si un valor es una lista o un objeto simple: los únicos que se recorren. */
function esDeJson(valor: unknown): valor is Record<string, unknown> | unknown[] {
  return Array.isArray(valor) || esObjetoSimple(valor);
}

/** Lo que hay que hacer con cada valor de una lista u objeto: la copia que lo sustituye, si es un texto repetido. */
type CopiaDe = (contenido: unknown) => string | undefined;

/** Sustituye en una lista cada texto repetido por su copia guardada. */
function compartirEnLista(lista: unknown[], copiaDe: CopiaDe): void {
  for (let i = 0; i < lista.length; i++) {
    const copia = copiaDe(lista[i]);
    if (copia !== undefined) {
      lista[i] = copia;
    }
  }
}

/** Sustituye en un objeto cada propiedad con un texto repetido por su copia guardada. */
function compartirEnObjeto(objeto: Record<string, unknown>, copiaDe: CopiaDe): void {
  for (const clave of Object.keys(objeto)) {
    const copia = copiaDe(objeto[clave]);
    if (copia !== undefined) {
      objeto[clave] = copia;
    }
  }
}

/**
 * Recorre `valor`, recién leído de JSON, y deja una sola copia de cada texto de hasta LARGO_MAXIMO_COMPARTIDO
 * caracteres: la primera que encuentra. Cambia el valor en su sitio y lo devuelve. Solo entra en listas y objetos
 * simples, con sus propiedades de datos, como los que da JSON.parse (en una propiedad propia «__proto__» también se
 * asigna la propiedad, no el prototipo); los objetos de otras clases, como un Int32Array, quedan igual. Recorre con una
 * pila propia, sin recursión, y el mapa de las vistas vive lo que dura el recorrido.
 *
 * @param valor - Un árbol de objetos, listas y textos.
 * @returns El mismo árbol con los textos repetidos compartidos.
 */
export function conTextosCompartidos<Valor>(valor: Valor): Valor {
  const vistas = new Map<string, string>();
  const pendientes: unknown[] = [];
  // Un texto corto ya visto devuelve su primera copia; uno nuevo se guarda; una lista u objeto queda pendiente.
  const copiaDe: CopiaDe = (contenido) => {
    if (typeof contenido !== 'string') {
      if (esDeJson(contenido)) {
        pendientes.push(contenido);
      }
      return undefined;
    }
    if (contenido.length > LARGO_MAXIMO_COMPARTIDO) {
      return undefined;
    }
    const vista = vistas.get(contenido);
    if (vista === undefined) {
      vistas.set(contenido, contenido);
    }
    return vista;
  };
  copiaDe(valor);
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (Array.isArray(actual)) {
      compartirEnLista(actual, copiaDe);
    } else if (esObjetoSimple(actual)) {
      compartirEnObjeto(actual, copiaDe);
    }
  }
  return valor;
}
