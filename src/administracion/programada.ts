/** Disparador interno sin identidad humana; solo una reserva nueva concede un intento de despacho. */
import { MS_POR_MINUTO } from '../comun/tiempo.ts';
import type { ConfiguracionProgramada } from './configuracion-programada.ts';
import type { ResultadoDespacho, SolicitudActualizacion } from './ejecutor-github.ts';
import { type ConfianzaOidcGitHub, leerConfianzaOidcGitHub } from './oidc-github.ts';
import {
  type AlmacenTrabajosProgramados,
  leerResultadoReservaTrabajoProgramado,
  leerSolicitudTrabajoProgramado,
  type ResultadoReservaTrabajoProgramado,
  type SolicitudTrabajoProgramado,
  VENTANA_TRABAJO_PROGRAMADO_MS,
} from './programacion-trabajos.ts';
import { type ReconciliarSinSesion, reconciliarDentroDeSuPlazo } from './reconciliacion.ts';
import { type AlmacenTrabajosActualizacion, exigirTrabajo } from './trabajos.ts';

export interface OpcionesComprobacionProgramada {
  readonly activacionHabilitada?: () => boolean;
  readonly almacen: Pick<AlmacenTrabajosProgramados, 'reservarTrabajoProgramado'> &
    Pick<AlmacenTrabajosActualizacion, 'anotarDespacho'>;
  readonly confianza: ConfianzaOidcGitHub;
  readonly despachar: (solicitud: SolicitudActualizacion, senal: AbortSignal) => Promise<ResultadoDespacho>;
  /** Cierra una ejecución abierta que GitHub da por completada; después la reserva definitiva decide el resto. */
  readonly reconciliar: ReconciliarSinSesion;
}
export function comprobarEventoProgramado(
  entrada: SolicitudTrabajoProgramado,
  configuracion: ConfiguracionProgramada,
): SolicitudTrabajoProgramado {
  if (configuracion.habilitada && configuracion.recuperarEl && entrada.cron !== configuracion.cron) {
    if (
      Object.keys(entrada).sort().join(',') !== 'cron,eventoEn' ||
      !Number.isSafeInteger(entrada.eventoEn) ||
      entrada.eventoEn <= 0 ||
      entrada.eventoEn % MS_POR_MINUTO !== 0
    ) {
      throw new Error('El evento programado no corresponde a la configuración');
    }
    const fecha = new Date(entrada.eventoEn);
    const dia = fecha.toISOString().slice(0, 10);
    const cron = `${fecha.getUTCMinutes()} ${fecha.getUTCHours()} ${fecha.getUTCDate()} ${fecha.getUTCMonth() + 1} *`;
    const partes = configuracion.cron.split(' ');
    const minuto = Number(partes[0]);
    const hora = Number(partes[1]);
    const diario = Date.parse(`${dia}T00:00:00Z`) + (hora * 60 + minuto) * MS_POR_MINUTO;
    if (
      dia === configuracion.recuperarEl &&
      entrada.cron === cron &&
      entrada.eventoEn > diario &&
      entrada.eventoEn - diario <= VENTANA_TRABAJO_PROGRAMADO_MS
    ) {
      return leerSolicitudTrabajoProgramado({ eventoEn: diario, cron: configuracion.cron, recuperacion: true });
    }
  }
  const evento = leerSolicitudTrabajoProgramado(entrada);
  if (
    !configuracion.habilitada ||
    evento.cron !== configuracion.cron ||
    (evento.recuperacion && configuracion.recuperarEl !== new Date(evento.eventoEn).toISOString().slice(0, 10))
  ) {
    throw new Error('El evento programado no corresponde a la configuración');
  }
  return evento;
}
export function crearComprobadorProgramado({
  almacen,
  confianza,
  despachar,
  reconciliar,
  activacionHabilitada,
}: OpcionesComprobacionProgramada) {
  const fijada = leerConfianzaOidcGitHub(confianza);
  return async (
    entrada: SolicitudTrabajoProgramado,
    senal: AbortSignal,
  ): Promise<ResultadoReservaTrabajoProgramado['estado']> => {
    senal.throwIfAborted();
    const solicitud = leerSolicitudTrabajoProgramado(entrada);
    let reserva = leerResultadoReservaTrabajoProgramado(await almacen.reservarTrabajoProgramado(solicitud, fijada));
    senal.throwIfAborted();
    // La autoridad decide con su reloj si hace falta consultar; la segunda petición ya no puede pedirlo.
    if (reserva.estado === 'pendiente-reconciliacion') {
      await reconciliarDentroDeSuPlazo(reconciliar, senal);
      senal.throwIfAborted();
      const tras = { ...solicitud, reconciliada: true } as const;
      reserva = leerResultadoReservaTrabajoProgramado(await almacen.reservarTrabajoProgramado(tras, fijada));
      senal.throwIfAborted();
      exigirTrabajo(reserva.estado !== 'pendiente-reconciliacion');
    }
    if (reserva.estado === 'nueva') {
      const trabajo = reserva.trabajos.ultimoTrabajo;
      if (trabajo?.accion !== 'comprobar-programada') {
        throw new Error('La reserva programada no corresponde a la operación');
      }
      const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
      const pendiente = reserva.revisarPaquetePendiente && activacionHabilitada?.();
      const resultado = await despachar(
        {
          ...referencia,
          accion: 'comprobar-programada',
          ...(pendiente ? { revisarPaquetePendiente: true } : {}),
        },
        senal,
      );
      senal.throwIfAborted();
      await almacen.anotarDespacho(referencia, resultado);
    }
    return reserva.estado;
  };
}
