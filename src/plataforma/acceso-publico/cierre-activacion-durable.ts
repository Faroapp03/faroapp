/** Mensajes del cierre pedido por el enlace del entorno privado, y la comprobación de lo que devuelve el durable. */
import { type AlmacenActivacion, leerResultadoTransicionActivacion } from '../../administracion/activacion.ts';
import {
  admiteCierreActivacion,
  leerRegistroCierreActivacion,
  leerSolicitudCierreActivacion,
  type RegistroCierreActivacion,
  type SolicitudCierreActivacion,
} from '../../administracion/cierre-activacion.ts';
import { leerEvidenciaIntentoActivacion } from '../../administracion/recuperacion-activacion.ts';
import { exigirTrabajo, objetoTrabajo } from '../../administracion/trabajos.ts';
import { leerIdentidadTrabajoDurable } from './trabajos-durable.ts';

export const RUTAS_CIERRE = ['/activacion/cierre/solicitar', '/activacion/cierre/cumplir'] as const;
export function accionCierre(
  almacen: AlmacenActivacion,
  ruta: string,
  cuerpo: unknown,
): (() => Promise<unknown>) | undefined {
  if (!admiteCierreActivacion(almacen)) {
    return undefined;
  }
  if (ruta === '/activacion/cierre/solicitar') {
    const solicitud = leerSolicitudCierreActivacion(objetoTrabajo(cuerpo, 'solicitud').solicitud);
    return () => almacen.solicitarCierreActivacion(solicitud);
  }
  const o = objetoTrabajo(cuerpo, 'fin,identidad,registro');
  const registro = leerRegistroCierreActivacion(o.registro);
  const identidad = leerIdentidadTrabajoDurable(o.identidad);
  const fin = leerEvidenciaIntentoActivacion(o.fin);
  return () => almacen.cerrarActivacionSolicitada(registro, identidad, fin);
}
/** Una solicitud aplicada deja el cierre anotado para ese trabajo, en la revisión siguiente. */
export function leerSolicitudCierreDurable(entrada: unknown, solicitud: SolicitudCierreActivacion) {
  const resultado = leerResultadoTransicionActivacion(entrada);
  if (resultado.estado === 'aplicado') {
    const c = resultado.activacion.ultimaActivacion?.cierre;
    exigirTrabajo(
      c?.estado === 'solicitado' &&
        c.trabajo.solicitudId === solicitud.trabajo.solicitudId &&
        c.trabajo.revisionReserva === solicitud.trabajo.revisionReserva &&
        c.revisionActivacion === resultado.activacion.revision &&
        resultado.activacion.revision === solicitud.revisionEsperada + 1,
    );
  }
  return resultado;
}
/** Un cumplimiento aplicado cierra sin publicar o deja la solicitud usada con lo observado. */
export function leerCierreCumplidoDurable(entrada: unknown, registro: RegistroCierreActivacion) {
  const resultado = leerResultadoTransicionActivacion(entrada);
  if (resultado.estado === 'aplicado') {
    const a = resultado.activacion.ultimaActivacion;
    exigirTrabajo(resultado.activacion.revision === registro.revisionEsperada + 1);
    exigirTrabajo(
      (a?.fase === 'abandonada' && a.abandono?.motivo === 'a-mano') || a?.cierre?.estado === 'web-cambiada',
    );
  }
  return resultado;
}
