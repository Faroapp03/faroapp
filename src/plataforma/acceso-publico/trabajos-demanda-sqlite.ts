/**
 * La autoridad de la reserva a demanda. Un run lanzado a mano, con su identidad ya verificada, pide aquí su reserva:
 * en una sola transacción y con el reloj de la autoridad se comprueban las guardias comunes y los topes, se anota la
 * solicitud y se crea el trabajo con su run ya fijado. Después pide su permiso de inicio por la vía de siempre.
 */
import { leerConfiguracionDemanda } from '../../administracion/configuracion-demanda.ts';
import {
  type ConfianzaOidcGitHub,
  type IdentidadEjecucionGitHub,
  leerConfianzaOidcGitHub,
} from '../../administracion/oidc-github.ts';
import type { SolicitudTrabajoProgramado } from '../../administracion/programacion-trabajos.ts';
import type { AccesoSesionPanel } from '../../administracion/sesion.ts';
import { decidirTopes } from '../../administracion/topes-demanda.ts';
import {
  estadoPublicoTrabajos,
  exigirTrabajo,
  type InicioTrabajo,
  leerInicioTrabajo,
  leerReferenciaTrabajo,
  leerSolicitudTrabajo,
  objetoTrabajo,
  type ReferenciaTrabajo,
  type SolicitudTrabajo,
} from '../../administracion/trabajos.ts';
import { MS_POR_DIA, MS_POR_MINUTO } from '../../comun/tiempo.ts';
import { AlmacenSesionEncuestaSqlite } from '../../encuesta/almacen-sqlite.ts';
import { admitirReservaSqlite } from './admision-reserva-sqlite.ts';
import { leerControlesSqlite } from './controles-sqlite.ts';
import { type EnviarDurable, reservarProgramadaSqlite } from './programacion-almacen.ts';
import { anotarSolicitudSqlite, leerHistorialDelMesSqlite, MOTIVOS_SOLICITUD } from './solicitudes-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import {
  type AlmacenTrabajosDemanda,
  leerPeticionDemanda,
  type MotivoRechazoDemanda,
  type PeticionDemanda,
  type ResultadoDemanda,
  RUTA_DEMANDA,
} from './trabajos-durable.ts';
import {
  anotarDespachoSqlite,
  confirmarInicioSqlite,
  identidadCoincide,
  leerTrabajosSqlite,
  reservarTrabajoSqlite,
  retirarTrabajoSqlite,
} from './trabajos-sqlite.ts';

/** El run pide su permiso de inicio nada más reservar: una hora sin él ya no es un arranque normal. */
const MINUTOS_PLAZO_INICIO = 60;
export const PLAZO_INICIO_DEMANDA_MS = MINUTOS_PLAZO_INICIO * MS_POR_MINUTO;
/**
 * Rechazos del mismo actor en un día UTC que se anotan como mucho. Los siguientes reciben la misma respuesta sin añadir
 * fila: insistir no llena el registro ni borra lo anotado antes.
 */
export const MAX_RECHAZOS_ANOTADOS_DIA = 20;

type PeticionReservaDemanda = Extract<PeticionDemanda, { operacion: 'reservar' }>;
const CERRADA: ResultadoDemanda = Object.freeze({ estado: 'cerrada' });
const SIN_RESERVA: ResultadoDemanda = Object.freeze({ estado: 'sin_reserva' });
const SOLO_PROGRAMADA: readonly string[] = ['requiere_atencion', 'fuera_de_ventana'];

function respuestaReserva(estado: 'reservada' | 'repetida', t: ReferenciaTrabajo): ResultadoDemanda {
  return Object.freeze({ estado, solicitudId: t.solicitudId, revisionReserva: t.revisionReserva });
}

/**
 * La misma liberación que la programada aplica a sus reservas vencidas, con el plazo de inicio de la demanda: una
 * reserva a demanda sin permiso de inicio en su plazo se retira. La retirada deja de ocupar y, en la misma
 * transacción, niega el permiso tardío, porque un trabajo terminado no admite inicio ni recibo.
 */
export function liberarDemandaSinInicioSqlite(sql: SqlAccesoPublico, ahora: number): void {
  const estado = leerTrabajosSqlite(sql, ahora);
  const t = estado.ultimoTrabajo;
  const sinInicio = t?.origen === 'demanda' && t.estado !== 'terminado' && !t.inicioConfirmado;
  if (!sinInicio || ahora - t.creadoEn <= PLAZO_INICIO_DEMANDA_MS) {
    return;
  }
  const referencia = { solicitudId: t.solicitudId, revisionReserva: t.revisionReserva };
  const retirada = retirarTrabajoSqlite(sql, { ...referencia, revisionEsperada: estado.revision }, ahora);
  exigirTrabajo(retirada.estado === 'retirado');
}

