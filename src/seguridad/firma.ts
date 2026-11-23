// Firmas HMAC de Faro. El informe comprueba aquí las estimaciones firmadas que llegan de fuera: sin firma, con la
// firma de otros datos o caducadas, se rechazan, y nadie puede presentar como «estimación de Faro» una nota
// inventada. Este repositorio no produce estimaciones firmadas; sí emite y comprueba los tokens de socios
// (api/socios/token-de-acceso.ts). El servidor no guarda nada: la firma viaja con el dato.
// Con estándares y Web Crypto, igual en Node, en un Worker de Cloudflare y en el navegador (README.md):
// - HMAC-SHA-256 (RFC 2104) sobre la caducidad y los datos en JSON canónico (JCS, RFC 8785: comun/jcs.ts);
// - una subclave por uso (las estimaciones y los tokens de socios), derivada del secreto con HKDF (RFC 5869): la firma
//   de un uso no vale para el otro, aunque el secreto sea uno solo;
// - un identificador de clave (kid) en cada firma, derivado también con HKDF: se puede rotar el secreto aceptando el
//   anterior durante un plazo (FARO_SECRETO_FIRMA_ANTERIOR), sin invalidar de golpe lo firmado.

import { aBase64Url, deBase64Url } from '../comun/base64url.js';
import { jsonCanonico, TextoJcsInvalido } from '../comun/jcs.ts';
import { esObjeto } from '../comun/json.ts';
import { MS_POR_DIA } from '../comun/tiempo.ts';

/** Bits en un byte: HKDF pide la longitud derivada en bits. */
const BITS_POR_BYTE = 8;

/** Un secreto HMAC-SHA-256 debe tener al menos 32 bytes (RFC 2104: no menos que la salida del hash). */
const MIN_SECRETO_BYTES = 32;
/** Cuánto vale una firma si no se indica otra cosa: un día. */
const VIGENCIA_POR_DEFECTO_MS = MS_POR_DIA;
/** Un HMAC-SHA-256 son 32 bytes: 43 caracteres en base64url sin relleno. */
const HMAC_BASE64URL = /^[A-Za-z0-9_-]{43}$/;
/** La caducidad son milisegundos desde 1970, que se escriben con 13 cifras hasta el año 2286. */
const CADUCIDAD = /^\d{13}$/;
/** Bytes del identificador de la clave (kid). */
const KID_BYTES = 6;
/** El kid son KID_BYTES bytes: 8 caracteres en base64url sin relleno. */
const KID = /^[A-Za-z0-9_-]{8}$/;
/** Las longitudes del formato validado por KID, CADUCIDAD y HMAC_BASE64URL, sin relleno. */
const LONGITUDES_FIRMA = { kid: 8, caducidad: 13, hmac: 43, separadores: 2 } as const;
/** Una firma válida tiene esta longitud exacta; limita split antes de crear sus partes. */
const LONGITUD_FIRMA =
  LONGITUDES_FIRMA.kid + LONGITUDES_FIRMA.caducidad + LONGITUDES_FIRMA.hmac + LONGITUDES_FIRMA.separadores;
/** Bytes de cada subclave: los de la salida de SHA-256 (RFC 2104 recomienda no menos). */
const SUBCLAVE_BYTES = 32;
/**
 * La sal de HKDF-Extract (RFC 5869, 3.1): fija y pública, solo separa estas claves de las de cualquier otro uso del
 * mismo secreto. El `info` de cada subclave dice su uso.
 */
const SAL_HKDF = 'faro/firma/v1';
const INFO_KID = 'faro/firma/v1/kid';

/** El algoritmo con que se importan las subclaves HMAC. */
const HMAC_SHA256 = { name: 'HMAC', hash: 'SHA-256' } as const;

/** Texto a bytes UTF-8. */
const CODIFICADOR = new TextEncoder();

/**
 * Para qué es una firma: cada uso tiene su subclave, y lo firmado para uno no se acepta en otro. Los tokens de acceso
 * de la API para socios (api/socios/token-de-acceso.ts) firman con la suya un JWT, no con el firmador de aquí.
 */
export type UsoDeFirma = 'estimaciones' | 'tokens-de-socios';

/** Firma valores admitidos por jsonCanonico; comprobar rechaza firmas y textos Unicode inválidos con false. */
export interface Firmador {
  firmar(datos: unknown): Promise<string>;
  comprobar(datos: unknown, firma: unknown): Promise<boolean>;
}

