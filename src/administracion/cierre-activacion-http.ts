/**
 * Cumplir el cierre pedido desde el panel: antes de tocar el almacén, el servidor pregunta él mismo a GitHub si la
 * ejecución que manda en la activación ha terminado, en su último intento. No se fía de lo que traiga el cliente.
 */
import {
  type AlmacenActivacion,
  autoridadActivacion,
  leerEstadoActivacionPrivado,
  type ResultadoTransicionActivacion,
} from './activacion.ts';
import { admiteCierreActivacion, type RegistroCierreActivacion } from './cierre-activacion.ts';
import type { ResultadoConsultaIntentoActivacion } from './consulta-ejecucion-github.ts';
import type { IdentidadEjecucionGitHub } from './oidc-github.ts';
import type { TrabajoPrivado } from './trabajos.ts';

export type ConsultarFinEjecucion = (
  trabajo: TrabajoPrivado,
  senal: AbortSignal,
) => Promise<ResultadoConsultaIntentoActivacion>;

export async function cumplirCierre(
  almacen: AlmacenActivacion,
  registro: RegistroCierreActivacion,
  {
    identidad,
    consultarFin,
    senal,
  }: { identidad: IdentidadEjecucionGitHub; consultarFin?: ConsultarFinEjecucion; senal: AbortSignal },
): Promise<ResultadoTransicionActivacion> {
  if (!consultarFin || !admiteCierreActivacion(almacen)) {
    throw new Error('Cierre no disponible');
  }
  const actual = leerEstadoActivacionPrivado(await almacen.leerActivacionPrivada());
  const a = actual.ultimaActivacion;
  if (!a) {
    return { estado: 'conflicto', activacion: actual };
  }
  // GitHub se consulta por la ejecución que manda en la activación: en un reintento, la que reintenta.
  const consulta = await consultarFin({ ...a.trabajo, ...autoridadActivacion(a) }, senal);
  senal.throwIfAborted();
  if (consulta.estado !== 'completada') {
    throw new Error('La ejecución de la activación no consta como terminada');
  }
  return almacen.cerrarActivacionSolicitada(registro, identidad, consulta.evidencia);
}
