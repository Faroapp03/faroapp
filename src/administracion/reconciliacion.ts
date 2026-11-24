/** Recupera el estado de una ejecución conocida sin reenviarla ni admitir una generación por su estado remoto. */
import type { ResultadoConsultaEjecucion } from './consulta-ejecucion-github.ts';
import type { AccesoSesionPanel, SesionPanelInactiva } from './sesion.ts';
import {
  type AlmacenTrabajosActualizacion,
  exigirTrabajo,
  leerEstadoTrabajosPrivado,
  leerReferenciaTrabajo,
  leerResultadoLecturaTrabajo,
  leerResultadoTransicionTrabajo,
  objetoTrabajo,
  type ReferenciaTrabajo,
  type ResultadoLecturaTrabajo,
  type TrabajoActualizacion,
  type TrabajoPrivado,
} from './trabajos.ts';

export type ResultadoReconciliacion =
  | (Extract<ResultadoLecturaTrabajo, { estado: 'activa' }> & {
      readonly decision: 'completada' | 'en-curso' | 'sin-ejecucion' | 'terminado' | 'conflicto';
    })
  | SesionPanelInactiva;
interface OpcionesReconciliacion {
  readonly almacen: AlmacenTrabajosActualizacion;
  readonly consultar: (trabajo: TrabajoPrivado, senal: AbortSignal) => Promise<ResultadoConsultaEjecucion>;
}
export function leerResultadoReconciliacion(entrada: unknown): ResultadoReconciliacion {
  if (
    entrada !== null &&
    typeof entrada === 'object' &&
    Object.getOwnPropertyDescriptor(entrada, 'estado')?.value === 'activa'
  ) {
    const o = objetoTrabajo(entrada, 'decision,estado,sesion,trabajos');
    const lectura = leerResultadoLecturaTrabajo({ estado: o.estado, sesion: o.sesion, trabajos: o.trabajos });
    const decisiones = ['completada', 'en-curso', 'sin-ejecucion', 'terminado', 'conflicto'] as const;
    const decision = decisiones.find((valor) => valor === o.decision);
    exigirTrabajo(lectura.estado === 'activa' && decision !== undefined);
    return { ...lectura, decision };
  }
  const lectura = leerResultadoLecturaTrabajo(entrada);
  exigirTrabajo(lectura.estado !== 'activa');
  return lectura;
}

function mismaReserva<T extends TrabajoActualizacion>(trabajo: T | null, referencia: ReferenciaTrabajo): trabajo is T {
  return (
    trabajo !== null &&
    trabajo.solicitudId === referencia.solicitudId &&
    trabajo.revisionReserva === referencia.revisionReserva
  );
}

async function consultarYRegistrar(
  { almacen, consultar }: OpcionesReconciliacion,
  acceso: AccesoSesionPanel,
  trabajo: TrabajoPrivado,
  senal: AbortSignal,
): Promise<'en-curso' | 'conflicto' | 'completada' | SesionPanelInactiva> {
  const consulta = await consultar(trabajo, senal);
  senal.throwIfAborted();
  const vigente = leerResultadoLecturaTrabajo(await almacen.leerTrabajoDeSesion(acceso));
  senal.throwIfAborted();
  if (vigente.estado !== 'activa') {
    return vigente;
  }
  if (consulta.estado === 'no-disponible') {
    throw new Error('Ejecución no disponible');
  }
  if (consulta.estado === 'en-curso') {
    return 'en-curso';
  }
  // Hecho remoto de una reserva autorizada, no cancelación ni cambio de controles.
  // SQL coteja la tupla y no sobrescribe un recibo llegado durante el GET.
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  const transicion = leerResultadoTransicionTrabajo(
    await almacen.finalizarEjecucionSinRecibo(referencia, consulta.evidencia),
  );
  senal.throwIfAborted();
  return transicion.estado === 'conflicto' ? 'conflicto' : 'completada';
}

type DecisionReconciliacion = Exclude<ResultadoReconciliacion, SesionPanelInactiva>['decision'];
function decisionActual(
  decision: DecisionReconciliacion,
  trabajo: TrabajoActualizacion | null,
  referencia: ReferenciaTrabajo,
): DecisionReconciliacion {
  if (!mismaReserva(trabajo, referencia)) {
    return 'conflicto';
  }
  if (trabajo.estado === 'terminado' && decision !== 'completada' && decision !== 'conflicto') {
    return 'terminado';
  }
  return decision;
}
async function decidirReconciliacion(
  opciones: OpcionesReconciliacion,
  acceso: AccesoSesionPanel,
  referencia: ReferenciaTrabajo,
  senal: AbortSignal,
): Promise<DecisionReconciliacion | SesionPanelInactiva> {
  const trabajo = leerEstadoTrabajosPrivado(await opciones.almacen.leerTrabajoPrivado()).ultimoTrabajo;
  senal.throwIfAborted();
  if (!mismaReserva(trabajo, referencia)) {
    return 'conflicto';
  }
  if (trabajo.estado === 'terminado') {
    return 'terminado';
  }
  if (trabajo.runId === null) {
    return 'sin-ejecucion';
  }
  return consultarYRegistrar(opciones, acceso, trabajo, senal);
}

