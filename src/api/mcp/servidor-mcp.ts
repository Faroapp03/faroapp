// El transporte Streamable HTTP del servidor MCP, sin estado, en POST /mcp: lo que se comprueba antes de leer el
// mensaje (origen, tipo del cuerpo y límite de consultas por red), la lectura del cuerpo con su límite de bytes y la
// respuesta: JSON cuando hay mensaje y sin cuerpo para los casos del protocolo; no usa SSE. Se enciende con
// FARO_MCP=si (docs/mcp.md); apagado, /mcp no existe.

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { esObjeto } from '../../comun/json.ts';
import { hoyUtc } from '../../comun/tiempo.ts';
import { crearLimitador, type Limitador, PERSONAS_POR_AULA, VENTANA_LIMITADOR_MS } from '../../seguridad/limitador.ts';
import { MAX_CUERPO_BYTES } from '../../seguridad/limites.ts';
import { esConsultaOperativa, sanearClienteDeclarado } from '../campos-operativos.ts';
import { type ContextoApi, redDe } from '../contexto-api.ts';
import { leerTextoLimitado } from '../cuerpo.ts';
import { SolicitudInvalida } from '../errores.ts';
import {
  CABECERA_CONTRATO,
  cabecerasApi,
  comprobarPeticionPost,
  registrarErrorInterno,
  respuestaDeError,
  respuestaPreflight,
} from '../http.ts';
import { conRegistroOperativo } from '../registro-operativo.ts';
import { despachar, type Respondido } from './despacho.ts';
import type { FirmadorMcp } from './firma-de-respuesta.ts';
import {
  CODIGO,
  ErrorMcp,
  errorRpc,
  type IdPeticion,
  leerMensaje,
  META,
  metaDe,
  type PeticionRpc,
} from './protocolo.ts';

/** La ruta del servidor MCP, en el Worker y en el servidor local. */
export const RUTA_MCP = '/mcp';
/** Consultas MCP de una persona en VENTANA_LIMITADOR_MS: una conversación larga con su asistente. */
const CONSULTAS_POR_PERSONA = 20;
/** Consultas MCP de toda una red en VENTANA_LIMITADOR_MS: un aula entera consultando a la vez. */
const MAX_CONSULTAS_MCP_POR_RED = PERSONAS_POR_AULA * CONSULTAS_POR_PERSONA;
/** Lo que admite la comprobación previa de CORS: solo POST y las cabeceras que envía un cliente MCP desde una web. */
const ADMITIDOS_EN_MCP = {
  metodos: 'POST',
  cabeceras: `content-type, authorization, accept, mcp-protocol-version, mcp-method, mcp-name, ${CABECERA_CONTRATO}`,
};

/**
 * Lo que comparten el servidor MCP y el agente A2A (api/a2a/servidor-a2a.ts), cada uno el suyo: su límite de consultas
 * por red y la fecha con que se responde.
 */
export interface ServidorDeAgentes {
  limitador: Limitador;
  /** La fecha de hoy (AAAA-MM-DD): decide qué cursos siguen abiertos y si una comprobación es antigua. */
  hoy: () => string;
  /**
   * Quien firma cada respuesta del servidor MCP con la clave diaria (firma-de-respuesta.ts), o null: sin claves no
   * se firma, que es lo de hoy mientras la raíz de las firmas no exista (docs/mcp.md, «Respuestas firmadas»).
   */
  firmador: FirmadorMcp | null;
}

/**
 * Respuesta con las cabeceras de la API (sin caché, nosniff, CORS solo para los orígenes de la lista), sin cuerpo ni
 * tipo de contenido si `cuerpo` es null.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición que se responde.
 * @param estado - El estado HTTP.
 * @param cuerpo - El cuerpo, que se escribe como JSON; null para no enviarlo.
 * @returns La respuesta.
 */
