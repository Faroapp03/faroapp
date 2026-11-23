/**
 * Registro de solicitudes de actualización en la autoridad: una fila por solicitud con cuándo llegó, quién la pidió,
 * qué pidió, la decisión y, al terminar, los minutos que cuenta. Es privado: nada de aquí entra en el estado público del
 * trabajo ni en la consola. Sus escrituras comparten la transacción del trabajo, así que una fila nunca contradice
 * el documento de trabajos.
 */
import { ACCIONES_DEMANDA, type AccionDemanda } from '../../administracion/configuracion-demanda.ts';
import type { AccionActualizacion } from '../../administracion/ejecutor-github.ts';
import {
  accion as esAccion,
  esIdEjecucion,
  esIdSolicitudTrabajo,
  esOrigenTrabajo,
  exigirTrabajo,
  type OrigenTrabajo,
} from '../../administracion/estado-trabajos.js';
import { esNombreDeActorGitHub } from '../../administracion/oidc-demanda.ts';
import { esIdentificadorGitHub } from '../../administracion/oidc-github.ts';
import { MARGEN_MIN_POR_TRABAJO, type TrabajoDelHistorial } from '../../administracion/topes-demanda.ts';
import type { SolicitudTrabajo, TrabajoPrivado } from '../../administracion/trabajos.ts';
import { MS_POR_MINUTO } from '../../comun/tiempo.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

/**
 * Por qué no se admitió una solicitud. Los tres primeros son las guardias comunes de la reserva; los cuatro de los
 * topes, los de `decidirTopes`; `fuera_de_ventana` y `requiere_atencion`, los de la programada.
 */
export const MOTIVOS_SOLICITUD = Object.freeze([
  'ocupado',
  'activacion_pendiente',
  'candidato_en_plazo',
  'requiere_atencion',
  'fuera_de_ventana',
  'separacion',
  'tope_dia',
  'tope_mes',
  'presupuesto',
] as const);
export type MotivoSolicitud = (typeof MOTIVOS_SOLICITUD)[number];
/**
 * Por qué se liberó una reserva a demanda admitida antes de su permiso de inicio. `ciclo_programado`: la tarea diaria
 * llegó mientras esperaba y tiene prioridad. La fila sigue admitida, así que sigue gastando los topes de quien la pidió.
 */
export const MOTIVOS_LIBERACION = Object.freeze(['ciclo_programado'] as const);
export type MotivoLiberacion = (typeof MOTIVOS_LIBERACION)[number];
/** Quién lanzó un run a demanda, tal como lo acredita el token de GitHub. Solo lo guarda este registro. */
export interface ActorSolicitud {
  readonly id: string;
  readonly nombre: string;
}
export type SolicitudAnotada = {
  readonly origen: OrigenTrabajo;
  readonly accion: AccionActualizacion;
  readonly runId?: string;
  readonly actor?: ActorSolicitud;
} & (
  | { readonly decision: 'admitida'; readonly solicitudId: string }
  | { readonly decision: 'rechazada'; readonly motivo: MotivoSolicitud }
);
/** Lo que una vía entrega al reservar: la solicitud con su origen. */
export type SolicitudReservada = Omit<SolicitudTrabajo, 'accion'> & {
  readonly accion: AccionActualizacion;
  readonly origen: OrigenTrabajo;
};

/** Filas que se conservan como poco; el mes en curso se conserva entero aunque pase de este tope. */
export const MAX_FILAS_SOLICITUDES = 200;
const LISTA = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(',');
/** Un identificador de solicitud puede repetirse tras otra reserva: cada trabajo completa la fila más reciente. */
const FILA_MAS_RECIENTE = '(SELECT max(id) FROM administracion_solicitudes WHERE solicitud_id=?)';

