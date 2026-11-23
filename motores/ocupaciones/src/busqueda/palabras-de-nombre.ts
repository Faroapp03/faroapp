// Qué palabras de una búsqueda son probablemente el nombre de una persona o de un lugar: el buscador de ocupaciones
// (ocupaciones.ts) no debe tomarlas por palabras del oficio. La limpieza de datos personales reconoce presentaciones,
// tratamientos y referencias a otras personas (seguridad/privacidad.ts); algunas formas («María, cajera», «Soy Pastora,
// cajera», «en L'Hospitalet») llegan al buscador y, si coinciden con una palabra del catálogo o empiezan como una,
// metería en la pista un grupo que no viene a cuento («Pastora» → criadores de ganado; «María» → marineros).
// Sin IA ni datos del motor: la mayúscula y la puntuación dan el contexto, y la lista oficial de nombres y apellidos
// del INE (comun/nombres-propios.ts), qué es un nombre.

import { CON_MAYUSCULA_INICIAL, segunLaLista } from '../../../../src/comun/nombres-propios.ts';
import { normalizar } from '../../../../src/comun/texto.ts';

/**
 * Donde acaba una frase: un signo de cierre o un salto de línea (que se queda con su frase) y el espacio que lo sigue.
 * Sin aserto de retroceso (`(?<=…)`), que WebKit no admite antes de Safari 16.4 y haría fallar el módulo al cargar.
 */
const FIN_DE_FRASE = /([.!?¡¿:\n])\s+/;
/** Las palabras de una frase; los apóstrofos y los guiones las separan («L'Hospitalet» → «L», «Hospitalet»). */
const PALABRA = /\p{L}+/gu;
/** Lo que sigue a una palabra empieza por una coma: «María, cajera», «Soy Pastora, cajera». */
const SEGUIDA_DE_COMA = /^\s*,/;
/** Entre dos palabras de un mismo nombre solo hay espacio: «Laura Pérez», no «Laura, Pérez». */
const SOLO_ESPACIO = /^[^\S\n]+$/;

/** Las palabras de una búsqueda que son probablemente un nombre propio, normalizadas («maria»). */
interface PalabrasDeNombre {
  /** Nombres propios probables por su mayúscula: su principio solo acerca una ocupación por derivación. */
  probables: Set<string>;
  /** Nombres y apellidos de la lista oficial en esa posición: no cuentan, ni como palabra ni por su principio. */
  sinValor: Set<string>;
}

/** Una palabra de la frase y lo que la separa de la siguiente. */
interface PalabraDeLaFrase {
  texto: string;
  sigue: string;
}

/** Lo que se sabe de la palabra anterior al mirar la siguiente. */
interface Anterior {
  /** Va pegada a la siguiente, sin más que espacio entre las dos. */
  pegada: boolean;
  /** Lleva mayúscula inicial y la lista no la tiene ni por nombre ni por apellido («Diagonal», «Sant»). */
  propiaSinLista: boolean;
  /** Es un nombre de la lista que no cuenta. */
  sinValor: boolean;
}

/** Las palabras de una frase, cada una con lo que hay entre ella y la siguiente. */
function palabrasDeLaFrase(frase: string): PalabraDeLaFrase[] {
  const encontradas = [...frase.matchAll(PALABRA)];
  return encontradas.map((encontrada, i) => {
    const fin = encontrada.index + encontrada[0].length;
    return { texto: encontrada[0], sigue: frase.slice(fin, encontradas[i + 1]?.index ?? frase.length) };
  });
}

/**
 * Si la palabra está donde suele ir un nombre propio: con mayúscula inicial sin abrir la frase («Soy Rocío», «en
 * L'Hospitalet»), o abriéndola si la sigue una coma («María, cajera»). La primera palabra de una frase lleva mayúscula
 * sea lo que sea.
 */
function dondeVaUnNombre(palabra: PalabraDeLaFrase, posicion: number): boolean {
  return CON_MAYUSCULA_INICIAL.test(palabra.texto) && (posicion > 0 || SEGUIDA_DE_COMA.test(palabra.sigue));
}

