/** Lo que el panel ve de la activación privada: fase, forma, fechas e identificadores, sin evidencias ni confianza. */
import {
  type ActivacionPrivada,
  dosServicios,
  type EstadoActivacionPrivado,
  leerEstadoActivacionPrivado,
} from './activacion.ts';
import { type EstadoActivacion, leerEstadoActivacion } from './estado-activacion.js';
import type { TrabajoActualizacion } from './trabajos.ts';

/**
 * Qué servía la web al detenerse: Cursos nuevo con el principal anterior (la formación figura como no disponible), u
 * otra combinación, que solo puede venir de un cambio hecho fuera de esta publicación.
 */
function servidoDetenida(a: ActivacionPrivada): 'cursos-nuevo' | 'cambiado' | 'desconocido' | null {
  if (!a.detenida) {
    return null;
  }
  const { observado } = a.detenida;
  if (observado === null) {
    return 'desconocido';
  }
  const anterior = a.evidencia?.anterior;
  const cursosNuevo =
    'principal' in observado &&
    anterior !== undefined &&
    'principal' in anterior &&
    observado.cursos.versionId === a.versionIdCursos &&
    observado.principal.versionId === anterior.principal.versionId;
  return cursosNuevo ? 'cursos-nuevo' : 'cambiado';
}
/**
 * Desde cuándo sus datos validados están sin publicar: desde el abandono que se reintenta, o desde este cierre. Un
 * rechazo porque el paquete no se pudo comprobar no deja datos validados: no cuenta.
 */
function datosSinPublicarDesde(a: ActivacionPrivada): number | null {
  if (a.fase === 'abandonada' || (a.fase === 'rechazada' && a.error !== 'candidato_no_verificable')) {
    return a.reintento?.abandonadaEn ?? a.actualizadoEn;
  }
  return a.reintento && a.fase !== 'confirmada' && a.fase !== 'rechazada' ? a.reintento.abandonadaEn : null;
}
/** Lo que la proyección necesita del almacén de trabajos: su revisión y el último trabajo, sin su confianza. */
export interface TrabajosObservados {
  readonly revision: number;
  readonly ultimoTrabajo: Pick<
    TrabajoActualizacion,
    'solicitudId' | 'revisionReserva' | 'revisionBase' | 'estado' | 'resultado'
  > | null;
}
/**
 * La oportunidad de reintentar sigue abierta mientras no haya otro trabajo, o mientras el siguiente, reservado justo
 * después, esté en curso o haya terminado sin pendientes sin haberlo descartado.
 */
function oportunidadAbierta(revisionTrabajos: number, trabajos: TrabajosObservados): boolean {
  const t = trabajos.ultimoTrabajo;
  return (
    trabajos.revision === revisionTrabajos ||
    (t !== null &&
      t.revisionBase === revisionTrabajos &&
      (t.estado !== 'terminado' || t.resultado?.resultado === 'sin-pendientes'))
  );
}
/** Sin el almacén de trabajos no se promete ningún reintento. */
function reintentoObservado(
  a: ActivacionPrivada,
  trabajos: TrabajosObservados | undefined,
): 'previsto' | 'es-reintento' | 'sin-artefacto' | null {
  if (a.reintento) {
    return 'es-reintento';
  }
  if (a.reintentoDescartado) {
    return a.reintentoDescartado;
  }
  const previsto =
    a.abandono?.motivo === 'rechazo-previo' &&
    a.revisionTrabajos !== undefined &&
    trabajos !== undefined &&
    oportunidadAbierta(a.revisionTrabajos, trabajos);
  return previsto ? 'previsto' : null;
}
/**
 * El cierre pedido solo está en curso mientras su ejecución puede cumplirlo: la activación sigue en la revisión en
 * que se anotó y el último trabajo es el despachado para cumplirlo, sin terminar. Si el despacho falló, la ejecución
 * terminó sin cumplirlo o un relevo avanzó la activación, no se ha cumplido y se puede volver a pedir.
 */
function cierreObservado(
  a: ActivacionPrivada,
  revision: number,
  trabajos: TrabajosObservados | undefined,
): { estado: 'en-curso' | 'no-cumplido' | 'sin-constancia' | 'web-cambiada'; caducaEn: number } | null {
  const c = a.cierre;
  if (!c) {
    return null;
  }
  if (c.estado === 'web-cambiada') {
    return { estado: 'web-cambiada', caducaEn: c.caducaEn };
  }
  // Sin el almacén de trabajos no se ha observado si su ejecución sigue: no se dice nada del cierre.
  if (!trabajos) {
    return null;
  }
  const t = trabajos.ultimoTrabajo;
  const suyo =
    c.revisionActivacion === revision &&
    t?.solicitudId === c.trabajo.solicitudId &&
    t.revisionReserva === c.trabajo.revisionReserva;
  if (!suyo) {
    return { estado: 'no-cumplido', caducaEn: c.caducaEn };
  }
  if (t.estado !== 'terminado') {
    return { estado: 'en-curso', caducaEn: c.caducaEn };
  }
  // Con recibo, la ejecución llegó a su final y su paso de activación pudo cumplirlo justo después: aún no consta.
  // Sin recibo (despacho rechazado, retirada o fin sin recibo) no llegó a ese paso: no se cumplió.
  const conRecibo = ['validado', 'sin-pendientes', 'rechazado'].includes(t.resultado?.resultado ?? '');
  return { estado: conRecibo ? 'sin-constancia' : 'no-cumplido', caducaEn: c.caducaEn };
}
export function activacionObservada(entrada: unknown, trabajos?: TrabajosObservados): EstadoActivacion {
  const privado: EstadoActivacionPrivado = leerEstadoActivacionPrivado(entrada);
  const ultima = privado.ultimaActivacion;
  return leerEstadoActivacion({
    version: privado.version,
    revision: privado.revision,
    ultimaActivacion:
      ultima === null
        ? null
        : {
            solicitudId: ultima.trabajo.solicitudId,
            revisionReserva: ultima.trabajo.revisionReserva,
            fase: ultima.fase,
            dosServicios: dosServicios(ultima),
            motivoAbandono: ultima.abandono?.motivo ?? null,
            reintento: reintentoObservado(ultima, trabajos),
            datosSinPublicarDesde: datosSinPublicarDesde(ultima),
            cierre: cierreObservado(ultima, privado.revision, trabajos),
            motivoDetenida: ultima.detenida?.motivo ?? null,
            servidoDetenida: servidoDetenida(ultima),
            creadoEn: ultima.creadoEn,
            actualizadoEn: ultima.actualizadoEn,
            // Una versión subida de una intención abandonada no se sirve: el panel no la presenta como registrada.
            versionId: ultima.fase === 'abandonada' ? null : ultima.versionId,
            deploymentId: ultima.deploymentId,
            error: ultima.error,
          },
  });
}