export function prepararSolicitudesSqlite(sql: SqlAccesoPublico): void {
  sql.ejecutar(`CREATE TABLE IF NOT EXISTS administracion_solicitudes (
    id INTEGER PRIMARY KEY, en INTEGER NOT NULL CHECK(en >= 0),
    origen TEXT NOT NULL CHECK(origen IN ('programada','panel','demanda')),
    accion TEXT NOT NULL CHECK(accion IN ('actualizar-datos','reintentar-pendientes','comprobar-programada',
      'comprobar-vencidas','actualizar-cursos')),
    actor_id TEXT, actor TEXT, solicitud_id TEXT, run_id TEXT,
    decision TEXT NOT NULL CHECK(decision IN ('admitida','rechazada')),
    motivo TEXT CHECK(motivo IS NULL OR motivo IN (${LISTA(MOTIVOS_SOLICITUD)})),
    iniciado_en INTEGER, minutos INTEGER CHECK(minutos IS NULL OR minutos >= 0),
    motivo_liberacion TEXT CHECK(motivo_liberacion IS NULL OR motivo_liberacion IN (${LISTA(MOTIVOS_LIBERACION)})),
    CHECK((origen = 'demanda') = (actor_id IS NOT NULL) AND (actor_id IS NULL) = (actor IS NULL)),
    CHECK((decision = 'admitida') = (motivo IS NULL) AND (decision = 'admitida') = (solicitud_id IS NOT NULL)),
    CHECK(decision = 'admitida' OR (iniciado_en IS NULL AND minutos IS NULL)),
    CHECK(motivo_liberacion IS NULL OR (origen = 'demanda' AND decision = 'admitida' AND iniciado_en IS NULL))) STRICT`);
  sql.ejecutar('CREATE INDEX IF NOT EXISTS administracion_solicitudes_en ON administracion_solicitudes(en)');
}

function comprobarSolicitud(entrada: SolicitudAnotada): void {
  exigirTrabajo(esOrigenTrabajo(entrada.origen) && esAccion(entrada.accion));
  exigirTrabajo(entrada.runId === undefined || esIdEjecucion(entrada.runId));
  const actor = entrada.actor;
  exigirTrabajo((entrada.origen === 'demanda') === (actor !== undefined));
  exigirTrabajo(actor === undefined || (esIdentificadorGitHub(actor.id) && esNombreDeActorGitHub(actor.nombre)));
  if (entrada.decision === 'admitida') {
    exigirTrabajo(esIdSolicitudTrabajo(entrada.solicitudId));
  } else {
    exigirTrabajo(entrada.decision === 'rechazada' && MOTIVOS_SOLICITUD.includes(entrada.motivo));
  }
}
/** Primer instante del mes UTC de `ahora`. */
function inicioDelMes(ahora: number): number {
  const fecha = new Date(ahora);
  return Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1);
}
/**
 * Conserva las últimas filas hasta el tope y, siempre, todo el mes en curso y la última solicitud admitida del mes
 * anterior que no sea de la programada: es lo que necesita `decidirTopes` para la separación al cambiar de mes.
 */
function podarSolicitudes(sql: SqlAccesoPublico, ahora: number): void {
  const mes = inicioDelMes(ahora);
  sql.ejecutar(
    `DELETE FROM administracion_solicitudes WHERE en < ?
      AND id NOT IN (SELECT id FROM administracion_solicitudes ORDER BY id DESC LIMIT ?)
      AND id <> COALESCE((SELECT id FROM administracion_solicitudes WHERE en < ? AND decision = 'admitida'
        AND origen <> 'programada' ORDER BY en DESC, id DESC LIMIT 1), -1)`,
    mes,
    MAX_FILAS_SOLICITUDES,
    mes,
  );
}
/** Anota una solicitud con el reloj de la autoridad. El actor solo se guarda cuando el origen es `demanda`. */
export function anotarSolicitudSqlite(sql: SqlAccesoPublico, entrada: SolicitudAnotada, ahora: number): void {
  comprobarSolicitud(entrada);
  exigirTrabajo(Number.isSafeInteger(ahora) && ahora >= 0);
  sql.ejecutar(
    'INSERT INTO administracion_solicitudes VALUES (NULL,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)',
    ahora,
    entrada.origen,
    entrada.accion,
    entrada.actor?.id ?? null,
    entrada.actor?.nombre ?? null,
    entrada.decision === 'admitida' ? entrada.solicitudId : null,
    entrada.runId ?? null,
    entrada.decision,
    entrada.decision === 'rechazada' ? entrada.motivo : null,
  );
  podarSolicitudes(sql, ahora);
}
/**
 * Anota por qué se liberó una reserva a demanda sin inicio, dentro de la transacción que la libera. Solo la fila
 * admitida de esa reserva, todavía sin inicio y sin otra liberación, puede recibirlo.
 */
