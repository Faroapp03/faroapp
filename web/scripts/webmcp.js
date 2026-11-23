// Ofrece al asistente de IA del propio navegador, con WebMCP, las herramientas de solo lectura del
// servidor MCP de Faro (docs/mcp.md). Las resuelve el motor del dispositivo (motor-local/cliente.js), que lleva ese
// servidor: nombres, títulos, descripciones y esquemas son los de su `tools/list`, y no se copia ninguno aquí.
// Ninguna consulta sale del dispositivo y ninguna herramienta lee la página: devuelven datos
// públicos de ocupaciones, tareas y formación, nunca lo que la persona ha escrito en Faro.
// WebMCP es un borrador de un grupo comunitario del W3C, a prueba en Chrome y Edge: sin document.modelContext este
// módulo no hace nada y la página funciona igual. Solo se registra lo que el servidor marca como de solo lectura.
// Si el motor no puede responder (la copia del paquete no está completa), no se registra ninguna herramienta y no se
// insiste: se vuelve a intentar la próxima vez que se abra la página.

import { esBooleano, esFormaDe, esListaDe, esNumero, esObjeto, esOpcional, esTexto } from './json.js';
import { pedirAlMotorLocal } from './motor-local/cliente.js';
import { antesDeQueNoCoincida } from './recorrido/instalacion-que-no-coincide.js';

/**
 * La revisión del Model Context Protocol que habla este cliente: la vigente del servidor MCP de Faro
 * (VERSION_MODERNA, src/api/mcp/protocolo.ts). La web no importa el motor; pruebas/web-recorrido-integral/webmcp.test.ts
 * comprueba que cada petición lleva la del motor, así que una revisión nueva no pasa las pruebas sin cambiar esta.
 */
const REVISION_MCP = '2026-07-28';
/** La ruta del servidor MCP en la API del motor (RUTA_MCP de src/api/mcp/servidor-mcp.ts), cotejada igual. */
const RUTA_MCP = '/mcp';
/**
 * El `_meta` que esa revisión exige en cada petición: su versión y las capacidades del cliente, que no declara
 * ninguna. Sin `clientInfo`, que es opcional y solo sirve para enseñarlo o anotarlo: cliente y servidor son el mismo
 * Faro, en el mismo dispositivo.
 */
const META = Object.freeze({
  'io.modelcontextprotocol/protocolVersion': REVISION_MCP,
  'io.modelcontextprotocol/clientCapabilities': Object.freeze({}),
});
/** Lo que lanza ofrecerHerramientas si la lista del servidor no tiene la forma esperada. */
const LISTA_INCOMPRENSIBLE = 'La lista de herramientas del servidor MCP no se entiende';
/** Un nombre de herramienta que WebMCP admite: de 1 a 128 caracteres entre letras y cifras ASCII, «_», «-» y «.». */
const NOMBRE_WEBMCP = /^[A-Za-z0-9_.-]{1,128}$/;
/** Lo que lee el asistente si el motor del dispositivo no responde (el transporte rechaza con un TypeError). */
const MOTOR_SIN_RESPUESTA = 'El motor de Faro en este dispositivo no ha podido responder; vuelve a intentarlo.';
/** Lo que lee el asistente si el servidor responde algo que no tiene la forma de un resultado de MCP. */
const RESULTADO_INCOMPRENSIBLE = 'El servidor MCP de este dispositivo ha respondido algo que no se entiende.';

/**
 * Lo que este módulo usa de WebMCP (webmachinelearning.github.io/webmcp, interfaz «ModelContext»).
 * @typedef {{ registerTool: (herramienta: HerramientaWebMcp, opciones: { signal?: AbortSignal }) => Promise<void> }}
 *   ContextoDeModelo
 */
/**
 * Una herramienta de WebMCP (diccionario «ModelContextTool»).
 * @typedef {{ name: string, title: string, description: string, inputSchema: Record<string, unknown>,
 *   annotations: { readOnlyHint: boolean, untrustedContentHint: boolean },
 *   execute: (entrada: unknown, opciones: { signal?: AbortSignal }) => Promise<unknown> }} HerramientaWebMcp
 */
/** Cómo llega una petición a la API del motor: como fetch. @typedef {typeof pedirAlMotorLocal} Transporte */

/** Un fallo del servidor MCP del dispositivo: un error JSON-RPC o una respuesta que no se entiende. */
class FalloDelMcpLocal extends Error {}

