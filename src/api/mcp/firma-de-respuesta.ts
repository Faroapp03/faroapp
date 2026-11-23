// La firma híbrida, clásica y poscuántica, de cada respuesta del servidor MCP: Ed25519 + ML-DSA-65 (FIPS 204), la
// combinación de la clave diaria (COMBINACIONES.diaria, en web/scripts/firmas/firmas.js), sobre el JSON canónico
// (JCS, RFC 8785) del resultado JSON-RPC, en un sobre separado que viaja en `_meta` del resultado con el `kid` de cada
// clave (`clave`: la huella SHA-256 de su pública, la misma que lleva el manifiesto firmado). El mensaje firmado es la
// PAE de DSSE con el tipo de la respuesta dentro, como en el dispositivo: la firma de una respuesta no vale como la de
// un manifiesto.
// Firma con Web Crypto, que es lo que hay en el Worker de Cloudflare (ML-DSA-65 con la marca de compatibilidad
// webcrypto_modern_algorithms) y en Node 24; sin claves no se firma, y el servidor responde como siempre.
// Se comprueba con el código del dispositivo: `sobreDeLaRespuesta` devuelve el sobre que entiende
// web/scripts/firmas/firmas.js (comprobarSobre) y nativa.js (comprobarSobreNativo) con las claves públicas diarias que
// certifica la raíz. La PAE, el base64 y el tipo son los de comun/sobre-dsse.ts, la fuente única que la web publica.

import { sha256Hex } from '../../comun/huella.ts';
import { jsonCanonico, TextoJcsInvalido } from '../../comun/jcs.ts';
import { esObjeto } from '../../comun/json.ts';
import { aBase64, bytesDeBase64, mensajeAFirmar, TIPOS } from '../../comun/sobre-dsse.ts';

/** El tipo del contenido firmado. */
export const TIPO_RESPUESTA_MCP = TIPOS.respuestaMcp;
/** La clave de `_meta` del resultado en que viaja la firma (prefijo inverso del dominio, como pide MCP). */
export const META_FIRMA = 'org.faroapp/firma';
/** La versión del formato de la firma de una respuesta. */
const FORMATO_DE_LA_FIRMA = 1;
/**
 * La combinación con que firma el servidor: la de la clave diaria (`COMBINACIONES.diaria`), con el nombre de cada
 * algoritmo en Web Crypto y el formato de su clave pública («raw» en Ed25519; «raw-public» en ML-DSA, de la
 * especificación «Modern Algorithms in WebCrypto» del WICG), los mismos que `ALGORITMOS[…].nativo` del dispositivo.
 */
export const ALGORITMOS_DE_LA_RESPUESTA = Object.freeze({
  ed25519: { nombre: 'Ed25519', formatoDeClave: 'raw', bytesDeLaClave: 32 },
  'ml-dsa-65': { nombre: 'ML-DSA-65', formatoDeClave: 'raw-public', bytesDeLaClave: 1952 },
} as const);
/** Cuántas claves hacen falta: una por algoritmo de la combinación. */
const CLAVES_DE_LA_COMBINACION = Object.keys(ALGORITMOS_DE_LA_RESPUESTA).length;
/**
 * Lo más hondo que puede anidarse un resultado recibido para comprobar su firma: los de Faro tienen pocos niveles, y
 * así la recursión de jsonCanonico (comun/jcs.ts) queda acotada también con un resultado ajeno.
 */
const MAX_PROFUNDIDAD_DEL_RESULTADO = 32;
/** Pasa a bytes el texto que se firma. */
const texto = new TextEncoder();
/** Lo que se firma para comprobar al arrancar que cada privada corresponde a su pública. */
const SONDA = texto.encode('faro/firma-mcp/sonda');