function responderMcp(contexto: ContextoApi, peticion: Request, estado: number, cuerpo: unknown): Response {
  const cabeceras = cabecerasApi(peticion, contexto.origenesPermitidos);
  if (cuerpo === null) {
    const { 'content-type': _sinCuerpo, ...sinTipo } = cabeceras;
    return new Response(null, { status: estado, headers: sinTipo });
  }
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras });
}

/**
 * Atiende una petición POST JSON-RPC: comprueba, lee el mensaje y, si espera respuesta, la pide a `resolver`; nunca
 * deja un error sin forma JSON-RPC. Lo comparten el servidor MCP y el agente A2A, cada uno con su resolución.
 *
 * @param contexto - El contexto de la API.
 * @param servidor - El servidor que atiende (su límite de consultas por red y su fecha).
 * @param peticion - La petición POST.
 * @param resolver - Resuelve un mensaje que espera respuesta; puede lanzar ErrorMcp.
 * @returns El estado y el cuerpo de la respuesta; sin cuerpo (202) para una notificación o una respuesta.
 */
async function atenderJsonRpc(
  contexto: ContextoApi,
  servidor: ServidorDeAgentes,
  peticion: Request,
  resolver: (mensaje: PeticionRpc) => Respondido | Promise<Respondido>,
): Promise<Respondido> {
  let id: IdPeticion | null = null;
  try {
    await comprobarAntesDeLeer(contexto, servidor, peticion);
    const mensaje = leerMensaje(await leerJson(peticion));
    if (!('metodo' in mensaje)) {
      return { estado: ESTADO_HTTP.aceptada, cuerpo: null };
    }
    id = mensaje.id;
    return await resolver(mensaje);
  } catch (error) {
    if (error instanceof ErrorMcp) {
      return { estado: error.estado, cuerpo: errorRpc(id, error) };
    }
    return errorDeLaApi(peticion, id, error);
  }
}

/**
 * Crea el servidor MCP o el agente A2A, con la fecha en UTC; las pruebas le dan su propio límite y una fecha fija.
 *
 * @param opciones - Lo que se sustituye: el límite, la fecha o el firmador.
 * @returns El servidor, con lo que falte por defecto.
 */
export function crearServidorDeAgentes(opciones: Partial<ServidorDeAgentes> = {}): ServidorDeAgentes {
  return {
    limitador: opciones.limitador ?? crearLimitador(MAX_CONSULTAS_MCP_POR_RED, VENTANA_LIMITADOR_MS),
    hoy: opciones.hoy ?? hoyUtc,
    firmador: opciones.firmador ?? null,
  };
}

/**
 * El cuerpo de la petición como JSON, leído con el límite de bytes de la API; -32700 si no es JSON.
 *
 * @param peticion - La petición POST.
 * @returns El cuerpo ya leído como JSON.
 * @throws {Error} ErrorMcp si el cuerpo es demasiado grande o no es JSON (-32700).
 */
export async function leerJson(peticion: Request): Promise<unknown> {
  const declarado = Number(peticion.headers.get('content-length') ?? 0);
  if (declarado > MAX_CUERPO_BYTES) {
    throw new ErrorMcp(CODIGO.peticion, 'La petición es demasiado grande', ESTADO_HTTP.solicitudIncorrecta);
  }
  let texto: string;
  try {
    texto = await leerTextoLimitado(peticion);
  } catch (error) {
    if (!(error instanceof SolicitudInvalida)) {
      throw error;
    }
    throw new ErrorMcp(CODIGO.peticion, error.message, ESTADO_HTTP.solicitudIncorrecta);
  }
  try {
    return JSON.parse(texto);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new ErrorMcp(CODIGO.json, 'Parse error', ESTADO_HTTP.solicitudIncorrecta);
  }
}

/**
 * Lo que se comprueba antes de leer el mensaje: de dónde viene, que sea JSON y que a la red le queden consultas.
 *
 * @param contexto - El contexto de la API.
 * @param servidor - El servidor, con su límite de consultas por red.
 * @param peticion - La petición POST.
 * @throws {Error} ErrorMcp si el origen no está permitido, el cuerpo no se declara JSON o la red ha agotado sus
 * consultas.
 */
