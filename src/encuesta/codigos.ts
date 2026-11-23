/**
 * Los códigos de un solo uso de la encuesta. Cada código lleva delante su tipo, que no es secreto porque se ve en el
 * enlace de invitación, y detrás siete grupos de cuatro símbolos al azar: 28 símbolos de 5 bits, 140 bits de aleatoriedad
 * criptográfica. El alfabeto es el de Crockford (sin I, L, O ni U) para que se pueda teclear sin confundir letras y
 * cifras. El servidor solo conoce la huella SHA-256 del código completo; con 140 bits al azar no hace falta sal para que
 * la huella no permita recuperarlo.
 */
import { sha256Hex } from '../comun/huella.ts';
import { EncuestaInvalida } from './contrato.ts';
import type { TipoDeCodigo } from './cuestionario.ts';

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GRUPOS = 7;
const SIMBOLOS_POR_GRUPO = 4;
/** 32 símbolos: cada byte al azar, reducido a sus 5 bits bajos, da un símbolo uniforme (256 es múltiplo de 32). */
const MASCARA_SIMBOLO = 0b1_1111;
/** Valores distintos de un Uint32Array: el rango de cada muestra al barajar. */
const RANGO_DE_LA_MUESTRA = 4_294_967_296;
const PREFIJOS: Readonly<Record<TipoDeCodigo, string>> = { participante: 'PART', profesional: 'PROF' };
const FORMATO = /^(PART|PROF)(-[0-9A-HJKMNP-TV-Z]{4}){7}$/;
/** Bits de aleatoriedad de cada código, para documentarlo y comprobarlo en las pruebas. */
export const BITS_DE_ALEATORIEDAD = GRUPOS * SIMBOLOS_POR_GRUPO * Math.log2(ALFABETO.length);

/** Un código nuevo del tipo dado, en su forma canónica (mayúsculas y guiones). */
export function codigoNuevo(tipo: TipoDeCodigo): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GRUPOS * SIMBOLOS_POR_GRUPO));
  const simbolos = Array.from(bytes, (byte) => ALFABETO[byte & MASCARA_SIMBOLO]);
  const grupos: string[] = [];
  for (let i = 0; i < GRUPOS; i += 1) {
    grupos.push(simbolos.slice(i * SIMBOLOS_POR_GRUPO, (i + 1) * SIMBOLOS_POR_GRUPO).join(''));
  }
  return [PREFIJOS[tipo], ...grupos].join('-');
}

/** El tipo de un código en forma canónica; cualquier otra forma se rechaza sin copiar el valor recibido. */
export function leerCodigo(entrada: unknown): { readonly codigo: string; readonly tipo: TipoDeCodigo } {
  if (typeof entrada !== 'string' || !FORMATO.test(entrada)) {
    throw new EncuestaInvalida();
  }
  return { codigo: entrada, tipo: entrada.startsWith(PREFIJOS.profesional) ? 'profesional' : 'participante' };
}

export function huellaDelCodigo(codigo: string): string {
  return sha256Hex(codigo);
}

/** Un entero uniforme en [0, tope) con rechazo, para no favorecer ninguna posición al barajar. */
function enteroAlAzar(tope: number): number {
  const limite = Math.floor(RANGO_DE_LA_MUESTRA / tope) * tope;
  const muestra = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(muestra);
    const valor = muestra[0] ?? 0;
    if (valor < limite) {
      return valor % tope;
    }
  }
}
/** Fisher-Yates con azar criptográfico: el orden impreso no dice nada del orden en que se generaron. */
export function barajar<T>(lista: readonly T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = enteroAlAzar(i + 1);
    const elegido = copia[j] as T;
    copia[j] = copia[i] as T;
    copia[i] = elegido;
  }
  return copia;
}
