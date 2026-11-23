/**
 * Cerrar desde el panel una publicación detenida o incierta, sin entrar en GitHub. Quien administra lo pide con su
 * sesión. El servidor comprueba en GitHub que la ejecución que manda en la activación ha terminado, anota el cierre
 * para el trabajo siguiente y despacha ese trabajo con el mismo despacho que el botón de actualizar; su paso de
 * activación es el que observa la web y cierra. Si el despacho falla, la solicitud caduca y se puede volver a pedir.
 */
import { type AlmacenActivacion, autoridadActivacion, leerEstadoActivacionPrivado } from './activacion.ts';
import { leerResultadoSolicitudActualizacion, type ResultadoSolicitudActualizacion } from './actualizacion.ts';
import { type AlmacenCierreActivacion, PLAZO_CIERRE_MS } from './cierre-activacion.ts';
import type { ConsultarFinEjecucion } from './cierre-activacion-http.ts';
import type { AccesoSesionPanel } from './sesion.ts';
import {
  type EstadoTrabajosPrivado,
  esEnteroTrabajo,
  exigirTrabajo,
  objetoTrabajo,
  type SolicitudTrabajo,
} from './trabajos.ts';

export type ResultadoCierrePublicacion =
  | { readonly estado: 'solicitado'; readonly caducaEn: number }
  | { readonly estado: 'ejecucion-en-curso' | 'sin-confirmacion' | 'conflicto' | 'no-despachado' };
export interface SolicitudCierrePublicacion {
  readonly revisionEsperada: number;
}
export type CerrarPublicacion = (
  acceso: AccesoSesionPanel,
  solicitud: SolicitudCierrePublicacion,
  senal: AbortSignal,
) => Promise<ResultadoCierrePublicacion>;
interface OpcionesCierrePublicacion {
  readonly almacen: AlmacenActivacion & AlmacenCierreActivacion;
  readonly leerTrabajos: () => Promise<EstadoTrabajosPrivado>;
  readonly solicitar: (
    acceso: AccesoSesionPanel,
    solicitud: SolicitudTrabajo,
    senal: AbortSignal,
  ) => Promise<ResultadoSolicitudActualizacion>;
  readonly consultarFin: ConsultarFinEjecucion;
  readonly ahora?: () => number;
  readonly nuevoId?: () => string;
}
const TERMINALES: readonly string[] = ['confirmada', 'rechazada', 'abandonada'];

export function leerSolicitudCierrePublicacion(entrada: unknown): SolicitudCierrePublicacion {
  const o = objetoTrabajo(entrada, 'revisionEsperada');
  exigirTrabajo(esEnteroTrabajo(o.revisionEsperada) && o.revisionEsperada < Number.MAX_SAFE_INTEGER);
  return Object.freeze({ revisionEsperada: o.revisionEsperada });
}
/** El trabajo despachado es el nuestro y no ha terminado: su ejecución puede cumplir el cierre. */
function despachado(resultado: ResultadoSolicitudActualizacion, solicitudId: string): boolean {
  const t = resultado.estado === 'activa' ? resultado.trabajos.ultimoTrabajo : null;
  return (
    resultado.estado === 'activa' &&
    resultado.decision === 'nueva' &&
    t?.solicitudId === solicitudId &&
    t.estado !== 'terminado'
  );
}
export function crearCerradorPublicacion({
  almacen,
  leerTrabajos,
  solicitar,
  consultarFin,
  ahora = Date.now,
  nuevoId = () => crypto.randomUUID(),
}: OpcionesCierrePublicacion): CerrarPublicacion {
  return async (acceso, { revisionEsperada }, senal) => {
    const estado = leerEstadoActivacionPrivado(await almacen.leerActivacionPrivada());
    const a = estado.ultimaActivacion;
    if (!a || TERMINALES.includes(a.fase) || estado.revision !== revisionEsperada) {
      return { estado: 'conflicto' };
    }
    const fin = await consultarFin({ ...a.trabajo, ...autoridadActivacion(a) }, senal);
    senal.throwIfAborted();
    if (fin.estado !== 'completada') {
      return { estado: fin.estado === 'en-curso' ? 'ejecucion-en-curso' : 'sin-confirmacion' };
    }
    const trabajos = await leerTrabajos();
    const trabajo = { solicitudId: nuevoId(), revisionReserva: trabajos.revision + 1 };
    const caducaEn = ahora() + PLAZO_CIERRE_MS;
    const anotado = await almacen.solicitarCierreActivacion({ revisionEsperada, trabajo, caducaEn });
    if (anotado.estado !== 'aplicado') {
      return { estado: 'conflicto' };
    }
    const reserva = leerResultadoSolicitudActualizacion(
      await solicitar(
        acceso,
        { solicitudId: trabajo.solicitudId, accion: 'reintentar-pendientes', revisionEsperada: trabajos.revision },
        senal,
      ),
    );
    return despachado(reserva, trabajo.solicitudId) ? { estado: 'solicitado', caducaEn } : { estado: 'no-despachado' };
  };
}
