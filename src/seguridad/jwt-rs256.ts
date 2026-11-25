// Verificación JWT RS256: firma y caché JWKS por configuración de confianza.
// No decide permisos ni depende de perfiles IA; las claims solo salen después de verificar el JWT.

import { deBase64Url } from '../comun/base64url.js';
import { cabecerasIdentidadWeb } from '../comun/identidad-web.ts';
import { esObjeto } from '../comun/json.ts';
import { MS_POR_MINUTO, MS_POR_SEGUNDO } from '../comun/tiempo.ts';

/** Un JWT son tres partes en base64url separadas por puntos: cabecera, contenido y firma. */
const PARTES_DE_UN_JWT = 3;
/** Algoritmo admitido para las firmas JWT: RS256. */
const ALGORITMO_JWT = 'RS256';
/** El mismo algoritmo en WebCrypto: RSASSA-PKCS1-v1_5 con SHA-256. */
const ALGORITMO_CRIPTO: { name: string; hash: string } = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
/** Cuánto se usan las claves descargadas antes de volver a pedirlas: una hora. */
const VIGENCIA_CLAVES_MS = 60 * MS_POR_MINUTO;
/** Lo mínimo entre dos descargas: una clave desconocida no puede provocar una descarga por petición. */
const MIN_ENTRE_DESCARGAS_MS = MS_POR_MINUTO;
/** Lo que se espera al servicio de claves JWKS: cinco segundos. */
export const ESPERA_CLAVES_MS = 5000;

/** Transporte de claves públicas; las pruebas lo sustituyen sin red. */
export type PeticionHttpJwt = typeof fetch;
/** La composición fija la confianza; ninguna URL se obtiene de claims o cabeceras del JWT. */
export interface AplicacionJwtRs256 {
  readonly emisor: string;
  readonly audiencia: string;
  readonly urlClaves: string;
}
export type VerificadorJwtRs256 = (token: string) => Promise<Readonly<Record<string, unknown>> | null>;

/** El servicio de claves JWKS no ha respondido como debe (red, plazo, estado o cuerpo): un fallo operativo esperable. */
export class ClavesNoDisponibles extends Error {
  override name = 'ClavesNoDisponibles';
}

/** Un JWT leído: su cabecera y su contenido (sin comprobar), lo firmado y la firma. */
interface JwtLeido {
  cabecera: { alg?: unknown; kid?: unknown };
  contenido: Record<string, unknown>;
  firmado: Uint8Array<ArrayBuffer>;
  firma: Uint8Array<ArrayBuffer>;
}

/** Una clave pública RSA de la respuesta JWKS (formato JWK, RFC 7517), con su identificador. */
interface ClavePublica {
  kty: 'RSA';
  alg?: string;
  use?: string;
  key_ops?: string[];
  n: string;
  e: string;
  kid: string;
}

const codificador = new TextEncoder();
const descodificador = new TextDecoder();

/** Un objeto JSON en base64url, o null. */
function objetoDe(texto: string): Record<string, unknown> | null {
  const bytes = deBase64Url(texto);
  if (!bytes) {
    return null;
  }
  try {
    const valor: unknown = JSON.parse(descodificador.decode(bytes));
    return esObjeto(valor) ? valor : null;
  } catch (error) {
    // No es JSON (SyntaxError): el JWT no tiene la forma de uno y no vale.
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return null;
  }
}

/** Las tres partes de un JWT, sin comprobar todavía nada, o null si no tiene esa forma. */
function leerJwt(token: string): JwtLeido | null {
  const partes = token.split('.');
  if (partes.length !== PARTES_DE_UN_JWT) {
    return null;
  }
  const [cabeceraCodificada, contenidoCodificado, firmaCodificada] = partes;
  if (cabeceraCodificada === undefined || contenidoCodificado === undefined || firmaCodificada === undefined) {
    return null;
  }
  const cabecera = objetoDe(cabeceraCodificada);
  const contenido = objetoDe(contenidoCodificado);
  const firma = deBase64Url(firmaCodificada);
  if (!cabecera || !contenido || !firma) {
    return null;
  }
  return { cabecera, contenido, firmado: codificador.encode(`${partes[0]}.${partes[1]}`), firma };
}

/** Si el contenido es de esta aplicación, de este emisor y está vigente ahora. */
function contenidoVigente(contenido: JwtLeido['contenido'], aplicacion: AplicacionJwtRs256, ahora: number): boolean {
  const audiencias = Array.isArray(contenido.aud) ? contenido.aud : [contenido.aud];
  if (!audiencias.includes(aplicacion.audiencia) || contenido.iss !== aplicacion.emisor) {
    return false;
  }
  if (typeof contenido.exp !== 'number' || !Number.isFinite(contenido.exp) || contenido.exp * MS_POR_SEGUNDO <= ahora) {
    return false;
  }
  return (
    contenido.nbf === undefined ||
    (typeof contenido.nbf === 'number' && Number.isFinite(contenido.nbf) && contenido.nbf * MS_POR_SEGUNDO <= ahora)
  );
}

/** Las operaciones declaradas deben permitir verificar; ausencia no restringe el uso de una clave pública. */
function permiteVerificar(operaciones: unknown): boolean {
  return (
    operaciones === undefined ||
    (Array.isArray(operaciones) && operaciones.every((op) => typeof op === 'string') && operaciones.includes('verify'))
  );
}

