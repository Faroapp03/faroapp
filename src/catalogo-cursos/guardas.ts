// Guardas básicas de la entrega del catálogo: textos, huellas, fechas, URL, vocabularios y formas cerradas. Las
// comparten la forma de la oferta y la de su clasificación, para que ambas exijan exactamente lo mismo.
import { esFormaDe, type Guarda } from '../comun/json.ts';
import { CatalogoNoValido, MAX_FILAS_CATALOGO, MAX_TEXTO_CATALOGO } from './contrato.ts';
import { instanteCatalogo } from './vigencia.ts';

export const esSha = (valor: unknown): valor is string => typeof valor === 'string' && /^[0-9a-f]{64}$/u.test(valor);
const PRIMER_IMPRIMIBLE = 32;
export const esTexto = (valor: unknown): valor is string =>
  typeof valor === 'string' &&
  valor.length > 0 &&
  Array.from(valor).length <= MAX_TEXTO_CATALOGO &&
  !Array.from(valor).some((caracter) => caracter.charCodeAt(0) < PRIMER_IMPRIMIBLE) &&
  valor.isWellFormed();

export function unaDe<const Valores extends readonly string[]>(valores: Valores): Guarda<Valores[number]> {
  return (valor): valor is Valores[number] =>
    typeof valor === 'string' && valores.some((candidato) => candidato === valor);
}

export function forma<Campos extends Record<string, Guarda<unknown>>>(campos: Campos) {
  const guarda = esFormaDe(campos);
  return (valor: unknown): valor is Parameters<typeof guarda>[0] & ReturnTypeForma<typeof guarda> =>
    guarda(valor) && Object.keys(valor).length === Object.keys(campos).length;
}
type ReturnTypeForma<T> = T extends Guarda<infer V> ? V : never;

export function lista<T>(guarda: Guarda<T>, maximo = MAX_FILAS_CATALOGO): Guarda<readonly T[]> {
  return (valor): valor is readonly T[] =>
    Array.isArray(valor) && valor.length <= maximo && Array.from(valor).every(guarda);
}

export function esFecha(valor: unknown): valor is string {
  if (!esTexto(valor)) {
    return false;
  }
  try {
    instanteCatalogo(valor);
    return true;
  } catch (error) {
    if (error instanceof CatalogoNoValido) {
      return false;
    }
    throw error;
  }
}

/**
 * Los mismos espacios que rechaza el contrato del productor: `\s` de JavaScript más los de `str.isspace` de Python.
 * De estos últimos, solo U+0085 no es espacio para JavaScript ni carácter de control.
 */
const ESPACIO_EN_URL = /[\s\u0085\\]/u;

export function esUrl(valor: unknown): valor is string {
  if (!esTexto(valor) || ESPACIO_EN_URL.test(valor)) {
    return false;
  }
  try {
    const url = new URL(valor);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

/** Las evidencias de materia y de clasificación identifican su fuente por dominio público, nunca por una IP literal. */
export function esUrlDeDominioPublico(valor: unknown): valor is string {
  if (!esUrl(valor)) {
    return false;
  }
  const original = /^https?:\/\/([^/?#:]+)(?::[0-9]+)?(?:[/?#]|$)/iu.exec(valor)?.[1];
  if (!original) {
    return false;
  }
  const etiquetas = original.toLowerCase().split('.');
  const ultimo = etiquetas.at(-1) ?? '';
  return (
    etiquetas.length > 1 &&
    /^[a-z][a-z0-9-]*$/u.test(ultimo) &&
    !['local', 'internal', 'localhost', 'localdomain', 'onion', 'test', 'invalid'].includes(ultimo) &&
    etiquetas.every((e) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(e))
  );
}

/** Compara como Python: puntos Unicode, sin traducción, locale ni orden UTF-16. */
export function compararTextos(a: string, b: string): number {
  const izquierda = a[Symbol.iterator]();
  const derecha = b[Symbol.iterator]();
  while (true) {
    const x = izquierda.next();
    const y = derecha.next();
    if (x.done && y.done) {
      return 0;
    }
    if (x.done) {
      return -1;
    }
    if (y.done) {
      return 1;
    }
    const px = puntoUnicode(x.value);
    const py = puntoUnicode(y.value);
    if (px !== py) {
      return px - py;
    }
  }
}

function puntoUnicode(caracter: string): number {
  const punto = caracter.codePointAt(0);
  if (punto === undefined) {
    throw new CatalogoNoValido('Texto Unicode no válido');
  }
  return punto;
}
