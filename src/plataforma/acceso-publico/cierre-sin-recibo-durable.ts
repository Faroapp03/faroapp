/** Lo que el objeto durable devuelve tras un cierre sin recibo, comprobado antes de dárselo al receptor. */
import type { CierreSinRecibo } from '../../administracion/cierre-sin-recibo.ts';
import type { IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import {
  exigirTrabajo,
  leerResultadoTransicionTrabajo,
  type ResultadoTransicionTrabajo,
} from '../../administracion/trabajos.ts';

export const RUTA_CIERRE_SIN_RECIBO_DURABLE = '/trabajos/cierre-sin-recibo';

/** Aplicado o repetido, el trabajo es el de la reserva, de esta ejecución, terminado y con el mismo porqué. */
export function leerTransicionCierreDurable(
  entrada: unknown,
  cierre: CierreSinRecibo,
  identidad: IdentidadEjecucionGitHub,
): ResultadoTransicionTrabajo {
  const resultado = leerResultadoTransicionTrabajo(entrada);
  if (resultado.estado !== 'conflicto') {
    const t = resultado.trabajos.ultimoTrabajo;
    exigirTrabajo(t?.solicitudId === cierre.solicitudId && t.revisionReserva === cierre.revisionReserva);
    exigirTrabajo(t.runId === identidad.runId && t.accion === cierre.accion && t.estado === 'terminado');
    const fallo = t.resultado?.ultimoFallo;
    exigirTrabajo(fallo?.causa === cierre.ultimoFallo.causa && fallo.paso === cierre.ultimoFallo.paso);
  }
  return resultado;
}