export function anotarLiberacionSqlite(sql: SqlAccesoPublico, solicitudId: string, motivo: MotivoLiberacion): void {
  exigirTrabajo(esIdSolicitudTrabajo(solicitudId) && MOTIVOS_LIBERACION.includes(motivo));
  const filas = sql.filas(
    `SELECT 1 FROM administracion_solicitudes WHERE id=${FILA_MAS_RECIENTE} AND origen='demanda'
      AND decision='admitida' AND iniciado_en IS NULL AND motivo_liberacion IS NULL`,
    solicitudId,
  );
  exigirTrabajo(filas.length === 1);
  sql.ejecutar(
    `UPDATE administracion_solicitudes SET motivo_liberacion=? WHERE id=${FILA_MAS_RECIENTE}`,
    motivo,
    solicitudId,
  );
}
/** Minutos de una solicitud admitida al terminar; `null` si no hay medida. */
function completarMinutosSqlite(sql: SqlAccesoPublico, solicitudId: string, minutos: number | null): void {
  exigirTrabajo(esIdSolicitudTrabajo(solicitudId));
  exigirTrabajo(minutos === null || (Number.isSafeInteger(minutos) && minutos >= 0));
  sql.ejecutar(`UPDATE administracion_solicitudes SET minutos=? WHERE id=${FILA_MAS_RECIENTE}`, minutos, solicitudId);
}
/**
 * Los minutos que cuenta un trabajo terminado. La autoridad mide desde que concedió el permiso de inicio hasta que
 * llegó el recibo, redondeado hacia arriba al minuto, como factura GitHub, y suma `MARGEN_MIN_POR_TRABAJO` por lo que
 * no ve. Un despacho rechazado no creó ningún run: cero. Sin inicio o sin recibo no hay medida.
 */
function minutosDelTrabajo(t: TrabajoPrivado, iniciadoEn: number | null, ahora: number): number | null {
  const resultado = t.resultado?.resultado;
  if (resultado === 'despacho-rechazado') {
    return 0;
  }
  const conRecibo = resultado === 'validado' || resultado === 'sin-pendientes' || resultado === 'rechazado';
  if (!conRecibo || iniciadoEn === null) {
    return null;
  }
  return Math.ceil((ahora - iniciadoEn) / MS_POR_MINUTO) + MARGEN_MIN_POR_TRABAJO;
}
function iniciadoEnDe(sql: SqlAccesoPublico, solicitudId: string): number | null {
  const fila = sql.filas(
    `SELECT iniciado_en FROM administracion_solicitudes WHERE id=${FILA_MAS_RECIENTE}`,
    solicitudId,
  )[0];
  const valor = fila?.iniciado_en;
  return typeof valor === 'number' ? valor : null;
}
/** Una reserva nueva de la programada o del panel deja su fila; la de demanda la deja antes quien conoce al actor. */
function anotarReservaNueva(sql: SqlAccesoPublico, t: TrabajoPrivado, ahora: number): void {
  exigirTrabajo(t.origen !== undefined);
  if (t.origen === 'demanda') {
    const filas = sql.filas(
      `SELECT 1 FROM administracion_solicitudes WHERE id=${FILA_MAS_RECIENTE} AND decision='admitida'
        AND origen='demanda' AND iniciado_en IS NULL AND minutos IS NULL`,
      t.solicitudId,
    );
    exigirTrabajo(filas.length === 1);
    return;
  }
  const runId = t.runId === null ? {} : { runId: t.runId };
  anotarSolicitudSqlite(
    sql,
    { origen: t.origen, accion: t.accion, decision: 'admitida', solicitudId: t.solicitudId, ...runId },
    ahora,
  );
}
/**
 * Enganche de la única escritura del documento de trabajos. Una reserva nueva deja su fila; después, la misma fila
 * recibe el run cuando se conoce, el instante del permiso de inicio y, al terminar, los minutos. Un trabajo reservado
 * antes de existir el registro no tiene fila y no se completa.
 */