/** Solo candidatos públicos RSA para RS256: las claves de cifrado u otros algoritmos no compiten por su kid. */
function esClaveDeFirma(clave: Record<string, unknown>): clave is Record<string, unknown> & ClavePublica {
  if (
    clave.kty !== 'RSA' ||
    typeof clave.kid !== 'string' ||
    (clave.use !== undefined && clave.use !== 'sig') ||
    (clave.alg !== undefined && clave.alg !== ALGORITMO_JWT) ||
    clave.d !== undefined
  ) {
    return false;
  }
  return (
    typeof clave.n === 'string' &&
    deBase64Url(clave.n) !== null &&
    typeof clave.e === 'string' &&
    deBase64Url(clave.e) !== null &&
    permiteVerificar(clave.key_ops)
  );
}

/** Un JWK defectuoso no invalida claves independientes; otros errores de WebCrypto siguen propagándose. */
async function importarClave(clave: ClavePublica): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey('jwk', clave, ALGORITMO_CRIPTO, false, ['verify']);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'DataError') {
      return null;
    }
    throw error;
  }
}

/**
 * Las claves públicas del emisor por su identificador (kid), importadas para comprobar firmas. La respuesta (un JWK
 * Set, RFC 7517) entra como unknown: solo cuentan las RSA aptas para verificar RS256 con un kid inequívoco.
 */
async function descargarClaves(urlClaves: string, pedir: PeticionHttpJwt): Promise<Map<string, CryptoKey>> {
  let respuesta: Response;
  try {
    respuesta = await pedir(urlClaves, {
      headers: { ...cabecerasIdentidadWeb() },
      signal: AbortSignal.timeout(ESPERA_CLAVES_MS),
    });
  } catch (error) {
    throw new ClavesNoDisponibles('no se han podido pedir las claves JWKS', { cause: error });
  }
  if (!respuesta.ok) {
    throw new ClavesNoDisponibles(`las claves JWKS han respondido ${respuesta.status}`);
  }
  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch (error) {
    throw new ClavesNoDisponibles('las claves JWKS no son JSON', { cause: error });
  }
  const claves = new Map<string, CryptoKey>();
  const vistos = new Set<string>();
  const recibidas = esObjeto(cuerpo) && Array.isArray(cuerpo.keys) ? cuerpo.keys.filter(esObjeto) : [];
  for (const clave of recibidas) {
    if (!esClaveDeFirma(clave)) {
      continue;
    }
    if (vistos.has(clave.kid)) {
      claves.delete(clave.kid);
      continue;
    }
    vistos.add(clave.kid);
    const importada = await importarClave(clave);
    if (importada) {
      claves.set(clave.kid, importada);
    }
  }
  return claves;
}

/**
 * La clave pública de cada identificador, con las descargadas en memoria. Se vuelven a pedir al caducar o al aparecer
 * un identificador desconocido (el emisor ha cambiado de clave), pero nunca más de un intento por minuto. La descarga es
 * de un solo vuelo: las peticiones que llegan mientras otra descarga esperan a esa misma, y solo una descarga que
 * termina bien renueva las claves y su vigencia. El freno tras un fallo no permite usar claves ya vencidas.
 *
 * @param urlClaves - La dirección JWKS fija de la aplicación.
 * @param pedir - Cómo se piden las claves.
 * @param ahora - El reloj, en milisegundos de época.
 * @returns La búsqueda de una clave por su `kid`: la clave, o null si el emisor no la tiene; rechaza si la descarga
 *   falla.
 */
function clavesDelEquipo(
  urlClaves: string,
  pedir: PeticionHttpJwt,
  ahora: () => number,
): (kid: string) => Promise<CryptoKey | null> {
  let claves = new Map<string, CryptoKey>();
  // Cuándo terminó bien la última descarga (la vigencia) y cuándo empezó el último intento (el freno).
  let descargadas = Number.NEGATIVE_INFINITY;
  let ultimoIntento = Number.NEGATIVE_INFINITY;
  let enCurso: Promise<void> | null = null;
  const descargar = (): Promise<void> => {
    enCurso ??= (async () => {
      ultimoIntento = ahora();
      try {
        claves = await descargarClaves(urlClaves, pedir);
        descargadas = ahora();
      } finally {
        enCurso = null;
      }
    })();
    return enCurso;
  };
  return async (kid) => {
    if (enCurso) {
      await enCurso;
    }
    const antiguas = ahora() - descargadas >= VIGENCIA_CLAVES_MS;
    const puedePedir = ahora() - ultimoIntento >= MIN_ENTRE_DESCARGAS_MS;
    if ((antiguas || !claves.has(kid)) && puedePedir) {
      await descargar();
    }
    if (ahora() - descargadas >= VIGENCIA_CLAVES_MS) {
      return null;
    }
    return claves.get(kid) ?? null;
  };
}

/** Firma, emisor, audiencia y vigencia. Los fallos del servicio de claves se dejan al adaptador. */
export function crearVerificadorJwtRs256(
  aplicacion: AplicacionJwtRs256,
  pedir: PeticionHttpJwt,
  ahora: () => number,
): VerificadorJwtRs256 {
  const configuracion = { ...aplicacion };
  const claveDe = clavesDelEquipo(configuracion.urlClaves, pedir, ahora);
  return async (token) => {
    const jwt = leerJwt(token);
    if (!jwt || jwt.cabecera.alg !== ALGORITMO_JWT || typeof jwt.cabecera.kid !== 'string') {
      return null;
    }
    if (!contenidoVigente(jwt.contenido, configuracion, ahora())) {
      return null;
    }
    const clave = await claveDe(jwt.cabecera.kid);
    if (clave === null || !(await crypto.subtle.verify(ALGORITMO_CRIPTO, clave, jwt.firma, jwt.firmado))) {
      return null;
    }
    if (!contenidoVigente(jwt.contenido, configuracion, ahora())) {
      return null;
    }
    return Object.freeze(jwt.contenido);
  };
}
