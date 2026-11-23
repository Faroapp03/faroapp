// Nombres propios de persona según la lista oficial del INE: los nombres de pila y los primeros apellidos que llevan 20
// personas o más entre los residentes en España, de cualquier nacionalidad (Censo de población anual a 1 de enero de
// 2025; plataforma_datos/comun/fuentes/nombres/lector.py). La usan la limpieza de datos personales, para quitar un nombre escrito en
// minúsculas tras una presentación (seguridad/privacidad.ts), y el buscador de ocupaciones, para que un nombre no
// cuente como palabra de oficio (motores/ocupaciones/src/busqueda/ocupaciones.ts).
// Es la única pieza de comun/ con datos: la limpieza no recibe el paquete del motor (es una función del texto, que se
// llama desde todas las capas), así que la lista se importa aquí, del paquete, igual en Node y en Cloudflare
// (archivo-del-paquete.ts). pruebas/seguridad/nombres-propios.test.ts comprueba su huella frente al manifiesto.
// La lista dice qué puede ser un nombre, no qué lo es: hay nombres que son también palabras corrientes (Rosa, Luz) o
// verbos (Leo), y apellidos como Mesa o Calle. Lo decide el contexto, en cada pieza que la usa.
// Lleva también lo contrario, sacado de los textos oficiales en castellano y en catalán: los oficios y las palabras
// corrientes, que con mayúscula tras «soy» no son un nombre («Soy Cuinera», «Soy Responsable»). Con eso, la limpieza
// reconoce un nombre que la lista no tiene porque es raro en España («Hola, soy Nkechi»).

import listaImportada from '../../datos/nombres.json' with { type: 'json' };
import { leerArchivoDelPaquete, soltarArchivoDelPaquete } from './archivo-del-paquete.ts';
import { esFormaDe, esListaDe, esTexto, type Guarda } from './json.ts';
import { ListaOrdenada } from './lista-ordenada.ts';
import { sinAcentos } from './texto.ts';

