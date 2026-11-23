/** Consultas institucionales: identidad vigente, cuotas y revocaciones persistidas, y respuestas sin caché. */
import type { AlmacenAccesos } from '../../administracion/accesos.ts';
import { type AlmacenInstituciones, LIMITES_CONECTIVIDAD } from '../../administracion/instituciones.ts';
import { hoyUtc, MS_POR_MINUTO, MS_POR_SEGUNDO } from '../../comun/tiempo.ts';
import type { SecretoDeFirma } from '../../seguridad/firma.ts';
import { crearLimitador, type Limitador, VENTANA_LIMITADOR_MS } from '../../seguridad/limitador.ts';
import { type Problema, respuestaDeProblema, TIPO_JSON, TIPO_PROBLEMA } from '../errores.ts';
import { consumirPublico, operacionPublica } from './acceso-publico.ts';
import type { AlmacenAccesoPublico } from './almacen-publico.ts';
import { AMBITO_DE_LECTURA, RUTA_CONSULTAS, RUTA_SOCIOS } from './metadatos.ts';
import type { Socio } from './registro.ts';
import type { RevocacionesDeTokens } from './revocaciones.ts';
import { crearEmisorDeTokens, type Destino, type EmisorDeTokens, type Reclamaciones } from './token-de-acceso.ts';

