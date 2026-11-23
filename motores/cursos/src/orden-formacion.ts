// Orden de las especialidades de formación: relación oficial, medida de parecido y desempates del catálogo.
// Una medida ausente no es coseno cero: las medidas van primero, también cuando son negativas.

import type { Correspondencia, EspecialidadRelacionada } from '../../../compartido/contratos/tipos-formacion.ts';
import { compararTexto } from '../../../src/comun/orden-alfabetico.ts';

/** De la correspondencia EURES más fiable a la menos. */
const ORDEN_CORRESPONDENCIA: Readonly<Record<Correspondencia, number>> = {
  exacta: 0,
  cercana: 1,
  estrecha: 2,
  amplia: 3,
};
/** De la relación con la ocupación más directa a la más lejana. */
const ORDEN_RELACION = { ocupacion: 0, incluye: 1, grupo: 2, variante: 3, sugerencia: 4 } as const;

/** Claves oficiales que deciden la prioridad de un enlace, sin medir parecido. */
type ClavesDeEnlace = Pick<EspecialidadRelacionada, 'relacion' | 'correspondencia'>;

/** A igual relación, una correspondencia ausente queda detrás de las conocidas. */
function ordenPorCorrespondencia(a: Correspondencia | null, b: Correspondencia | null): number {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return ORDEN_CORRESPONDENCIA[a] - ORDEN_CORRESPONDENCIA[b];
}

/**
 * Prioridad de un enlace oficial: relación con la ocupación y, a igualdad, correspondencia.
 * Un empate conserva la primera opción cuando el llamador elige el mejor enlace.
 *
 * @param a - Relación y correspondencia del primer enlace.
 * @param b - Relación y correspondencia del segundo enlace.
 * @returns Negativo si `a` tiene prioridad, positivo si la tiene `b` y cero si empatan.
 */
export function ordenDeEnlaces(a: ClavesDeEnlace, b: ClavesDeEnlace): number {
  return (
    ORDEN_RELACION[a.relacion] - ORDEN_RELACION[b.relacion] ||
    ordenPorCorrespondencia(a.correspondencia, b.correspondencia)
  );
}

/**
 * Ordena por relación; dentro de cada una, las especialidades con medida preceden a las que carecen de ella.
 * Las medidas finitas se ordenan de mayor a menor, incluidos cero y valores negativos. A igual medida o sin ella,
 * se desempata por correspondencia y nombre en castellano; las sugerencias carecen de correspondencia oficial.
 *
 * @param a - Una especialidad con parecido finito o ausente.
 * @param b - Otra especialidad con parecido finito o ausente.
 * @returns Negativo si `a` va antes, positivo si va después y cero si las claves de orden empatan.
 */
export function ordenEspecialidades(a: EspecialidadRelacionada, b: EspecialidadRelacionada): number {
  const porRelacion = ORDEN_RELACION[a.relacion] - ORDEN_RELACION[b.relacion];
  if (porRelacion !== 0) {
    return porRelacion;
  }
  if (a.parecido === undefined && b.parecido !== undefined) {
    return 1;
  }
  if (a.parecido !== undefined && b.parecido === undefined) {
    return -1;
  }
  const porParecido = a.parecido !== undefined && b.parecido !== undefined ? b.parecido - a.parecido : 0;
  return (
    porParecido ||
    ordenPorCorrespondencia(a.correspondencia, b.correspondencia) ||
    compararTexto(a.nombre, b.nombre, 'es')
  );
}
