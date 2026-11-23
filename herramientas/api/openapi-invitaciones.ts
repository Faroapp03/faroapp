/** Activación de instituciones invitadas: el secreto se recibe solo por POST y nunca se recupera. */
import {
  RUTA_ACTIVAR_INVITACION,
  RUTA_CONSULTAR_INVITACION,
  RUTA_TOKEN,
  TIPO_DE_TOKEN,
} from '../../src/api/socios/metadatos.ts';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const SECRETO = '[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]';
const CLIENTE = { type: 'string', pattern: `^inst-${UUID}$` };
const NO_CACHE = { 'cache-control': { schema: { const: 'no-store' } } };
const SOLICITUD = {
  type: 'object',
  additionalProperties: false,
  required: ['invitacion'],
  properties: { invitacion: { type: 'string', pattern: `^${UUID}\\.${SECRETO}$` } },
};
const PREVIA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'institucion', 'caducaEn'],
  properties: {
    version: { const: 1 },
    institucion: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'nombre'],
      properties: {
        id: CLIENTE,
        nombre: { type: 'string', minLength: 1, maxLength: 120 },
      },
    },
    caducaEn: { type: 'string', format: 'date-time' },
  },
};
const CREDENCIAL = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'client_id', 'client_secret', 'token_endpoint', 'token_type'],
  properties: {
    version: { const: 1 },
    client_id: CLIENTE,
    client_secret: {
      type: 'string',
      pattern: `^${SECRETO}$`,
      description: 'Se entrega una sola vez. Guardar solo en el servidor de la institución.',
    },
    token_endpoint: { const: RUTA_TOKEN },
    token_type: { const: TIPO_DE_TOKEN },
  },
};
function respuestaError(codigo: string) {
  return {
    description: 'La operación no se ha completado',
    headers: NO_CACHE,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['error'],
          properties: { error: { const: codigo } },
        },
      },
    },
  };
}
function mixta(codigo: string) {
  const json = respuestaError(codigo);
  return {
    ...json,
    content: { ...json.content, 'application/problem+json': { schema: { $ref: '#/components/schemas/Problema' } } },
  };
}
function operacion(summary: string, schema: unknown) {
  return {
    tags: ['socios'],
    summary,
    security: [],
    description:
      'Solo en el propio sitio, con API institucional habilitada. El secreto va en el cuerpo JSON de hasta 4096 bytes, nunca en la dirección. No admite parámetros URL ni reintentos automáticos.',
    parameters: [
      { $ref: '#/components/parameters/Contrato' },
      { name: 'Origin', in: 'header', required: true, schema: { type: 'string', format: 'uri' } },
    ],
    requestBody: { required: true, content: { 'application/json': { schema: SOLICITUD } } },
    responses: {
      200: { description: summary, headers: NO_CACHE, content: { 'application/json': { schema } } },
      400: respuestaError('solicitud_invalida'),
      403: respuestaError('origen_no_permitido'),
      404: mixta('ruta_desconocida'),
      405: respuestaError('metodo_no_admitido'),
      409: { $ref: '#/components/responses/Problema' },
      410: respuestaError('invitacion_no_disponible'),
      415: respuestaError('tipo_no_admitido'),
      429: respuestaError('demasiadas_peticiones'),
      503: mixta('no_disponible'),
    },
  };
}
export const RUTAS_DE_INVITACION = {
  [RUTA_CONSULTAR_INVITACION]: {
    post: operacion('Consulta la institución y caducidad sin consumir la invitación', PREVIA),
  },
  [RUTA_ACTIVAR_INVITACION]: { post: operacion('Consume la invitación y entrega la clave una sola vez', CREDENCIAL) },
};