export { RUTA_CONSULTAS, RUTA_INTROSPECCION, RUTA_REVOCAR, RUTA_SOCIOS, RUTA_TOKEN } from './metadatos.ts';
export const REINO = 'faro-socios';
const HORA_MS = 60 * MS_POR_MINUTO;
export const HORA_S = HORA_MS / MS_POR_SEGUNDO;
const PETICIONES_CON_CREDENCIALES_POR_RED = 60;
const CABECERAS = { 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff' } as const;
type RegistroInstitucional = Pick<
  AlmacenInstituciones,
  'buscarInstitucion' | 'consultarInvitacion' | 'activarInvitacion'
>;
export interface OpcionesDeSocios {
  readonly instituciones: RegistroInstitucional;
  readonly accesos: Pick<AlmacenAccesos, 'registrarAcceso'>;
  readonly almacen: AlmacenAccesoPublico;
  readonly ahora?: () => number;
  readonly hoy?: () => string;
}
export interface ServidorDeSocios {
  readonly instituciones: RegistroInstitucional;
  readonly accesos: Pick<AlmacenAccesos, 'registrarAcceso'>;
  readonly almacen: AlmacenAccesoPublico;
  readonly emisor: EmisorDeTokens;
  readonly revocaciones: RevocacionesDeTokens;
  readonly limites: { readonly credencialesPorRed: Limitador };
  readonly hoy: () => string;
}
/** Todas las capacidades son obligatorias; nunca se adopta un registro alternativo en memoria o desde el entorno. */
export async function crearServidorDeSocios(
  opciones: OpcionesDeSocios,
  secretos: { secreto: SecretoDeFirma | undefined; anterior: SecretoDeFirma | undefined },
): Promise<ServidorDeSocios> {
  const { instituciones, accesos, almacen, ahora = Date.now } = opciones;
  if (!instituciones || !accesos || !almacen) {
    throw new TypeError('La API institucional requiere identidad, cuotas, revocaciones y registro persistentes');
  }
  const redAdmite = crearLimitador(PETICIONES_CON_CREDENCIALES_POR_RED, VENTANA_LIMITADOR_MS, ahora);
  return {
    instituciones,
    accesos,
    almacen,
    emisor: await crearEmisorDeTokens(secretos.secreto, secretos.anterior, ahora),
    revocaciones: {
      revocar: (jti, caducaS) => operacionPublica(() => almacen.revocar(jti, caducaS)),
      revocado: (jti) => operacionPublica(() => almacen.revocado(jti)),
    },
    limites: {
      // La red solo interviene en este limitador efímero y acotado: no se persiste ni se registra.
      credencialesPorRed: redAdmite,
    },
    hoy: opciones.hoy ?? hoyUtc,
  };
}
export function destinoDe(peticion: Request): Destino {
  const { origin: origen } = new URL(peticion.url);
  return { emisor: `${origen}${RUTA_SOCIOS}`, audiencia: `${origen}${RUTA_CONSULTAS}` };
}
/** TLS obligatorio, salvo el bucle local sin transporte por una red externa. */
export function transporteSeguro(peticion: Request): boolean {
  const { protocol: protocolo, hostname: anfitrion } = new URL(peticion.url);
  return protocolo === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(anfitrion);
}
/** Cada validación consulta institución y huella exacta vigentes, además de firma, destino, caducidad y revocación. */
export async function tokenVigente(
  servidor: ServidorDeSocios,
  token: string,
  peticion: Request,
): Promise<Reclamaciones | null> {
  const reclamaciones = await servidor.emisor.comprobar(token, destinoDe(peticion));
  if (!reclamaciones) {
    return null;
  }
  const socio = await buscarSocio(servidor, reclamaciones.client_id);
  if (!socio?.huellas.includes(reclamaciones.credencial) || reclamaciones.scope !== AMBITO_DE_LECTURA) {
    return null;
  }
  return (await servidor.revocaciones.revocado(reclamaciones.jti)) ? null : reclamaciones;
}
export function buscarSocio(servidor: ServidorDeSocios, id: string): Promise<Socio | null> {
  return operacionPublica(() => servidor.instituciones.buscarInstitucion(id));
}
export async function consumirConsulta(servidor: ServidorDeSocios, id: string): Promise<boolean> {
  const socio = await buscarSocio(servidor, id);
  if (!socio) {
    return false;
  }
  return consumirPublico(servidor.almacen, [
    { clave: `consultas:cliente:${id}`, limite: socio.consultasPorHora, ventanaMs: HORA_MS },
    { clave: 'consultas:global', limite: LIMITES_CONECTIVIDAD.consultasGlobalesHora, ventanaMs: HORA_MS },
  ]);
}
/**
 * Gasta un uso del tope global por hora de las peticiones con credenciales. Solo se gasta con una credencial vigente ya
 * comprobada (la de una institución o la de una invitación): quien no tiene ninguna no puede agotarlo y dejar sin
 * servicio a las instituciones.
 */
export function consumirCredencialGlobal(servidor: ServidorDeSocios): Promise<boolean> {
  return consumirPublico(servidor.almacen, [
    { clave: 'credenciales:global', limite: LIMITES_CONECTIVIDAD.credencialesGlobalesHora, ventanaMs: HORA_MS },
  ]);
}
export function consumirToken(servidor: ServidorDeSocios, id: string): Promise<boolean> {
  return consumirPublico(servidor.almacen, [
    { clave: `tokens:cliente:${id}`, limite: LIMITES_CONECTIVIDAD.tokensPorInstitucionHora, ventanaMs: HORA_MS },
  ]);
}

/**
 * Una respuesta JSON (o sin cuerpo, con null) con las cabeceras de la API para socios.
 *
 * @param estado - El estado HTTP.
 * @param cuerpo - El cuerpo, que se escribe como JSON; null para no enviarlo.
 * @param cabeceras - Cabeceras que se añaden.
 * @returns La respuesta.
 */
export function respuestaJson(estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): Response {
  if (cuerpo === null) {
    return new Response(null, { status: estado, headers: { ...CABECERAS, ...cabeceras } });
  }
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CABECERAS, 'content-type': `${TIPO_JSON}; charset=utf-8`, ...cabeceras },
  });
}

/**
 * Un problema (RFC 9457) como respuesta, con Retry-After si su código lo pide y las cabeceras dadas. `tipo` es el de
 * Problem Details salvo en los errores de OAuth, que RFC 6749 (5.2) quiere en application/json.
 *
 * @param cuerpo - El problema.
 * @param cabeceras - Cabeceras que se añaden.
 * @param tipo - El tipo de contenido.
 * @returns La respuesta.
 */
export function respuestaDeUnProblema(
  cuerpo: Problema,
  cabeceras: Record<string, string> = {},
  tipo: string = TIPO_PROBLEMA,
): Response {
  const { estado, cabeceras: deReintento } = respuestaDeProblema(cuerpo);
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CABECERAS, ...deReintento, ...cabeceras, 'content-type': `${tipo}; charset=utf-8` },
  });
}
