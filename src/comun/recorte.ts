// Recorte de textos para presentación, por unidades UTF-16, sin partir palabras ni pares sustitutos válidos.

/** Primera y última unidad UTF-16 de la mitad alta de un par sustituto (un carácter fuera del plano básico). */
const SUSTITUTO_ALTO = { desde: 0xd800, hasta: 0xdbff } as const;

/**
 * Recorta un texto a `letras` unidades UTF-16 como mucho sin partir ninguna palabra: si no cabe, se corta en el último
 * espacio que cabe, sin los signos , ; : . ni blancos finales, y se marca con «…» (que cuenta). Una sola palabra más larga
 * que todo se corta donde toque, pero nunca entre las dos mitades de un emoji u otro carácter fuera del plano básico.
 * «…y a veces ayudo» no queda en «…y a veces ay», sino en «…y a veces…».
 *
 * @param texto - Texto que se quiere mostrar entero o recortado.
 * @param letras - Límite en unidades UTF-16; entero positivo.
 * @returns El texto si cabe; si no, su recorte terminado en «…», de `letras` unidades como mucho.
 */
export function recortarEnPalabras(texto: string, letras: number): string {
  if (texto.length <= letras) {
    return texto;
  }
  const ultima = texto.charCodeAt(letras - 2);
  const partido = ultima >= SUSTITUTO_ALTO.desde && ultima <= SUSTITUTO_ALTO.hasta;
  const cabe = texto.slice(0, partido ? letras - 2 : letras - 1);
  const espacio = /\s\S*$/.exec(cabe)?.index ?? -1;
  // El límite es entero positivo y esta rama tiene texto.length > letras: el índice existe.
  const entero = /\s/.test(texto[letras - 1] as string) || espacio <= 0 ? cabe : cabe.slice(0, espacio);
  return `${entero.replace(/[\s,;:.]+$/, '')}…`;
}