export function registrarTransicionSqlite(
  sql: SqlAccesoPublico,
  anterior: TrabajoPrivado | null,
  nuevo: TrabajoPrivado | null,
  ahora: number,
): void {
  if (nuevo === null) {
    return;
  }
  if (anterior?.solicitudId !== nuevo.solicitudId) {
    anotarReservaNueva(sql, nuevo, ahora);
    return;
  }
  const id = nuevo.solicitudId;
  if (nuevo.runId !== null) {
    sql.ejecutar(`UPDATE administracion_solicitudes SET run_id=? WHERE id=${FILA_MAS_RECIENTE}`, nuevo.runId, id);
  }
  if (!anterior.inicioConfirmado && nuevo.inicioConfirmado) {
    sql.ejecutar(`UPDATE administracion_solicitudes SET iniciado_en=? WHERE id=${FILA_MAS_RECIENTE}`, ahora, id);
  }
  if (anterior.estado !== 'terminado' && nuevo.estado === 'terminado') {
    completarMinutosSqlite(sql, id, minutosDelTrabajo(nuevo, iniciadoEnDe(sql, id), ahora));
  }
}
/**
 * La acción con la que cuenta una solicitud en los topes. La programada no gasta topes (`null`). Reintentar lo
 * pendiente desde el panel cuenta como una actualización completa: es la estimación prudente de su coste.
 */
function accionEnLosTopes(origen: unknown, accion: unknown): AccionDemanda | null {
  exigirTrabajo(esOrigenTrabajo(origen) && esAccion(accion));
  if (origen === 'programada') {
    exigirTrabajo(accion === 'comprobar-programada');
    return null;
  }
  const enLosTopes = accion === 'reintentar-pendientes' ? 'actualizar-datos' : accion;
  const admitida = ACCIONES_DEMANDA.find((a) => a === enLosTopes);
  exigirTrabajo(admitida !== undefined);
  return admitida;
}
/**
 * Los trabajos admitidos del mes UTC de `ahora` y la última solicitud anterior, en orden de llegada: la forma exacta
 * del historial de `decidirTopes`. Las rechazadas no gastan topes ni minutos y no entran.
 */
export function leerHistorialDelMesSqlite(sql: SqlAccesoPublico, ahora: number): readonly TrabajoDelHistorial[] {
  const mes = inicioDelMes(ahora);
  const filas = sql.filas(
    `SELECT en, origen, accion, minutos FROM administracion_solicitudes WHERE decision = 'admitida' AND (en >= ?
      OR id = (SELECT id FROM administracion_solicitudes WHERE en < ? AND decision = 'admitida'
        AND origen <> 'programada' ORDER BY en DESC, id DESC LIMIT 1)) ORDER BY en, id`,
    mes,
    mes,
  );
  return Object.freeze(
    filas.map((fila) => {
      const { en, minutos } = fila;
      exigirTrabajo(Number.isSafeInteger(en) && typeof en === 'number' && en <= ahora);
      exigirTrabajo(minutos === null || (typeof minutos === 'number' && Number.isSafeInteger(minutos)));
      return Object.freeze({ en, accion: accionEnLosTopes(fila.origen, fila.accion), minutos });
    }),
  );
}
