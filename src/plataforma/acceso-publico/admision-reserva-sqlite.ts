/**
 * Una sola decisión sobre si cabe un trabajo nuevo sin quitarle su publicación al anterior. La aplica la tarea
 * programada, que no tiene una persona que decida. El botón del panel no la aplica: quien lo pulsa puede sustituir a
 * propósito un candidato atascado. Se evalúa dentro de la transacción de la autoridad.
 */
import type { ActivacionPrivada } from '../../administracion/activacion.ts';
import { trabajoEnPlazo } from '../../administracion/programacion-trabajos.ts';
import type { EstadoTrabajosPrivado } from '../../administracion/trabajos.ts';
import { leerActivacionSqlite, TERMINALES } from './activacion-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { leerTrabajosSqlite } from './trabajos-sqlite.ts';

export type MotivoReservaNoAdmitida = 'ocupado' | 'activacion_pendiente' | 'candidato_en_plazo';
export type AdmisionReserva =
  | { readonly admitida: true }
  | { readonly admitida: false; readonly motivo: MotivoReservaNoAdmitida };

/**
 * El recibo validado llega antes de que la misma ejecución reserve su activación: mientras siga en plazo,
 * un trabajo nuevo le quitaría el candidato que aún puede activar.
 */
function candidatoAunActivable(trabajos: EstadoTrabajosPrivado, activacion: ActivacionPrivada | null, ahora: number) {
  const t = trabajos.ultimoTrabajo;
  return (
    t?.estado === 'terminado' &&
    t.resultado?.resultado === 'validado' &&
    trabajoEnPlazo(t, ahora) &&
    activacion?.trabajo.solicitudId !== t.solicitudId
  );
}

/**
 * Una activación sin resolver conserva su copia del trabajo y otro candidato duplicaría su efecto; una abandonada
 * está resuelta, porque la ejecución siguiente es la que puede reintentarla. El orden fija el motivo cuando
 * coinciden varios.
 */
export function decidirAdmisionReserva(
  trabajos: EstadoTrabajosPrivado,
  activacion: ActivacionPrivada | null,
  ahora: number,
): AdmisionReserva {
  if (activacion && !TERMINALES.includes(activacion.fase)) {
    return { admitida: false, motivo: 'activacion_pendiente' };
  }
  if (candidatoAunActivable(trabajos, activacion, ahora)) {
    return { admitida: false, motivo: 'candidato_en_plazo' };
  }
  if (trabajos.ultimoTrabajo && trabajos.ultimoTrabajo.estado !== 'terminado') {
    return { admitida: false, motivo: 'ocupado' };
  }
  return { admitida: true };
}

/** Sin la activación preparada no ha podido reservarse ninguna, así que no hay ninguna pendiente. */
function activacionObservada(sql: SqlAccesoPublico, ahora: number): ActivacionPrivada | null {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  if (metadata === undefined || !Object.hasOwn(metadata, 'activacion_panel_version')) {
    return null;
  }
  return leerActivacionSqlite(sql, ahora).ultimaActivacion;
}

/**
 * Lee la autoridad y responde si cabe un trabajo nuevo o por qué no; no escribe.
 * Sirve al panel para avisar, antes de pulsar, de que hay una publicación pendiente que se sustituiría.
 */
export function admitirReservaSqlite(sql: SqlAccesoPublico, ahora: number): AdmisionReserva {
  return decidirAdmisionReserva(leerTrabajosSqlite(sql, ahora), activacionObservada(sql, ahora), ahora);
}
