// Operaciones REST para socios descritas desde los mismos metadatos y esquemas que MCP.

import { HERRAMIENTAS } from '../../src/api/mcp/definiciones.ts';
import {
  AMBITO_DE_LECTURA,
  RUTA_ACTIVAR_INVITACION,
  RUTA_CONSULTAR_INVITACION,
  RUTA_CONSULTAS,
  RUTA_INTROSPECCION,
  RUTA_REVOCAR,
  RUTA_TOKEN,
  TIPO_DE_TOKEN,
  VIDA_DEL_TOKEN_S,
} from '../../src/api/socios/metadatos.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { RUTAS_DE_INVITACION } from './openapi-invitaciones.ts';

const SEGUNDOS_POR_MINUTO = 60;
const MAX_ESTADO_DE_CLIENTE = 499;

type Objeto = Record<string, unknown>;

/** La etiqueta que agrupa las operaciones de la API para socios: quien solo prueba la API de la web la puede dejar. */
const ETIQUETA = 'socios';
const FORMULARIO = 'application/x-www-form-urlencoded';
const PROBLEMA = { $ref: '#/components/responses/Problema' };
const CON_REINTENTO = { $ref: '#/components/responses/ProblemaConReintento' };
/** El error de OAuth (RFC 6749, 5.2): application/json, con el código en `error` y los miembros de RFC 9457. */
const ERROR_DE_OAUTH = {
  description: 'Error de OAuth 2.0 (RFC 6749, 5.2), con los miembros de Problem Details (RFC 9457)',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorDeOAuth' } } },
};
/** El 401 de los puntos de OAuth, con el desafío Basic. */
const SIN_CREDENCIALES = {
  ...ERROR_DE_OAUTH,
  headers: { 'www-authenticate': { description: 'Basic realm="faro-socios"', schema: { type: 'string' } } },
};
/** El 401 y el 403 de las consultas, con el desafío Bearer (RFC 6750, 3). */
const DESAFIO_BEARER = {
  description: 'Token ausente, no válido (401) o sin el ámbito (403): desafío Bearer de RFC 6750, 3',
  headers: { 'www-authenticate': { description: 'Bearer realm="faro-socios"…', schema: { type: 'string' } } },
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problema' } } },
};
/** El cuerpo de la revocación y de la introspección: el token y, si se quiere, su pista. */
const CON_TOKEN = {
  type: 'object',
  required: ['token'],
  properties: { token: { type: 'string' }, token_type_hint: { type: 'string' } },
};

/** Una operación con credenciales del socio (HTTP Basic) y cuerpo de formulario; `otras`, sus respuestas propias. */
function operacionDeOAuth(resumen: string, cuerpo: Objeto, correcta: Objeto, otras: Objeto = {}): Objeto {
  return {
    tags: [ETIQUETA],
    summary: resumen,
    security: [{ credencialesDeSocio: [] }],
    requestBody: { required: true, content: { [FORMULARIO]: { schema: cuerpo } } },
    responses: {
      200: correcta,
      400: ERROR_DE_OAUTH,
      401: SIN_CREDENCIALES,
      405: PROBLEMA,
      429: CON_REINTENTO,
      ...otras,
    },
  };
}

/** La consulta de una herramienta: sus argumentos, como parámetros de la dirección con su esquema. */
function operacionDeConsulta({ title, description, inputSchema, outputSchema }: (typeof HERRAMIENTAS)[number]): Objeto {
  const requeridos = inputSchema.required ?? [];
  const parametros = Object.entries(inputSchema.properties ?? {}).map(([nombre, esquema]) => ({
    name: nombre,
    in: 'query',
    required: requeridos.includes(nombre),
    schema: esquema,
  }));
  const datos = outputSchema ?? {
    type: 'object',
    required: ['procedencia'],
    properties: { procedencia: { type: 'object' } },
  };
  return {
    tags: [ETIQUETA],
    summary: title,
    description,
    parameters: parametros,
    security: [{ socios: [AMBITO_DE_LECTURA] }],
    responses: {
      200: { description: 'Los datos con su procedencia', content: { 'application/json': { schema: datos } } },
      400: PROBLEMA,
      401: DESAFIO_BEARER,
      403: DESAFIO_BEARER,
      405: PROBLEMA,
      429: CON_REINTENTO,
    },
  };
}

