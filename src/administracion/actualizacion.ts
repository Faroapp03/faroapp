/** Reserva durable antes de enviar; ninguna repetición de una solicitud recupera el permiso de despacho. */
import type { ResultadoDespacho, SolicitudActualizacion } from './ejecutor-github.ts';
import { type ConfianzaOidcGitHub, leerConfianzaOidcGitHub } from './oidc-github.ts';
import { type AccesoSesionPanel, leerAccesoSesionPanel } from './sesion.ts';
import {
  type AlmacenTrabajosActualizacion,
  exigirTrabajo,
  leerResultadoLecturaTrabajo,
  leerSolicitudTrabajo,
  objetoTrabajo,
  type ResultadoLecturaTrabajo,
  type ResultadoReservaTrabajo,
  type SolicitudTrabajo,
} from './trabajos.ts';

export interface OpcionesActualizacion {
  readonly almacen: AlmacenTrabajosActualizacion;
  readonly confianza: ConfianzaOidcGitHub;
  readonly despachar: (solicitud: SolicitudActualizacion, senal: AbortSignal) => Promise<ResultadoDespacho>;
}
type DecisionReserva = Extract<ResultadoReservaTrabajo, { trabajos: unknown }>['estado'];
export type ResultadoSolicitudActualizacion =
  | Exclude<ResultadoLecturaTrabajo, { estado: 'activa' }>
  | (Extract<ResultadoLecturaTrabajo, { estado: 'activa' }> & { readonly decision: DecisionReserva });

/** La respuesta pública conserva solo sesión, trabajo y decisión; nunca la confianza del ejecutor. */
export function leerResultadoSolicitudActualizacion(entrada: unknown): ResultadoSolicitudActualizacion {
  if (entrada !== null && typeof entrada === 'object' && Object.hasOwn(entrada, 'decision')) {
    const o = objetoTrabajo(entrada, 'decision,estado,sesion,trabajos');
    const lectura = leerResultadoLecturaTrabajo({ estado: o.estado, sesion: o.sesion, trabajos: o.trabajos });
    exigirTrabajo(lectura.estado === 'activa');
    exigirTrabajo(
      o.decision === 'nueva' || o.decision === 'repetida' || o.decision === 'ocupado' || o.decision === 'conflicto',
    );
    return Object.freeze({ ...lectura, decision: o.decision });
  }
  const lectura = leerResultadoLecturaTrabajo(entrada);
  exigirTrabajo(lectura.estado !== 'activa');
  return lectura;
}

/**
 * El almacén confirma sesión y revisión en una transacción corta; la red se utiliza después.
 * Si una dependencia lanza, el error se propaga y la reserva conserva su estado para reconciliarlo.
 * La respuesta solo sale tras comprobar de nuevo la sesión, sin prolongarla.
 */
export function crearSolicitadorActualizacion({ almacen, confianza, despachar }: OpcionesActualizacion) {
  const fijada = leerConfianzaOidcGitHub(confianza);
  return async (
    entradaAcceso: AccesoSesionPanel,
    entradaSolicitud: SolicitudTrabajo,
    senal: AbortSignal,
  ): Promise<ResultadoSolicitudActualizacion> => {
    senal.throwIfAborted();
    const acceso = leerAccesoSesionPanel(entradaAcceso);
    const solicitud = leerSolicitudTrabajo(entradaSolicitud);
    const reserva = await almacen.reservarTrabajoDeSesion(acceso, solicitud, fijada);
    if (!('trabajos' in reserva)) {
      return reserva;
    }
    if (reserva.estado === 'nueva') {
      const trabajo = reserva.trabajos.ultimoTrabajo;
      if (!trabajo || trabajo.solicitudId !== solicitud.solicitudId) {
        throw new Error('La reserva de actualización no corresponde a la solicitud');
      }
      const resultado = await despachar(
        { solicitudId: solicitud.solicitudId, accion: solicitud.accion, revisionReserva: trabajo.revisionReserva },
        senal,
      );
      await almacen.anotarDespacho(
        { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva },
        resultado,
      );
    }
    const lectura = await almacen.leerTrabajoDeSesion(acceso);
    return lectura.estado === 'activa' ? { ...lectura, decision: reserva.estado } : lectura;
  };
}
