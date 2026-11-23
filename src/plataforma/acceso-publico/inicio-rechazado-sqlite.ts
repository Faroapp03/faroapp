/** Anota el primer permiso de inicio negado a un run de este repositorio firmado para otra revisión. */
import type { ConfianzaOidcGitHub, IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import {
  estadoPublicoTrabajos,
  type InicioTrabajo,
  MARGEN_RELOJ_GITHUB_MS,
  type ResultadoTransicionTrabajo,
  type TrabajoPrivado,
} from '../../administracion/trabajos.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { guardar as guardarTrabajoSqlite, identidadCoincide, leerTrabajosSqlite } from './trabajos-sqlite.ts';

const MS_SEGUNDO = 1000;
const SHA = /^[0-9a-f]{40}$/;
/**
 * La autoridad repite la comprobación del receptor: la identidad coincide con la confianza de la reserva en todo
 * salvo en la revisión del workflow o del código, que es un SHA bien formado y distinto del autorizado.
 */
function revisionNoAutorizada(identidad: IdentidadEjecucionGitHub, confianza: ConfianzaOidcGitHub, ahora: number) {
  const { workflowSha, sha } = identidad;
  if (typeof workflowSha !== 'string' || !SHA.test(workflowSha) || typeof sha !== 'string' || !SHA.test(sha)) {
    return false;
  }
  return (
    identidadCoincide(identidad, { ...confianza, workflowSha, sha }, ahora) &&
    (workflowSha !== confianza.workflowSha || sha !== confianza.sha)
  );
}
/** Solo una reserva abierta, de protocolo obligatorio y aún sin inicio confirmado puede recibir el hecho. */
function reservaQueEspera(t: TrabajoPrivado | null, inicio: InicioTrabajo): t is TrabajoPrivado {
  return (
    t !== null &&
    t.solicitudId === inicio.solicitudId &&
    t.revisionReserva === inicio.revisionReserva &&
    t.accion === inicio.accion &&
    t.estado !== 'terminado' &&
    t.protocoloInicio === 'obligatorio' &&
    !t.inicioConfirmado
  );
}
/** Se escribe una sola vez por reserva: las repeticiones conservan el primer instante y no avanzan la revisión. */
export function anotarInicioRechazadoSqlite(
  sql: SqlAccesoPublico,
  inicio: InicioTrabajo,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): ResultadoTransicionTrabajo {
  const estado = leerTrabajosSqlite(sql, ahora);
  const t = estado.ultimoTrabajo;
  if (
    !reservaQueEspera(t, inicio) ||
    !revisionNoAutorizada(identidad, t.confianza, ahora) ||
    identidad.emitidoEn * MS_SEGUNDO < t.creadoEn - MARGEN_RELOJ_GITHUB_MS ||
    (t.runId !== null && t.runId !== identidad.runId)
  ) {
    return { estado: 'conflicto', trabajos: estadoPublicoTrabajos(estado) };
  }
  if (t.inicioRechazado !== undefined) {
    return { estado: 'repetido', trabajos: estadoPublicoTrabajos(estado) };
  }
  const trabajo: TrabajoPrivado = { ...t, inicioRechazado: { en: ahora, motivo: 'revision_no_autorizada' } };
  return { estado: 'aplicado', trabajos: estadoPublicoTrabajos(guardarTrabajoSqlite(sql, estado, trabajo, ahora)) };
}