function rechazosAnotadosHoy(sql: SqlAccesoPublico, actorId: string, ahora: number): number {
  const fila = sql.filas(
    `SELECT count(*) AS n FROM administracion_solicitudes
      WHERE origen='demanda' AND decision='rechazada' AND actor_id=? AND en >= ?`,
    actorId,
    ahora - (ahora % MS_POR_DIA),
  )[0];
  exigirTrabajo(typeof fila?.n === 'number');
  return fila.n;
}
function rechazar(
  sql: SqlAccesoPublico,
  peticion: PeticionReservaDemanda,
  motivo: MotivoRechazoDemanda,
  ahora: number,
): ResultadoDemanda {
  const { ejecucion, actor } = peticion.identidad;
  if (rechazosAnotadosHoy(sql, actor.id, ahora) < MAX_RECHAZOS_ANOTADOS_DIA) {
    const solicitud = { origen: 'demanda', accion: peticion.accion, runId: ejecucion.runId, actor } as const;
    anotarSolicitudSqlite(sql, { ...solicitud, decision: 'rechazada', motivo }, ahora);
  }
  return Object.freeze({ estado: 'rechazada', motivo });
}

/** Un run que ya tuvo una reserva admitida no obtiene otra, aunque la suya ya no sea el último trabajo. */
function runConReservaAdmitida(sql: SqlAccesoPublico, runId: string): boolean {
  return sql.filas("SELECT 1 FROM administracion_solicitudes WHERE run_id=? AND decision='admitida'", runId).length > 0;
}

/**
 * La fila admitida va antes que el trabajo, porque el enganche del registro la exige al crear un trabajo a demanda;
 * el despacho fija el run en el mismo instante. Todo comparte la transacción del llamador: si un paso falla, no queda
 * ni la fila ni el trabajo.
 */
function crearReserva(
  sql: SqlAccesoPublico,
  peticion: PeticionReservaDemanda,
  revision: number,
  ahora: number,
): ResultadoDemanda {
  const { ejecucion, actor } = peticion.identidad;
  const solicitudId = crypto.randomUUID();
  const solicitud = { origen: 'demanda', accion: peticion.accion, runId: ejecucion.runId, actor } as const;
  anotarSolicitudSqlite(sql, { ...solicitud, decision: 'admitida', solicitudId }, ahora);
  const reservada = { solicitudId, accion: peticion.accion, revisionEsperada: revision, origen: 'demanda' } as const;
  const reserva = reservarTrabajoSqlite(sql, reservada, peticion.confianza, ahora);
  const t = reserva.trabajos.ultimoTrabajo;
  exigirTrabajo(reserva.estado === 'nueva' && t !== null);
  const referencia = { solicitudId, revisionReserva: t.revisionReserva };
  const despacho = anotarDespachoSqlite(sql, referencia, { estado: 'despachada', runId: ejecucion.runId }, ahora);
  exigirTrabajo(despacho.estado === 'aplicado');
  return respuestaReserva('reservada', referencia);
}

/**
 * Reserva del run, dentro de la transacción del llamador. La identidad llega verificada por la frontera; aquí se
 * comprueba de nuevo contra la confianza y la lista de actores, y una que no encaja es un error, nunca un rechazo.
 */
export function reservarDemandaSqlite(
  sql: SqlAccesoPublico,
  peticion: PeticionReservaDemanda,
  ahora: number,
): ResultadoDemanda {
  const lectura = leerConfiguracionDemanda(peticion.configuracion ?? undefined);
  if (lectura.estado === 'cerrada') {
    return CERRADA;
  }
  const { ejecucion, actor } = peticion.identidad;
  exigirTrabajo(lectura.configuracion.actores.includes(actor.id));
  exigirTrabajo(identidadCoincide(ejecucion, peticion.confianza, ahora));
  liberarDemandaSinInicioSqlite(sql, ahora);
  const estado = leerTrabajosSqlite(sql, ahora);
  const t = estado.ultimoTrabajo;
  if (t?.runId === ejecucion.runId && t.origen === 'demanda') {
    return respuestaReserva('repetida', t);
  }
  if (t?.runId === ejecucion.runId || runConReservaAdmitida(sql, ejecucion.runId)) {
    return Object.freeze({ estado: 'rechazada', motivo: 'ocupado' });
  }
  const admision = admitirReservaSqlite(sql, ahora);
  if (!admision.admitida) {
    return rechazar(sql, peticion, admision.motivo, ahora);
  }
  const historial = leerHistorialDelMesSqlite(sql, ahora);
  const topes = decidirTopes(lectura.configuracion, peticion.accion, ahora, historial);
  if (topes.decision === 'rechazada') {
    return rechazar(sql, peticion, topes.motivo, ahora);
  }
  return crearReserva(sql, peticion, estado.revision, ahora);
}

