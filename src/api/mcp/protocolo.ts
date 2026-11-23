// Las piezas del Model Context Protocol que no dependen de lo que ofrece Faro: versiones, códigos de error, forma de
// los mensajes JSON-RPC 2.0 y metadatos de cada petición. Sigue la revisión 2026-07-28 de la especificación
// (modelcontextprotocol.io/specification/2026-07-28), sin estado: cada petición dice su versión en `_meta` y se atiende
// sola. Para los clientes que aún hablan una revisión anterior (de 2025-03-26 a 2025-11-25), el servidor es «de las dos
// épocas», como permite la especificación: responde a `initialize` y a `ping` y atiende las demás peticiones sin
// sesión (no emite `Mcp-Session-Id`).

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { esObjeto } from '../../comun/json.ts';

/** La revisión vigente de la especificación: la que se anuncia primero. */
export const VERSION_MODERNA = '2026-07-28';
/** Revisiones anteriores, con el saludo `initialize`, que se siguen atendiendo; la primera es la que se propone. */
export const VERSIONES_ANTERIORES = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
/** Todas las revisiones que se atienden, de la más reciente a la más antigua. */
export const VERSIONES = [VERSION_MODERNA, ...VERSIONES_ANTERIORES] as const;
/**
 * Sin cabecera de versión ni versión en `_meta`, un cliente de las revisiones anteriores a 2025-06-18, que no la
 * enviaban: la especificación permite tratarlo como 2025-03-26.
 */
export const VERSION_SIN_CABECERA = '2025-03-26';

/** Claves de `_meta` que define la especificación para cada petición y cada resultado. */
export const META = {
  version: 'io.modelcontextprotocol/protocolVersion',
  capacidades: 'io.modelcontextprotocol/clientCapabilities',
  cliente: 'io.modelcontextprotocol/clientInfo',
  servidor: 'io.modelcontextprotocol/serverInfo',
} as const;

/**
 * Códigos de error JSON-RPC 2.0 y los que reserva la especificación de MCP (-32020 a -32099). Los mensajes que fija
 * una norma se escriben tal cual, en inglés: «Parse error» y «Method not found» (JSON-RPC 2.0, apartado 5.1),
 * «Unsupported protocol version» (MCP, «Lifecycle») y el prefijo «Header mismatch» (MCP, «Server Validation»), para
 * que un cliente los reconozca; los demás, en castellano.
 */
export const CODIGO = {
  json: -32700,
  peticion: -32600,
  metodo: -32601,
  parametros: -32602,
  interno: -32603,
  cabeceras: -32020,
  version: -32022,
  /**
   * Demasiadas consultas de una misma red. Es un error de Faro: la especificación pide que los códigos propios queden
   * fuera del intervalo reservado de JSON-RPC (-32768 a -32000).
   */
  demasiadas: -31429,
} as const;

/** Prefijo y sufijo con que un cliente envía en Base64 un valor de cabecera que no es ASCII visible. */
const CABECERA_EN_BASE64 = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/;
/** Lo que puede llevar una cabecera tal cual: ASCII visible, espacio y tabulador. */
const ASCII_DE_CABECERA = /^[\x20-\x7e\t]*$/;

/** El identificador de una petición JSON-RPC: una notificación no lo lleva. */
export type IdPeticion = string | number;

/** Un error de protocolo: se responde como `error` de JSON-RPC, con el estado HTTP que le corresponde. */
export class ErrorMcp extends Error {
  readonly codigo: number;
  readonly estado: number;
  readonly datos: unknown;

  constructor(codigo: number, mensaje: string, estado = 200, datos?: unknown) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
    this.datos = datos;
  }
}

/** Una petición JSON-RPC ya comprobada: método, identificador y parámetros. Una notificación no llega a serlo. */
export interface PeticionRpc {
  id: IdPeticion;
  metodo: string;
  parametros: Record<string, unknown>;
}

/** Lo que llega en el cuerpo y no es una petición: una notificación o una respuesta del cliente. */
export type MensajeSinRespuesta = { tipo: 'sin-respuesta' };

/** Una respuesta JSON-RPC 2.0 con resultado. */
export interface RespuestaRpc {
  jsonrpc: '2.0';
  id: IdPeticion;
  result: unknown;
}

/** Una respuesta JSON-RPC 2.0 de error: su código, su mensaje y, si los hay, sus datos. */
export interface ErrorRpc {
  jsonrpc: '2.0';
  id: IdPeticion | null;
  error: { code: number; message: string; data?: unknown };
}

