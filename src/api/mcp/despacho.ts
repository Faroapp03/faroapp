// Qué hace el servidor MCP con cada petición JSON-RPC ya leída: de qué época es (la revisión vigente, sin estado, o una
// anterior, con saludo), si sus cabeceras dicen lo mismo que su cuerpo y qué método la atiende. Devuelve el estado HTTP
// y el cuerpo; el transporte (servidor-mcp.ts) los pone en la respuesta.

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { esObjeto } from '../../comun/json.ts';
import { MS_POR_MINUTO } from '../../comun/tiempo.ts';
import { VERSION_FARO } from '../../comun/version.ts';
import type { AmbitoConsulta } from './consultas.ts';
import { type FirmadorMcp, firmarResultado } from './firma-de-respuesta.ts';
import { definiciones, llamarHerramientaConElMotor } from './herramientas.ts';
import {
  CODIGO,
  ErrorMcp,
  type ErrorRpc,
  META,
  metaDe,
  type PeticionRpc,
  type RespuestaRpc,
  respuestaRpc,
  VERSION_MODERNA,
  VERSION_SIN_CABECERA,
  VERSIONES,
  VERSIONES_ANTERIORES,
  valorDeCabecera,
} from './protocolo.ts';
import { leerRecurso, listaDeRecursos } from './recursos.ts';

/** Estado HTTP y cuerpo JSON-RPC de la respuesta a una petición. */
export interface Respondido {
  estado: number;
  cuerpo: RespuestaRpc | ErrorRpc | null;
  cabeceras?: Record<string, string>;
}

export type AmbitoDespacho = AmbitoConsulta;

/** Época de una petición: la revisión vigente, sin saludo, o una anterior, que empieza con `initialize`. */
type Epoca = 'vigente' | 'anterior';

/** Quién responde, como lo pide la especificación en `serverInfo`. */
const SERVIDOR = { name: 'faro', title: 'Faro', version: VERSION_FARO };
/** Capacidades de la instantánea de configuración creada para esta API; no anuncia cambios dinámicos de sus listas. */
const CAPACIDADES = { tools: { listChanged: false }, resources: { listChanged: false } };
/** Los minutos que un cliente puede guardar las listas: una hora. */
const MINUTOS_DE_CACHE = 60;
/** Las listas describen la instantánea de configuración de esta API; un cliente puede guardarlas una hora. */
const CACHE = { ttlMs: MINUTOS_DE_CACHE * MS_POR_MINUTO, cacheScope: 'public' } as const;
/** Lo que un asistente debe saber para usar bien el servidor. */
const INSTRUCCIONES =
  'Datos comprobados de Faro sobre el trabajo y la IA generativa en Cataluña. De solo lectura y sin llamadas a modelos durante la consulta. Antes de buscar, Faro retira los datos personales que reconoce su filtro. No envíes datos personales en las consultas. Busca la ocupación con buscar_ocupacion y confirma el grupo con la persona antes de usar ficha_grupo, formacion_oficial, acreditacion_competencias o contexto_del_grupo. Cita la procedencia de cada respuesta y distingue lo oficial de lo elaborado por Faro. Es orientación, no una decisión sobre nadie.';

/** Los métodos que repiten en `Mcp-Name` un valor de sus parámetros, y cuál. */
const NOMBRE_EN_CABECERA = new Map<string, (parametros: Record<string, unknown>) => unknown>([
  ['tools/call', (parametros) => parametros.name],
  ['resources/read', (parametros) => parametros.uri],
]);

/** Las cabeceras que repiten el cuerpo y tienen que coincidir con él (revisión vigente, «Server Validation»). */
function comprobarCabeceras(cabeceras: Headers, { metodo, parametros }: PeticionRpc): void {
  const metodoDeCabecera = cabeceras.get('mcp-method');
  if (metodoDeCabecera !== metodo) {
    throw new ErrorMcp(
      CODIGO.cabeceras,
      'Header mismatch: Mcp-Method no coincide con el cuerpo',
      ESTADO_HTTP.solicitudIncorrecta,
    );
  }
  const nombre = NOMBRE_EN_CABECERA.get(metodo)?.(parametros);
  if (nombre === undefined) {
    return;
  }
  const crudo = cabeceras.get('mcp-name');
  if (crudo === null || valorDeCabecera(crudo) !== nombre) {
    throw new ErrorMcp(
      CODIGO.cabeceras,
      'Header mismatch: Mcp-Name no coincide con el cuerpo',
      ESTADO_HTTP.solicitudIncorrecta,
    );
  }
}

/** Una versión que no se atiende: la especificación pide decir cuáles sí. */
function versionNoAdmitida() {
  return new ErrorMcp(CODIGO.version, 'Unsupported protocol version', ESTADO_HTTP.solicitudIncorrecta, {
    supported: VERSIONES,
  });
}

/**
 * La época de la petición. `initialize` es siempre de una revisión anterior. Con versión en `_meta`, la vigente: la
 * cabecera MCP-Protocol-Version tiene que decir lo mismo y `_meta` traer las capacidades del cliente. Sin ella, una
 * revisión anterior, con la versión en la cabecera (o, sin cabecera, 2025-03-26).
 */
