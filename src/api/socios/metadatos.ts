// Direcciones y constantes públicas de socios, sin servidor ni emisión de tokens.

/** La raíz de la API para socios; la versión va en la dirección, porque la usan sistemas de otros. */
export const RUTA_SOCIOS = '/api/socios/v1';
/** Consulta sin consumo y activación única por secreto recibido solo en el cuerpo POST. */
export const RUTA_CONSULTAR_INVITACION = `${RUTA_SOCIOS}/invitacion/consultar`;
export const RUTA_ACTIVAR_INVITACION = `${RUTA_SOCIOS}/invitacion/activar`;
/** Pedir un token con las credenciales del socio (RFC 6749, 4.4). */
export const RUTA_TOKEN = `${RUTA_SOCIOS}/token`;
/** Revocar un token (RFC 7009). */
export const RUTA_REVOCAR = `${RUTA_SOCIOS}/revocar`;
/** Preguntar si un token sigue vivo (RFC 7662). */
export const RUTA_INTROSPECCION = `${RUTA_SOCIOS}/introspeccion`;
/** Las consultas, una por herramienta del servidor MCP: `${RUTA_CONSULTAS}/<herramienta>`. */
export const RUTA_CONSULTAS = `${RUTA_SOCIOS}/consultas`;
/** Los minutos que vale un token. */
const MINUTOS_DE_VIDA_DEL_TOKEN = 15;
/** Los segundos de un minuto. */
const SEGUNDOS_POR_MINUTO = 60;
/** Lo que vale un token: 15 minutos. Corto, para que uno robado sirva poco y una revocación tarde poco en notarse. */
export const VIDA_DEL_TOKEN_S = MINUTOS_DE_VIDA_DEL_TOKEN * SEGUNDOS_POR_MINUTO;
/** El ámbito predeterminado (RFC 6749, 3.3): leer las consultas públicas. */
export const AMBITO_DE_LECTURA = 'faro.lectura';
/** El tipo de token de la respuesta (RFC 6750). */
export const TIPO_DE_TOKEN = 'Bearer';
