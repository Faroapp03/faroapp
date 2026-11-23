/**
 * Cómo termina un trabajo cuyo motor no dejó un recibo que publicar. Hay dos caminos y los dos guardan por qué no
 * terminó (`ultimoFallo`), que el panel enseña hasta que otro trabajo lo sustituye:
 * - el cierre del supervisor, autenticado por OIDC como el recibo, con la causa y el paso que él conoce;
 * - la evidencia de GitHub de que el job acabó sin enviar nada: el servidor solo sabe que no hubo resultado.
 * Transiciones síncronas dentro de la transacción del llamador, como las de `trabajos-sqlite.ts`.
 */
import type { CierreSinRecibo } from '../../administracion/cierre-sin-recibo.ts';
import type { UltimoFallo } from '../../administracion/estado-trabajos.js';
import type { IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import {
  type EstadoTrabajosPrivado,
  type EvidenciaEjecucionCompletada,
  estadoPublicoTrabajos,
  type ReferenciaTrabajo,
  type ResultadoTransicionTrabajo,
  type TrabajoPrivado,
} from '../../administracion/trabajos.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import {
  coincideReferencia,
  guardar,
  identidadCoincide,
  leerTrabajosSqlite,
  terminalSinCandidato,
} from './trabajos-sqlite.ts';

/** Un job que terminó sin decir nada: no se sabe en qué paso iba. */
const SIN_RESULTADO: UltimoFallo = Object.freeze({ causa: 'sin-resultado', paso: null });

function respuesta(
  estado: ResultadoTransicionTrabajo['estado'],
  trabajos: EstadoTrabajosPrivado,
): ResultadoTransicionTrabajo {
  return { estado, trabajos: estadoPublicoTrabajos(trabajos) };
}
function evidenciaCoincide(t: TrabajoPrivado, evidencia: EvidenciaEjecucionCompletada): boolean {
  const inicioRuta = t.confianza.workflowRef.indexOf('/.github/workflows/') + 1;
  const ruta = t.confianza.workflowRef.slice(inicioRuta).split('@')[0];
  return (
    evidencia.estado === 'completed' &&
    evidencia.runId === t.runId &&
    evidencia.runAttempt === '1' &&
    evidencia.repositorioId === t.confianza.repositorioId &&
    evidencia.propietarioId === t.confianza.propietarioId &&
    evidencia.sha === t.confianza.sha &&
    evidencia.workflowPath === ruta &&
    evidencia.evento === 'workflow_dispatch'
  );
}
export function finalizarSinReciboSqlite(
  sql: SqlAccesoPublico,
  referencia: ReferenciaTrabajo,
  evidencia: EvidenciaEjecucionCompletada,
  ahora: number,
): ResultadoTransicionTrabajo {
  const estado = leerTrabajosSqlite(sql, ahora);
  const t = estado.ultimoTrabajo;
  if (!coincideReferencia(t, referencia) || t.runId === null || !evidenciaCoincide(t, evidencia)) {
    return respuesta('conflicto', estado);
  }
  if (t.estado === 'terminado') {
    return respuesta(t.resultado?.resultado === 'ejecucion-sin-recibo' ? 'repetido' : 'conflicto', estado);
  }
  const terminado = terminalSinCandidato(t, 'ejecucion-sin-recibo', ahora, SIN_RESULTADO);
  return respuesta('aplicado', guardar(sql, estado, terminado, ahora));
}
function mismoFallo(guardado: UltimoFallo | undefined, recibido: UltimoFallo): boolean {
  return guardado?.causa === recibido.causa && guardado.paso === recibido.paso;
}
/**
 * El cierre del supervisor. Solo lo admite la ejecución que obtuvo el permiso de inicio de esta reserva. Si el motor
 * no dejó recibo, termina el trabajo sin él; si dejó un recibo rechazado (por ejemplo, porque no quedaba tiempo), le
 * añade el porqué. Repetir el mismo cierre no cambia nada; uno distinto sobre un trabajo ya explicado es un conflicto.
 */
export function cerrarSinReciboSqlite(
  sql: SqlAccesoPublico,
  cierre: CierreSinRecibo,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): ResultadoTransicionTrabajo {
  const estado = leerTrabajosSqlite(sql, ahora);
  const t = estado.ultimoTrabajo;
  if (
    !coincideReferencia(t, cierre) ||
    t.accion !== cierre.accion ||
    !t.inicioConfirmado ||
    t.runId !== identidad.runId ||
    !identidadCoincide(identidad, t.confianza, ahora)
  ) {
    return respuesta('conflicto', estado);
  }
  if (t.estado !== 'terminado') {
    const terminado = terminalSinCandidato(t, 'ejecucion-sin-recibo', ahora, cierre.ultimoFallo);
    return respuesta('aplicado', guardar(sql, estado, terminado, ahora));
  }
  const resultado = t.resultado;
  if (mismoFallo(resultado?.ultimoFallo, cierre.ultimoFallo)) {
    return respuesta('repetido', estado);
  }
  if (resultado?.resultado !== 'rechazado' || resultado.ultimoFallo !== undefined) {
    return respuesta('conflicto', estado);
  }
  const explicado = { ...t, actualizadoEn: ahora, resultado: { ...resultado, ultimoFallo: cierre.ultimoFallo } };
  return respuesta('aplicado', guardar(sql, estado, explicado, ahora));
}
