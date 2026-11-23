// La lengua de un informe en HTML: cómo se pinta un texto que puede llevar datos
// sin traducir. En un informe traducido, cada dato oficial que se muestra en su idioma original (Informe.sinTraducir)
// va dentro de un <span lang="…">, para que el lector de pantalla lo lea con su voz. En castellano, el idioma de los
// datos, no hay nada que marcar.

import { IDIOMA_POR_DEFECTO, type Idioma, type IdiomaDeDato } from '../comun/idioma.ts';
import type { Informe, TextoSinTraducir } from '../dominio/tipos-informe.ts';
import { escapar } from './html.ts';

/** Caracteres con significado en una expresión regular: se escapan para buscar un texto literal. */
const ESPECIALES_DE_REGEX = /[.*+?^${}()|[\]\\]/g;
// Se calcula una vez por informe: cada apartado la pide al pintarse. La WeakMap la suelta con el informe.
const lenguasPorInforme = new WeakMap<Informe, LenguaHtml>();

/** Con qué se pinta un informe: su idioma y el escape que marca los datos sin traducir. */
export interface LenguaHtml {
  idioma: Idioma;
  /**
   * Un texto para el contenido de un elemento: escapado y, en un informe traducido, con cada dato sin traducir dentro
   * de un <span lang>. Nunca para un atributo, donde un <span> rompería el HTML: ahí se usa escapar().
   */
  texto(texto: string): string;
  /**
   * Un dato entero (un título, un nombre), escapado y, si no está traducido, dentro de un <span lang>. `mostrado` es
   * como se pinta si no es tal cual (en minúsculas, con mayúscula inicial). Solo para el contenido de un elemento.
   */
  dato(original: string, mostrado?: string): string;
  /** El idioma en que se ve un dato: el suyo, si no está traducido, o el del informe. */
  idiomaDe(original: string): IdiomaDeDato;
}

/** El escape que marca los datos sin traducir; sin ninguno, el escape sin más. */
function marcador(idiomaDe: ReadonlyMap<string, IdiomaDeDato>): (texto: string) => string {
  if (!idiomaDe.size) {
    return escapar;
  }
  // Los más largos primero: si un dato contiene a otro, se marca el entero.
  const literales = [...idiomaDe.keys()].map(escapar).sort((a, b) => b.length - a.length);
  const patron = new RegExp(literales.map((literal) => literal.replace(ESPECIALES_DE_REGEX, '\\$&')).join('|'), 'g');
  const idiomaDelEscapado = new Map([...idiomaDe].map(([texto, idioma]) => [escapar(texto), idioma]));
  return (texto) =>
    escapar(texto).replace(patron, (dato) => {
      const idioma = idiomaDelEscapado.get(dato);
      return idioma ? conIdioma(dato, idioma) : dato;
    });
}

/** El escape de un dato entero: marcado con su idioma si no está traducido. */
function marcadorDeDatos(idiomaDe: ReadonlyMap<string, IdiomaDeDato>): LenguaHtml['dato'] {
  return (original, mostrado = original) => {
    const idioma = idiomaDe.get(original);
    return idioma ? conIdioma(escapar(mostrado), idioma) : escapar(mostrado);
  };
}

/**
 * Un texto ya escapado dentro de un <span> con su idioma (WCAG 3.1.2), para que el lector de pantalla lo lea con su
 * voz. Solo para el contenido de un elemento. El idioma se escapa también: la función es pública y su tipo admite
 * cualquier texto, así que la seguridad del atributo no depende de quién la llame.
 *
 * @param html - Contenido ya escapado.
 * @param idioma - Código de idioma BCP 47 («es», «ca», «en»).
 * @returns El contenido dentro de `<span lang="…">`.
 */
export function conIdioma(html: string, idioma: string): string {
  return `<span lang="${escapar(idioma)}">${html}</span>`;
}

/**
 * La lengua con que se pinta un informe: la suya o, si no la dice, el castellano. Se calcula una vez por informe.
 *
 * @param informe - El informe que se pinta.
 * @returns Su idioma y los escapes que marcan los datos sin traducir.
 */
export function lenguaDe(informe: Informe): LenguaHtml {
  const guardada = lenguasPorInforme.get(informe);
  if (guardada) {
    return guardada;
  }
  const idioma = informe.idioma ?? IDIOMA_POR_DEFECTO;
  const sinTraducir: TextoSinTraducir[] = informe.sinTraducir ?? [];
  const idiomaDe = new Map(sinTraducir.filter(({ texto }) => texto).map(({ texto, idioma }) => [texto, idioma]));
  const lengua: LenguaHtml = {
    idioma,
    texto: marcador(idiomaDe),
    dato: marcadorDeDatos(idiomaDe),
    idiomaDe: (original) => idiomaDe.get(original) ?? idioma,
  };
  lenguasPorInforme.set(informe, lengua);
  return lengua;
}
