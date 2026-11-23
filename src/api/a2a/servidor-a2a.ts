// El agente A2A de Faro (Agent2Agent 1.0): la tarjeta en /.well-known/agent-card.json y el enlace JSON-RPC en
// POST /a2a, para consultar los servicios factuales declarados por MCP. Se enciende
// con FARO_A2A=si (docs/mcp.md); apagado, ni la tarjeta ni /a2a existen.
// Sin estado y sin tareas: SendMessage responde enseguida con un mensaje del agente. El mensaje pide una habilidad con
// una parte de datos {"skill": …, "arguments": {…}}; un mensaje de solo texto busca la ocupación. Lo que Faro no hace
// (tareas, flujos, avisos, tarjeta ampliada) responde con el error que fija la especificación (sección 5.4). Las
// comprobaciones antes de leer (origen, tipo, límite por red) y el tope del cuerpo son los del servidor MCP.

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { sha256Hex } from '../../comun/huella.ts';
import { esObjeto } from '../../comun/json.ts';
import { esConsultaOperativa } from '../campos-operativos.ts';
import type { ContextoApi } from '../contexto-api.ts';
import { TIPO_JSON } from '../errores.ts';
import { cabecerasApi, respuestaPreflight } from '../http.ts';
import type { Respondido } from '../mcp/despacho.ts';
import { HERRAMIENTA_DE_BUSQUEDA, llamarHerramientaConElMotor } from '../mcp/herramientas.ts';
import { CODIGO, ErrorMcp, errorRpc, type IdPeticion, leerMensaje, respuestaRpc } from '../mcp/protocolo.ts';
import { comprobarAntesDeLeer, errorDeLaApi, leerJson, type ServidorDeAgentes } from '../mcp/servidor-mcp.ts';
import { conRegistroOperativo } from '../registro-operativo.ts';
import { tarjetaDeAgente, VERSION_A2A } from './tarjeta.ts';

/** Los errores propios de A2A en el enlace JSON-RPC (especificación, sección 5.4). */
const ERROR_A2A = {
  tareaNoEncontrada: -32001,
  avisosNoAdmitidos: -32003,
  operacionNoAdmitida: -32004,
  contenidoNoAdmitido: -32005,
  sinTarjetaAmpliada: -32007,
  versionNoAdmitida: -32009,
} as const;
/** Tiempo de caché de la tarjeta; su ETag identifica su contenido publicado. */
const CACHE_TARJETA_S = 3600;
/** Lo que admite la comprobación previa de CORS: solo POST y las cabeceras que envía un cliente A2A desde una web. */
const ADMITIDOS_EN_A2A = { metodos: 'POST', cabeceras: 'content-type, authorization, a2a-version, a2a-extensions' };
/** Caracteres hexadecimales del SHA-256 de la tarjeta que forman su ETag: 128 bits bastan para distinguir versiones. */
const CARACTERES_DEL_ETAG = 32;
/** Los métodos de tareas: el agente no las crea, así que responde «tarea no encontrada». */
const METODOS_DE_TAREAS = new Set(['GetTask', 'CancelTask', 'SubscribeToTask']);
/** Los métodos de avisos push: el agente no los envía. */
const METODOS_DE_AVISOS = new Set([
  'CreateTaskPushNotificationConfig',
  'GetTaskPushNotificationConfig',
  'ListTaskPushNotificationConfigs',
  'DeleteTaskPushNotificationConfig',
]);
/** Los métodos de flujo y de listado de tareas: operación no admitida. */
const METODOS_DE_FLUJO_Y_LISTA = new Set(['SendStreamingMessage', 'ListTasks']);
/** La versión que la especificación supone a un cliente que no envía `a2a-version`; este agente habla otra. */
const VERSION_A2A_SIN_CABECERA = '0.3';

/** La versión que pide el cliente: sin cabecera, la especificación supone VERSION_A2A_SIN_CABECERA, que este agente no habla. */
function comprobarVersion(cabeceras: Headers): void {
  const pedida = cabeceras.get('a2a-version')?.trim() || VERSION_A2A_SIN_CABECERA;
  if (pedida !== VERSION_A2A) {
    throw new ErrorMcp(ERROR_A2A.versionNoAdmitida, 'Versión de A2A no admitida', ESTADO_HTTP.correcto, {
      admitidas: [VERSION_A2A],
    });
  }
}

/**
 * La habilidad y sus argumentos que pide un mensaje: de su parte de datos o, si solo hay texto, buscar la ocupación.
 */
