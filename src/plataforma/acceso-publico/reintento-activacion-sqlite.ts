/**
 * Reintento de una intención abandonada por `rechazo-previo`, en la misma transacción que la activación y los trabajos.
 * Solo una vez por trabajo abandonado, solo con su trabajo exacto y solo si después no hubo ningún otro trabajo:
 * así un trabajo validado más reciente siempre gana.
 */
import {
  type ActivacionPrivada,
  leerSolicitudReservaActivacion,
  mismoOrigen,
  type ResultadoTransicionActivacion,
  type SolicitudActivacion,
  type SolicitudReintentoActivacion,
} from '../../administracion/activacion.ts';
import type { IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import type { TrabajoPrivado } from '../../administracion/trabajos.ts';
import {
  coincide,
  guardar,
  identidadValida,
  leerActivacionSqlite,
  nuevaActivacion,
  reservarActivacionSqlite,
  resultado,
} from './activacion-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { identidadCoincide, leerTrabajosSqlite } from './trabajos-sqlite.ts';

/** La abandonada admite un reintento: por un rechazo sin efecto previo, no es ya un reintento y sabe su revisión. */
function reintentable(
  a: ActivacionPrivada | null,
  solicitud: SolicitudReintentoActivacion,
): a is ActivacionPrivada & { abandono: NonNullable<ActivacionPrivada['abandono']> } {
  const de = solicitud.reintentoDe;
  return (
    a !== null &&
    a.fase === 'abandonada' &&
    a.abandono?.motivo === 'rechazo-previo' &&
    a.reintento === undefined &&
    a.reintentoDescartado === undefined &&
    a.revisionTrabajos !== undefined &&
    a.trabajo.solicitudId === de.solicitudId &&
    a.trabajo.revisionReserva === de.revisionReserva &&
    a.trabajo.runId === de.runId &&
    a.trabajo.huellaRecibo === de.huellaRecibo
  );
}
/**
 * El trabajo de la ejecución que reintenta: terminado sin pendientes, con su inicio confirmado, del mismo origen que
 * el abandonado y reservado justo después de él, sin ningún otro trabajo en medio.
 */
function trabajoQueReintenta(
  t: TrabajoPrivado | null,
  a: ActivacionPrivada,
  entrada: { solicitud: SolicitudReintentoActivacion; identidad: IdentidadEjecucionGitHub; ahora: number },
): t is TrabajoPrivado {
  const { solicitud, identidad, ahora } = entrada;
  return (
    t !== null &&
    t.solicitudId === solicitud.solicitudId &&
    t.revisionReserva === solicitud.revisionReserva &&
    t.runId === solicitud.runId &&
    t.estado === 'terminado' &&
    t.resultado?.resultado === 'sin-pendientes' &&
    t.protocoloInicio === 'obligatorio' &&
    t.inicioConfirmado &&
    t.revisionBase === a.revisionTrabajos &&
    mismoOrigen(t.confianza, a.trabajo.confianza) &&
    identidad.runId === t.runId &&
    // También desde un intento posterior de la misma ejecución, si el primero no llegó a pedirlo.
    identidadCoincide(identidad, t.confianza, ahora, identidad.runAttempt)
  );
}
export function reintentarActivacionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudReintentoActivacion,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): ResultadoTransicionActivacion {
  const estado = leerActivacionSqlite(sql, ahora);
  const a = estado.ultimaActivacion;
  if (a?.reintento && coincide(a, solicitud)) {
    const mismo =
      a.trabajo.solicitudId === solicitud.reintentoDe.solicitudId && a.trabajo.runId === solicitud.reintentoDe.runId;
    return resultado(
      mismo && solicitud.revisionEsperada === a.revisionBase && identidadValida(a, identidad, ahora)
        ? 'repetido'
        : 'conflicto',
      estado,
    );
  }
  if (solicitud.revisionEsperada !== estado.revision || !reintentable(a, solicitud)) {
    return resultado('conflicto', estado);
  }
  const trabajos = leerTrabajosSqlite(sql, ahora);
  const t = trabajos.ultimoTrabajo;
  if (!trabajoQueReintenta(t, a, { solicitud, identidad, ahora })) {
    return resultado('conflicto', estado);
  }
  if (solicitud.descartado) {
    return guardar(sql, estado, { ...a, actualizadoEn: ahora, reintentoDescartado: solicitud.descartado }, ahora);
  }
  const base = nuevaActivacion(a.trabajo, { activacion: estado.revision, trabajos: trabajos.revision }, ahora);
  return guardar(
    sql,
    estado,
    {
      ...base,
      reintento: {
        solicitudId: t.solicitudId,
        revisionReserva: t.revisionReserva,
        runId: solicitud.runId,
        confianza: t.confianza,
        abandonadaEn: a.actualizadoEn,
        observado: a.abandono.observado,
      },
    },
    ahora,
  );
}
/** Una reserva con `reintentoDe` es un reintento; sin él, la reserva del último trabajo validado. */
export function reservarActivacionConReintentoSqlite(
  sql: SqlAccesoPublico,
  entrada: SolicitudActivacion | SolicitudReintentoActivacion,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): ResultadoTransicionActivacion {
  const solicitud = leerSolicitudReservaActivacion(entrada);
  return 'reintentoDe' in solicitud
    ? reintentarActivacionSqlite(sql, solicitud, identidad, ahora)
    : reservarActivacionSqlite(sql, solicitud, identidad, ahora);
}