/** Un identificador JSON-RPC que admite el servidor: un texto o un número entero (sin null ni fracciones). */
function esId(valor: unknown): valor is IdPeticion {
  return typeof valor === 'string' || (typeof valor === 'number' && Number.isInteger(valor));
}

/**
 * El mensaje JSON-RPC del cuerpo, ya leído como JSON. Un lote (lista) no se admite: la especificación lo retiró en
 * 2025-06-18. Una notificación o una respuesta no esperan nada: el transporte contesta 202 sin cuerpo.
 *
 * @param cuerpo - El JSON del cuerpo.
 * @returns La petición, o la notificación o respuesta que no espera nada.
 * @throws {Error} ErrorMcp si no es un único mensaje JSON-RPC 2.0 válido.
 */
export function leerMensaje(cuerpo: unknown): PeticionRpc | MensajeSinRespuesta {
  if (!esObjeto(cuerpo) || cuerpo.jsonrpc !== '2.0') {
    throw new ErrorMcp(CODIGO.peticion, 'Se esperaba un único mensaje JSON-RPC 2.0', ESTADO_HTTP.solicitudIncorrecta);
  }
  const esRespuesta = !('method' in cuerpo) && ('result' in cuerpo || 'error' in cuerpo) && esId(cuerpo.id);
  if (esRespuesta) {
    return { tipo: 'sin-respuesta' };
  }
  if (typeof cuerpo.method !== 'string' || cuerpo.method === '') {
    throw new ErrorMcp(CODIGO.peticion, 'Falta el método', ESTADO_HTTP.solicitudIncorrecta);
  }
  if ('params' in cuerpo && !esObjeto(cuerpo.params)) {
    throw new ErrorMcp(CODIGO.peticion, 'Los parámetros tienen que ser un objeto', ESTADO_HTTP.solicitudIncorrecta);
  }
  if (!('id' in cuerpo)) {
    return { tipo: 'sin-respuesta' };
  }
  if (!esId(cuerpo.id)) {
    throw new ErrorMcp(CODIGO.peticion, 'El identificador no es válido', ESTADO_HTTP.solicitudIncorrecta);
  }
  return { id: cuerpo.id, metodo: cuerpo.method, parametros: esObjeto(cuerpo.params) ? cuerpo.params : {} };
}

/**
 * El `_meta` de los parámetros, o un objeto vacío.
 *
 * @param parametros - Los parámetros de la petición.
 * @returns Su `_meta`, o un objeto vacío.
 */
export function metaDe(parametros: Record<string, unknown>): Record<string, unknown> {
  return esObjeto(parametros._meta) ? parametros._meta : {};
}

/**
 * Respuesta JSON-RPC con resultado.
 *
 * @param id - El identificador de la petición.
 * @param resultado - El resultado.
 * @returns La respuesta.
 */
export function respuestaRpc(id: IdPeticion, resultado: unknown): RespuestaRpc {
  return {
    jsonrpc: '2.0',
    id,
    result: resultado,
  };
}

/**
 * Respuesta JSON-RPC de error; sin identificador conocido, `id` es null, como pide JSON-RPC 2.0.
 *
 * @param id - El identificador de la petición, si se conoce.
 * @param error - El error.
 * @returns La respuesta de error.
 */
export function errorRpc(id: IdPeticion | null, error: ErrorMcp): ErrorRpc {
  const detalle = {
    code: error.codigo,
    message: error.message,
    ...(error.datos === undefined ? {} : { data: error.datos }),
  };
  return { jsonrpc: '2.0', id, error: detalle };
}

/**
 * El valor de una cabecera `Mcp-Name`, descodificado si llega en Base64; null si no es válido.
 *
 * @param crudo - El valor tal como llegó.
 * @returns El valor descodificado, o null si no es válido.
 */
export function valorDeCabecera(crudo: string): string | null {
  const codificado = CABECERA_EN_BASE64.exec(crudo);
  if (!codificado) {
    return ASCII_DE_CABECERA.test(crudo) ? crudo : null;
  }
  try {
    const bytes = Uint8Array.from(atob(codificado[1] ?? ''), (letra) => letra.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    // Ni Base64 válido (DOMException de atob) ni UTF-8 (TypeError del descodificador estricto): el valor no vale y la
    // cabecera no coincide con el cuerpo.
    if (!(error instanceof DOMException || error instanceof TypeError)) {
      throw error;
    }
    return null;
  }
}