/**
 * El secreto de firma: un texto (el del servidor, FARO_SECRETO_FIRMA) o una clave HMAC-SHA-256 de Web Crypto que ya
 * firma y comprueba (la del motor del dispositivo, guardada sin poder extraerse:
 * web/scripts/motor-local/secreto-firma.js).
 */
export type SecretoDeFirma = string | CryptoKey;

/** Una subclave HMAC-SHA-256 que no se puede extraer, con su kid. */
export interface Subclave {
  kid: string;
  clave: CryptoKey;
}

/** Con qué se crea un firmador, además del secreto. */
export interface OpcionesDelFirmador {
  /** Para qué firma: su subclave. Por defecto, las estimaciones. */
  uso?: UsoDeFirma;
  /**
   * El secreto anterior a una rotación (FARO_SECRETO_FIRMA_ANTERIOR): sus firmas se siguen aceptando hasta que
   * caducan; las nuevas se hacen siempre con el actual. Se quita pasada la vigencia más larga (24 h).
   */
  anterior?: SecretoDeFirma | undefined;
}

/** Los bytes de un HMAC en base64url, o null si el texto no tiene exactamente esa forma. */
function bytesDelHmac(codificado: string): Uint8Array<ArrayBuffer> | null {
  return HMAC_BASE64URL.test(codificado) ? deBase64Url(codificado) : null;
}

/** El hash de un algoritmo de Web Crypto que lo lleva (el `hash` de HmacKeyAlgorithm), o undefined si no lo lleva. */
function hashDelAlgoritmo(algoritmo: CryptoKey['algorithm']): unknown {
  return 'hash' in algoritmo && esObjeto(algoritmo.hash) ? algoritmo.hash.name : undefined;
}

/** Si la clave de Web Crypto es una HMAC-SHA-256 que firma y comprueba. */
function esClaveHmac(clave: CryptoKey): boolean {
  return (
    clave.type === 'secret' &&
    clave.algorithm.name === 'HMAC' &&
    hashDelAlgoritmo(clave.algorithm) === 'SHA-256' &&
    clave.usages.includes('sign') &&
    clave.usages.includes('verify')
  );
}

function importarHmac(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytes, HMAC_SHA256, false, ['sign', 'verify']);
}

/**
 * HKDF completo (RFC 5869: Extract y Expand) con el HKDF de Web Crypto, para un secreto de texto: el texto es el
 * material de partida (IKM), que no tiene por qué ser uniforme.
 */
async function subclaveDelTexto(secreto: string, uso: UsoDeFirma): Promise<Subclave> {
  const bytes = CODIFICADOR.encode(secreto);
  if (bytes.length < MIN_SECRETO_BYTES) {
    throw new Error(`El secreto de firma debe tener al menos ${MIN_SECRETO_BYTES} bytes UTF-8`);
  }
  const base = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits']);
  const derivar = (info: string, longitud: number): Promise<ArrayBuffer> =>
    crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: CODIFICADOR.encode(SAL_HKDF), info: CODIFICADOR.encode(info) },
      base,
      longitud * BITS_POR_BYTE,
    );
  const clave = await importarHmac(await derivar(`${SAL_HKDF}/${uso}`, SUBCLAVE_BYTES));
  return { kid: aBase64Url(await derivar(INFO_KID, KID_BYTES)), clave };
}

/**
 * Solo HKDF-Expand (RFC 5869, 2.3; con una salida de un bloque, T(1) = HMAC(PRK, info | 0x01)) para la clave HMAC del
 * dispositivo, que ya es una clave fuerte y al azar (RFC 5869, 3.3: entonces se puede saltar Extract). Web Crypto no
 * deja usar una clave HMAC como base de su HKDF y la del dispositivo no se puede extraer: el bloque de Expand se
 * calcula firmando con ella, y la subclave se importa al momento sin poder extraerse.
 */
async function subclaveDeLaClave(prk: CryptoKey, uso: UsoDeFirma): Promise<Subclave> {
  if (!esClaveHmac(prk)) {
    throw new Error('La clave de firma tiene que ser HMAC-SHA-256 y poder firmar y comprobar');
  }
  const expandir = async (info: string) =>
    new Uint8Array(await crypto.subtle.sign('HMAC', prk, CODIFICADOR.encode(`${info}\u0001`)));
  const clave = await importarHmac(await expandir(`${SAL_HKDF}/${uso}`));
  return { kid: aBase64Url((await expandir(INFO_KID)).slice(0, KID_BYTES)), clave };
}

