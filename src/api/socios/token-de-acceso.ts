// Los tokens de acceso de la API para socios: JWT (RFC 7519) con el perfil de RFC 9068 («at+jwt»), firmados con
// HMAC-SHA-256 (HS256, RFC 7518, 3.2) con una subclave propia, derivada con HKDF del secreto de firma del servidor y
// con su `kid` (seguridad/firma.ts): un token no vale como pase ni como estimación, ni al revés, y durante una rotación del
// secreto (FARO_SECRETO_FIRMA_ANTERIOR) se siguen aceptando los firmados con el anterior.
// Por qué HS256 y no RS256, que RFC 9068 (2.1) pide admitir: quien emite y quien comprueba los tokens es el mismo
// servicio, nadie más necesita la clave de comprobación, y una clave RSA no se puede derivar del secreto: sería otro
// secreto que guardar y rotar. La desviación y cuándo cambiarla están en docs/api/socios.md («Desviaciones»).
// La comprobación sigue RFC 9068, 4, y RFC 8725 (3.1 y 3.11): tipo explícito, solo el algoritmo esperado, firma
// comprobada con Web Crypto, emisor y audiencia exactos y caducidad.

import { aBase64Url, deBase64Url } from '../../comun/base64url.js';
import { cumple, type EsquemaDe } from '../../comun/esquema.ts';
import { MS_POR_SEGUNDO } from '../../comun/tiempo.ts';
import { type SecretoDeFirma, subclaveDe } from '../../seguridad/firma.ts';
import { AMBITO_DE_LECTURA, RUTA_CONSULTAS, RUTA_SOCIOS, VIDA_DEL_TOKEN_S } from './metadatos.ts';
import { CARACTERES_DE_LA_CREDENCIAL, type SocioAutenticado } from './registro.ts';

export { AMBITO_DE_LECTURA, TIPO_DE_TOKEN, VIDA_DEL_TOKEN_S } from './metadatos.ts';

/** Lo más largo que puede ser un token de Faro: los suyos miden unos 500 caracteres; lo demás no se lee. */
const MAX_TOKEN_CARACTERES = 2048;
/** Bytes al azar del identificador de cada token (jti): 128 bits (RFC 6749, 10.10). */
const JTI_BYTES = 16;
/** Un HMAC-SHA-256 son 32 bytes. */
const HMAC_BYTES = 32;
/** Margen para un `iat` por delante del reloj de esta instancia: los relojes de dos instancias no son idénticos. */
const MARGEN_DEL_RELOJ_S = 60;
/** Las partes de un JWT compacto: cabecera, cuerpo y firma. */
const PARTES_DEL_TOKEN = 3;
/** El uso con que se deriva la subclave de los tokens (seguridad/firma.ts): separa estas firmas de las demás. */
const USO_DE_LA_FIRMA = 'tokens-de-socios';
/** El algoritmo de firma de los tokens: HMAC-SHA-256 (RFC 7518, 3.2). */
const HS256 = 'HS256';
/** El tipo de los tokens de acceso en JWT (RFC 9068, 2.1). */
const AT_JWT = 'at+jwt';

/** Pasa a bytes el texto que se firma. */
const codificador = new TextEncoder();
/** Los caracteres que da base64url sin relleno por cada grupo de bytes que codifica (RFC 4648, apartado 5): 4 por 3. */
const CARACTERES_POR_GRUPO_BASE64 = 4;
/** Los bytes de un grupo de base64: 3. */
const BYTES_POR_GRUPO_BASE64 = 3;
/** Los caracteres de base64url sin relleno de unos bytes: 4 por cada 3 (RFC 4648, apartado 5). */
function caracteresBase64Url(bytes: number): number {
  return Math.ceil((bytes * CARACTERES_POR_GRUPO_BASE64) / BYTES_POR_GRUPO_BASE64);
}
/** Lee como texto las partes del token; un byte que no es UTF-8 lanza en vez de sustituirse. */
const descodificador = new TextDecoder('utf-8', { fatal: true });

/** La cabecera JOSE de un token de Faro: exactamente estos tres parámetros. */
interface Cabecera {
  alg: typeof HS256;
  typ: string;
  kid: string;
}