/** Las anotaciones de MCP que se leen aquí («ToolAnnotations»). */
const esAnotacionesMcp = esFormaDe({ readOnlyHint: esOpcional(esBooleano), openWorldHint: esOpcional(esBooleano) });
/** Una herramienta tal como la lista el servidor (DefinicionDeHerramienta, src/api/mcp/herramientas.ts). */
const esDefinicionMcp = esFormaDe({
  name: esTexto,
  title: esTexto,
  description: esTexto,
  inputSchema: esObjeto,
  annotations: esAnotacionesMcp,
});
/** @typedef {typeof esDefinicionMcp extends (valor: unknown) => valor is infer Forma ? Forma : never} DefinicionMcp */
/** El resultado de `tools/list`, de una sola página. */
const esListaMcp = esFormaDe({ tools: esListaDe(esDefinicionMcp) });
/** El resultado de `tools/call` (MCP, «CallToolResult»): su contenido, si es un error y, si lo hay, sus datos. */
const esResultadoDeHerramienta = esFormaDe({
  content: esListaDe(esObjeto),
  isError: esOpcional(esBooleano),
  structuredContent: esOpcional(esObjeto),
});
/** Una respuesta JSON-RPC 2.0 con resultado. */
const esRespuestaRpc = esFormaDe({ result: esObjeto });
/** Una respuesta JSON-RPC 2.0 de error. */
const esErrorRpc = esFormaDe({ error: esFormaDe({ code: esNumero, message: esTexto }) });

/** Un error de herramienta con la forma de MCP, que el asistente sabe leer. @param {string} mensaje */
function errorParaElAsistente(mensaje) {
  return { content: [{ type: 'text', text: mensaje }], isError: true };
}

/**
 * El cuerpo de una respuesta como JSON, o null si no lo es: entonces no es JSON-RPC, y quien llama lo dice.
 * @param {Response} respuesta @returns {Promise<unknown>}
 */
async function cuerpoJson(respuesta) {
  try {
    return await respuesta.json();
  } catch {
    return null;
  }
}

/**
 * Hace una petición JSON-RPC al servidor MCP del motor del dispositivo con la revisión vigente: el `_meta` en los
 * parámetros y repetido en las cabeceras, como pide su transporte HTTP. Devuelve el resultado; si el servidor responde
 * un error o algo que no es JSON-RPC, lanza FalloDelMcpLocal.
 * @param {Transporte} transporte Cómo llega la petición al motor del dispositivo.
 * @param {string} metodo El método JSON-RPC (`tools/list`, `tools/call`).
 * @param {Record<string, unknown>} parametros Los parámetros del método, sin `_meta`.
 * @param {AbortSignal | undefined} senal La señal que cancela la petición.
 * @returns {Promise<Record<string, unknown>>} El `result` de la respuesta.
 */
async function pedirAlMcp(transporte, metodo, parametros, senal) {
  senal?.throwIfAborted();
  /** @type {Record<string, string>} */
  const cabeceras = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': REVISION_MCP,
    'mcp-method': metodo,
  };
  // Solo se llama a herramientas registradas, cuyo nombre es ASCII (NOMBRE_WEBMCP): va tal cual en la cabecera.
  if (metodo === 'tools/call') {
    cabeceras['mcp-name'] = String(parametros.name);
  }
  const cuerpo = { jsonrpc: '2.0', id: crypto.randomUUID(), method: metodo, params: { ...parametros, _meta: META } };
  const opciones = {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify(cuerpo),
    ...(senal ? { signal: senal } : {}),
  };
  const respuesta = await transporte(RUTA_MCP, opciones);
  const mensaje = await cuerpoJson(respuesta);
  senal?.throwIfAborted();
  if (esErrorRpc(mensaje)) {
    throw new FalloDelMcpLocal(mensaje.error.message);
  }
  if (!esRespuestaRpc(mensaje)) {
    throw new FalloDelMcpLocal(`${RESULTADO_INCOMPRENSIBLE} Estado HTTP: ${respuesta.status}.`);
  }
  return mensaje.result;
}

/**
 * Lo que la herramienta devuelve al asistente, que WebMCP serializa en JSON. Con datos, los datos con su procedencia:
 * serializados son el mismo texto que el servidor MCP pone en su contenido. Si la llamada no vale, el error tal como
 * lo da MCP, para que el asistente la corrija.
 * @param {Record<string, unknown>} resultado @returns {unknown}
 */
function respuestaParaElAsistente(resultado) {
  if (!esResultadoDeHerramienta(resultado)) {
    return errorParaElAsistente(RESULTADO_INCOMPRENSIBLE);
  }
  if (resultado.isError !== true && resultado.structuredContent) {
    return resultado.structuredContent;
  }
  return { content: resultado.content, isError: resultado.isError === true };
}

/**
 * Ejecuta una herramienta en el motor del dispositivo. Un fallo del motor o del servidor llega al asistente como error
 * de la herramienta; una ejecución cancelada rechaza con el motivo de su señal (WebMCP ya no espera su resultado).
 * @param {Transporte} transporte @param {string} nombre @param {unknown} entrada @param {AbortSignal | undefined} senal
 * @returns {Promise<unknown>}
 */
async function ejecutarEnElDispositivo(transporte, nombre, entrada, senal) {
  /** @type {Record<string, unknown>} */
  let resultado;
  try {
    resultado = await pedirAlMcp(transporte, 'tools/call', { name: nombre, arguments: entrada }, senal);
  } catch (error) {
    if (senal?.aborted) {
      throw senal.reason;
    }
    if (error instanceof FalloDelMcpLocal) {
      return errorParaElAsistente(error.message);
    }
    if (error instanceof TypeError) {
      return errorParaElAsistente(MOTOR_SIN_RESPUESTA);
    }
    throw error;
  }
  return respuestaParaElAsistente(resultado);
}

