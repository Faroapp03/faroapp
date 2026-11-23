// Las consultas de la API para socios: GET /api/socios/v1/consultas/<herramienta>?<argumentos>, una por herramienta del
// servidor MCP (api/mcp/herramientas.ts), con su mismo esquema de entrada, la misma función y la misma respuesta
// (`structuredContent`: los datos con su procedencia y, en la ficha del grupo, la marca de lo escrito con IA). Una
// sola fuente: nada de lo que se consulta se define aquí. De solo lectura y sin llamadas a modelos. La búsqueda
// aplica la minimización compartida; su filtro no garantiza reconocer todos los datos personales.
// El token va en la cabecera Authorization (RFC 6750, 2.1), nunca en la dirección. Los errores son Problem Details
// (RFC 9457) y, si son del token, llevan el desafío de RFC 6750 (3). Ningún error repite texto libre del socio: dicen
// qué admite la consulta; lo único que pueden repetir es un código que ya ha pasado su patrón (cifras y puntos), como
// el de un grupo que no existe.

import { type Esquema, validar } from '../../comun/esquema.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import type { ContextoApi } from '../contexto-api.ts';
import { type MotivoDelProblema, problema, registrarErrorInterno, respuestaDeError } from '../errores.ts';
import { HERRAMIENTAS, llamarHerramientaConElMotor } from '../mcp/herramientas.ts';
import { AccesoPublicoNoDisponible, operacionPublica } from './acceso-publico.ts';
import {
  consumirConsulta,
  HORA_S,
  REINO,
  respuestaDeUnProblema,
  respuestaJson,
  type ServidorDeSocios,
  tokenVigente,
  transporteSeguro,
} from './servidor-socios.ts';
import { AMBITO_DE_LECTURA, type Reclamaciones } from './token-de-acceso.ts';

/** Un token Bearer en la cabecera (RFC 6750, 2.1): el esquema, sin distinguir mayúsculas, y el b64token. */
const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;
/** El desafío sin código de error: RFC 6750 (3.1) no lo pone cuando la petición no trae ningún token. */
const DESAFIO_BEARER = `Bearer realm="${REINO}"`;
/** Un entero en la dirección: lo que admite un argumento `integer` antes de pasar por su esquema. */
const ENTERO = /^\d{1,9}$/;

/** Una herramienta del servidor MCP. */
type Herramienta = (typeof HERRAMIENTAS)[number];
/** Los códigos de error de RFC 6750 (3.1) que lleva el desafío; null, ninguno. */
type CodigoBearer = 'invalid_request' | 'invalid_token' | 'insufficient_scope';

/** Un error de una consulta: su código HTTP, su problema y, si es del token, su código de RFC 6750. */
class ErrorDeConsulta extends Error {
  override readonly name = 'ErrorDeConsulta';
  readonly estado: number;
  readonly motivo: MotivoDelProblema;
  readonly codigo: CodigoBearer | null;

  constructor(estado: number, motivo: MotivoDelProblema, codigo: CodigoBearer | null, detalle: string) {
    super(detalle);
    this.estado = estado;
    this.motivo = motivo;
    this.codigo = codigo;
  }
}