export type DecisionReconciliacionSinSesion = 'sin-ejecucion-abierta' | 'completada' | 'en-curso' | 'indeterminada';
/** `runDelSolicitante`: el run que pide la reserva no se consulta a sí mismo; sigue en curso mientras pregunta. */
export type ReconciliarSinSesion = (
  senal: AbortSignal,
  runDelSolicitante?: string,
) => Promise<DecisionReconciliacionSinSesion>;
interface OpcionesReconciliacionSinSesion {
  readonly almacen: Pick<AlmacenTrabajosActualizacion, 'leerTrabajoPrivado' | 'finalizarEjecucionSinRecibo'>;
  readonly consultar: OpcionesReconciliacion['consultar'];
}
/**
 * La misma consulta que usa el panel, sin sesión, para quien pide una reserva mientras el último trabajo sigue abierto:
 * el reloj diario, la petición a demanda y el botón de actualizar. Cierra la ejecución solo si GitHub la da por
 * completada con la identidad fijada en la reserva, en el repositorio de esa reserva. Nunca retira, reenvía ni repite un
 * despacho; lo que no se puede comprobar queda tal cual y la reserva sigue ocupada.
 */
export function crearReconciliadorSinSesion({
  almacen,
  consultar,
}: OpcionesReconciliacionSinSesion): ReconciliarSinSesion {
  return async (senal, runDelSolicitante) => {
    senal.throwIfAborted();
    const trabajo = leerEstadoTrabajosPrivado(await almacen.leerTrabajoPrivado()).ultimoTrabajo;
    senal.throwIfAborted();
    if (!trabajo || trabajo.estado === 'terminado' || trabajo.runId === null || trabajo.runId === runDelSolicitante) {
      return 'sin-ejecucion-abierta';
    }
    const consulta = await consultar(trabajo, senal);
    senal.throwIfAborted();
    if (consulta.estado === 'en-curso') {
      return 'en-curso';
    }
    if (consulta.estado === 'no-disponible') {
      return 'indeterminada';
    }
    // SQL vuelve a cotejar la tupla y no sobrescribe un recibo llegado durante el GET.
    const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
    const transicion = leerResultadoTransicionTrabajo(
      await almacen.finalizarEjecucionSinRecibo(referencia, consulta.evidencia),
    );
    senal.throwIfAborted();
    return transicion.estado === 'conflicto' ? 'indeterminada' : 'completada';
  };
}
/**
 * Parte del plazo de una petición que puede gastar la consulta a GitHub. El resto queda para reservar y despachar,
 * que con su propio plazo de tres segundos no debe quedar cortado por una consulta lenta.
 */
export const PLAZO_RECONCILIACION_SIN_SESION_MS = 1500;
/** Una consulta que agota su parte del plazo es indeterminada: no libera nada y la reserva decide con lo que hay. */
export async function reconciliarDentroDeSuPlazo(
  reconciliar: ReconciliarSinSesion,
  senal: AbortSignal,
  runDelSolicitante?: string,
): Promise<DecisionReconciliacionSinSesion> {
  const limite = AbortSignal.any([senal, AbortSignal.timeout(PLAZO_RECONCILIACION_SIN_SESION_MS)]);
  try {
    return await reconciliar(limite, runDelSolicitante);
  } catch (causa) {
    if (senal.aborted || !limite.aborted) {
      throw causa;
    }
    return 'indeterminada';
  }
}

export function crearReconciliadorActualizacion(opciones: OpcionesReconciliacion) {
  const { almacen } = opciones;
  return async (
    acceso: AccesoSesionPanel,
    entrada: ReferenciaTrabajo,
    senal: AbortSignal,
  ): Promise<ResultadoReconciliacion> => {
    const referencia = leerReferenciaTrabajo(entrada);
    senal.throwIfAborted();
    const inicial = leerResultadoLecturaTrabajo(await almacen.leerTrabajoDeSesion(acceso));
    senal.throwIfAborted();
    if (inicial.estado !== 'activa') {
      return inicial;
    }
    const decision = await decidirReconciliacion(opciones, acceso, referencia, senal);
    if (typeof decision !== 'string') {
      return decision;
    }
    const final = leerResultadoLecturaTrabajo(await almacen.leerTrabajoDeSesion(acceso));
    senal.throwIfAborted();
    return final.estado === 'activa'
      ? { ...final, decision: decisionActual(decision, final.trabajos.ultimoTrabajo, referencia) }
      : final;
  };
}