/** Las reclamaciones de un token (RFC 9068, 2.2), más la credencial con que se obtuvo (registro.ts). */
export interface Reclamaciones {
  iss: string;
  sub: string;
  aud: string;
  client_id: string;
  iat: number;
  exp: number;
  jti: string;
  scope: string;
  credencial: string;
}

/** Para quién es un token: el emisor (`iss`) y la audiencia (`aud`) del despliegue que atiende la petición. */
export interface Destino {
  emisor: string;
  audiencia: string;
}

/** Emite tokens y comprueba los que le llegan. */
export interface EmisorDeTokens {
  emitir(
    autenticado: SocioAutenticado,
    destino: Destino,
    ambito?: string,
  ): Promise<{ token: string; reclamaciones: Reclamaciones }>;
  /** Las reclamaciones de un token firmado por este emisor, para este destino y sin caducar; si no, null. */
  comprobar(token: string, destino: Destino): Promise<Reclamaciones | null>;
}

const ESQUEMA_CABECERA: EsquemaDe<Cabecera> = {
  type: 'object',
  additionalProperties: false,
  required: ['alg', 'typ', 'kid'],
  properties: {
    alg: { enum: [HS256] },
    // RFC 9068, 4: «at+jwt» o «application/at+jwt»; ningún otro.
    typ: { enum: [AT_JWT, `application/${AT_JWT}`] },
    kid: { type: 'string', pattern: '^[A-Za-z0-9_-]{8}$' },
  },
};

const ESQUEMA_RECLAMACIONES: EsquemaDe<Reclamaciones> = {
  type: 'object',
  additionalProperties: false,
  required: ['iss', 'sub', 'aud', 'client_id', 'iat', 'exp', 'jti', 'scope', 'credencial'],
  properties: {
    iss: { type: 'string' },
    sub: { type: 'string' },
    aud: { type: 'string' },
    client_id: { type: 'string' },
    iat: { type: 'integer', minimum: 0 },
    exp: { type: 'integer', minimum: 0 },
    jti: { type: 'string', pattern: `^[A-Za-z0-9_-]{${caracteresBase64Url(JTI_BYTES)}}$` },
    scope: { enum: [AMBITO_DE_LECTURA] },
    credencial: { type: 'string', pattern: `^[0-9a-f]{${CARACTERES_DE_LA_CREDENCIAL}}$` },
  },
};

/** Un objeto en JSON, codificado en base64url como una parte del JWS (RFC 7515, 3.1). */
function parteDe(objeto: object): string {
  return aBase64Url(codificador.encode(JSON.stringify(objeto)));
}

/** El JSON de una parte del JWS, o null si no es base64url, UTF-8 o JSON. */
function jsonDeLaParte(parte: string): unknown {
  const bytes = deBase64Url(parte);
  if (!bytes) {
    return null;
  }
  try {
    return JSON.parse(descodificador.decode(bytes));
  } catch (error) {
    // UTF-8 (TypeError del descodificador estricto) o JSON (SyntaxError) roto: no es un token de Faro, como cualquier
    // otro que no cuadre.
    if (!(error instanceof TypeError || error instanceof SyntaxError)) {
      throw error;
    }
    return null;
  }
}

/** Solo la audiencia de consultas del mismo origen tiene un consumidor de tokens de Socios. */
function destinoDeLectura(destino: Destino): boolean {
  let origen: string;
  try {
    origen = new URL(destino.emisor).origin;
  } catch (error) {
    // Un emisor que no es una URL (TypeError) no es el de ninguna lectura.
    if (!(error instanceof TypeError)) {
      throw error;
    }
    return false;
  }
  return destino.emisor === `${origen}${RUTA_SOCIOS}` && destino.audiencia === `${origen}${RUTA_CONSULTAS}`;
}

/** Si las reclamaciones dicen lo que dice todo token de Faro para este destino y siguen vigentes. */
function reclamacionesValidas(reclamaciones: Reclamaciones, destino: Destino, ahoraS: number): boolean {
  const { iss, aud, sub, client_id: cliente, iat, exp } = reclamaciones;
  return (
    destinoDeLectura(destino) &&
    iss === destino.emisor &&
    aud === destino.audiencia &&
    sub === cliente &&
    exp - iat === VIDA_DEL_TOKEN_S &&
    iat <= ahoraS + MARGEN_DEL_RELOJ_S &&
    ahoraS < exp
  );
}