/** Los bytes que cubre HMAC: caducidad Unix y datos canónicos, unidos por un punto. */
function mensajeFirmado(caduca: number, datos: unknown): Uint8Array<ArrayBuffer> {
  return CODIFICADOR.encode(`${caduca}.${jsonCanonico(datos)}`);
}

/** Mensaje para verificar; un texto sin forma Unicode no admite una firma JCS válida. */
function mensajeComprobable(caduca: number, datos: unknown): Uint8Array<ArrayBuffer> | null {
  try {
    return mensajeFirmado(caduca, datos);
  } catch (error) {
    if (error instanceof TextoJcsInvalido) {
      return null;
    }
    throw error;
  }
}

/**
 * La subclave del uso: derivada del secreto dado o, sin él, de uno aleatorio que dura lo que el proceso.
 *
 * @param secreto - El secreto de firma, o undefined si no hay.
 * @param uso - Para qué se firma; cada uso deriva su propia subclave.
 * @returns La subclave HMAC-SHA-256 del uso.
 */
export function subclaveDe(secreto: SecretoDeFirma | undefined, uso: UsoDeFirma): Promise<Subclave> {
  if (typeof secreto === 'object') {
    return subclaveDeLaClave(secreto, uso);
  }
  return subclaveDelTexto(secreto ?? aBase64Url(crypto.getRandomValues(new Uint8Array(MIN_SECRETO_BYTES))), uso);
}

/**
 * Crea un firmador. Sin secreto configurado usa uno aleatorio: las firmas valen mientras viva el proceso.
 * La firma es «kid.caducidad.hmac» y cubre la caducidad y los datos en JSON canónico (JCS): `${caducidad}.${jcs}`.
 *
 * @param secreto - El secreto de firma; sin él, uno efímero del proceso.
 * @param vigenciaMs - Cuánto vale una firma, en milisegundos; junto al reloj debe producir una caducidad entera
 *   de 13 cifras, el formato que acepta comprobar.
 * @param ahora - El reloj Unix en milisegundos (Date.now por defecto), no un contador relativo.
 * @param opciones - El uso de la firma y el secreto anterior aún admitido.
 * @returns El firmador; firmar propaga errores de datos no JSON y de Web Crypto. Comprobar devuelve false
 *   por texto Unicode inválido; los demás errores de datos no JSON y de Web Crypto se propagan.
 */
export async function crearFirmador(
  secreto?: SecretoDeFirma,
  vigenciaMs: number = VIGENCIA_POR_DEFECTO_MS,
  ahora: () => number = () => Date.now(),
  { uso = 'estimaciones', anterior }: OpcionesDelFirmador = {},
): Promise<Firmador> {
  const actual = await subclaveDe(secreto, uso);
  const aceptadas = new Map([[actual.kid, actual.clave]]);
  if (anterior !== undefined) {
    const vieja = await subclaveDe(anterior, uso);
    if (!aceptadas.has(vieja.kid)) {
      aceptadas.set(vieja.kid, vieja.clave);
    }
  }
  return {
    async firmar(datos) {
      const caduca = ahora() + vigenciaMs;
      const hmac = aBase64Url(await crypto.subtle.sign('HMAC', actual.clave, mensajeFirmado(caduca, datos)));
      return `${actual.kid}.${caduca}.${hmac}`;
    },
    async comprobar(datos, firma) {
      if (typeof firma !== 'string' || firma.length !== LONGITUD_FIRMA) {
        return false;
      }
      const [kid = '', caducidad = '', hmac, ...resto] = firma.split('.');
      const clave = KID.test(kid) ? aceptadas.get(kid) : undefined;
      const caduca = Number(caducidad);
      const mac = bytesDelHmac(hmac ?? '');
      if (resto.length > 0 || !clave || !CADUCIDAD.test(caducidad) || !mac || caduca < ahora()) {
        return false;
      }
      const contenido = mensajeComprobable(caduca, datos);
      if (!contenido) {
        return false;
      }
      // verify compara en tiempo constante; sus errores no son errores de canonicalización.
      return crypto.subtle.verify('HMAC', clave, mac, contenido);
    },
  };
}
