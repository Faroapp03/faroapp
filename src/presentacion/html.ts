// Escape de texto para HTML. Todo texto que venga de la persona, del modelo o de las fuentes pasa por aquí antes de
// pintarse: el informe nunca inserta texto sin escapar.

/** Lo que sustituye a cada uno de los cuatro caracteres que se escapan. */
const ENTIDADES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/**
 * El texto con &, <, > y comillas dobles escapados, listo para un elemento o un atributo entre comillas dobles.
 *
 * @param texto - El texto sin escapar.
 * @returns El texto escapado.
 */
export function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (caracter) => ENTIDADES[caracter] ?? caracter);
}
