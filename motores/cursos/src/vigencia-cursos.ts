// Momento, orden y antigüedad de las convocatorias del SOC y del Consorci según las fechas de la copia.
// Primero las que están por iniciar, después las iniciadas y, al final, las que no tienen fecha de inicio.
// Dentro de cada momento se ordenan por inicio y nombre; el municipio se muestra sin decidir la prioridad.

import { MAX_DIAS_COPIA_CURSOS } from '../../../compartido/contratos/formacion-del-informe.ts';
import type { MomentoCurso } from '../../../compartido/contratos/tipos-formacion.ts';
import { diasEntreFechas } from '../../../compartido/utilidades/fechas.ts';

// La antigüedad máxima de una copia, la cuenta de días entre fechas y el orden de las convocatorias no son lógica de
// cursos: viven en compartido/ (la app los usa sin cargar el motor) y se reexportan aquí.
export type { ClavesDeOrden } from '../../../compartido/utilidades/orden-de-convocatorias.ts';
export { ordenDeConvocatorias } from '../../../compartido/utilidades/orden-de-convocatorias.ts';
export { diasEntreFechas, MAX_DIAS_COPIA_CURSOS };

/**
 * Modalidades del Consorci que se siguen desde cualquier sitio: el municipio publicado es el de la entidad.
 * La coincidencia es exacta, sin normalizar mayúsculas, espacios ni acentos.
 */
const MODALIDADES_A_DISTANCIA: ReadonlySet<string> = new Set(['Teleformació', 'Adaptada a Aula virtual']);

/**
 * Momento de un curso el día `hoy` (AAAA-MM-DD), solo por sus fechas. El día de inicio el curso ya ha empezado y el
 * día de fin todavía no ha terminado. Sin inicio, «sin-fecha», salvo que el fin ya haya pasado.
 * Las fechas presentes deben ser días reales AAAA-MM-DD; se comparan como texto sin validarlas aquí.
 * El momento no comprueba plazas ni inscripción y, sin fin, no acredita que el curso siga activo.
 *
 * @param curso - Fechas de la convocatoria.
 * @param curso.inicio - Día de inicio (AAAA-MM-DD), o null si no se publica.
 * @param curso.fin - Día de fin (AAAA-MM-DD), o null si no se publica.
 * @param hoy - Día de la consulta (AAAA-MM-DD).
 * @returns Su momento, o «terminado» si ya acabó.
 */
export function momentoDelCurso(
  { inicio, fin }: { inicio: string | null; fin: string | null },
  hoy: string,
): MomentoCurso | 'terminado' {
  if (fin && fin < hoy) {
    return 'terminado';
  }
  if (!inicio) {
    return 'sin-fecha';
  }
  return inicio > hoy ? 'por-iniciar' : 'iniciado';
}

/**
 * Si una modalidad se sigue a distancia (teleformación o aula virtual).
 *
 * @param modalidad - Modalidad tal como la publica el Consorci.
 * @returns Si coincide exactamente con una de las dos modalidades a distancia.
 */
export function esADistancia(modalidad: string): boolean {
  return MODALIDADES_A_DISTANCIA.has(modalidad);
}

/**
 * Si una copia de cursos, del día `fechaCopia`, tiene el día `hoy` más de MAX_DIAS_COPIA_CURSOS días. Una fecha que no
 * se puede leer cuenta como antigua: sin saber la edad de la copia, se avisa.
 *
 * @param fechaCopia - Día de la copia (AAAA-MM-DD).
 * @param hoy - Día de la consulta (AAAA-MM-DD).
 * @returns Si la copia pasa del límite o su edad no se puede calcular.
 */
export function esCopiaAntigua(fechaCopia: string, hoy: string): boolean {
  return !(diasEntreFechas(fechaCopia, hoy) <= MAX_DIAS_COPIA_CURSOS);
}
