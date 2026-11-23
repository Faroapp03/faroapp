// Los tres puntos de OAuth 2.0 de la API para socios, todos con el socio autenticado por HTTP Basic (RFC 6749, 2.3.1)
// y el cuerpo en application/x-www-form-urlencoded:
// - token: credenciales del cliente (RFC 6749, 4.4) a cambio de un token de acceso (token-de-acceso.ts, VIDA_DEL_TOKEN_S);
// - revocar: el socio anula uno de sus tokens (RFC 7009);
// - introspeccion: el socio pregunta si uno de sus tokens sigue vivo (RFC 7662).
// Los errores 400 y 401 son los de RFC 6749 (5.2): application/json con el código en `error`, y con los miembros de
// Problem Details (RFC 9457) para que el detalle se lea como en el resto de la API. No llevan `error_description`, que
// solo admite ASCII: el detalle en castellano va en `detail`. Las credenciales en el cuerpo (client_secret) no se
// admiten: RFC 6749 las desaconseja y solo las permite a quien no puede usar Basic, que no es el caso de un servidor.

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { cabecerasDeDesafio } from '../../seguridad/desafio-http.ts';
import { type ContextoApi, redDe } from '../contexto-api.ts';
import { leerTextoLimitado } from '../cuerpo.ts';
import { type MotivoDelProblema, problema, SolicitudInvalida, TIPO_JSON } from '../errores.ts';
import { AccesoPublicoNoDisponible } from './acceso-publico.ts';
import { autenticarSocio, type SocioAutenticado } from './registro.ts';
import { RevocacionesLlenas } from './revocaciones.ts';
import {
  buscarSocio,
  consumirCredencialGlobal,
  consumirToken,
  destinoDe,
  HORA_S,
  REINO,
  respuestaDeUnProblema,
  respuestaJson,
  type ServidorDeSocios,
  tokenVigente,
  transporteSeguro,
} from './servidor-socios.ts';
import {
  AMBITO_DE_LECTURA,
  type Destino,
  type Reclamaciones,
  TIPO_DE_TOKEN,
  VIDA_DEL_TOKEN_S,
} from './token-de-acceso.ts';

/** El tipo del cuerpo de los tres puntos (RFC 6749, 4.4.2; RFC 7009, 2.1; RFC 7662, 2.1). */
const TIPO_FORMULARIO = 'application/x-www-form-urlencoded';
/** La única concesión que se atiende. */
const CREDENCIALES_DEL_CLIENTE = 'client_credentials';
/** El desafío de un 401: Basic, con el juego de caracteres de RFC 7617 (2.1). */
const DESAFIO_BASIC = `Basic realm="${REINO}", charset="UTF-8"`;
/** Credenciales Basic: el esquema (sin distinguir mayúsculas, RFC 9110, 11.1) y base64 estándar. */
const BASIC = /^Basic +([A-Za-z0-9+/]+={0,2})$/i;
/** Lo más largo que puede ser un secreto presentado: los de Faro miden 43 caracteres; lo demás no se calcula. */
const MAX_SECRETO_CARACTERES = 256;
/** Segundos tras los que repetir una revocación que no ha cabido: para entonces, los tokens recordados han caducado. */
const REINTENTO_DE_REVOCACION_S = VIDA_DEL_TOKEN_S;

/** Lee como texto las credenciales de la cabecera Basic; un byte que no es UTF-8 lanza en vez de sustituirse. */
const descodificador = new TextDecoder('utf-8', { fatal: true });

/** Lo que hace cada punto con el formulario, una vez autenticado el socio. */
type Atencion = (formulario: ReadonlyMap<string, string>, autenticado: SocioAutenticado) => Promise<Response>;

/** Un error de OAuth: su código HTTP, su problema y su código de RFC 6749 (5.2) o RFC 7009 (2.2.1). */
class ErrorDeOAuth extends Error {
  override readonly name = 'ErrorDeOAuth';
  readonly estado: number;
  readonly motivo: MotivoDelProblema;
  readonly codigo: string;

  constructor(estado: number, motivo: MotivoDelProblema, codigo: string, detalle: string) {
    super(detalle);
    this.estado = estado;
    this.motivo = motivo;
    this.codigo = codigo;
  }
}

