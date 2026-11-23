/**
 * Cierre pedido desde el panel, en la misma transacción que la activación y los trabajos. Se anota ligado a la revisión
 * exacta y al trabajo que se despacha para cumplirlo; lo cumple solo esa ejecución, una vez, antes de caducar y con la
 * ejecución que manda en la activación ya terminada según GitHub. Solo cierra si la web sirve otra vez lo anterior.
 */
import {
  type ActivacionPrivada,
  autoridadActivacion,
  dosServicios,
  type EvidenciaIntentoActivacionCompletado,
  evidenciaIntentoCoincide,
  mismoOrigen,
  type ResultadoTransicionActivacion,
  sirveLoAnterior,
} from '../../administracion/activacion.ts';
import {
  PLAZO_CIERRE_MS,
  type RegistroCierreActivacion,
  type SolicitudCierreActivacion,
} from '../../administracion/cierre-activacion.ts';
import type { IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import { formaObservada } from '../../administracion/versiones-activacion.ts';
import { guardar, leerActivacionSqlite, resultado, TERMINALES } from './activacion-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { identidadCoincide, leerTrabajosSqlite } from './trabajos-sqlite.ts';

export function solicitarCierreActivacionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudCierreActivacion,
  ahora: number,
): ResultadoTransicionActivacion {
  const estado = leerActivacionSqlite(sql, ahora);
  const a = estado.ultimaActivacion;
  const trabajos = leerTrabajosSqlite(sql, ahora);
  const ultimo = trabajos.ultimoTrabajo;
  if (
    !a ||
    TERMINALES.includes(a.fase) ||
    solicitud.revisionEsperada !== estado.revision ||
    // El trabajo que lo cumple es la reserva siguiente, que solo cabe con el último trabajo terminado.
    solicitud.trabajo.revisionReserva !== trabajos.revision + 1 ||
    (ultimo !== null && ultimo.estado !== 'terminado') ||
    solicitud.caducaEn <= ahora ||
    solicitud.caducaEn > ahora + PLAZO_CIERRE_MS
  ) {
    return resultado('conflicto', estado);
  }
  const { detenida: _detenida, ...resto } = a;
  const cierre = {
    trabajo: solicitud.trabajo,
    revisionActivacion: estado.revision + 1,
    caducaEn: solicitud.caducaEn,
    estado: 'solicitado',
    observado: null,
  } as const;
  return guardar(sql, estado, { ...resto, ...(a.detenida ? { detenida: a.detenida } : {}), cierre }, ahora);
}
/** La ejecución que lo cumple: la del trabajo despachado, del mismo origen que la que manda en la activación. */
function ejecucionQueCumple(
  a: ActivacionPrivada,
  sql: SqlAccesoPublico,
  {
    registro,
    identidad,
    ahora,
  }: { registro: RegistroCierreActivacion; identidad: IdentidadEjecucionGitHub; ahora: number },
): boolean {
  const t = leerTrabajosSqlite(sql, ahora).ultimoTrabajo;
  return (
    t !== null &&
    t.solicitudId === registro.solicitudId &&
    t.revisionReserva === registro.revisionReserva &&
    t.runId === registro.runId &&
    identidad.runId === registro.runId &&
    t.inicioConfirmado &&
    identidadCoincide(identidad, t.confianza, ahora) &&
    mismoOrigen(t.confianza, autoridadActivacion(a).confianza)
  );
}
/** La solicitud sigue vigente y es para este trabajo, con la activación en la revisión exacta en que se anotó. */
function vigente(a: ActivacionPrivada | null, registro: RegistroCierreActivacion, revision: number, ahora: number) {
  const c = a?.cierre;
  return (
    a !== null &&
    c !== undefined &&
    !TERMINALES.includes(a.fase) &&
    c.estado === 'solicitado' &&
    ahora < c.caducaEn &&
    registro.revisionEsperada === revision &&
    c.revisionActivacion === revision &&
    c.trabajo.solicitudId === registro.solicitudId &&
    c.trabajo.revisionReserva === registro.revisionReserva
  );
}
/** GitHub dice que la ejecución que manda en la activación ha terminado, en su último intento conocido o después. */
function terminada(a: ActivacionPrivada, fin: EvidenciaIntentoActivacionCompletado): boolean {
  return (
    evidenciaIntentoCoincide(fin, autoridadActivacion(a)) &&
    Number(fin.runAttempt) >= Number(a.recuperacion?.intento ?? '1')
  );
}
export function cerrarActivacionSolicitadaSqlite(
  sql: SqlAccesoPublico,
  registro: RegistroCierreActivacion,
  { identidad, fin }: { identidad: IdentidadEjecucionGitHub; fin: EvidenciaIntentoActivacionCompletado },
  ahora: number,
): ResultadoTransicionActivacion {
  const estado = leerActivacionSqlite(sql, ahora);
  const a = estado.ultimaActivacion;
  if (
    !vigente(a, registro, estado.revision, ahora) ||
    !a ||
    !ejecucionQueCumple(a, sql, { registro, identidad, ahora }) ||
    !terminada(a, fin) ||
    !formaObservada(registro.observado, dosServicios(a))
  ) {
    return resultado('conflicto', estado);
  }
  const { detenida: _detenida, cierre, ...resto } = a;
  if (cierre && a.evidencia !== null && !sirveLoAnterior(a.evidencia.anterior, registro.observado)) {
    // La web ya no sirve lo anterior: no se cierra; la solicitud queda usada, con lo observado.
    const usada = { ...cierre, estado: 'web-cambiada', observado: registro.observado } as const;
    return guardar(sql, estado, { ...a, actualizadoEn: ahora, cierre: usada }, ahora);
  }
  const abandono = { motivo: 'a-mano', observado: registro.observado } as const;
  return guardar(sql, estado, { ...resto, actualizadoEn: ahora, fase: 'abandonada', abandono }, ahora);
}