/** Un algoritmo de la combinación. */
type AlgoritmoDeLaRespuesta = keyof typeof ALGORITMOS_DE_LA_RESPUESTA;
/** Una clave de firma tal como llega en la configuración: la pública cruda y la privada en PKCS #8, en base64. */
export interface ClaveDeFirma {
  algoritmo: AlgoritmoDeLaRespuesta;
  publica: string;
  privada: string;
}
/** La firma de una respuesta: el sobre sin su contenido (el contenido es el propio resultado, en JSON canónico). */
interface FirmaDeRespuesta {
  formato: typeof FORMATO_DE_LA_FIRMA;
  tipo: typeof TIPO_RESPUESTA_MCP;
  firmas: { algoritmo: AlgoritmoDeLaRespuesta; clave: string; firma: string }[];
}
/** Firma resultados; se crea una vez con las claves y vive lo que el servidor. */
export interface FirmadorMcp {
  /** Los ids (`kid`) de sus claves, para decirlos al arrancar. */
  readonly ids: readonly string[];
  firmar(resultado: Record<string, unknown>): Promise<FirmaDeRespuesta>;
}
/** Lo que se usa de Web Crypto: los tipos de TypeScript aún no declaran «raw-public». */
interface SubtleParaFirmar {
  importKey(
    formato: string,
    clave: Uint8Array<ArrayBuffer>,
    algoritmo: { name: string },
    extraible: boolean,
    usos: string[],
  ): Promise<CryptoKey>;
  sign(algoritmo: { name: string }, clave: CryptoKey, mensaje: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
  verify(
    algoritmo: { name: string },
    clave: CryptoKey,
    firma: Uint8Array<ArrayBuffer>,
    mensaje: Uint8Array<ArrayBuffer>,
  ): Promise<boolean>;
}
/** Una clave ya importada, con su id. */
interface ClaveImportada {
  algoritmo: AlgoritmoDeLaRespuesta;
  id: string;
  privada: CryptoKey;
}

/** Las claves de firma no sirven: faltan, sobran, no son base64, no casan entre sí o la plataforma no las admite. */
export class ClavesDeFirmaInvalidas extends Error {}

/** Si el valor es uno de los algoritmos de la combinación. */
function esAlgoritmo(valor: unknown): valor is AlgoritmoDeLaRespuesta {
  return typeof valor === 'string' && Object.hasOwn(ALGORITMOS_DE_LA_RESPUESTA, valor);
}

/** Si el valor tiene la forma de una clave de firma. */
function esClaveDeFirma(valor: unknown): valor is ClaveDeFirma {
  return (
    esObjeto(valor) &&
    esAlgoritmo(valor.algoritmo) &&
    typeof valor.publica === 'string' &&
    typeof valor.privada === 'string'
  );
}

/** Exige exactamente una clave por algoritmo de la combinación; si no, ClavesDeFirmaInvalidas. */
function exigirLaCombinacion(claves: readonly ClaveDeFirma[]): void {
  const algoritmos = new Set(claves.map(({ algoritmo }) => algoritmo));
  if (claves.length !== CLAVES_DE_LA_COMBINACION || algoritmos.size !== CLAVES_DE_LA_COMBINACION) {
    throw new ClavesDeFirmaInvalidas('FARO_FIRMA_MCP_CLAVES necesita una clave ed25519 y una ml-dsa-65, y solo esas');
  }
}

/** Si el valor no se anida más de MAX_PROFUNDIDAD_DEL_RESULTADO niveles; se recorre por niveles, sin recursión. */
function cabeEnProfundidad(valor: unknown): boolean {
  let nivel: unknown[] = [valor];
  for (let profundidad = 0; nivel.length; profundidad++) {
    if (profundidad > MAX_PROFUNDIDAD_DEL_RESULTADO) {
      return false;
    }
    nivel = nivel.flatMap((hijo) => (typeof hijo === 'object' && hijo !== null ? Object.values(hijo) : []));
  }
  return true;
}

/**
 * Las claves de firma de un texto JSON (la variable FARO_FIRMA_MCP_CLAVES, una lista de { algoritmo, publica, privada }
 * en base64): exactamente una por algoritmo de la combinación. Vacío o ausente, null: no se firma. Lo demás que no
 * cuadre es un error, para que un error de tecleo nunca deje el servidor sin firma sin decirlo.
 *
 * @param configuracion - El texto JSON de la variable, o undefined si no está.
 * @returns Las claves, o null si no hay que firmar.
 * @throws {Error} ClavesDeFirmaInvalidas si el texto no es JSON o la combinación de claves no cuadra.
 */
export function clavesDeFirmaDe(configuracion: string | undefined): ClaveDeFirma[] | null {
  if (!configuracion?.trim()) {
    return null;
  }
  let leidas: unknown;
  try {
    leidas = JSON.parse(configuracion);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new ClavesDeFirmaInvalidas('FARO_FIRMA_MCP_CLAVES no es un JSON válido');
  }
  if (!Array.isArray(leidas) || !leidas.every(esClaveDeFirma)) {
    throw new ClavesDeFirmaInvalidas('FARO_FIRMA_MCP_CLAVES debe ser una lista de { algoritmo, publica, privada }');
  }
  exigirLaCombinacion(leidas);
  return leidas;
}

/**
 * El mensaje que se firma: la PAE de DSSE con el tipo de las respuestas (mensajeAFirmar).
 *
 * @param contenido - El contenido que se firma, en bytes.
 * @returns El mensaje que firma cada algoritmo.
 */
export function mensajeDeLaRespuesta(contenido: Uint8Array): Uint8Array<ArrayBuffer> {
  return mensajeAFirmar(TIPO_RESPUESTA_MCP, contenido);
}

/**
 * El resultado sin su firma: lo que se firma y lo que se comprueba. Un `_meta` que queda vacío se quita, para que un
 * resultado que no llevaba `_meta` antes de firmarse se reconstruya igual al comprobarlo.
 */
function sinFirma(resultado: Record<string, unknown>): Record<string, unknown> {
  if (!esObjeto(resultado._meta)) {
    return resultado;
  }
  const { [META_FIRMA]: _firma, ...meta } = resultado._meta;
  const { _meta: _conFirma, ...resto } = resultado;
  return Object.keys(meta).length ? { ...resto, _meta: meta } : resto;
}

/** Los bytes del JSON canónico del resultado sin su firma. */
function contenidoDe(resultado: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  return texto.encode(jsonCanonico(sinFirma(resultado)));
}

/** Importa una clave y comprueba que su privada firma lo que su pública acepta; el id es la huella de la pública. */
async function importar(subtle: SubtleParaFirmar, clave: ClaveDeFirma): Promise<ClaveImportada> {
  const { nombre, formatoDeClave, bytesDeLaClave } = ALGORITMOS_DE_LA_RESPUESTA[clave.algoritmo];
  const publica = bytesDeBase64(clave.publica);
  const privada = bytesDeBase64(clave.privada);
  if (!publica || !privada || publica.length !== bytesDeLaClave) {
    throw new ClavesDeFirmaInvalidas(`La clave ${clave.algoritmo} no está en base64 o la pública no tiene su tamaño`);
  }
  const algoritmo = { name: nombre };
  let importada: CryptoKey;
  let acepta = false;
  try {
    importada = await subtle.importKey('pkcs8', privada, algoritmo, false, ['sign']);
    const deComprobacion = await subtle.importKey(formatoDeClave, publica, algoritmo, false, ['verify']);
    const firma = new Uint8Array(await subtle.sign(algoritmo, importada, SONDA));
    acepta = await subtle.verify(algoritmo, deComprobacion, firma, SONDA);
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new ClavesDeFirmaInvalidas(`Esta plataforma no admite la clave ${clave.algoritmo}: ${motivo}`);
  }
  if (!acepta) {
    throw new ClavesDeFirmaInvalidas(`La privada ${clave.algoritmo} no corresponde a su pública`);
  }
  return { algoritmo: clave.algoritmo, id: sha256Hex(publica), privada: importada };
}

/**
 * El firmador con las claves dadas (clavesDeFirmaDe), importadas con Web Crypto y comprobadas una a una. Falla, con
 * ClavesDeFirmaInvalidas, si una clave no sirve o la plataforma no trae su algoritmo.
 *
 * @param claves - Las claves de firma, una por algoritmo de la combinación.
 * @param subtle - La implementación de Web Crypto; por defecto, la de la plataforma.
 * @returns El firmador, con las claves ya importadas.
 * @throws {Error} ClavesDeFirmaInvalidas si una clave no sirve o la plataforma no trae su algoritmo.
 */
export async function crearFirmadorMcp(
  claves: readonly ClaveDeFirma[],
  subtle: SubtleCrypto = crypto.subtle,
): Promise<FirmadorMcp> {
  exigirLaCombinacion(claves);
  // Los tipos de Web Crypto no conocen «raw-public»; lo que la plataforma admite lo dice `importar`, en ejecución.
  const nativa = subtle as unknown as SubtleParaFirmar;
  const importadas: ClaveImportada[] = [];
  for (const clave of claves) {
    importadas.push(await importar(nativa, clave));
  }
  return {
    ids: importadas.map(({ id }) => id),
    async firmar(resultado) {
      const mensaje = mensajeDeLaRespuesta(contenidoDe(resultado));
      const firmas: FirmaDeRespuesta['firmas'] = [];
      for (const { algoritmo, id, privada } of importadas) {
        const firma = await nativa.sign({ name: ALGORITMOS_DE_LA_RESPUESTA[algoritmo].nombre }, privada, mensaje);
        firmas.push({ algoritmo, clave: id, firma: aBase64(new Uint8Array(firma)) });
      }
      return { formato: FORMATO_DE_LA_FIRMA, tipo: TIPO_RESPUESTA_MCP, firmas };
    },
  };
}

/**
 * El resultado con su firma en `_meta`; lo firmado es el resultado tal como está, sin ninguna firma anterior.
 *
 * @param resultado - El resultado que se devuelve.
 * @param firmador - Quien firma.
 * @returns El resultado con su firma en `_meta`.
 */
export async function firmarResultado(
  resultado: Record<string, unknown>,
  firmador: FirmadorMcp,
): Promise<Record<string, unknown>> {
  const limpio = sinFirma(resultado);
  const meta = esObjeto(limpio._meta) ? limpio._meta : {};
  return { ...limpio, _meta: { ...meta, [META_FIRMA]: await firmador.firmar(limpio) } };
}

/**
 * El sobre de la firma de un resultado recibido, para comprobarlo con el código del dispositivo (`comprobarSobre` o
 * `comprobarSobreNativo`, con `tipo` TIPO_RESPUESTA_MCP, la combinación diaria y las claves públicas diarias): el
 * tipo, el resultado sin su firma en JSON canónico como contenido, y sus firmas. Null si el resultado no lleva
 * firma, contiene Unicode malformado, no tiene la forma de un resultado o supera
 * MAX_PROFUNDIDAD_DEL_RESULTADO niveles.
 *
 * @param resultado - El resultado recibido, tal como llegó.
 * @returns El sobre listo para comprobar, o null si no hay forma de comprobarlo.
 */
export function sobreDeLaRespuesta(resultado: unknown): { tipo: string; contenido: string; firmas: unknown } | null {
  if (!esObjeto(resultado) || !esObjeto(resultado._meta) || !cabeEnProfundidad(resultado)) {
    return null;
  }
  const firma = resultado._meta[META_FIRMA];
  if (!esObjeto(firma) || firma.formato !== FORMATO_DE_LA_FIRMA || firma.tipo !== TIPO_RESPUESTA_MCP) {
    return null;
  }
  try {
    return { tipo: TIPO_RESPUESTA_MCP, contenido: aBase64(contenidoDe(resultado)), firmas: firma.firmas };
  } catch (error) {
    if (error instanceof TextoJcsInvalido) {
      return null;
    }
    throw error;
  }
}