/** invalid_request: falta un parámetro, se repite o la petición está mal hecha. */
function peticionMalHecha(detalle: string) {
  return new ErrorDeOAuth(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida', 'invalid_request', detalle);
}
/** invalid_client: sin credenciales, con un método que no se admite o con unas que no son de ningún socio. */
function sinCredencialesValidas() {
  return new ErrorDeOAuth(
    ESTADO_HTTP.noAutenticado,
    'credenciales_no_validas',
    'invalid_client',
    'Las credenciales del socio no son válidas.',
  );
}

/** La respuesta de un error de OAuth: application/json (RFC 6749, 5.2) y, si es un 401, el desafío Basic. */
function respuestaDeErrorDeOAuth(error: ErrorDeOAuth): Response {
  const cuerpo = problema(error.estado, error.motivo, error.message, { error: error.codigo });
  return respuestaDeUnProblema(cuerpo, cabecerasDeDesafio(error.estado, DESAFIO_BASIC), TIPO_JSON);
}

/** Un texto con la codificación de un formulario (RFC 6749, apéndice B), o null si no se puede descodificar. */
function deFormulario(texto: string): string | null {
  try {
    return decodeURIComponent(texto.replaceAll('+', ' '));
  } catch (error) {
    // Un «%» sin dos cifras hexadecimales detrás (URIError): no son unas credenciales que se puedan comparar.
    if (!(error instanceof URIError)) {
      throw error;
    }
    return null;
  }
}

/** El socio y el secreto de la cabecera Authorization: Basic (RFC 6749, 2.3.1), o null si no los trae bien. */
function credencialesBasic(cabecera: string | null): { id: string; secreto: string } | null {
  const codificadas = cabecera?.match(BASIC)?.[1];
  if (!codificadas) {
    return null;
  }
  let texto: string;
  try {
    texto = descodificador.decode(Uint8Array.from(atob(codificadas), (letra) => letra.charCodeAt(0)));
  } catch (error) {
    // Base64 de longitud imposible (DOMException de atob) o bytes que no son UTF-8 (TypeError del descodificador
    // estricto): no hay credenciales que leer.
    if (!(error instanceof DOMException || error instanceof TypeError)) {
      throw error;
    }
    return null;
  }
  const separador = texto.indexOf(':');
  if (separador < 0) {
    return null;
  }
  const id = deFormulario(texto.slice(0, separador));
  const secreto = deFormulario(texto.slice(separador + 1));
  if (id === null || secreto === null || secreto.length > MAX_SECRETO_CARACTERES) {
    return null;
  }
  return { id, secreto };
}

/** El formulario del cuerpo, con cada parámetro una sola vez (RFC 6749, 3.2). */
async function leerFormulario(peticion: Request): Promise<ReadonlyMap<string, string>> {
  // split devuelve al menos un segmento, también para la cadena vacía.
  const primero = (peticion.headers.get('content-type') ?? '').split(';')[0] as string;
  const tipo = primero.trim().toLowerCase();
  if (tipo !== TIPO_FORMULARIO) {
    throw peticionMalHecha(`El cuerpo debe enviarse como ${TIPO_FORMULARIO}.`);
  }
  let texto: string;
  try {
    texto = await leerTextoLimitado(peticion);
  } catch (error) {
    if (error instanceof SolicitudInvalida) {
      throw peticionMalHecha('La petición es demasiado grande.');
    }
    throw error;
  }
  const formulario = new Map<string, string>();
  for (const [nombre, valor] of new URLSearchParams(texto)) {
    if (formulario.has(nombre)) {
      throw peticionMalHecha('Cada parámetro va una sola vez.');
    }
    formulario.set(nombre, valor);
  }
  return formulario;
}

/**
 * El socio de la petición. Las credenciales van solo en la cabecera: con client_secret en el cuerpo también, son dos
 * métodos a la vez (invalid_request, RFC 6749, 2.3); solo en el cuerpo, un método que no se admite (invalid_client).
 */
async function autenticar(
  servidor: ServidorDeSocios,
  peticion: Request,
  formulario: ReadonlyMap<string, string>,
): Promise<SocioAutenticado> {
  const cabecera = peticion.headers.get('authorization');
  if (formulario.has('client_secret') && cabecera !== null) {
    throw peticionMalHecha('Las credenciales van solo en la cabecera Authorization.');
  }
  const credenciales = credencialesBasic(cabecera);
  if (!credenciales) {
    throw sinCredencialesValidas();
  }
  const idDelCuerpo = formulario.get('client_id');
  if (idDelCuerpo !== undefined && idDelCuerpo !== credenciales.id) {
    throw peticionMalHecha('El client_id del cuerpo no es el de la cabecera Authorization.');
  }
  const socio = await buscarSocio(servidor, credenciales.id);
  const autenticado = autenticarSocio(socio, credenciales.secreto);
  if (!autenticado) {
    throw sinCredencialesValidas();
  }
  return autenticado;
}

/** El 429 de las peticiones con credenciales, por la red o por el tope global. */
function demasiadasPeticionesConCredenciales(): Response {
  return respuestaDeUnProblema(
    problema(
      ESTADO_HTTP.demasiadasPeticiones,
      'demasiadas_peticiones',
      'Demasiadas peticiones con credenciales. Vuelve a intentarlo más tarde.',
    ),
  );
}

/**
 * Lo común de los tres puntos: transporte cifrado, límite de la red, formulario y socio, y el tope global solo con el
 * socio ya autenticado; después, lo de cada uno. Un error de OAuth se responde aquí; cualquier otro sigue hacia la API,
 * que lo traduce (errores.ts).
 */
async function conOAuth(
  contexto: ContextoApi,
  servidor: ServidorDeSocios,
  peticion: Request,
  atencion: Atencion,
): Promise<Response> {
  try {
    if (!transporteSeguro(peticion)) {
      throw peticionMalHecha('La API institucional solo atiende por HTTPS.');
    }
    if (!(await servidor.limites.credencialesPorRed(redDe(contexto, peticion)))) {
      return demasiadasPeticionesConCredenciales();
    }
    const formulario = await leerFormulario(peticion);
    const autenticado = await autenticar(servidor, peticion, formulario);
    if (!(await consumirCredencialGlobal(servidor))) {
      return demasiadasPeticionesConCredenciales();
    }
    return await atencion(formulario, autenticado);
  } catch (error) {
    if (error instanceof AccesoPublicoNoDisponible) {
      return respuestaDeUnProblema(problema(ESTADO_HTTP.noDisponible, 'no_configurado', error.message));
    }
    if (error instanceof ErrorDeOAuth) {
      return respuestaDeErrorDeOAuth(error);
    }
    throw error;
  }
}

/** Concesión de credenciales del cliente; el ámbito se comprueba después contra su registro. */
function comprobarConcesion(formulario: ReadonlyMap<string, string>): void {
  const concesion = formulario.get('grant_type');
  if (concesion === undefined) {
    throw peticionMalHecha('Falta grant_type.');
  }
  if (concesion !== CREDENCIALES_DEL_CLIENTE) {
    const detalle = `Esta API solo admite grant_type=${CREDENCIALES_DEL_CLIENTE}.`;
    throw new ErrorDeOAuth(ESTADO_HTTP.solicitudIncorrecta, 'concesion_no_admitida', 'unsupported_grant_type', detalle);
  }
}

/** Un único ámbito de lectura y su audiencia operativa exacta. */
function destinoSolicitado(
  formulario: ReadonlyMap<string, string>,
  peticion: Request,
): { destino: Destino; ambito: string } {
  const pedido = formulario.get('scope') ?? AMBITO_DE_LECTURA;
  const ambito = pedido.split(' ').every((valor) => valor === AMBITO_DE_LECTURA) ? AMBITO_DE_LECTURA : pedido;
  if (ambito !== AMBITO_DE_LECTURA) {
    throw new ErrorDeOAuth(
      ESTADO_HTTP.solicitudIncorrecta,
      'ambito_no_valido',
      'invalid_scope',
      'El ámbito solicitado no está concedido al cliente.',
    );
  }
  const destino = destinoDe(peticion);
  const recurso = formulario.get('resource');
  if (recurso !== undefined && recurso !== destino.audiencia) {
    throw peticionMalHecha('El recurso no corresponde al ámbito solicitado.');
  }
  return { destino, ambito };
}

/** Revocación e introspección reconocen únicamente tokens para las consultas de lectura. */
async function tokenConocido(
  servidor: ServidorDeSocios,
  token: string,
  peticion: Request,
  vigente: boolean,
): Promise<Reclamaciones | null> {
  return vigente ? tokenVigente(servidor, token, peticion) : servidor.emisor.comprobar(token, destinoDe(peticion));
}

/** El token que pide el formulario de una revocación o una introspección. */
function tokenDelFormulario(formulario: ReadonlyMap<string, string>): string {
  const token = formulario.get('token');
  if (!token) {
    throw peticionMalHecha('Falta token.');
  }
  return token;
}

/**
 * POST token: un token de acceso para el socio, si no ha agotado los de esta hora.
 *
 * @param contexto - El contexto de la API.
 * @param servidor - La API para socios.
 * @param peticion - La petición POST.
 * @returns La respuesta con el token de acceso, o un problema.
 */
export function atenderToken(contexto: ContextoApi, servidor: ServidorDeSocios, peticion: Request): Promise<Response> {
  return conOAuth(contexto, servidor, peticion, async (formulario, autenticado) => {
    comprobarConcesion(formulario);
    const { destino, ambito } = destinoSolicitado(formulario, peticion);
    if (!(await consumirToken(servidor, autenticado.socio.id))) {
      const detalle = 'Esta institución ha pedido demasiados tokens en la hora UTC actual: reutiliza el que tiene.';
      return respuestaDeUnProblema(problema(ESTADO_HTTP.demasiadasPeticiones, 'demasiadas_peticiones', detalle), {
        'retry-after': String(HORA_S),
      });
    }
    const { token, reclamaciones } = await servidor.emisor.emitir(autenticado, destino, ambito);
    return respuestaJson(ESTADO_HTTP.correcto, {
      access_token: token,
      token_type: TIPO_DE_TOKEN,
      expires_in: VIDA_DEL_TOKEN_S,
      scope: reclamaciones.scope,
    });
  });
}

/**
 * POST revocar (RFC 7009, 2.1 y 2.2): 200 sin cuerpo si el token queda revocado o si no es un token válido; un token
 * de otro socio se rechaza. La pista token_type_hint se ignora: Faro solo emite tokens de acceso.
 *
 * @param contexto - El contexto de la API.
 * @param servidor - La API para socios.
 * @param peticion - La petición POST.
 * @returns La respuesta: 200 sin cuerpo o un problema.
 */
export function atenderRevocacion(
  contexto: ContextoApi,
  servidor: ServidorDeSocios,
  peticion: Request,
): Promise<Response> {
  return conOAuth(contexto, servidor, peticion, async (formulario, autenticado) => {
    const reclamaciones = await tokenConocido(servidor, tokenDelFormulario(formulario), peticion, false);
    if (!reclamaciones) {
      return respuestaJson(ESTADO_HTTP.correcto, null);
    }
    if (reclamaciones.client_id !== autenticado.socio.id) {
      throw new ErrorDeOAuth(
        ESTADO_HTTP.solicitudIncorrecta,
        'token_de_otro_socio',
        'unauthorized_client',
        'Ese token es de otro socio.',
      );
    }
    try {
      await servidor.revocaciones.revocar(reclamaciones.jti, reclamaciones.exp);
    } catch (error) {
      if (!(error instanceof RevocacionesLlenas)) {
        throw error;
      }
      const detalle = 'No se ha podido revocar el token: sigue vivo. Vuelve a intentarlo más tarde.';
      const reintento = { 'retry-after': String(REINTENTO_DE_REVOCACION_S) };
      return respuestaDeUnProblema(problema(ESTADO_HTTP.noDisponible, 'revocacion_no_disponible', detalle), reintento);
    }
    return respuestaJson(ESTADO_HTTP.correcto, null);
  });
}

/**
 * POST introspeccion (RFC 7662, 2.2): si el token sigue vivo, sus datos; si no, o si es de otro socio, solo `active:
 * false` (RFC 7662, 2.3: un token que quien pregunta no puede conocer no es un error).
 *
 * @param contexto - El contexto de la API.
 * @param servidor - La API para socios.
 * @param peticion - La petición POST.
 * @returns La respuesta con los datos del token o `active: false`.
 */
export function atenderIntrospeccion(
  contexto: ContextoApi,
  servidor: ServidorDeSocios,
  peticion: Request,
): Promise<Response> {
  return conOAuth(contexto, servidor, peticion, async (formulario, autenticado) => {
    const reclamaciones = await tokenConocido(servidor, tokenDelFormulario(formulario), peticion, true);
    if (!reclamaciones || reclamaciones.client_id !== autenticado.socio.id) {
      return respuestaJson(ESTADO_HTTP.correcto, { active: false });
    }
    const { credencial: _interna, ...publicas } = reclamaciones;
    return respuestaJson(ESTADO_HTTP.correcto, { active: true, token_type: TIPO_DE_TOKEN, ...publicas });
  });
}
