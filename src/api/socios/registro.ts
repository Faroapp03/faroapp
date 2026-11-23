/** Secretos institucionales aleatorios y autenticación mediante huellas completas de las claves vigentes. */
import { aBase64Url } from '../../comun/base64url.js';
import { sha256Hex } from '../../comun/huella.ts';

/**
 * Bytes al azar de un secreto: 256 bits. RFC 6749, 10.10, pide que adivinar una credencial tenga una probabilidad de
 * 2^-128 como mucho y recomienda 2^-160.
 */
const SECRETO_BYTES = 32;
/** Los caracteres de una huella SHA-256 en hexadecimal. */
const CARACTERES_DE_LA_HUELLA = 64;
/** Huellas vigentes a la vez de un socio: la del secreto y la del nuevo mientras se cambia. */
const MAX_HUELLAS_POR_SOCIO = 2;
/**
 * La huella con que se compara un secreto cuando el socio no existe: mantiene el mismo número de comparaciones
 * completas que con un socio real. Este recorrido no garantiza tiempos idénticos de ejecución en JavaScript.
 */
const HUELLA_DE_NADIE = '0'.repeat(CARACTERES_DE_LA_HUELLA);
/** Huella SHA-256 completa: cada token queda ligado a la clave exacta con que se obtuvo. */
export const CARACTERES_DE_LA_CREDENCIAL = CARACTERES_DE_LA_HUELLA;

/** Un socio dado de alta: su identificador, las huellas de sus secretos vigentes y su límite de consultas. */
export interface Socio {
  readonly id: string;
  readonly huellas: readonly string[];
  readonly consultasPorHora: number;
}

/** Un socio autenticado y la credencial con que lo ha hecho. */
export interface SocioAutenticado {
  readonly socio: Socio;
  /**
   * La huella completa del secreto presentado (CARACTERES_DE_LA_CREDENCIAL): va dentro de cada token, y un
   * token cuya credencial ya no está en el registro deja de valer cuando la instancia lee el registro nuevo.
   */
  readonly credencial: string;
}

/** Si dos textos son iguales, recorriendo todos sus caracteres sin retornar por la primera diferencia. */
function igualesEnTiempoConstante(uno: string, otro: string): boolean {
  let diferencia = uno.length ^ otro.length;
  const largo = Math.max(uno.length, otro.length);
  for (let i = 0; i < largo; i++) {
    diferencia |= (uno.charCodeAt(i) || 0) ^ (otro.charCodeAt(i) || 0);
  }
  return diferencia === 0;
}

/**
 * La huella SHA-256 (en hexadecimal) de un secreto: lo único que se guarda de él.
 *
 * @param secreto - El secreto en claro.
 * @returns Su huella, en hexadecimal.
 */
export function huellaDelSecreto(secreto: string): string {
  return sha256Hex(secreto);
}

/**
 * Un secreto nuevo para un socio: 256 bits al azar en base64url (43 caracteres).
 *
 * @returns El secreto, en base64url.
 */
export function secretoNuevo(): string {
  return aBase64Url(crypto.getRandomValues(new Uint8Array(SECRETO_BYTES)));
}

/**
 * El socio cuyas credenciales son estas, con la credencial que ha usado, o null. La huella del secreto se calcula y
 * se compara siempre entera y siempre MAX_HUELLAS_POR_SOCIO veces (las que faltan, con HUELLA_DE_NADIE), exista el
 * socio o no y tenga una huella o dos: el número de comparaciones no distingue los casos.
 *
 * @param socio - La institución vigente que presenta la clave; null si no existe.
 * @param secreto - El secreto que presenta.
 * @returns El socio y su credencial, o null si no coinciden.
 */
export function autenticarSocio(socio: Socio | null, secreto: string): SocioAutenticado | null {
  const huellas = socio?.huellas ?? [];
  const presentada = huellaDelSecreto(secreto);
  let coincidente: string | null = null;
  for (let i = 0; i < MAX_HUELLAS_POR_SOCIO; i++) {
    const huella = huellas[i] ?? HUELLA_DE_NADIE;
    if (igualesEnTiempoConstante(presentada, huella) && i < huellas.length) {
      coincidente = huella;
    }
  }
  return socio && coincidente !== null ? { socio, credencial: coincidente } : null;
}