/** Lo que el INE no conserva al normalizar un nombre: el apóstrofo y el punto volado («D'Amico», «Marcel·la»). */
const SIGNOS_DEL_NOMBRE = /['’·.]/g;
/**
 * Solo caracteres ASCII imprimibles (U+0020–U+007E), sin letras con tilde ni signos de fuera del ASCII: basta pasarla a
 * minúsculas (la limpieza mira cada palabra).
 */
const SOLO_ASCII_IMPRIMIBLE = /^[\x20-\x7e]*$/;
/**
 * Una palabra escrita como un nombre propio, con mayúscula inicial y minúsculas detrás («Laura»): no una sigla
 * («TCAE», «CNC») ni una palabra de un texto en mayúsculas («LAURA»), donde la mayúscula no distingue nada. La usan la
 * limpieza de datos personales y el buscador, cada uno con su contexto.
 */
export const CON_MAYUSCULA_INICIAL = /^\p{Lu}\p{Ll}/u;

/** Las palabras de hasta 4 letras se comparan enteras, sin quitarles la terminación. */
const MAX_LETRAS_SIN_RAIZ = 4;
/** La terminación de género y número que se quita para comparar: «cuinera», «cuiners» → «cuiner». */
const TERMINACION_DE_GENERO_Y_NUMERO = /(?:as|os|es|a|o|e|s)$/;

/** Lo que se usa de la lista oficial del paquete: cada campo, una lista de palabras en su forma de comparar. */
interface ListaOficial {
  readonly nombres: readonly string[];
  readonly apellidos: readonly string[];
  readonly tambien_oficio: readonly string[];
  readonly oficios: readonly string[];
  readonly palabras_corrientes: readonly string[];
}

/** La forma de la lista oficial, comprobada al leerla: un campo que no es una lista de textos la deja sin leer. */
const esListaOficial: Guarda<ListaOficial> = esFormaDe({
  nombres: esListaDe(esTexto),
  apellidos: esListaDe(esTexto),
  tambien_oficio: esListaDe(esTexto),
  oficios: esListaDe(esTexto),
  palabras_corrientes: esListaDe(esTexto),
});

/** La lista oficial del paquete no tiene la forma que se espera (ListaOficial). */
export class ListaDeNombresMalFormada extends Error {
  override name = 'ListaDeNombresMalFormada';
}

/**
 * La lista oficial leída del paquete, comprobada.
 *
 * @throws {ListaDeNombresMalFormada} Si algún campo falta o no es una lista de textos.
 */
function listaComprobada(): ListaOficial {
  const lista = leerArchivoDelPaquete(listaImportada);
  soltarArchivoDelPaquete(listaImportada);
  if (!esListaOficial(lista)) {
    throw new ListaDeNombresMalFormada('datos/nombres.json no tiene la forma de la lista de nombres');
  }
  return lista;
}

/**
 * La lista oficial, en listas ordenadas para consultarla: responden como un Set y ocupan una fracción de su memoria
 * (lista-ordenada.ts). La lista leída no se guarda: después solo hacen falta ellas.
 */
function conjuntosDeLaLista(lista: ListaOficial): {
  readonly nombresDePila: ListaOrdenada;
  readonly apellidos: ListaOrdenada;
  readonly tambienOficio: ListaOrdenada;
  readonly oficios: ListaOrdenada;
  readonly palabrasCorrientes: ListaOrdenada;
} {
  return {
    nombresDePila: new ListaOrdenada(lista.nombres),
    apellidos: new ListaOrdenada(lista.apellidos),
    tambienOficio: new ListaOrdenada(lista.tambien_oficio),
    oficios: new ListaOrdenada(lista.oficios),
    palabrasCorrientes: new ListaOrdenada(lista.palabras_corrientes),
  };
}

const LISTA = conjuntosDeLaLista(listaComprobada());

/**
 * Nombres de oficio del diccionario de Faro (motores/ocupaciones/src/busqueda/denominaciones-de-diccionario.ts) que la
 * lista del INE tiene también como nombre o apellido y que, tras «soy» o «sóc», son casi siempre el oficio: «soy
 * rider», «sóc manyà», «sóc mossa», «soy MIR», «soy urbano». La lista solo marca como oficio la primera palabra de un
 * título ESCO en castellano («pastora»), y la limpieza los quitaba como nombres, así que el buscador se quedaba sin el
 * oficio. Los nombres de pila frecuentes («Kelly») se siguen quitando: ahí manda la privacidad.
 * pruebas/seguridad/privacidad-nombres.test.ts comprueba que todo nombre de una palabra del diccionario está aquí, se conserva
 * solo o es una de esas excepciones.
 */
const OFICIOS_DEL_DICCIONARIO: ReadonlySet<string> = new Set(['manya', 'mir', 'mossa', 'rider', 'urbano']);

/** Lo que dice la lista oficial de una palabra, en su forma de comparar. */
export interface SegunLaLista {
  /** La palabra en minúsculas, sin tildes ni signos, como la guarda la lista (formaDeNombre). */
  readonly forma: string;
  /** Es un nombre de pila de una sola palabra, de hombre o de mujer. */
  readonly dePila: boolean;
  /** Es un primer apellido de una sola palabra. */
  readonly apellido: boolean;
  /**
   * Siendo un nombre o un apellido, nombra también un oficio: es, en masculino o en femenino, la primera palabra de
   * una ocupación ESCO («Pastora», «Herrero»). Las dos formas de género van siempre juntas.
   */
  readonly oficio: boolean;
  /**
   * Los datos oficiales la usan como otra cosa que un nombre: es la primera palabra de un título de ocupación en
   * castellano o en catalán («Cuinera», «Técnico») o una palabra que sus textos escriben en minúscula («Responsable»,
   * «Autónoma»), en cualquier género y número. Lo es también un nombre de la lista que es palabra corriente («Rosa»).
   */
  readonly noEsNombre: boolean;
}

/**
 * La forma con que se compara una palabra con la lista: minúsculas, sin tildes, sin «ñ» ni «ç» y sin apóstrofos, como
 * normaliza el INE («Núria» → «nuria», «D'Amico» → «damico»). Es la de `forma` en plataforma_datos/comun/fuentes/nombres/lector.py.
 *
 * @param palabra - Una palabra, como se ha escrito.
 * @returns Su forma de comparar.
 */
export function formaDeNombre(palabra: string): string {
  return (SOLO_ASCII_IMPRIMIBLE.test(palabra) ? palabra.toLowerCase() : sinAcentos(palabra)).replace(
    SIGNOS_DEL_NOMBRE,
    '',
  );
}

/**
 * La raíz con que la lista guarda los oficios y las palabras corrientes, que iguala el masculino y el femenino, el
 * singular y el plural: la de `raiz` en plataforma_datos/comun/fuentes/nombres/lector.py.
 */
function raiz(forma: string): string {
  return forma.length > MAX_LETRAS_SIN_RAIZ ? forma.replace(TERMINACION_DE_GENERO_Y_NUMERO, '') : forma;
}

/**
 * Qué es la palabra según la lista: nombre de pila, apellido, oficio u otra cosa. Se normaliza una sola vez.
 *
 * @param palabra - Una palabra, como se ha escrito.
 * @returns Su forma de comparar y lo que la lista dice de ella.
 */
export function segunLaLista(palabra: string): SegunLaLista {
  const forma = formaDeNombre(palabra);
  const deLosDatos = raiz(forma);
  return {
    forma,
    dePila: LISTA.nombresDePila.has(forma),
    apellido: LISTA.apellidos.has(forma),
    oficio: LISTA.tambienOficio.has(forma) || OFICIOS_DEL_DICCIONARIO.has(forma),
    noEsNombre: LISTA.oficios.has(deLosDatos) || LISTA.palabrasCorrientes.has(deLosDatos),
  };
}
