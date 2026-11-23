// Minimiza una consulta antes de buscar: las marcas de sustitución no son palabras del oficio.

import { limpiarDatosPersonales } from './privacidad.ts';

/** Tramos entre corchetes, para distinguir las marcas exactas de otras palabras de la consulta. */
const TRAMO_ENTRE_CORCHETES = /\[[^\]]+\]/g;
/** Marcas que emiten los identificadores, direcciones, nombres y empresas de la limpieza vigente. */
const MARCAS_DE_LIMPIEZA: ReadonlySet<string> = new Set([
  '[nombre eliminado]',
  '[dirección eliminada]',
  '[teléfono eliminado]',
  '[tarjeta eliminada]',
  '[correo eliminado]',
  '[cuenta eliminada]',
  '[documento eliminado]',
  '[enlace eliminado]',
  '[usuario eliminado]',
  '[número de la Seguridad Social eliminado]',
  '[cifras eliminadas]',
  '[empresa]',
]);

/** Controla si la búsqueda omite también los tramos entre corchetes que no son marcas del limpiador. */
export interface OpcionesTextoParaBuscar {
  omitirCorchetes?: boolean;
}

/**
 * Retira los datos personales reconocidos y las marcas exactas de sustitución antes de buscar por palabras.
 * Conserva otros corchetes salvo que el consumidor pida omitir todos esos tramos.
 * El consumidor valida el tamaño de entrada y aplica después el límite propio de su búsqueda.
 *
 * @param texto - La consulta de trabajo, con su tamaño ya validado.
 * @param opciones - Si se omiten todos los tramos entre corchetes, además de las marcas del limpiador.
 * @returns El texto minimizado y con los espacios agrupados.
 */
export function textoParaBuscar(texto: string, { omitirCorchetes = false }: OpcionesTextoParaBuscar = {}): string {
  return limpiarDatosPersonales(texto)
    .texto.replace(TRAMO_ENTRE_CORCHETES, (tramo) => (omitirCorchetes || MARCAS_DE_LIMPIEZA.has(tramo) ? ' ' : tramo))
    .replace(/\s+/g, ' ')
    .trim();
}
