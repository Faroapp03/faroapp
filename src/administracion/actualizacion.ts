/** Reserva durable antes de enviar; ninguna repetición de una solicitud recupera el permiso de despacho. */
import type { ResultadoDespacho, SolicitudActualizacion } from './ejecutor-github.ts';
import { type ConfianzaOidcGitHub, leerConfianzaOidcGitHub } from './oidc-github.ts';
import { type ReconciliarSinSesion, reconciliarDentroDeSuPlazo } from './reconciliacion.ts';
import { type AccesoSesionPanel, leerAccesoSesionPanel } from './sesion.ts';
import {
  type AlmacenTrabajosActualizacion,
  type EstadoTrabajos,
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
  /** Comprueba en GitHub el trabajo que ocupa, para que uno terminado sin recibo no espere a que lo reconcilie alguien. */
  readonly reconciliar: ReconciliarSinSesion;
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
 * La misma solicitud ya admitida sobre la revisión siguiente: solo pasa cuando se admitió tras registrar el fin del
 * trabajo que ocupaba, porque la persona la envía con la revisión que vio.
 */
function admitidaTrasElCierre(reserva: { trabajos: EstadoTrabajos }, siguiente: SolicitudTrabajo): boolean {
  const t = reserva.trabajos.ultimoTrabajo;
  return (
    t?.solicitudId === siguiente.solicitudId &&
    t.accion === siguiente.accion &&
    t.revisionBase === siguiente.revisionEsperada
  );
}
/**
 * Si el trabajo que ocupa ya terminó en GitHub, se registra su fin y se vuelve a pedir una sola vez. «Ocupado» solo
 * sale con la revisión que vio la persona, así que el segundo intento espera la siguiente: si entre medias cambió algo
 * más que ese cierre, la autoridad responde conflicto y la persona vuelve a ver el estado antes de decidir. Repetir
 * después la solicitud original pide a la autoridad esa misma reserva, que la reconoce como repetida.
 */
async function reservarTrasComprobarElAnterior(
  { almacen, reconciliar }: Pick<OpcionesActualizacion, 'almacen' | 'reconciliar'>,
  peticion: { acceso: AccesoSesionPanel; solicitud: SolicitudTrabajo; confianza: ConfianzaOidcGitHub },
  senal: AbortSignal,
) {
  const { acceso, solicitud, confianza } = peticion;
  const reserva = await almacen.reservarTrabajoDeSesion(acceso, solicitud, confianza);
  if (!('trabajos' in reserva)) {
    return reserva;
  }
  const siguiente = { ...solicitud, revisionEsperada: solicitud.revisionEsperada + 1 };
  if (reserva.estado === 'conflicto' && admitidaTrasElCierre(reserva, siguiente)) {
    return almacen.reservarTrabajoDeSesion(acceso, siguiente, confianza);
  }
  if (reserva.estado !== 'ocupado') {
    return reserva;
  }
  const decision = await reconciliarDentroDeSuPlazo(reconciliar, senal);
  senal.throwIfAborted();
  return decision === 'completada' ? almacen.reservarTrabajoDeSesion(acceso, siguiente, confianza) : reserva;
}

/**
 * El almacén confirma sesión y revisión en una transacción corta; la red se utiliza después.
 * Si una dependencia lanza, el error se propaga y la reserva conserva su estado para reconciliarlo.
 * La respuesta solo sale tras comprobar de nuevo la sesión, sin prolongarla.
 */
export function crearSolicitadorActualizacion({ almacen, confianza, despachar, reconciliar }: OpcionesActualizacion) {
  const fijada = leerConfianzaOidcGitHub(confianza);
  return async (
    entradaAcceso: AccesoSesionPanel,
    entradaSolicitud: SolicitudTrabajo,
    senal: AbortSignal,
  ): Promise<ResultadoSolicitudActualizacion> => {
    senal.throwIfAborted();
    const acceso = leerAccesoSesionPanel(entradaAcceso);
    const solicitud = leerSolicitudTrabajo(entradaSolicitud);
    const reserva = await reservarTrasComprobarElAnterior(
      { almacen, reconciliar },
      { acceso, solicitud, confianza: fijada },
      senal,
    );
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
