/** Forma lingüística compartida por las tareas del motor local, en castellano y catalán. */
import type { Idioma } from '../comun/idioma.ts';
import { sinAcentos } from '../comun/texto.ts';

const MIN_LETRAS_INFINITIVO = 3;
const INFINITIVOS_CORTOS: ReadonlySet<string> = new Set(['ir']);

/** Reconoce la terminación del primer término catalán, incluidos sus pronombres. */
function empiezaPorInfinitivoCatalan(texto: string): boolean {
  const primera =
    sinAcentos(texto.trim())
      .replace(/·/g, '')
      .split(/[^a-zç]+/)
      .filter(Boolean)[0] ?? '';
  return /(ar|er|re|ir|ur)$/.test(primera) && primera.length >= MIN_LETRAS_INFINITIVO;
}

/** Conserva el texto salvo la mayúscula del primer carácter. */
export function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Filtro de forma; no acredita que la primera palabra sea semánticamente un verbo. */
export function empiezaPorInfinitivo(texto: string, idioma: Idioma = 'es'): boolean {
  if (idioma === 'ca') {
    return empiezaPorInfinitivoCatalan(texto);
  }
  const primera =
    sinAcentos(texto.trim())
      .split(/[^a-zñ]+/)
      .filter(Boolean)[0] ?? '';
  const infinitivo = /(ar|er|ir)(se|le|les|lo|la|los|las|me|te|nos|selo|sela|selos|selas)?$/;
  const largo = primera.length >= MIN_LETRAS_INFINITIVO || INFINITIVOS_CORTOS.has(primera);
  return infinitivo.test(primera) && largo;
}

/** Admite la forma del infinitivo en cualquiera de las dos lenguas. */
export function empiezaPorInfinitivoEnSuIdioma(texto: string): boolean {
  return empiezaPorInfinitivo(texto) || empiezaPorInfinitivo(texto, 'ca');
}
