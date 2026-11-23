/** Protocolo privado de instituciones. Solo transmite huellas; la comprobación de sesión y CAS es del almacén. */
import {
  type AlmacenInstituciones,
  ID_INSTITUCION,
  leerIdentidadInvitacion,
  leerSolicitudInstitucion,
  leerSolicitudInvitar,
  leerSolicitudRetirarClave,
} from '../../administracion/instituciones.ts';
import { leerAccesoSesionPanel } from '../../administracion/sesion.ts';

const RUTAS = new Set([
  '/instituciones/preparar',
  '/instituciones/leer',
  '/instituciones/invitar',
  '/instituciones/renovar',
  '/instituciones/retirar',
  '/instituciones/retirar-clave',
  '/instituciones/consultar',
  '/instituciones/activar',
  '/instituciones/buscar',
]);
/** 100 instituciones con nombres, correo privado y dos claves opacas; se comprueba antes de devolver bytes. */
export const MAX_RESPUESTA_INSTITUCIONES = 262_144;
export function esRutaInstitucionesDurable(ruta: string): boolean {
  return RUTAS.has(ruta);
}
function objeto(entrada: unknown, claves: string): Record<string, unknown> {
  if (
    entrada === null ||
    typeof entrada !== 'object' ||
    Array.isArray(entrada) ||
    (Object.getPrototypeOf(entrada) !== Object.prototype && Object.getPrototypeOf(entrada) !== null) ||
    Object.getOwnPropertySymbols(entrada).length > 0 ||
    Object.getOwnPropertyNames(entrada).sort().join(',') !== claves
  ) {
    throw new Error('Mensaje institucional no válido');
  }
  for (const clave of Object.getOwnPropertyNames(entrada)) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      throw new Error('Mensaje institucional no válido');
    }
  }
  return entrada as Record<string, unknown>;
}
/** Devuelve una acción después de validar; su ejecución queda fuera de la captura del contrato. */
function accionDe(almacen: AlmacenInstituciones, ruta: string, entrada: unknown): (() => Promise<unknown>) | undefined {
  switch (ruta) {
    case '/instituciones/preparar': {
      objeto(entrada, '');
      return async () => {
        await almacen.prepararInstituciones();
        return { correcto: true };
      };
    }
    case '/instituciones/leer': {
      const o = objeto(entrada, 'acceso'),
        acceso = leerAccesoSesionPanel(o.acceso);
      return () => almacen.leerInstitucionesDeSesion(acceso);
    }
    case '/instituciones/invitar': {
      const o = objeto(entrada, 'acceso,nueva,solicitud'),
        acceso = leerAccesoSesionPanel(o.acceso),
        solicitud = leerSolicitudInvitar(o.solicitud),
        n = objeto(o.nueva, 'huella,id,institucionId');
      if (typeof n.institucionId !== 'string' || !ID_INSTITUCION.test(n.institucionId)) {
        throw new Error('Identidad institucional no válida');
      }
      const nueva = { ...leerIdentidadInvitacion({ id: n.id, huella: n.huella }), institucionId: n.institucionId };
      return () => almacen.invitarInstitucionDeSesion(acceso, solicitud, nueva);
    }
    case '/instituciones/renovar': {
      const o = objeto(entrada, 'acceso,nueva,solicitud'),
        acceso = leerAccesoSesionPanel(o.acceso),
        solicitud = leerSolicitudInstitucion(o.solicitud),
        nueva = leerIdentidadInvitacion(o.nueva);
      return () => almacen.renovarInvitacionDeSesion(acceso, solicitud, nueva);
    }
    case '/instituciones/retirar': {
      const o = objeto(entrada, 'acceso,solicitud'),
        acceso = leerAccesoSesionPanel(o.acceso),
        solicitud = leerSolicitudInstitucion(o.solicitud);
      return () => almacen.retirarInstitucionDeSesion(acceso, solicitud);
    }
    case '/instituciones/retirar-clave': {
      const o = objeto(entrada, 'acceso,solicitud'),
        acceso = leerAccesoSesionPanel(o.acceso),
        solicitud = leerSolicitudRetirarClave(o.solicitud);
      return () => almacen.retirarClaveDeSesion(acceso, solicitud);
    }
    default:
      return accionPublica(almacen, ruta, entrada);
  }
}
/** Activar una invitación no requiere sesión humana; el secreto acredita solo esta operación limitada. */
function accionPublica(
  almacen: AlmacenInstituciones,
  ruta: string,
  entrada: unknown,
): (() => Promise<unknown>) | undefined {
  switch (ruta) {
    case '/instituciones/consultar': {
      const o = objeto(entrada, 'recibida'),
        recibida = leerIdentidadInvitacion(o.recibida);
      return () => almacen.consultarInvitacion(recibida);
    }
    case '/instituciones/activar': {
      const o = objeto(entrada, 'clave,recibida'),
        recibida = leerIdentidadInvitacion(o.recibida),
        clave = leerIdentidadInvitacion(o.clave);
      return () => almacen.activarInvitacion(recibida, clave);
    }
    case '/instituciones/buscar': {
      const o = objeto(entrada, 'id');
      if (typeof o.id !== 'string' || !ID_INSTITUCION.test(o.id)) {
        throw new Error('Identidad institucional no válida');
      }
      const id = o.id;
      return async () => ({ socio: await almacen.buscarInstitucion(id) });
    }
    default:
      return undefined;
  }
}
export async function operarInstitucionesDurable(
  almacen: AlmacenInstituciones,
  ruta: string,
  cuerpo: unknown,
): Promise<unknown> {
  let accion: (() => Promise<unknown>) | undefined;
  try {
    accion = accionDe(almacen, ruta, cuerpo);
  } catch {
    return undefined;
  }
  return accion ? accion() : undefined;
}
