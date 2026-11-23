// Conjuntos de textos que solo se consultan, en poca memoria: los textos, ordenados y sin repetir, y una búsqueda
// binaria (log2(n) comparaciones) en lugar de la tabla de dispersión de un Set, que ocupa varias veces lo que sus
// entradas. Dos formas: una lista de textos ordenados (`textosOrdenados` y `estaEnLosOrdenados`), si los textos ya
// están en memoria por otro lado, y `ListaOrdenada`, que además los une en una sola cadena, si el conjunto es lo único
// que los guarda: un Set guarda cada texto como una cadena aparte, con su cabecera.
//
// `ListaOrdenada` recibe los textos ya ordenados y sin repetir (las listas del paquete las escribe así la cadena de
// datos): solo lo comprueba, en una pasada, y no ordena nada al arrancar; su búsqueda compara en su sitio, dentro de
// la cadena unida, sin copiar ningún texto. El orden es el de `<`, por unidades UTF-16, el mismo de `sort()` sin
// función de comparación. Las dos formas responden lo mismo que un Set.

/** Lo que separa un texto del siguiente en la cadena: ningún texto de la lista puede llevarlo. */
const SEPARADOR = '\n';

/**
 * Los textos sin repetir y en el orden de `<`: la forma que consulta `estaEnLosOrdenados`. Ordena una copia y quita
 * los repetidos, que quedan juntos, en la misma pasada: sin el Set intermedio, que costaría más CPU al arrancar.
 *
 * @param textos - Los textos a ordenar.
 * @returns Una copia ordenada por la comparación del proyecto.
 */
export function textosOrdenados(textos: readonly string[]): string[] {
  const ordenados = [...textos].sort();
  let cuantos = 0;
  for (const texto of ordenados) {
    if (cuantos === 0 || texto !== ordenados[cuantos - 1]) {
      ordenados[cuantos++] = texto;
    }
  }
  ordenados.length = cuantos;
  return ordenados;
}

/**
 * Si `buscado` está en `ordenados`, una lista que da `textosOrdenados`: lo mismo que `has` de un Set con ellos. Esta
 * búsqueda y la de `ListaOrdenada.has` van escritas aparte, sin una función común que reciba la comparación: una
 * función común con dos comparaciones distintas haría una llamada por paso y frenaría la búsqueda en caliente.
 *
 * @param ordenados - La lista ya ordenada por textosOrdenados.
 * @param buscado - El texto a buscar.
 * @returns Si el texto está en la lista.
 */
export function estaEnLosOrdenados(ordenados: readonly string[], buscado: string): boolean {
  let desde = 0;
  let hasta = ordenados.length - 1;
  // Cada vuelta deja fuera la mitad del tramo [desde, hasta]: el bucle termina tras log2(n) + 1 vueltas a lo sumo.
  while (desde <= hasta) {
    const medio = (desde + hasta) >>> 1;
    // `medio` queda dentro de [desde, hasta], ambos índices de la lista.
    const texto = ordenados[medio] as string;
    if (texto === buscado) {
      return true;
    }
    if (texto < buscado) {
      desde = medio + 1;
    } else {
      hasta = medio - 1;
    }
  }
  return false;
}

/**
 * Compara el texto de `unidos` entre `inicio` y `fin` con `buscado`, unidad UTF-16 a unidad UTF-16, como `<`:
 * negativo si va antes, cero si es el mismo texto y positivo si va después.
 */
function comparar(unidos: string, inicio: number, fin: number, buscado: string): number {
  const largo = fin - inicio;
  const comun = Math.min(largo, buscado.length);
  for (let k = 0; k < comun; k++) {
    const diferencia = unidos.charCodeAt(inicio + k) - buscado.charCodeAt(k);
    if (diferencia !== 0) {
      return diferencia;
    }
  }
  return largo - buscado.length;
}

/** Textos que solo se consultan, guardados en una cadena ordenada con la posición de cada uno. */
export class ListaOrdenada {
  /** Los textos ordenados, unidos con el separador. */
  private readonly unidos: string;
  /**
   * Dónde empieza cada texto en `unidos`. La última posición es la que tendría un texto más, tras el separador del
   * último: así cada texto `i` acaba donde empieza el `i + 1`, menos el separador.
   */
  private readonly inicios: Int32Array;

  /** `ordenados`: los textos sin repetir y en el orden de `<`. Si no lo están, o uno lleva el separador, lanza. */
  constructor(ordenados: readonly string[]) {
    this.inicios = new Int32Array(ordenados.length + 1);
    let posicion = 0;
    for (let i = 0; i < ordenados.length; i++) {
      // El bucle limita `i` a la lista; con `i > 0` también existe la entrada anterior.
      const texto = ordenados[i] as string;
      if (i > 0 && !((ordenados[i - 1] as string) < texto)) {
        const pareja = JSON.stringify([ordenados[i - 1], texto]);
        throw new Error(`La lista no está ordenada y sin repetir: ${pareja}`);
      }
      if (texto.includes(SEPARADOR)) {
        throw new Error(`Un texto de la lista lleva el separador: ${JSON.stringify(texto)}`);
      }
      this.inicios[i] = posicion;
      posicion += texto.length + SEPARADOR.length;
    }
    this.inicios[ordenados.length] = posicion;
    this.unidos = ordenados.join(SEPARADOR);
  }

  /** Si la lista tiene el texto, igual que `Set.prototype.has`. */
  has(buscado: string): boolean {
    let desde = 0;
    let hasta = this.inicios.length - 2;
    // La misma búsqueda binaria que estaEnLosOrdenados, comparando dentro de `unidos`.
    while (desde <= hasta) {
      const medio = (desde + hasta) >>> 1;
      // Cada texto tiene su inicio y el siguiente, incluida la posición final del constructor.
      const fin = (this.inicios[medio + 1] as number) - SEPARADOR.length;
      const orden = comparar(this.unidos, this.inicios[medio] as number, fin, buscado);
      if (orden === 0) {
        return true;
      }
      if (orden < 0) {
        desde = medio + 1;
      } else {
        hasta = medio - 1;
      }
    }
    return false;
  }
}
