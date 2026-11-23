// La ocupación que confirma la persona: un grupo ISCO-08 de 4 cifras y, solo si quiere afinar, una
// ocupación ESCO de ese grupo. Puede añadir un segundo grupo cuando hace las dos cosas («los helados los hago y los
// vendo»). Cualquier combinación incoherente es un error de entrada: nunca se adivina qué quiso decir. Sin IA.

import { EntradaInvalida } from './errores.ts';
import { esGrupoValido, tituloIsco } from './grupos.ts';
import type { Entrada } from './tipos-entrada.ts';
import type { Datos } from './tipos-paquete.ts';

/**
 * Caracteres como máximo de la palabra con que la persona nombró su trabajo («heladero»). La definición compartida
 * vive en comun/protocolo-web.ts; la usan el esquema, la limpieza de la API y el campo de la web.
 */
export { MAX_OCUPACION_PERSONA } from '../comun/protocolo-web.ts';

/** Los códigos tal como llegan: la ocupación ESCO, el grupo o los dos, y un segundo grupo opcional. */
export type CodigosOcupacion = Pick<Entrada, 'ocupacionEsco' | 'isco08' | 'isco08Secundario'>;

/** La ocupación comprobada: siempre un grupo; la ocupación ESCO y el segundo grupo, si los hay. */
export interface OcupacionConfirmada {
  esco: string | null;
  isco08: string;
  secundario: string | null;
}

/** El grupo de la ocupación ESCO, que debe existir y coincidir con el grupo si también se indica. */
function desdeEsco(datos: Datos, esco: string, isco08: string | undefined): Omit<OcupacionConfirmada, 'secundario'> {
  const ocupacion = Object.hasOwn(datos.esco.ocupaciones, esco) ? datos.esco.ocupaciones[esco] : null;
  if (!ocupacion) {
    throw new EntradaInvalida(`Ocupación ESCO desconocida: ${esco}`);
  }
  if (isco08 !== undefined && isco08 !== ocupacion.isco08) {
    throw new EntradaInvalida(`La ocupación ESCO ${esco} no pertenece al grupo ${isco08}`);
  }
  return { esco, isco08: ocupacion.isco08 };
}

/** El grupo, si existe en la clasificación oficial como grupo de 4 cifras. */
function grupoComprobado(datos: Datos, isco08: string): string {
  if (!esGrupoValido(datos, isco08)) {
    throw new EntradaInvalida(`Grupo ISCO-08 desconocido: ${isco08}`);
  }
  return isco08;
}

/** El segundo grupo, si lo hay: tiene que existir y ser distinto del primero. */
function secundarioComprobado(datos: Datos, secundario: string | undefined, principal: string): string | null {
  if (secundario === undefined) {
    return null;
  }
  if (secundario === principal) {
    throw new EntradaInvalida('El segundo grupo es el mismo que el primero');
  }
  return grupoComprobado(datos, secundario);
}

/**
 * Comprueba los códigos de la ocupación y devuelve la ocupación confirmada. El grupo es obligatorio si no hay
 * ocupación ESCO; si llegan los dos, tienen que coincidir. Lanza EntradaInvalida (un 400 en la API) si no cuadran.
 *
 * @param datos - Paquete de datos cargado.
 * @param codigos - Los códigos que confirmó la persona.
 * @returns La ocupación confirmada, con sus códigos comprobados.
 * @throws {EntradaInvalida} Si falta el grupo y la ocupación, si algún código no existe o si no coinciden.
 */
export function resolverOcupacion(datos: Datos, codigos: CodigosOcupacion): OcupacionConfirmada {
  const { ocupacionEsco, isco08, isco08Secundario } = codigos;
  let principal: Omit<OcupacionConfirmada, 'secundario'>;
  if (ocupacionEsco !== undefined) {
    principal = desdeEsco(datos, ocupacionEsco, isco08);
  } else if (isco08 !== undefined) {
    principal = { esco: null, isco08: grupoComprobado(datos, isco08) };
  } else {
    throw new EntradaInvalida('Indica el grupo de ocupación o la ocupación ESCO');
  }
  return { ...principal, secundario: secundarioComprobado(datos, isco08Secundario, principal.isco08) };
}

/** El título de una ocupación ESCO, o null si no es una clave propia del catálogo. */
function tituloEsco(datos: Datos, esco: string): string | null {
  // El catálogo validado es un Record de ocupaciones: una clave propia tiene ficha.
  return Object.hasOwn(datos.esco.ocupaciones, esco)
    ? (datos.esco.ocupaciones[esco] as Datos['esco']['ocupaciones'][string]).titulo
    : null;
}

/**
 * El nombre de la ocupación que se da como contexto al traducir una tarea: el de la ocupación ESCO (cada forma una sola
 * vez) o, sin ella, el título oficial del grupo. Solo se leen claves propias del catálogo: un código que no está (o
 * una clave heredada como «constructor») es un error de entrada con su código, no un fallo sin explicación.
 *
 * @param datos - Paquete de datos cargado.
 * @param ocupacion - URI ESCO (o null) y grupo ISCO-08, idealmente salidos de resolverOcupacion.
 * @returns El nombre, con sus formas separadas por « / ».
 * @throws {EntradaInvalida} Si la ocupación ESCO o el grupo no están en el catálogo.
 */
export function nombreDeLaOcupacion(datos: Datos, ocupacion: Pick<OcupacionConfirmada, 'esco' | 'isco08'>): string {
  const titulo = ocupacion.esco === null ? tituloIsco(datos, ocupacion.isco08) : tituloEsco(datos, ocupacion.esco);
  if (titulo === null) {
    throw new EntradaInvalida(`No está en el catálogo: ${ocupacion.esco ?? ocupacion.isco08}`);
  }
  return [...new Set(titulo.split('/').map((forma) => forma.trim()))].join(' / ');
}
