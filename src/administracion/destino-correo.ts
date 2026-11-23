/**
 * La dirección de correo que recibe los avisos de mantenimiento. Es un dato personal y acaba en la cabecera «To» de un
 * mensaje: por eso se admite una sola dirección, sin nada que permita añadir cabeceras (saltos de línea y otros
 * caracteres de control) ni más destinatarios (comas, punto y coma, signos de mayor o menor, espacios).
 */

/** El máximo de una dirección que cabe en el camino de un mensaje (RFC 5321, 4.5.3.1.3). */
export const MAX_CORREO = 254;
/** Espacios de cualquier tipo, caracteres de control y los separadores de una lista de destinatarios. */
const PROHIBIDOS = /[\s\p{Cc},;<>]/u;

/** El rechazo no repite la dirección recibida: el motivo basta para responder y no deja el dato en ningún registro. */
export class DestinoCorreoInvalido extends Error {
  override readonly name = 'DestinoCorreoInvalido';
  constructor() {
    super('La dirección de correo de los avisos no es válida');
  }
}

/** Un dominio con al menos un punto y sin etiquetas vacías: «.org», «faro.» o «faro..org» no llegan a ningún buzón. */
function dominioValido(dominio: string): boolean {
  const etiquetas = dominio.split('.');
  return etiquetas.length >= 2 && etiquetas.every((etiqueta) => etiqueta.length > 0);
}

/**
 * Devuelve la dirección lista para guardar, con el dominio en minúsculas; la parte local se conserva tal cual, porque
 * su servidor puede distinguir mayúsculas. Cualquier otra entrada se rechaza entera: nada se recorta ni se corrige.
 */
export function leerDestinoCorreo(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length > MAX_CORREO || PROHIBIDOS.test(valor)) {
    throw new DestinoCorreoInvalido();
  }
  const partes = valor.split('@');
  const [local, dominio] = partes;
  if (partes.length !== 2 || !local || !dominio || !dominioValido(dominio)) {
    throw new DestinoCorreoInvalido();
  }
  // Algunas letras se alargan al pasar a minúsculas: el máximo vale también para la dirección que se guarda.
  const normalizado = `${local}@${dominio.toLowerCase()}`;
  if (normalizado.length > MAX_CORREO) {
    throw new DestinoCorreoInvalido();
  }
  return normalizado;
}
