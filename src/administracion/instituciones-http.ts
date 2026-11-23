/** Operaciones protegidas del panel. El secreto solo existe en esta respuesta; el almacén recibe su huella. */
import { SolicitudInvalida } from '../api/errores.ts';
import { huellaDelSecreto, secretoNuevo } from '../api/socios/registro.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import {
  type AlmacenInstitucionesPanel,
  type EnlaceInvitacion,
  type IdentidadInvitacion,
  leerResultadoCambioInstitucionesSesion,
  leerResultadoRegistroSesion,
  leerSolicitudInstitucion,
  leerSolicitudInvitar,
  leerSolicitudRetirarClave,
  type ResultadoCambioInstitucionesSesion,
  type ResultadoRegistroSesion,
  SolicitudInstitucionInvalida,
} from './instituciones.ts';
import type { AccesoSesionPanel } from './sesion.ts';

export type OperacionInstituciones =
  | 'institucionesLeer'
  | 'institucionesInvitar'
  | 'institucionesRenovar'
  | 'institucionesRetirar'
  | 'institucionesRetirarClave';
const OPERACIONES = new Set<OperacionInstituciones>([
  'institucionesLeer',
  'institucionesInvitar',
  'institucionesRenovar',
  'institucionesRetirar',
  'institucionesRetirarClave',
]);
export function esOperacionInstituciones(operacion: string): operacion is OperacionInstituciones {
  return OPERACIONES.has(operacion as OperacionInstituciones);
}
export interface RespuestaInstitucionesPanel {
  readonly datos: object;
  readonly estadoHttp: number;
}
function generar() {
  const secreto = secretoNuevo();
  return { identidad: { id: crypto.randomUUID(), huella: huellaDelSecreto(secreto) }, secreto };
}
/** Solo la entrada se transforma en 400. Una respuesta remota mal formada sigue siendo un fallo técnico. */
function solicitud<T>(leer: (valor: unknown) => T, cuerpo: unknown): T {
  try {
    return leer(cuerpo);
  } catch (error) {
    if (error instanceof SolicitudInstitucionInvalida) {
      throw new SolicitudInvalida('Solicitud institucional no válida');
    }
    throw error;
  }
}
function resultado<T>(leer: (valor: unknown) => T, valor: unknown): T {
  try {
    return leer(valor);
  } catch {
    throw new Error('Respuesta institucional no válida');
  }
}
async function cambiar(
  almacen: AlmacenInstitucionesPanel,
  acceso: AccesoSesionPanel,
  operacion: Exclude<OperacionInstituciones, 'institucionesLeer'>,
  cuerpo: unknown,
): Promise<{
  resultado: ResultadoCambioInstitucionesSesion;
  invitacion?: { readonly identidad: IdentidadInvitacion; readonly secreto: string; readonly institucionId: string };
}> {
  switch (operacion) {
    case 'institucionesInvitar': {
      const entrada = solicitud(leerSolicitudInvitar, cuerpo),
        nueva = generar(),
        institucionId = `inst-${crypto.randomUUID()}`;
      return {
        resultado: await almacen.invitarInstitucionDeSesion(acceso, entrada, { ...nueva.identidad, institucionId }),
        invitacion: { ...nueva, institucionId },
      };
    }
    case 'institucionesRenovar': {
      const entrada = solicitud(leerSolicitudInstitucion, cuerpo),
        nueva = generar();
      return {
        resultado: await almacen.renovarInvitacionDeSesion(acceso, entrada, nueva.identidad),
        invitacion: { ...nueva, institucionId: entrada.id },
      };
    }
    case 'institucionesRetirar':
      return {
        resultado: await almacen.retirarInstitucionDeSesion(acceso, solicitud(leerSolicitudInstitucion, cuerpo)),
      };
    case 'institucionesRetirarClave':
      return { resultado: await almacen.retirarClaveDeSesion(acceso, solicitud(leerSolicitudRetirarClave, cuerpo)) };
  }
}
function sesionInactiva(
  r: ResultadoRegistroSesion | ResultadoCambioInstitucionesSesion,
): RespuestaInstitucionesPanel | null {
  if ('sesion' in r) {
    return null;
  }
  return r.estado === 'sustituida'
    ? { datos: { error: 'sesion_sustituida' }, estadoHttp: ESTADO_HTTP.conflicto }
    : { datos: { error: 'sesion_inactiva' }, estadoHttp: ESTADO_HTTP.prohibido };
}
function cambioRechazado(r: ResultadoCambioInstitucionesSesion): RespuestaInstitucionesPanel | null {
  const sesion = sesionInactiva(r);
  if (sesion) {
    return sesion;
  }
  switch (r.estado) {
    case 'conflicto':
      return { datos: { error: 'revision_desactualizada' }, estadoHttp: ESTADO_HTTP.conflicto };
    case 'lleno':
      return { datos: { error: 'limite_instituciones' }, estadoHttp: ESTADO_HTTP.conflicto };
    case 'no_encontrada':
      return { datos: { error: 'institucion_no_encontrada' }, estadoHttp: ESTADO_HTTP.noEncontrado };
    case 'dos_claves_activas':
      return { datos: { error: 'dos_claves_activas' }, estadoHttp: ESTADO_HTTP.conflicto };
    default:
      return null;
  }
}
export async function atenderInstitucionesPanel(
  almacen: AlmacenInstitucionesPanel,
  acceso: AccesoSesionPanel,
  operacion: OperacionInstituciones,
  cuerpo: Record<string, unknown>,
): Promise<RespuestaInstitucionesPanel> {
  if (operacion === 'institucionesLeer') {
    if (Object.keys(cuerpo).length > 0) {
      throw new SolicitudInvalida('Solicitud institucional no válida');
    }
    const r = resultado(leerResultadoRegistroSesion, await almacen.leerInstitucionesDeSesion(acceso));
    return sesionInactiva(r) ?? { datos: r, estadoHttp: ESTADO_HTTP.correcto };
  }
  const cambio = await cambiar(almacen, acceso, operacion, cuerpo);
  const r = resultado(leerResultadoCambioInstitucionesSesion, cambio.resultado),
    rechazo = cambioRechazado(r);
  if (rechazo) {
    return rechazo;
  }
  if (r.estado !== 'cambiado') {
    throw new Error('Resultado institucional no válido');
  }
  let invitacion: EnlaceInvitacion | undefined;
  if (cambio.invitacion) {
    // Se busca la institución exacta creada por esta operación; ninguna invitación ajena puede completar el enlace.
    const i = r.registro.instituciones.find((i) => i.id === cambio.invitacion?.institucionId);
    if (!i?.invitacion) {
      throw new Error('Invitación institucional no confirmada');
    }
    invitacion = {
      enlaceRelativo: `/activar-acceso.html#invitacion=${cambio.invitacion.identidad.id}.${cambio.invitacion.secreto}`,
      caducaEn: i.invitacion.caducaEn,
    };
  }
  return {
    datos: { estado: 'activa', sesion: r.sesion, registro: r.registro, ...(invitacion ? { invitacion } : {}) },
    estadoHttp: ESTADO_HTTP.correcto,
  };
}