/** Las operaciones de la API para socios: su método y su camino, sin plantillas, para comprobarlas contra la API. */
export const OPERACIONES_DE_SOCIOS: readonly { metodo: 'GET' | 'POST'; ruta: string }[] = [
  { metodo: 'POST', ruta: RUTA_TOKEN },
  { metodo: 'POST', ruta: RUTA_CONSULTAR_INVITACION },
  { metodo: 'POST', ruta: RUTA_ACTIVAR_INVITACION },
  { metodo: 'POST', ruta: RUTA_REVOCAR },
  { metodo: 'POST', ruta: RUTA_INTROSPECCION },
  ...HERRAMIENTAS.map(({ name }) => ({ metodo: 'GET' as const, ruta: `${RUTA_CONSULTAS}/${name}` })),
];

const TOKEN = {
  type: 'object',
  required: ['access_token', 'token_type', 'expires_in', 'scope'],
  properties: {
    access_token: { type: 'string', description: 'JWT de acceso (RFC 9068); para el socio, opaco.' },
    token_type: { const: TIPO_DE_TOKEN },
    expires_in: { const: VIDA_DEL_TOKEN_S },
    scope: { enum: [AMBITO_DE_LECTURA] },
  },
};
const PEDIR_TOKEN = {
  type: 'object',
  required: ['grant_type'],
  properties: {
    grant_type: { const: 'client_credentials' },
    scope: {
      enum: [AMBITO_DE_LECTURA],
      description: 'Sin scope, faro.lectura. Solo se ofrecen consultas factuales.',
    },
    resource: {
      type: 'string',
      format: 'uri',
      description: 'Audiencia exacta del mismo origen: /api/socios/v1/consultas. Si se envía, se comprueba.',
    },
  },
};

/**
 * Las rutas de la API para socios en la forma de OpenAPI (`paths`).
 *
 * @returns Las rutas, por su dirección.
 */
export function rutasDeSocios(): Record<string, Objeto> {
  const introspeccion = { type: 'object', required: ['active'], properties: { active: { type: 'boolean' } } };
  const rutas: Record<string, Objeto> = {
    ...RUTAS_DE_INVITACION,
    [RUTA_TOKEN]: {
      post: operacionDeOAuth('Un token de acceso con las credenciales del socio (RFC 6749, 4.4)', PEDIR_TOKEN, {
        description: 'El token de acceso',
        content: { 'application/json': { schema: TOKEN } },
      }),
    },
    [RUTA_REVOCAR]: {
      post: operacionDeOAuth(
        'Revoca un token del socio (RFC 7009)',
        CON_TOKEN,
        { description: 'Revocado, o no era un token válido' },
        { 503: CON_REINTENTO },
      ),
    },
    [RUTA_INTROSPECCION]: {
      post: operacionDeOAuth('Si un token del socio sigue vivo (RFC 7662)', CON_TOKEN, {
        description: 'El estado del token',
        content: { 'application/json': { schema: introspeccion } },
      }),
    },
  };
  for (const herramienta of HERRAMIENTAS) {
    rutas[`${RUTA_CONSULTAS}/${herramienta.name}`] = { get: operacionDeConsulta(herramienta) };
  }
  return rutas;
}

/** Los esquemas de seguridad de la API para socios: Basic en los puntos de OAuth y OAuth 2.0 en las consultas. */
export const SEGURIDAD_DE_SOCIOS: Objeto = {
  credencialesDeSocio: {
    type: 'http',
    scheme: 'basic',
    description: 'El identificador y el secreto del socio (RFC 6749, 2.3.1), solo en los puntos de OAuth.',
  },
  socios: {
    type: 'oauth2',
    description: `Token de acceso de ${VIDA_DEL_TOKEN_S / SEGUNDOS_POR_MINUTO} minutos, en la cabecera Authorization: Bearer.`,
    flows: {
      clientCredentials: {
        tokenUrl: RUTA_TOKEN,
        scopes: {
          [AMBITO_DE_LECTURA]: 'Leer datos públicos de ocupaciones, formación y contexto laboral',
        },
      },
    },
  },
};

/** El esquema del error de OAuth: los miembros de un problema (RFC 9457) y el código de RFC 6749 en `error`. */
export const ESQUEMA_ERROR_DE_OAUTH: Objeto = {
  type: 'object',
  description: 'Error de OAuth 2.0 (RFC 6749, 5.2) con los miembros de Problem Details (RFC 9457).',
  required: ['error', 'type', 'title', 'status', 'detail'],
  properties: {
    error: {
      enum: ['invalid_request', 'invalid_client', 'unsupported_grant_type', 'invalid_scope', 'unauthorized_client'],
    },
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer', minimum: ESTADO_HTTP.solicitudIncorrecta, maximum: MAX_ESTADO_DE_CLIENTE },
    detail: { type: 'string' },
  },
};