export async function comprobarAntesDeLeer(
  contexto: ContextoApi,
  servidor: ServidorDeAgentes,
  peticion: Request,
): Promise<void> {
  try {
    comprobarPeticionPost(peticion, contexto.origenesPermitidos);
  } catch (error) {
    const { estado } = respuestaDeError(error);
    throw new ErrorMcp(
      CODIGO.peticion,
      estado === ESTADO_HTTP.prohibido ? 'Origen no permitido' : 'El cuerpo tiene que ser JSON',
      estado,
    );
  }
  if (!(await servidor.limitador(redDe(contexto, peticion)))) {
    throw new ErrorMcp(
      CODIGO.demasiadas,
      'Demasiadas consultas desde esta red; prueba dentro de unos minutos',
      ESTADO_HTTP.demasiadasPeticiones,
    );
  }
}

/**
 * Un error de la API que no es del protocolo (plazo, cancelación, fallo interno) como error JSON-RPC.
 *
 * @param peticion - La petición, para registrar un fallo interno.
 * @param id - El identificador del mensaje, si se conoce.
 * @param error - El error de la API.
 * @returns El estado y el cuerpo JSON-RPC del error.
 */
export function errorDeLaApi(peticion: Request, id: IdPeticion | null, error: unknown): Respondido {
  const { estado } = respuestaDeError(error);
  if (estado === ESTADO_HTTP.errorInterno) {
    registrarErrorInterno(peticion, error);
  }
  const errorMcp = new ErrorMcp(
    CODIGO.interno,
    estado === ESTADO_HTTP.errorInterno ? 'Error interno' : 'La consulta no ha terminado',
    estado,
  );
  return { estado, cuerpo: errorRpc(id, errorMcp) };
}

/**
 * Atiende /mcp: POST con un mensaje JSON-RPC; OPTIONS, la comprobación previa de CORS; cualquier otro método, 405,
 * como pide la especificación para el GET y el DELETE de las revisiones anteriores.
 *
 * @param contexto - El contexto de la API.
 * @param servidor - El servidor MCP.
 * @param peticion - La petición a /mcp.
 * @returns La respuesta JSON-RPC, la de CORS o un 405.
 */
export async function atenderMcp(
  contexto: ContextoApi,
  servidor: ServidorDeAgentes,
  peticion: Request,
): Promise<Response> {
  if (peticion.method === 'OPTIONS') {
    return respuestaPreflight(peticion, contexto.origenesPermitidos, ADMITIDOS_EN_MCP);
  }
  if (peticion.method !== 'POST') {
    const respuesta = responderMcp(contexto, peticion, ESTADO_HTTP.metodoNoAdmitido, null);
    respuesta.headers.set('allow', 'POST, OPTIONS');
    return respuesta;
  }
  const { estado, cuerpo, cabeceras } = await atenderJsonRpc(contexto, servidor, peticion, (mensaje) => {
    const ambito = {
      datos: contexto.datos,
      ...(contexto.datosGlobales !== undefined ? { datosGlobales: contexto.datosGlobales } : {}),
      politica: contexto.politica,
      hoy: servidor.hoy(),
      puertaDeCursos: contexto.motorDeCursos,
    };
    const resolver = () => despachar(ambito, peticion.headers, mensaje, servidor.firmador);
    if (mensaje.metodo !== 'tools/call') {
      return resolver();
    }
    const declarada = metaDe(mensaje.parametros)[META.cliente];
    const uso = {
      canal: 'mcp',
      consulta: esConsultaOperativa(mensaje.parametros.name) ? mensaje.parametros.name : 'no_identificada',
      ...sanearClienteDeclarado(esObjeto(declarada) ? declarada.name : declarada),
    } as const;
    return conRegistroOperativo(contexto, peticion, uso, resolver);
  });
  const respuesta = responderMcp(contexto, peticion, estado, cuerpo);
  for (const [nombre, valor] of Object.entries(cabeceras ?? {})) {
    respuesta.headers.set(nombre, valor);
  }
  return respuesta;
}