/** Comprueba un token con las claves aceptadas: forma, cabecera, firma y reclamaciones, en ese orden. */
async function comprobarToken(
  claves: ReadonlyMap<string, CryptoKey>,
  token: string,
  destino: Destino,
  ahoraS: number,
): Promise<Reclamaciones | null> {
  const partes = token.length <= MAX_TOKEN_CARACTERES ? token.split('.') : [];
  if (partes.length !== PARTES_DEL_TOKEN) {
    return null;
  }
  const [cabeceraCodificada = '', cuerpoCodificado = '', firmaCodificada = ''] = partes;
  const cabecera = jsonDeLaParte(cabeceraCodificada);
  const clave = cumple(cabecera, ESQUEMA_CABECERA) ? claves.get(cabecera.kid) : undefined;
  const firma = deBase64Url(firmaCodificada);
  if (!clave || firma?.byteLength !== HMAC_BYTES) {
    return null;
  }
  const firmado = codificador.encode(`${cabeceraCodificada}.${cuerpoCodificado}`);
  // Web Crypto comprueba la firma con la subclave del uso tokens-de-socios.
  if (!(await crypto.subtle.verify('HMAC', clave, firma, firmado))) {
    return null;
  }
  const reclamaciones = jsonDeLaParte(cuerpoCodificado);
  if (!cumple(reclamaciones, ESQUEMA_RECLAMACIONES)) {
    return null;
  }
  return reclamacionesValidas(reclamaciones, destino, ahoraS) ? reclamaciones : null;
}

/** Las reclamaciones de un token nuevo para un socio autenticado. */
function reclamacionesNuevas(
  { socio, credencial }: SocioAutenticado,
  destino: Destino,
  ahoraS: number,
  ambito: string,
): Reclamaciones {
  return {
    iss: destino.emisor,
    // RFC 9068, 2.2: sin persona de por medio (credenciales del cliente), `sub` es el propio cliente.
    sub: socio.id,
    aud: destino.audiencia,
    client_id: socio.id,
    iat: ahoraS,
    exp: ahoraS + VIDA_DEL_TOKEN_S,
    jti: aBase64Url(crypto.getRandomValues(new Uint8Array(JTI_BYTES))),
    scope: ambito,
    credencial,
  };
}

/**
 * Crea el emisor con el secreto de firma (y, durante una rotación, el anterior, cuyas firmas se aceptan). Sin
 * secreto, uno aleatorio que dura lo que el proceso.
 *
 * @param secreto - El secreto de firma; sin él, uno aleatorio.
 * @param anterior - El secreto anterior, durante una rotación.
 * @param ahora - El reloj, en milisegundos; por defecto, `Date.now`.
 * @returns El emisor.
 */
export async function crearEmisorDeTokens(
  secreto: SecretoDeFirma | undefined,
  anterior: SecretoDeFirma | undefined,
  ahora: () => number = Date.now,
): Promise<EmisorDeTokens> {
  const actual = await subclaveDe(secreto, USO_DE_LA_FIRMA);
  const claves = new Map([[actual.kid, actual.clave]]);
  if (anterior !== undefined) {
    const vieja = await subclaveDe(anterior, USO_DE_LA_FIRMA);
    if (!claves.has(vieja.kid)) {
      claves.set(vieja.kid, vieja.clave);
    }
  }
  const ahoraS = () => Math.floor(ahora() / MS_POR_SEGUNDO);
  return {
    async emitir(autenticado, destino, ambito = AMBITO_DE_LECTURA) {
      if (ambito !== AMBITO_DE_LECTURA || !destinoDeLectura(destino)) {
        throw new Error('No se puede emitir un token para ese ámbito y audiencia');
      }
      const reclamaciones = reclamacionesNuevas(autenticado, destino, ahoraS(), ambito);
      const firmado = `${parteDe({ alg: HS256, typ: AT_JWT, kid: actual.kid })}.${parteDe(reclamaciones)}`;
      const firma = await crypto.subtle.sign('HMAC', actual.clave, codificador.encode(firmado));
      return { token: `${firmado}.${aBase64Url(new Uint8Array(firma))}`, reclamaciones };
    },
    comprobar(token, destino) {
      return comprobarToken(claves, token, destino, ahoraS());
    },
  };
}