/**
 * Si una herramienta del servidor se puede ofrecer: la marca como de solo lectura y su nombre es de los que admite
 * WebMCP. Una herramienta nueva que escribiera algo no llegaría al asistente del navegador sin revisar este módulo.
 * @param {DefinicionMcp} definicion La herramienta tal como la lista el servidor (se usan `name` y `annotations`).
 * @returns {boolean} Si se puede ofrecer.
 */
function sePuedeOfrecer({ name, annotations }) {
  return annotations.readOnlyHint === true && NOMBRE_WEBMCP.test(name);
}

/**
 * La herramienta de WebMCP de una definición del servidor MCP, resuelta en el dispositivo. WebMCP no tiene las
 * anotaciones de MCP: la de solo lectura es común, y la de contenido no fiable (untrustedContentHint) corresponde a la
 * de MCP que dice que la herramienta consulta algo fuera de sus propios datos (openWorldHint).
 * @param {DefinicionMcp} definicion La herramienta tal como la lista el servidor.
 * @param {Transporte} transporte Cómo llega una petición al motor del dispositivo.
 * @returns {HerramientaWebMcp} La herramienta lista para registrar.
 */
function herramientaWebMcp({ name, title, description, inputSchema, annotations }, transporte) {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: annotations.openWorldHint === true },
    execute: (entrada, { signal }) => ejecutarEnElDispositivo(transporte, name, entrada, signal),
  };
}

/**
 * Si el valor es el contexto de modelo de WebMCP, con lo que este módulo usa de él.
 * @param {unknown} valor @returns {valor is ContextoDeModelo}
 */
function esContextoDeModelo(valor) {
  return (
    typeof valor === 'object' && valor !== null && 'registerTool' in valor && typeof valor.registerTool === 'function'
  );
}

/**
 * Registra en el contexto de modelo las herramientas de solo lectura del servidor MCP del dispositivo y devuelve sus
 * nombres. Todas o ninguna: cada registro lleva una señal propia (WebMCP, «ModelContextRegisterToolOptions») y, si
 * alguno se rechaza, se aborta y se retiran las ya registradas antes de rechazar. Con `senal`, cancelarla retira todas.
 * @param {ContextoDeModelo} contexto El contexto de modelo de la página.
 * @param {{ transporte?: Transporte, senal?: AbortSignal }} [opciones] El transporte al motor y la señal de retirada.
 * @returns {Promise<string[]>} Los nombres de las herramientas registradas.
 * @throws {FalloDelMcpLocal} Si la lista del servidor no se entiende; un registro rechazado rechaza con su motivo.
 */
export async function ofrecerHerramientas(contexto, { transporte = alMotorLocal, senal } = {}) {
  const lista = await pedirAlMcp(transporte, 'tools/list', {}, senal);
  senal?.throwIfAborted();
  if (!esListaMcp(lista)) {
    throw new FalloDelMcpLocal(LISTA_INCOMPRENSIBLE);
  }
  const ofrecidas = lista.tools.filter(sePuedeOfrecer).map((definicion) => herramientaWebMcp(definicion, transporte));
  const retirada = new AbortController();
  const alRetirar = () => retirada.abort(senal?.reason);
  senal?.addEventListener('abort', alRetirar, { once: true });
  const registros = await Promise.allSettled(
    ofrecidas.map((herramienta) => contexto.registerTool(herramienta, { signal: retirada.signal })),
  );
  const rechazado = registros.find((registro) => registro.status === 'rejected');
  if (rechazado) {
    retirada.abort(rechazado.reason);
    senal?.removeEventListener('abort', alRetirar);
    throw rechazado.reason;
  }
  senal?.throwIfAborted();
  return ofrecidas.map(({ name }) => name);
}

/**
 * El transporte de siempre al motor del dispositivo, que no espera a un service worker que no va a llegar: si la
 * instalación no coincide, falla en el acto (instalacion-que-no-coincide.js) y la página sigue sin herramientas.
 * @type {Transporte}
 */
function alMotorLocal(direccion, opciones) {
  return antesDeQueNoCoincida(pedirAlMotorLocal(direccion, opciones));
}

/**
 * El contexto de modelo de WebMCP de esta página, o null si el navegador no lo ofrece.
 * @returns {ContextoDeModelo | null}
 */
export function contextoDeLaPagina() {
  const documento = globalThis.document;
  if (!documento || !('modelContext' in documento)) {
    return null;
  }
  return esContextoDeModelo(documento.modelContext) ? documento.modelContext : null;
}

const contexto = contextoDeLaPagina();
// Un fallo (el motor sin su copia del paquete, un registro rechazado) deja la página sin herramientas para el
// asistente (ofrecerHerramientas retira las ya registradas): se anota en la consola y la página sigue igual. Por eso
// nadie espera esta promesa, que no rechaza.
if (contexto) {
  void ofrecerHerramientas(contexto).catch((error) => {
    console.warn('Faro: no se ofrecen herramientas al asistente del navegador.', error);
  });
}