function pedidoDe(mensaje: unknown): { name: unknown; arguments: unknown } {
  const partes = esObjeto(mensaje) && Array.isArray(mensaje.parts) ? mensaje.parts.filter(esObjeto) : [];
  if (partes.length === 0) {
    throw new ErrorMcp(CODIGO.parametros, 'El mensaje necesita al menos una parte');
  }
  const datos = partes.find((parte) => 'data' in parte)?.data;
  if (datos !== undefined) {
    if (!esObjeto(datos)) {
      throw new ErrorMcp(CODIGO.parametros, 'La parte de datos es {"skill": …, "arguments": {…}}');
    }
    return { name: datos.skill, arguments: datos.arguments ?? {} };
  }
  const texto = partes
    .map((parte) => (typeof parte.text === 'string' ? parte.text : ''))
    .join(' ')
    .trim();
  if (texto) {
    return { name: HERRAMIENTA_DE_BUSQUEDA, arguments: { texto } };
  }
  throw new ErrorMcp(ERROR_A2A.contenidoNoAdmitido, 'Este agente lee partes de texto o de datos JSON, no archivos');
}

/** SendMessage: llama a la herramienta y responde un mensaje del agente con sus datos, o con el porqué si no puede. */
async function enviarMensaje(
  contexto: ContextoApi,
  servidor: ServidorDeAgentes,
  solicitud: { parametros: Record<string, unknown>; peticion: Request },
) {
  const mensaje = solicitud.parametros.message;
  const pedido = pedidoDe(mensaje);
  const ambito = {
    datos: contexto.datos,
    ...(contexto.datosGlobales !== undefined ? { datosGlobales: contexto.datosGlobales } : {}),
    politica: contexto.politica,
    hoy: servidor.hoy(),
    puertaDeCursos: contexto.motorDeCursos,
  };
  const uso = { canal: 'a2a', habilidad: esConsultaOperativa(pedido.name) ? pedido.name : 'no_identificada' } as const;
  const resultado = await conRegistroOperativo(contexto, solicitud.peticion, uso, () =>
    llamarHerramientaConElMotor(ambito, pedido),
  );
  const parte = !('structuredContent' in resultado)
    ? { text: resultado.content[0]?.text ?? '', mediaType: 'text/plain' }
    : { data: resultado.structuredContent, mediaType: TIPO_JSON };
  const idDeContexto =
    esObjeto(mensaje) && typeof mensaje.contextId === 'string' ? mensaje.contextId : crypto.randomUUID();
  return { message: { role: 'ROLE_AGENT', messageId: crypto.randomUUID(), contextId: idDeContexto, parts: [parte] } };
}

/** Atiende un método del enlace JSON-RPC: SendMessage, o el error de lo que Faro no hace. */
async function atenderMetodo(
  contexto: ContextoApi,
  servidor: ServidorDeAgentes,
  pedido: { metodo: string; parametros: Record<string, unknown>; peticion: Request },
) {
  const { metodo, parametros } = pedido;
  if (metodo === 'SendMessage') {
    return enviarMensaje(contexto, servidor, { parametros, peticion: pedido.peticion });
  }
  if (METODOS_DE_TAREAS.has(metodo)) {
    throw new ErrorMcp(ERROR_A2A.tareaNoEncontrada, 'Este agente no crea tareas: cada mensaje se responde enseguida');
  }
  if (METODOS_DE_AVISOS.has(metodo)) {
    throw new ErrorMcp(ERROR_A2A.avisosNoAdmitidos, 'Este agente no envía avisos');
  }
  if (METODOS_DE_FLUJO_Y_LISTA.has(metodo)) {
    throw new ErrorMcp(ERROR_A2A.operacionNoAdmitida, `No admitido: ${metodo}`);
  }
  if (metodo === 'GetExtendedAgentCard') {
    throw new ErrorMcp(ERROR_A2A.sinTarjetaAmpliada, 'No hay tarjeta ampliada');
  }
  throw new ErrorMcp(CODIGO.metodo, 'Método desconocido');
}

/**
 * Atiende el POST de /a2a: comprueba la petición, lee el mensaje JSON-RPC y responde; un mensaje sin método (una
 * respuesta o una notificación) se acepta con un 202 y sin cuerpo.
 *
 * @param contexto - El contexto de la API.
 * @param servidor - El agente A2A.
 * @param peticion - La petición a /a2a.
 * @returns El estado y el cuerpo JSON-RPC (null sin cuerpo).
 */
