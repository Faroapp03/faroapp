/**
 * Fases de una activación y lo que cada una exige. La forma de dos servicios publica primero el Worker de Cursos y
 * después el principal; la de un servicio publica solo el principal, no tiene fases ni campos de Cursos y se admite
 * para leer, terminar y recuperar las activaciones guardadas con ella.
 */
import type { ActivacionPrivada } from './activacion.ts';
import { exigirTrabajo } from './trabajos.ts';

export const FASES_ACTIVACION = [
  'reservada',
  'preparada',
  'subiendo-cursos',
  'cursos-subida',
  'promoviendo-cursos',
  'cursos-confirmado',
  'subiendo',
  'subida',
  'promoviendo',
  'confirmada',
  'rechazada',
  'abandonada',
] as const;
export type FaseActivacion = (typeof FASES_ACTIVACION)[number];
/** Fases en las que la subida o el despliegue de un Worker está en curso: las únicas en que puede quedar detenida. */
export const FASES_CON_EFECTO: readonly FaseActivacion[] = [
  'subiendo-cursos',
  'promoviendo-cursos',
  'subiendo',
  'promoviendo',
];
const FASES_CURSOS: readonly FaseActivacion[] = [
  'subiendo-cursos',
  'cursos-subida',
  'promoviendo-cursos',
  'cursos-confirmado',
];
const CON_VERSION_CURSOS: readonly FaseActivacion[] = [
  'cursos-subida',
  'promoviendo-cursos',
  'cursos-confirmado',
  'subiendo',
  'subida',
  'promoviendo',
  'confirmada',
];
const CON_DEPLOYMENT_CURSOS: readonly FaseActivacion[] = [
  'cursos-confirmado',
  'subiendo',
  'subida',
  'promoviendo',
  'confirmada',
];
/** Versión de Cursos de una activación de dos servicios; una de un servicio no lleva estos campos. */
export interface CursosActivacion {
  readonly versionIdCursos: string | null;
  readonly deploymentIdCursos: string | null;
}
/** La forma de dos servicios publica primero el Worker de Cursos y después el principal. */
export function dosServicios(a: ActivacionPrivada): a is ActivacionPrivada & CursosActivacion {
  return a.versionIdCursos !== undefined;
}
/** Cada campo de Cursos existe solo en la forma de dos servicios y se rellena en la fase que lo observa. */
function leerFaseCursos(
  fase: FaseActivacion,
  campos: Pick<ActivacionPrivada, 'evidencia' | 'versionIdCursos' | 'deploymentIdCursos'>,
): void {
  const { evidencia, versionIdCursos, deploymentIdCursos } = campos;
  if (versionIdCursos === undefined) {
    exigirTrabajo(!FASES_CURSOS.includes(fase) && (evidencia === null || !('principal' in evidencia.anterior)));
    return;
  }
  exigirTrabajo(evidencia === null || 'principal' in evidencia.anterior);
  if (fase === 'abandonada') {
    // Conserva lo que se llegó a anotar: una versión de Cursos subida, y su despliegue si se llegó a confirmar.
    exigirTrabajo(deploymentIdCursos === null || versionIdCursos !== null);
    return;
  }
  exigirTrabajo((versionIdCursos !== null) === CON_VERSION_CURSOS.includes(fase));
  exigirTrabajo((deploymentIdCursos !== null) === CON_DEPLOYMENT_CURSOS.includes(fase));
}
export function leerFase(
  entrada: unknown,
  campos: Pick<
    ActivacionPrivada,
    'evidencia' | 'versionId' | 'deploymentId' | 'error' | 'versionIdCursos' | 'deploymentIdCursos'
  >,
): FaseActivacion {
  const fase = FASES_ACTIVACION.find((f) => f === entrada);
  exigirTrabajo(fase !== undefined);
  leerFaseCursos(fase, campos);
  const { evidencia, versionId, deploymentId, error } = campos;
  if (fase === 'reservada') {
    exigirTrabajo(evidencia === null);
  } else if (fase !== 'rechazada' && fase !== 'abandonada') {
    exigirTrabajo(evidencia !== null);
  }
  const conVersion = fase === 'subida' || fase === 'promoviendo' || fase === 'confirmada';
  // Una abandonada conserva la versión del principal si llegó a subirse; nunca un despliegue confirmado.
  exigirTrabajo(fase === 'abandonada' ? versionId === null || evidencia !== null : (versionId !== null) === conVersion);
  exigirTrabajo((deploymentId !== null) === (fase === 'confirmada'));
  exigirTrabajo((error !== null) === (fase === 'rechazada'));
  return fase;
}
