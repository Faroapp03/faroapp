/**
 * Rutas HTTP de la sesión única del Panel de Control: bienvenida, apertura con bloqueo y registro de accesos. Las tres
 * llegan solo tras superar Access; la identidad sale del principal verificado, nunca de la petición.
 */
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { sha256Hex } from '../comun/huella.ts';
import type { PrincipalAdministrativo } from '../plataforma/acceso-administrativo.ts';
import { type AccesoSesionPanel, type AlmacenSesionPanel, leerEstadoSesionPanel } from './sesion.ts';
import {
  type AlmacenSesionUnica,
  type IdentidadPanel,
  leerBienvenidaPanel,
  leerRegistroPanel,
  leerResultadoAperturaUnica,
} from './sesion-unica.ts';

export type OperacionSesionUnica = 'bienvenida' | 'abrir' | 'registro';
export const RUTAS_SESION_UNICA = [
  ['/administracion/api/sesion/bienvenida', 'bienvenida'],
  ['/administracion/api/sesion/abrir', 'abrir'],
  ['/administracion/api/sesion/registro', 'registro'],
] as const;
interface Frontera {
  readonly respuesta: (datos: object, estado?: number) => Response;
  readonly rechazar: (estado: number, codigo: string) => never;
  /** Token nuevo y exclusivo de esta página, con su acceso derivado; lo genera el enrutador. */
  readonly nuevoAcceso: () => { readonly token: string; readonly acceso: AccesoSesionPanel };
}

/** Huella estable de la persona: la misma para su sesión del panel y para la sesión única. */
export function huellaDePrincipal(principal: PrincipalAdministrativo): string {
  return sha256Hex(JSON.stringify([principal.emisor, principal.sujeto]));
}
/** Sin correo verificado o sin instante de emisión no hay identidad: nunca se abre con un correo vacío. */
export function identidadDelPrincipal(principal: PrincipalAdministrativo): IdentidadPanel | null {
  if (principal.correo === null || principal.emitidoEn === null) {
    return null;
  }
  return {
    huellaPrincipal: huellaDePrincipal(principal),
    correo: principal.correo,
    huellaEntrada: sha256Hex(JSON.stringify([principal.emisor, principal.sujeto, principal.emitidoEn])),
  };
}
/** Abrir admite un cuerpo vacío o solo la decisión explícita de retomar la sesión propia de otro dispositivo. */
function retomarDe(cuerpo: Record<string, unknown>, frontera: Frontera): boolean {
  const claves = Object.keys(cuerpo);
  if (claves.length === 0) {
    return false;
  }
  if (claves.length !== 1 || claves[0] !== 'retomar' || typeof cuerpo.retomar !== 'boolean') {
    frontera.rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  return cuerpo.retomar;
}
async function abrir(
  almacen: AlmacenSesionUnica,
  identidad: IdentidadPanel,
  cuerpo: Record<string, unknown>,
  frontera: Frontera,
): Promise<Response> {
  const retomar = retomarDe(cuerpo, frontera);
  const { token, acceso } = frontera.nuevoAcceso();
  const resultado = leerResultadoAperturaUnica(await almacen.abrirSesionUnica(acceso, identidad, retomar));
  if (resultado.estado === 'ocupada') {
    return frontera.respuesta({ error: 'panel_ocupado', ocupacion: resultado.ocupacion }, ESTADO_HTTP.conflicto);
  }
  const sesion = leerEstadoSesionPanel(resultado.sesion);
  return frontera.respuesta({ token, sesion });
}
export async function atenderSesionUnica(
  almacen: AlmacenSesionPanel & AlmacenSesionUnica,
  principal: PrincipalAdministrativo,
  { operacion, cuerpo }: { readonly operacion: OperacionSesionUnica; readonly cuerpo: Record<string, unknown> },
  frontera: Frontera,
): Promise<Response> {
  if (operacion !== 'abrir' && Object.keys(cuerpo).length !== 0) {
    frontera.rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  // Las tres operaciones exigen la misma identidad con correo: el registro dice quién entró, y no lo lee nadie
  // que no pueda quedar anotado en él.
  const identidad = identidadDelPrincipal(principal);
  if (identidad === null) {
    frontera.rechazar(ESTADO_HTTP.prohibido, 'correo_no_verificado');
  }
  if (operacion === 'registro') {
    return frontera.respuesta({ registro: leerRegistroPanel(await almacen.leerRegistroPanel()) });
  }
  if (operacion === 'bienvenida') {
    return frontera.respuesta(leerBienvenidaPanel(await almacen.recibirEnPanel(identidad)));
  }
  return abrir(almacen, identidad, cuerpo, frontera);
}
