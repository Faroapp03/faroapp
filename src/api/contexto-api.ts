// Datos, firmas, límites de lectura y respuestas que comparten las rutas factuales.

import type { OfertaDeFormacion } from '../../motores/cursos/src/index.ts';
import type { UsoConectividad } from '../administracion/accesos.ts';
import type { DatosGlobales } from '../datos-globales/datos.ts';
import type { Datos, PoliticaReferencias } from '../dominio/tipos-paquete.ts';
import type { PuertaDelMotor } from '../plataforma/motor-de-cursos.ts';
import type { Firmador } from '../seguridad/firma.ts';
import { claveDeRed, type Limitadores } from '../seguridad/limitador.ts';
import {
  cabecerasApi,
  DemasiadasPeticiones,
  type Problema,
  type RespuestaDeError,
  respuestaConProblema,
  respuestaDeProblema,
} from './http.ts';
import type { ServidorDeAgentes } from './mcp/servidor-mcp.ts';
import type { ServidorDeSocios } from './socios/servidor-socios.ts';

export interface ContextoApi {
  readonly registrarAcceso: (uso: UsoConectividad) => Promise<void>;
  readonly datos: Datos;
  readonly datosGlobales?: DatosGlobales | null;
  readonly motorDeCursos: PuertaDelMotor;
  readonly firmador: Firmador;
  readonly politica: PoliticaReferencias;
  readonly oferta: OfertaDeFormacion;
  readonly caminoAMano: boolean;
  readonly origenesPermitidos: readonly string[];
  readonly limitadores: Limitadores;
  readonly ipDeCloudflare: boolean;
  readonly mcp: ServidorDeAgentes | null;
  readonly a2a: ServidorDeAgentes | null;
  readonly socios: ServidorDeSocios | null;
}

/** Lo que atiende una ruta. `parametros` son los grupos capturados por su patrón (por ejemplo, el código ESCO). */
export type ManejadorRuta = (
  contexto: ContextoApi,
  peticion: Request,
  url: URL,
  parametros: string[],
) => Promise<Response>;

/**
 * Respuesta JSON con las cabeceras de la API.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param estado - El código HTTP (ESTADO_HTTP).
 * @param cuerpo - El cuerpo, que se envía como JSON.
 * @returns La respuesta.
 */
export function responder(contexto: ContextoApi, peticion: Request, estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: cabecerasApi(peticion, contexto.origenesPermitidos),
  });
}

/**
 * Respuesta de error en Problem Details (respuestaConProblema, api/http.ts), con los orígenes de la API.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param respuesta - El estado, el problema y sus cabeceras.
 * @returns La respuesta application/problem+json.
 */
export function responderProblema(contexto: ContextoApi, peticion: Request, respuesta: RespuestaDeError): Response {
  return respuestaConProblema(peticion, contexto.origenesPermitidos, respuesta);
}

/**
 * Respuesta de un problema, con las cabeceras que pide su código (respuestaDeProblema, api/errores.ts).
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param cuerpo - El problema.
 * @returns La respuesta application/problem+json.
 */
export function responderUnProblema(contexto: ContextoApi, peticion: Request, cuerpo: Problema): Response {
  return responderProblema(contexto, peticion, respuestaDeProblema(cuerpo));
}

/**
 * La clave de red de la petición (la IPv4 o el /64 de la IPv6); fuera de Cloudflare, todos son «local».
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @returns La clave de su red, o «local».
 */
export function redDe(contexto: ContextoApi, peticion: Request): string {
  const ip = contexto.ipDeCloudflare ? peticion.headers.get('cf-connecting-ip') : null;
  return ip ? claveDeRed(ip) : 'local';
}

/**
 * Cuenta una lectura factual (GET /api/*) de la red de la petición y falla con 429 si la red ha agotado las suyas. Solo
 * en el Worker: fuera, todas las peticiones son de la red «local» y no se limita nada.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @throws {DemasiadasPeticiones} Si la red ha agotado sus lecturas.
 */
export async function exigirLecturaDeLaRed(contexto: ContextoApi, peticion: Request): Promise<void> {
  const { lecturas } = contexto.limitadores;
  if (!contexto.ipDeCloudflare || !lecturas) {
    return;
  }
  if (!(await lecturas(redDe(contexto, peticion)))) {
    throw new DemasiadasPeticiones();
  }
}
