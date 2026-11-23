/**
 * Relevo de una activación por un intento posterior de la misma ejecución: solo con la evidencia de GitHub de que el
 * intento anterior terminó, para que ninguna orden de Wrangler siga en vuelo.
 */
import {
  type EvidenciaEjecucionCompletada,
  esEnteroTrabajo,
  esIdEjecucion,
  exigirTrabajo,
  objetoTrabajo,
  type TrabajoPrivado,
} from './trabajos.ts';

export interface EvidenciaIntentoActivacionCompletado extends Omit<EvidenciaEjecucionCompletada, 'runAttempt'> {
  readonly runAttempt: string;
}
export interface RecuperacionActivacion {
  readonly version: 1;
  readonly intento: string;
  readonly revisionBase: number;
  readonly anterior: EvidenciaIntentoActivacionCompletado;
}
/** La ejecución que tiene la autoridad sobre una activación: la de su trabajo o, en un reintento, la que reintenta. */
export type AutoridadActivacion = Pick<TrabajoPrivado, 'solicitudId' | 'revisionReserva' | 'runId' | 'confianza'>;
export function leerEvidenciaIntentoActivacion(entrada: unknown): EvidenciaIntentoActivacionCompletado {
  const o = objetoTrabajo(
    entrada,
    'conclusion,estado,evento,propietarioId,repositorioId,runAttempt,runId,sha,workflowPath',
  );
  exigirTrabajo(o.estado === 'completed' && o.evento === 'workflow_dispatch');
  exigirTrabajo(
    esIdEjecucion(o.runId) &&
      esIdEjecucion(o.runAttempt) &&
      esIdEjecucion(o.repositorioId) &&
      esIdEjecucion(o.propietarioId),
  );
  exigirTrabajo(typeof o.sha === 'string' && /^[0-9a-f]{40}$/.test(o.sha));
  exigirTrabajo(
    typeof o.workflowPath === 'string' && /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(o.workflowPath),
  );
  const conclusion = (
    ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale'] as const
  ).find((c) => c === o.conclusion);
  exigirTrabajo(conclusion !== undefined);
  return Object.freeze({
    estado: 'completed',
    evento: 'workflow_dispatch',
    runId: o.runId,
    runAttempt: o.runAttempt,
    repositorioId: o.repositorioId,
    propietarioId: o.propietarioId,
    sha: o.sha,
    workflowPath: o.workflowPath,
    conclusion,
  });
}
export function evidenciaIntentoCoincide(
  e: EvidenciaIntentoActivacionCompletado,
  autoridad: Pick<AutoridadActivacion, 'runId' | 'confianza'>,
): boolean {
  const { confianza } = autoridad;
  return (
    e.runId === autoridad.runId &&
    e.repositorioId === confianza.repositorioId &&
    e.propietarioId === confianza.propietarioId &&
    e.sha === confianza.sha &&
    confianza.workflowRef.endsWith(`/${e.workflowPath}@${confianza.ref}`)
  );
}
export function leerRecuperacion(
  entrada: unknown,
  autoridad: AutoridadActivacion,
  revision: { readonly base: number; readonly actual: number },
): RecuperacionActivacion {
  const r = objetoTrabajo(entrada, 'anterior,intento,revisionBase,version');
  const anterior = leerEvidenciaIntentoActivacion(r.anterior);
  exigirTrabajo(r.version === 1 && esIdEjecucion(r.intento) && Number(r.intento) > 1);
  exigirTrabajo(esEnteroTrabajo(r.revisionBase) && r.revisionBase > revision.base && r.revisionBase < revision.actual);
  exigirTrabajo(Number(anterior.runAttempt) === Number(r.intento) - 1 && evidenciaIntentoCoincide(anterior, autoridad));
  return Object.freeze({ version: 1, intento: r.intento, revisionBase: r.revisionBase, anterior });
}