async function atenderPost(contexto: ContextoApi, servidor: ServidorDeAgentes, peticion: Request): Promise<Respondido> {
  let id: IdPeticion | null = null;
  try {
    await comprobarAntesDeLeer(contexto, servidor, peticion);
    const mensaje = leerMensaje(await leerJson(peticion));
    if (!('metodo' in mensaje)) {
      return { estado: 202, cuerpo: null };
    }
    id = mensaje.id;
    comprobarVersion(peticion.headers);
    return {
      estado: 200,
      cuerpo: respuestaRpc(
        mensaje.id,
        await atenderMetodo(contexto, servidor, { metodo: mensaje.metodo, parametros: mensaje.parametros, peticion }),
      ),
    };
  } catch (error) {
    if (error instanceof ErrorMcp) {
      return { estado: error.estado, cuerpo: errorRpc(id, error) };
    }
    return errorDeLaApi(peticion, id, error);
  }
}

/** La tarjeta de un origen serializada y su ETag. */
interface TarjetaSerializada {
  texto: string;
  etiqueta: string;
}

/** Cuántos orígenes se guardan serializados: lo normal es uno o dos; con más, se empieza de nuevo. */
const MAX_ORIGENES_EN_CACHE = 8;
/** Las tarjetas ya serializadas por origen. */
const TARJETAS_POR_ORIGEN = new Map<string, TarjetaSerializada>();

/**
 * La tarjeta del origen, serializada y con su ETag; se calcula una vez por origen.
 *
 * @param origen - El origen (esquema y servidor) con que se pidió la tarjeta.
 * @returns Su texto JSON y su etiqueta.
 */
function tarjetaSerializada(origen: string): TarjetaSerializada {
  const clave = origen;
  const guardada = TARJETAS_POR_ORIGEN.get(clave);
  if (guardada) {
    return guardada;
  }
  const texto = JSON.stringify(tarjetaDeAgente(origen));
  const nueva = { texto, etiqueta: `"${sha256Hex(texto).slice(0, CARACTERES_DEL_ETAG)}"` };
  if (TARJETAS_POR_ORIGEN.size >= MAX_ORIGENES_EN_CACHE) {
    TARJETAS_POR_ORIGEN.clear();
  }
  TARJETAS_POR_ORIGEN.set(clave, nueva);
  return nueva;
}

/**
 * La tarjeta, con caché y ETag (sección 8.6.1); si el cliente ya la tiene, 304 sin cuerpo.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición a la tarjeta.
 * @returns La tarjeta, un 304 sin cuerpo o un 405.
 */
export async function responderTarjeta(contexto: ContextoApi, peticion: Request): Promise<Response> {
  const cabeceras = cabecerasApi(peticion, contexto.origenesPermitidos);
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...cabeceras, allow: 'GET, HEAD' } });
  }
  const { texto, etiqueta } = tarjetaSerializada(new URL(peticion.url).origin);
  const conCache = { ...cabeceras, 'cache-control': `public, max-age=${CACHE_TARJETA_S}`, etag: etiqueta };
  if (peticion.headers.get('if-none-match') === etiqueta) {
    return new Response(null, { status: 304, headers: conCache });
  }
  return new Response(peticion.method === 'HEAD' ? null : texto, { status: 200, headers: conCache });
}

/**
 * Atiende /a2a: POST con un mensaje JSON-RPC; OPTIONS, la comprobación previa de CORS; cualquier otro método, 405.
 *
 * @param contexto - El contexto de la API.
 * @param servidor - El agente A2A.
 * @param peticion - La petición a /a2a.
 * @returns La respuesta JSON-RPC, la de CORS o un 405.
 */
export async function atenderA2a(
  contexto: ContextoApi,
  servidor: ServidorDeAgentes,
  peticion: Request,
): Promise<Response> {
  if (peticion.method === 'OPTIONS') {
    return respuestaPreflight(peticion, contexto.origenesPermitidos, ADMITIDOS_EN_A2A);
  }
  const cabeceras = cabecerasApi(peticion, contexto.origenesPermitidos);
  if (peticion.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...cabeceras, allow: 'POST, OPTIONS' } });
  }
  const { estado, cuerpo, cabeceras: adicionales } = await atenderPost(contexto, servidor, peticion);
  return new Response(cuerpo === null ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cabeceras, ...adicionales },
  });
}