/** Una consulta mal hecha (400): un argumento que no se admite, repetido o fuera de su esquema. */
function consultaMalHecha(detalle: string) {
  return new ErrorDeConsulta(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida', 'invalid_request', detalle);
}

/** El desafío WWW-Authenticate de un error del token (RFC 6750, 3), con el ámbito que falta si es eso. */
function desafioDe(codigo: CodigoBearer | null): string {
  if (codigo === null) {
    return DESAFIO_BEARER;
  }
  const ambito = codigo === 'insufficient_scope' ? `, scope="${AMBITO_DE_LECTURA}"` : '';
  return `${DESAFIO_BEARER}, error="${codigo}"${ambito}`;
}

/** La respuesta de un error: Problem Details y, si es del token (401 o 403), su desafío. */
function respuestaDeErrorDeConsulta(error: ErrorDeConsulta): Response {
  const cuerpo = problema(error.estado, error.motivo, error.message, error.codigo ? { error: error.codigo } : {});
  const delToken = error.estado === ESTADO_HTTP.noAutenticado || error.estado === ESTADO_HTTP.prohibido;
  return respuestaDeUnProblema(cuerpo, delToken ? { 'www-authenticate': desafioDe(error.codigo) } : {});
}

/** El socio del token de la petición, si el token sigue vivo y tiene el ámbito de lectura. */
async function socioDelToken(
  servidor: ServidorDeSocios,
  peticion: Request,
): Promise<Pick<Reclamaciones, 'client_id' | 'credencial'>> {
  const token = peticion.headers.get('authorization')?.match(BEARER)?.[1];
  if (!token) {
    const detalle = 'La consulta necesita un token de acceso en la cabecera Authorization.';
    throw new ErrorDeConsulta(ESTADO_HTTP.noAutenticado, 'token_ausente', null, detalle);
  }
  const reclamaciones = await tokenVigente(servidor, token, peticion);
  if (!reclamaciones) {
    const detalle = 'El token de acceso no es válido, ha caducado o se ha revocado: pide otro.';
    throw new ErrorDeConsulta(ESTADO_HTTP.noAutenticado, 'token_no_valido', 'invalid_token', detalle);
  }
  if (!reclamaciones.scope.split(' ').includes(AMBITO_DE_LECTURA)) {
    const detalle = `La consulta necesita el ámbito ${AMBITO_DE_LECTURA}.`;
    throw new ErrorDeConsulta(ESTADO_HTTP.prohibido, 'ambito_no_valido', 'insufficient_scope', detalle);
  }
  return { client_id: reclamaciones.client_id, credencial: reclamaciones.credencial };
}

/**
 * Los argumentos de la herramienta, de los parámetros de la dirección: cada uno una vez y solo los de su esquema; los
 * enteros, como números. Después los valida el esquema de la herramienta, con los nombres de la consulta.
 */
function argumentosDe(herramienta: Herramienta, url: URL): Record<string, unknown> {
  const propiedades = herramienta.inputSchema.properties ?? {};
  const admitidos = Object.keys(propiedades);
  const argumentos: Record<string, unknown> = {};
  for (const [nombre, valor] of url.searchParams) {
    if (!admitidos.includes(nombre)) {
      throw consultaMalHecha(`Esta consulta admite: ${admitidos.join(', ') || 'ningún parámetro'}.`);
    }
    if (Object.hasOwn(argumentos, nombre)) {
      throw consultaMalHecha('Cada parámetro va una sola vez.');
    }
    // admitidos procede de las claves de este mismo objeto, que no se modifica en el recorrido.
    const propiedad = propiedades[nombre] as Esquema;
    argumentos[nombre] = propiedad.type === 'integer' && ENTERO.test(valor) ? Number(valor) : valor;
  }
  const errores = validar(argumentos, herramienta.inputSchema, 'consulta');
  if (errores.length) {
    throw consultaMalHecha(`Entrada no válida: ${errores.join('; ')}`);
  }
  return argumentos;
}

/** Lo que responde la herramienta: sus datos (200) o, si no puede, su mensaje como consulta mal hecha (400). */
async function responderConsulta(
  contexto: ContextoApi,
  servidor: ServidorDeSocios,
  herramienta: Herramienta,
  url: URL,
): Promise<Response> {
  const ambito = {
    datos: contexto.datos,
    ...(contexto.datosGlobales !== undefined ? { datosGlobales: contexto.datosGlobales } : {}),
    politica: contexto.politica,
    hoy: servidor.hoy(),
    puertaDeCursos: contexto.motorDeCursos,
  };
  const resultado = await llamarHerramientaConElMotor(ambito, {
    name: herramienta.name,
    arguments: argumentosDe(herramienta, url),
  });
  if (resultado.isError) {
    throw consultaMalHecha(resultado.content[0]?.text ?? 'La consulta no se ha podido hacer.');
  }
  return respuestaJson(ESTADO_HTTP.correcto, resultado.structuredContent);
}

type IdentidadConsulta = Pick<Reclamaciones, 'client_id' | 'credencial'>;
async function autorizar(servidor: ServidorDeSocios, peticion: Request): Promise<IdentidadConsulta> {
  if (!transporteSeguro(peticion)) {
    throw consultaMalHecha('La API para socios solo atiende por HTTPS.');
  }
  return socioDelToken(servidor, peticion);
}
async function consultarAutorizada(
  contexto: ContextoApi,
  servidor: ServidorDeSocios,
  peticion: Request,
  { identidad, herramienta }: { identidad: IdentidadConsulta; herramienta: Herramienta | undefined },
): Promise<Response> {
  if (!(await consumirConsulta(servidor, identidad.client_id))) {
    const detalle = 'Este socio ha agotado sus consultas de la hora UTC actual.';
    return respuestaDeUnProblema(problema(ESTADO_HTTP.demasiadasPeticiones, 'demasiadas_peticiones', detalle), {
      'retry-after': String(HORA_S),
    });
  }
  if (!herramienta) {
    throw new ErrorDeConsulta(
      ESTADO_HTTP.noEncontrado,
      'ruta_desconocida',
      null,
      'La API para socios no tiene esa consulta.',
    );
  }
  return responderConsulta(contexto, servidor, herramienta, new URL(peticion.url));
}
function falloDeConsulta(error: unknown): Response | null {
  if (error instanceof AccesoPublicoNoDisponible) {
    return respuestaDeUnProblema(problema(ESTADO_HTTP.noDisponible, 'no_configurado', error.message));
  }
  return error instanceof ErrorDeConsulta ? respuestaDeErrorDeConsulta(error) : null;
}
async function anotarConsulta(
  servidor: ServidorDeSocios,
  identidad: IdentidadConsulta | null,
  herramienta: Herramienta | undefined,
  estadoHttp: number,
): Promise<boolean> {
  const accesos = servidor.accesos;
  if (!identidad) {
    return true;
  }
  try {
    await operacionPublica(() =>
      accesos.registrarAcceso({
        canal: 'api',
        institucionId: identidad.client_id,
        credencial: identidad.credencial,
        consulta: herramienta?.name ?? 'no_identificada',
        estadoHttp,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
function registroNoDisponible(): Response {
  return respuestaDeUnProblema(
    problema(ESTADO_HTTP.noDisponible, 'no_configurado', 'El registro operativo no está disponible.'),
  );
}
async function registrarFalloInesperado(
  servidor: ServidorDeSocios,
  peticion: Request,
  error: unknown,
  consulta: { identidad: IdentidadConsulta | null; herramienta: Herramienta | undefined },
): Promise<Response> {
  const estado = respuestaDeError(error).estado;
  if (await anotarConsulta(servidor, consulta.identidad, consulta.herramienta, estado)) {
    throw error;
  }
  if (estado === ESTADO_HTTP.errorInterno) {
    registrarErrorInterno(peticion, error);
  }
  return registroNoDisponible();
}
/** Transporte, token vivo, cuota y consulta; el registro guarda solo metadatos de la respuesta efectiva. */
export async function atenderConsulta(
  contexto: ContextoApi,
  servidor: ServidorDeSocios,
  peticion: Request,
  nombre: string,
): Promise<Response> {
  const herramienta = HERRAMIENTAS.find((una) => una.name === nombre);
  let identidad: IdentidadConsulta | null = null;
  let respuesta: Response;
  try {
    identidad = await autorizar(servidor, peticion);
    respuesta = await consultarAutorizada(contexto, servidor, peticion, { identidad, herramienta });
  } catch (error) {
    const conocida = falloDeConsulta(error);
    if (!conocida) {
      return registrarFalloInesperado(servidor, peticion, error, { identidad, herramienta });
    }
    respuesta = conocida;
  }
  if (!(await anotarConsulta(servidor, identidad, herramienta, respuesta.status))) {
    respuesta = registroNoDisponible();
  }
  return respuesta;
}