/**
 * Si un nombre propio probable es, según la lista, un nombre o un apellido que no cuenta. Un nombre de pila, siempre,
 * salvo que sea también un oficio («Soy Pastora» puede ser una pastora): ese, solo si lo sigue una coma («Soy Pastora,
 * cajera»). Un apellido, solo justo detrás de un nombre que no cuenta («Laura Pérez»): solo, muchos son palabras
 * corrientes («Tienda», «Obra»). Detrás de otra palabra con mayúscula que no es un nombre, ninguno: es parte del nombre
 * de un lugar o de una empresa («Diagonal Mar»), que se queda como estaba.
 */
function sinValorSegunLaLista(palabra: PalabraDeLaFrase, anterior: Anterior | null): boolean {
  if (anterior?.pegada && anterior.propiaSinLista) {
    return false;
  }
  const { dePila, apellido, oficio } = segunLaLista(palabra.texto);
  if (dePila) {
    return !oficio || SEGUIDA_DE_COMA.test(palabra.sigue);
  }
  return apellido && anterior?.pegada === true && anterior.sinValor;
}

/** Lo que la siguiente palabra necesita saber de esta. */
function comoAnterior(palabra: PalabraDeLaFrase, sinValor: boolean): Anterior {
  const { dePila, apellido } = segunLaLista(palabra.texto);
  const propiaSinLista = CON_MAYUSCULA_INICIAL.test(palabra.texto) && !dePila && !apellido;
  return { pegada: SOLO_ESPACIO.test(palabra.sigue), propiaSinLista, sinValor };
}

/** Recorre una frase y anota sus nombres probables y los que no cuentan. */
function anotarFrase(frase: string, palabras: PalabrasDeNombre): void {
  let anterior: Anterior | null = null;
  for (const [posicion, palabra] of palabrasDeLaFrase(frase).entries()) {
    const nombre = dondeVaUnNombre(palabra, posicion);
    const sinValor = nombre && sinValorSegunLaLista(palabra, anterior);
    if (nombre) {
      palabras.probables.add(normalizar(palabra.texto));
    }
    if (sinValor) {
      palabras.sinValor.add(normalizar(palabra.texto));
    }
    anterior = comoAnterior(palabra, sinValor);
  }
}

/**
 * Parte un texto en frases, cada una con su signo de cierre: al partir con FIN_DE_FRASE, que captura el signo, los
 * trozos alternan frase y signo, y aquí se vuelven a juntar.
 *
 * @param texto - Texto de una búsqueda.
 * @returns Las frases en orden, sin el espacio que las separaba.
 */
function frases(texto: string): string[] {
  const trozos = texto.split(FIN_DE_FRASE);
  const resultado: string[] = [];
  for (let i = 0; i < trozos.length; i += 2) {
    resultado.push(trozos[i] + (trozos[i + 1] ?? ''));
  }
  return resultado;
}

/**
 * Las palabras de un texto que son probablemente un nombre propio (de persona o de lugar), normalizadas: las que
 * llevan mayúscula inicial sin abrir el texto ni una frase, y la primera si va seguida de coma. Las aproximaciones
 * de un nombre probable se limitan a las derivadas (`parecidas` en consulta.ts y `soloDerivadas` en puntuacion.ts);
 * las palabras incluidas en sinValor como nombre o apellido en esa posición no cuentan: ni «Nieves» busca nieve, ni
 * «Soy Pastora, cajera», pastor.
 *
 * @param texto - Texto de una búsqueda, tal como lo escribió la persona.
 * @returns Los nombres probables y los que no cuentan, normalizados («maria»).
 */
export function palabrasDeNombre(texto: string): PalabrasDeNombre {
  const palabras: PalabrasDeNombre = { probables: new Set(), sinValor: new Set() };
  // Componer antes de segmentar evita partir una letra de su marca; los índices son internos.
  for (const frase of frases(texto.normalize('NFC'))) {
    anotarFrase(frase.trim(), palabras);
  }
  return palabras;
}