/** La reserva de este run si es el trabajo actual; solo lee. La usa la activación en un intento posterior. */
export function consultarDemandaSqlite(sql: SqlAccesoPublico, runId: string, ahora: number): ResultadoDemanda {
  const t = leerTrabajosSqlite(sql, ahora).ultimoTrabajo;
  return t?.origen === 'demanda' && t.runId === runId ? respuestaReserva('reservada', t) : SIN_RESERVA;
}

function esMotivoRechazoDemanda(valor: unknown): valor is MotivoRechazoDemanda {
  return MOTIVOS_SOLICITUD.some((m) => m === valor && !SOLO_PROGRAMADA.includes(m));
}
/** Cada estado con sus claves exactas, y solo los que puede dar la operación pedida. */
export function leerResultadoDemanda(entrada: unknown, peticion: PeticionDemanda): ResultadoDemanda {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const estado = Object.getOwnPropertyDescriptor(entrada, 'estado')?.value;
  const reservar = peticion.operacion === 'reservar';
  if (estado === 'reservada' || estado === 'repetida') {
    exigirTrabajo(reservar || estado === 'reservada');
    const o = objetoTrabajo(entrada, 'estado,revisionReserva,solicitudId');
    return respuestaReserva(
      estado,
      leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva }),
    );
  }
  if (estado === 'rechazada') {
    const motivo = objetoTrabajo(entrada, 'estado,motivo').motivo;
    exigirTrabajo(reservar && esMotivoRechazoDemanda(motivo));
    return Object.freeze({ estado, motivo });
  }
  objetoTrabajo(entrada, 'estado');
  exigirTrabajo(estado === (reservar ? 'cerrada' : 'sin_reserva'));
  return reservar ? CERRADA : SIN_RESERVA;
}
/** El lado cliente del enlace privado: valida la petición antes de enviarla y la respuesta al recibirla. */
export function pedirDemandaDurable(enviar: EnviarDurable, entrada: PeticionDemanda): Promise<ResultadoDemanda> {
  const peticion = leerPeticionDemanda(entrada);
  return enviar(RUTA_DEMANDA, peticion, (valor) => leerResultadoDemanda(valor, peticion));
}

/**
 * El almacén de sesión del objeto durable con la reserva a demanda. Las operaciones que crean o arrancan un trabajo, y
 * la lectura del panel que precede a su reserva, liberan antes, en su misma transacción, una reserva a demanda
 * vencida sin inicio.
 */
export class AlmacenSesionDemandaSqlite extends AlmacenSesionEncuestaSqlite implements AlmacenTrabajosDemanda {
  async operarDemanda(entrada: PeticionDemanda): Promise<ResultadoDemanda> {
    const peticion = leerPeticionDemanda(entrada);
    return this.conTrabajos((ahora) =>
      peticion.operacion === 'consultar'
        ? consultarDemandaSqlite(this.sql, peticion.runId, ahora)
        : reservarDemandaSqlite(this.sql, peticion, ahora),
    );
  }
  override async confirmarInicio(entrada: InicioTrabajo, identidad: IdentidadEjecucionGitHub) {
    const inicio = leerInicioTrabajo(entrada);
    return this.conTrabajos((ahora) => {
      liberarDemandaSinInicioSqlite(this.sql, ahora);
      return confirmarInicioSqlite(this.sql, inicio, identidad, ahora);
    });
  }
  override async reservarTrabajoProgramado(entrada: SolicitudTrabajoProgramado, confianza: ConfianzaOidcGitHub) {
    const liberando = <T>(accion: (ahora: number) => T) =>
      this.conTrabajos((ahora) => {
        liberarDemandaSinInicioSqlite(this.sql, ahora);
        return accion(ahora);
      });
    return reservarProgramadaSqlite(this.sql, liberando, entrada, confianza);
  }
  /** El panel lee antes de pulsar: así la revisión que ve ya incluye la liberación y su reserva puede seguir. */
  override async leerTrabajoDeSesion(acceso: AccesoSesionPanel) {
    return this.conSesion(acceso, (sesion, ahora) => {
      exigirTrabajo(leerControlesSqlite(this.sql) !== null);
      liberarDemandaSinInicioSqlite(this.sql, ahora);
      const trabajos = estadoPublicoTrabajos(leerTrabajosSqlite(this.sql, ahora));
      return { estado: 'activa', sesion, trabajos } as const;
    });
  }
  override async reservarTrabajoDeSesion(
    acceso: AccesoSesionPanel,
    entrada: SolicitudTrabajo,
    entradaConfianza: ConfianzaOidcGitHub,
  ) {
    const solicitud = leerSolicitudTrabajo(entrada);
    const confianza = leerConfianzaOidcGitHub(entradaConfianza);
    return this.conSesion(acceso, (sesion, ahora) => {
      exigirTrabajo(leerControlesSqlite(this.sql) !== null);
      liberarDemandaSinInicioSqlite(this.sql, ahora);
      return { ...reservarTrabajoSqlite(this.sql, { ...solicitud, origen: 'panel' }, confianza, ahora), sesion };
    });
  }
}