function epocaDe(cabeceras: Headers, peticion: PeticionRpc): Epoca {
  if (peticion.metodo === 'initialize') {
    return 'anterior';
  }
  const meta = metaDe(peticion.parametros);
  const pedida = meta[META.version];
  const deCabecera = cabeceras.get('mcp-protocol-version');
  if (pedida === undefined) {
    if (deCabecera === VERSION_MODERNA) {
      throw new ErrorMcp(CODIGO.parametros, `Falta ${META.version} en _meta`, ESTADO_HTTP.solicitudIncorrecta);
    }
    const anterior = deCabecera ?? VERSION_SIN_CABECERA;
    const anteriores: readonly string[] = VERSIONES_ANTERIORES;
    if (!anteriores.includes(anterior)) {
      throw versionNoAdmitida();
    }
    return 'anterior';
  }
  if (deCabecera !== pedida) {
    throw new ErrorMcp(
      CODIGO.cabeceras,
      'Header mismatch: MCP-Protocol-Version no coincide con _meta',
      ESTADO_HTTP.solicitudIncorrecta,
    );
  }
  if (pedida !== VERSION_MODERNA) {
    throw versionNoAdmitida();
  }
  const capacidades = meta[META.capacidades];
  if (!esObjeto(capacidades)) {
    throw new ErrorMcp(CODIGO.parametros, `Falta ${META.capacidades} en _meta`, ESTADO_HTTP.solicitudIncorrecta);
  }
  comprobarCabeceras(cabeceras, peticion);
  return 'vigente';
}

/** Las listas son de una sola página: un cursor no puede venir de este servidor. */
function sinCursor(parametros: Record<string, unknown>): void {
  if (parametros.cursor !== undefined) {
    throw new ErrorMcp(CODIGO.parametros, 'Cursor no válido');
  }
}

/** El saludo de las revisiones anteriores: se acepta la versión pedida si se atiende; si no, se propone la última. */
function saludo(parametros: Record<string, unknown>, instrucciones = INSTRUCCIONES) {
  const pedida = parametros.protocolVersion;
  const anteriores: readonly string[] = VERSIONES_ANTERIORES;
  const version = typeof pedida === 'string' && anteriores.includes(pedida) ? pedida : VERSIONES_ANTERIORES[0];
  return { protocolVersion: version, capabilities: CAPACIDADES, serverInfo: SERVIDOR, instructions: instrucciones };
}

/** Lo que responde cada método de cada época, o undefined si no lo tiene; `cacheable`, si lleva ttlMs y cacheScope. */
async function resultadoDe(ambito: AmbitoDespacho, epoca: Epoca, { metodo, parametros }: PeticionRpc) {
  const instrucciones = INSTRUCCIONES;
  switch (metodo) {
    case 'tools/list':
      sinCursor(parametros);
      return {
        cacheable: true,
        resultado: {
          tools: definiciones(),
        },
      };
    case 'tools/call':
      return {
        cacheable: false,
        resultado: await llamarHerramientaConElMotor(ambito, parametros),
      };
    case 'resources/list':
      sinCursor(parametros);
      return { cacheable: true, resultado: { resources: listaDeRecursos() } };
    case 'resources/read':
      return { cacheable: true, resultado: leerRecurso(parametros) };
  }
  if (epoca === 'vigente' && metodo === 'server/discover') {
    const descubrir = { supportedVersions: VERSIONES, capabilities: CAPACIDADES, instructions: instrucciones };
    return { cacheable: true, resultado: descubrir };
  }
  if (epoca === 'anterior' && metodo === 'initialize') {
    return { cacheable: false, resultado: saludo(parametros, instrucciones) };
  }
  if (epoca === 'anterior' && metodo === 'ping') {
    return { cacheable: false, resultado: {} };
  }
  return undefined;
}

/**
 * Atiende una petición JSON-RPC. En la revisión vigente, cada resultado lleva `resultType` y quién responde, y las
 * listas, cuánto pueden guardarse; un método que no existe es 404. En las anteriores, el resultado va tal cual y un
 * método que no existe es 200 con su error: para ellas, 404 significaría que la sesión ha caducado. Con firmador,
 * cada resultado de las dos épocas lleva su firma híbrida en `_meta` (firma-de-respuesta.ts).
 *
 * @param ambito - El ámbito de las consultas.
 * @param cabeceras - Las cabeceras de la petición.
 * @param peticion - La petición JSON-RPC ya leída.
 * @param firmador - Quien firma las respuestas; null si no se firman.
 * @returns Lo respondido: el estado HTTP y el mensaje.
 * @throws {Error} ErrorMcp si las cabeceras y el cuerpo no coinciden, falta la versión o el método no existe.
 */
export async function despachar(
  ambito: AmbitoDespacho,
  cabeceras: Headers,
  peticion: PeticionRpc,
  firmador: FirmadorMcp | null = null,
): Promise<Respondido> {
  const epoca = epocaDe(cabeceras, peticion);
  const atendido = await resultadoDe(ambito, epoca, peticion);
  if (!atendido) {
    throw new ErrorMcp(
      CODIGO.metodo,
      'Method not found',
      epoca === 'vigente' ? ESTADO_HTTP.noEncontrado : ESTADO_HTTP.correcto,
    );
  }
  const resultado: Record<string, unknown> =
    epoca === 'anterior'
      ? { ...atendido.resultado }
      : {
          resultType: 'complete',
          ...atendido.resultado,
          ...(atendido.cacheable ? CACHE : {}),
          _meta: { [META.servidor]: SERVIDOR },
        };
  const cuerpo = firmador ? await firmarResultado(resultado, firmador) : resultado;
  return { estado: 200, cuerpo: respuestaRpc(peticion.id, cuerpo) };
}
