/** Mensajes cerrados del enlace del entorno (binding) privado; la autenticación OIDC pertenece al receptor HTTP. */
import {
  type ActivacionPrivada,
  type AlmacenActivacion,
  admiteRecuperacionActivacion,
  autoridadActivacion,
  type EvidenciaIntentoActivacionCompletado,
  leerEvidenciaIntentoActivacion,
  leerRegistroPasoActivacion,
  leerResultadoTransicionActivacion,
  leerSolicitudActivacion,
  leerSolicitudReservaActivacion,
  type PasoActivacion,
  type ReferenciaActivacion,
  type RegistroPasoActivacion,
  type SolicitudActivacion,
  type SolicitudReintentoActivacion,
} from '../../administracion/activacion.ts';
import type { IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import { exigirTrabajo, objetoTrabajo } from '../../administracion/trabajos.ts';
import { accionCierre, RUTAS_CIERRE } from './cierre-activacion-durable.ts';
import { leerIdentidadTrabajoDurable } from './trabajos-durable.ts';

export const MAX_MENSAJE_ACTIVACION_DURABLE = 16_384;
export const MAX_RESPUESTA_ACTIVACION_DURABLE = 16_384;
const RUTAS = new Set([
  '/activacion/preparar',
  '/activacion/leer',
  '/activacion/reservar',
  '/activacion/paso',
  '/activacion/recuperar',
  '/activacion/paso-recuperacion',
  ...RUTAS_CIERRE,
]);
export function esRutaActivacionDurable(ruta: string): boolean {
  return RUTAS.has(ruta);
}
function accionRecuperacion(almacen: AlmacenActivacion, ruta: string, cuerpo: unknown) {
  if (!admiteRecuperacionActivacion(almacen)) {
    return undefined;
  }
  if (ruta === '/activacion/recuperar') {
    const o = objetoTrabajo(cuerpo, 'anterior,identidad,solicitud');
    const solicitud = leerSolicitudActivacion(o.solicitud);
    const identidad = leerIdentidadTrabajoDurable(o.identidad);
    const anterior = leerEvidenciaIntentoActivacion(o.anterior);
    return () => almacen.recuperarActivacion(solicitud, identidad, anterior);
  }
  const o = objetoTrabajo(cuerpo, 'identidad,registro');
  const registro = leerRegistroPasoActivacion(o.registro);
  const identidad = leerIdentidadTrabajoDurable(o.identidad);
  return () => almacen.registrarPasoRecuperacionActivacion(registro, identidad);
}
function accionValida(almacen: AlmacenActivacion, ruta: string, cuerpo: unknown): (() => Promise<unknown>) | undefined {
  if (!esRutaActivacionDurable(ruta)) {
    return undefined;
  }
  try {
    if (ruta === '/activacion/preparar' || ruta === '/activacion/leer') {
      objetoTrabajo(cuerpo, '');
      return ruta === '/activacion/leer'
        ? () => almacen.leerActivacionPrivada()
        : async () => {
            await almacen.prepararActivacion();
            return { correcto: true };
          };
    }
    if (ruta === '/activacion/recuperar' || ruta === '/activacion/paso-recuperacion') {
      return accionRecuperacion(almacen, ruta, cuerpo);
    }
    if ((RUTAS_CIERRE as readonly string[]).includes(ruta)) {
      return accionCierre(almacen, ruta, cuerpo);
    }
    if (ruta === '/activacion/reservar') {
      const o = objetoTrabajo(cuerpo, 'identidad,solicitud');
      const solicitud = leerSolicitudReservaActivacion(o.solicitud);
      const identidad = leerIdentidadTrabajoDurable(o.identidad);
      return () => almacen.reservarActivacion(solicitud, identidad);
    }
    const o = objetoTrabajo(cuerpo, 'identidad,registro');
    const registro = leerRegistroPasoActivacion(o.registro);
    const identidad = leerIdentidadTrabajoDurable(o.identidad);
    return () => almacen.registrarPasoActivacion(registro, identidad);
  } catch {
    return undefined;
  }
}
export async function operarActivacionDurable(
  almacen: AlmacenActivacion,
  ruta: string,
  cuerpo: unknown,
): Promise<unknown> {
  const accion = accionValida(almacen, ruta, cuerpo);
  return accion ? accion() : undefined;
}
function leerTransicion(
  entrada: unknown,
  solicitud: ReferenciaActivacion & Pick<SolicitudActivacion, 'revisionEsperada'>,
) {
  const resultado = leerResultadoTransicionActivacion(entrada);
  if (resultado.estado === 'aplicado' || resultado.estado === 'repetido') {
    const a = resultado.activacion.ultimaActivacion;
    const autoridad = a === null ? null : autoridadActivacion(a);
    exigirTrabajo(
      autoridad !== null &&
        autoridad.solicitudId === solicitud.solicitudId &&
        autoridad.revisionReserva === solicitud.revisionReserva &&
        autoridad.runId === solicitud.runId,
    );
    exigirTrabajo(
      resultado.estado === 'aplicado'
        ? resultado.activacion.revision === solicitud.revisionEsperada + 1
        : resultado.activacion.revision >= solicitud.revisionEsperada + 1,
    );
  }
  return resultado;
}
export function leerReservaActivacionDurable(
  entrada: unknown,
  solicitud: SolicitudActivacion | SolicitudReintentoActivacion,
) {
  if ('reintentoDe' in solicitud && solicitud.descartado) {
    return leerDescarteDurable(entrada, solicitud);
  }
  const resultado = leerTransicion(entrada, solicitud);
  if (resultado.estado === 'aplicado' || resultado.estado === 'repetido') {
    const a = resultado.activacion.ultimaActivacion;
    exigirTrabajo(a?.revisionBase === solicitud.revisionEsperada && reintentoCoincide(a, solicitud));
    exigirTrabajo(resultado.estado !== 'aplicado' || a.fase === 'reservada');
  }
  return resultado;
}
/** Un descarte aplicado deja la misma abandonada, con el motivo anotado y la revisión siguiente. */
function leerDescarteDurable(entrada: unknown, solicitud: SolicitudReintentoActivacion) {
  const resultado = leerResultadoTransicionActivacion(entrada);
  if (resultado.estado === 'aplicado') {
    const a = resultado.activacion.ultimaActivacion;
    exigirTrabajo(
      a !== null &&
        a.reintentoDescartado === solicitud.descartado &&
        a.trabajo.solicitudId === solicitud.reintentoDe.solicitudId &&
        a.trabajo.runId === solicitud.reintentoDe.runId &&
        resultado.activacion.revision === solicitud.revisionEsperada + 1,
    );
  }
  return resultado;
}
/** Un reintento aplicado o repetido es una intención nueva sobre el trabajo abandonado exacto que nombra. */
function reintentoCoincide(a: ActivacionPrivada | null, solicitud: SolicitudActivacion | SolicitudReintentoActivacion) {
  if (!('reintentoDe' in solicitud)) {
    return a?.reintento === undefined;
  }
  const de = solicitud.reintentoDe;
  return (
    a?.reintento !== undefined &&
    a.trabajo.solicitudId === de.solicitudId &&
    a.trabajo.revisionReserva === de.revisionReserva &&
    a.trabajo.runId === de.runId &&
    a.trabajo.huellaRecibo === de.huellaRecibo
  );
}
function validarPaso(a: ActivacionPrivada, paso: PasoActivacion): void {
  switch (paso.tipo) {
    case 'preparar':
      exigirTrabajo(a.fase === 'preparada');
      exigirTrabajo(JSON.stringify(a.evidencia) === JSON.stringify(paso.evidencia));
      break;
    case 'subida':
      exigirTrabajo(a.fase === 'subida');
      exigirTrabajo(a.versionId === paso.versionId);
      break;
    case 'confirmada':
      exigirTrabajo(a.fase === 'confirmada');
      exigirTrabajo(
        a.versionId === paso.versionId &&
          a.deploymentId === paso.deploymentId &&
          a.evidencia?.sha256ManifiestoWeb === paso.sha256ManifiestoWeb,
      );
      break;
    case 'rechazar':
      exigirTrabajo(a.fase === 'rechazada');
      exigirTrabajo(a.error === paso.error);
      break;
    case 'anotar-rechazo':
      exigirTrabajo(JSON.stringify(a.detenida) === JSON.stringify({ motivo: paso.motivo, observado: paso.observado }));
      break;
    case 'abandonar':
      exigirTrabajo(a.fase === 'abandonada');
      exigirTrabajo(JSON.stringify(a.abandono) === JSON.stringify({ motivo: paso.motivo, observado: paso.observado }));
      break;
    default:
      exigirTrabajo(a.fase === paso.tipo);
  }
}
export function leerPasoRegistradoActivacionDurable(entrada: unknown, registro: RegistroPasoActivacion) {
  const resultado = leerTransicion(entrada, registro);
  if (resultado.estado === 'aplicado' || resultado.estado === 'repetido') {
    exigirTrabajo(resultado.activacion.revision === registro.revisionEsperada + 1);
    const a = resultado.activacion.ultimaActivacion;
    exigirTrabajo(a !== null);
    validarPaso(a, registro.paso);
  }
  return resultado;
}

export function leerRecuperacionActivacionDurable(
  entrada: unknown,
  solicitud: SolicitudActivacion,
  identidad: IdentidadEjecucionGitHub,
  anterior: EvidenciaIntentoActivacionCompletado,
) {
  const resultado = leerTransicion(entrada, solicitud);
  if (resultado.estado === 'aplicado' || resultado.estado === 'repetido') {
    const r = resultado.activacion.ultimaActivacion?.recuperacion;
    exigirTrabajo(
      r?.intento === identidad.runAttempt &&
        r.revisionBase === solicitud.revisionEsperada &&
        JSON.stringify(r.anterior) === JSON.stringify(anterior),
    );
  }
  return resultado;
}
export function leerPasoRecuperacionActivacionDurable(
  entrada: unknown,
  registro: RegistroPasoActivacion,
  identidad: IdentidadEjecucionGitHub,
) {
  const resultado = leerPasoRegistradoActivacionDurable(entrada, registro);
  if (resultado.estado === 'aplicado' || resultado.estado === 'repetido') {
    exigirTrabajo(resultado.activacion.ultimaActivacion?.recuperacion?.intento === identidad.runAttempt);
  }
  return resultado;
}
