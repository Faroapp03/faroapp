// Validador del subconjunto de JSON Schema que usa Faro: para lo que devuelve el modelo y para lo que llega a la API.
// Sin dependencias externas. Solo se miran las propiedades propias: una clave heredada como «constructor» o
// «__proto__» nunca cuenta como propiedad prevista ni como propiedad presente.
// `validar` es recursiva (por erroresDeLista y erroresDeObjeto), y la acota el esquema, no el valor: solo baja por las
// claves de `items` y `properties`, y los esquemas son constantes del código, de unos pocos niveles. Un valor más
// profundo que su esquema no se recorre más abajo. El trabajo y la memoria también están acotados: una lista que
// pasa de `maxItems` no se recorre, y no se juntan más de MAX_ERRORES errores.
// Diferencia con JSON Schema: minLength y maxLength se miden en unidades UTF-16 (`length` de JavaScript), no en puntos
// de código; un carácter fuera del plano básico (un emoji) cuenta 2. Para esos textos, maxLength puede ser más
// estricto y minLength más permisivo que la validación estándar. No se atribuye a este subconjunto soporte de oneOf.

import { esObjeto } from './json.ts';

/** Esquema de un valor: el subconjunto de JSON Schema que entiende `validar`. */
export interface Esquema {
  type?: string | string[];
  enum?: readonly unknown[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: Esquema;
  required?: readonly string[];
  properties?: Record<string, Esquema>;
  additionalProperties?: boolean;
}

/** Los tipos de JSON Schema y los demás que puede devolver `typeof`, que no son de JSON. */
type Tipo =
  | 'null'
  | 'array'
  | 'integer'
  | 'number'
  | 'string'
  | 'boolean'
  | 'object'
  | 'undefined'
  | 'bigint'
  | 'symbol'
  | 'function';

/** Errores que se juntan como mucho: bastan para corregir la entrada y acotan la respuesta a un valor enorme. */
const MAX_ERRORES = 20;

declare const tipoDelEsquema: unique symbol;

/**
 * Un esquema que describe valores de tipo `T`: el tipo se declara una sola vez, junto al esquema, y quien valida con él
 * (`cumple`) lo recibe sin aserciones. La marca solo existe para el compilador.
 */
export type EsquemaDe<T> = Esquema & { readonly [tipoDelEsquema]?: T };

/**
 * Añade errores a la lista sin pasarlos como argumentos sueltos (una lista enorme superaría el límite de argumentos)
 * y sin pasar de MAX_ERRORES.
 *
 * @param errores - Lista que se amplía.
 * @param nuevos - Errores que se añaden, en orden.
 */
function anadir(errores: string[], nuevos: readonly string[]): void {
  for (const error of nuevos) {
    if (errores.length >= MAX_ERRORES) {
      return;
    }
    errores.push(error);
  }
}

/** Tipo de un valor con los nombres de JSON Schema, que separan lo que `typeof` junta: null, listas y enteros. */
function tipoDe(valor: unknown): Tipo {
  if (valor === null) {
    return 'null';
  }
  if (Array.isArray(valor)) {
    return 'array';
  }
  if (Number.isInteger(valor)) {
    return 'integer';
  }
  return typeof valor;
}

/** Tipos que admite el esquema: `type` puede traer uno, varios o ninguno (entonces vale cualquiera). */
function tiposAdmitidos(esquema: Esquema): string[] {
  if (Array.isArray(esquema.type)) {
    return esquema.type;
  }
  return esquema.type ? [esquema.type] : [];
}

/** Como en JSON Schema, un entero cumple también el tipo «number». */
function tipoAceptado(tipo: Tipo, admitidos: string[]): boolean {
  if (!admitidos.length || admitidos.includes(tipo)) {
    return true;
  }
  return tipo === 'integer' && admitidos.includes('number');
}

/** Lo que incumple un texto: su longitud y su patrón. */
function erroresDeTexto(valor: string, esquema: Esquema, ruta: string): string[] {
  const errores: string[] = [];
  if (esquema.minLength != null && valor.length < esquema.minLength) {
    errores.push(`${ruta}: texto demasiado corto`);
  }
  if (esquema.maxLength != null && valor.length > esquema.maxLength) {
    errores.push(`${ruta}: texto demasiado largo`);
  }
  if (esquema.pattern != null && !new RegExp(esquema.pattern, 'u').test(valor)) {
    errores.push(`${ruta}: formato no válido`);
  }
  return errores;
}

/** Lo que incumple un número: su mínimo y su máximo. */
function erroresDeNumero(valor: number, esquema: Esquema, ruta: string): string[] {
  const errores: string[] = [];
  if (esquema.minimum != null && valor < esquema.minimum) {
    errores.push(`${ruta}: por debajo del mínimo`);
  }
  if (esquema.maximum != null && valor > esquema.maximum) {
    errores.push(`${ruta}: por encima del máximo`);
  }
  return errores;
}

/** Lo que incumple una lista: su tamaño y, con `items` y si el tamaño cabe, cada elemento. */
function erroresDeLista(valor: unknown[], esquema: Esquema, ruta: string): string[] {
  const errores: string[] = [];
  if (esquema.minItems != null && valor.length < esquema.minItems) {
    errores.push(`${ruta}: pocos elementos`);
  }
  if (esquema.maxItems != null && valor.length > esquema.maxItems) {
    // Una lista demasiado larga ya es inválida: recorrerla solo gastaría trabajo en un valor que se rechaza.
    return [`${ruta}: demasiados elementos`];
  }
  const esquemaElemento = esquema.items;
  if (!esquemaElemento) {
    return errores;
  }
  for (const [i, elemento] of valor.entries()) {
    if (errores.length >= MAX_ERRORES) {
      break;
    }
    anadir(errores, validar(elemento, esquemaElemento, `${ruta}[${i}]`));
  }
  return errores;
}

/** Las propiedades propias de clave string se comprueban aunque no sean enumerables. */
function erroresDeObjeto(valor: Record<string, unknown>, esquema: Esquema, ruta: string): string[] {
  const errores: string[] = [];
  for (const requerida of esquema.required ?? []) {
    if (!Object.hasOwn(valor, requerida)) {
      errores.push(`${ruta}.${requerida}: falta`);
    }
  }
  const propiedades = esquema.properties ?? {};
  const entradas = Object.getOwnPropertyNames(valor).map((clave): [string, unknown] => [clave, valor[clave]]);
  for (const [clave, valorPropiedad] of entradas) {
    if (errores.length >= MAX_ERRORES) {
      break;
    }
    if (Object.hasOwn(propiedades, clave)) {
      anadir(errores, validar(valorPropiedad, propiedades[clave] as Esquema, `${ruta}.${clave}`));
    } else if (esquema.additionalProperties === false) {
      errores.push(`${ruta}.${clave}: propiedad no prevista`);
    }
  }
  return errores;
}

/**
 * Guarda de tipo: el valor cumple el esquema y, desde ahí, es un `T`.
 *
 * @param valor - Valor que se comprueba, de cualquier origen.
 * @param esquema - Esquema que declara el tipo `T`.
 * @returns Si el valor cumple el esquema.
 */
export function cumple<T>(valor: unknown, esquema: EsquemaDe<T>): valor is T {
  return validar(valor, esquema).length === 0;
}

/**
 * Devuelve la lista de errores del valor frente al esquema; vacía si lo cumple.
 *
 * @param valor - Valor que se comprueba, de cualquier origen.
 * @param esquema - Esquema del subconjunto que entiende este validador.
 * @param ruta - Ruta del valor dentro del documento, en la forma `$.campo[0]`, para los mensajes.
 * @returns Hasta MAX_ERRORES mensajes, cada uno con la ruta de lo que incumple; vacía si lo cumple.
 */
export function validar(valor: unknown, esquema: Esquema, ruta = '$'): string[] {
  const admitidos = tiposAdmitidos(esquema);
  const tipo = tipoDe(valor);
  // Con el tipo equivocado, el resto de reglas no tiene sentido: se informa solo de eso.
  if (!tipoAceptado(tipo, admitidos)) {
    return [`${ruta}: se esperaba ${admitidos.join('|')}`];
  }
  const errores: string[] = [];
  if (esquema.enum && !esquema.enum.includes(valor)) {
    errores.push(`${ruta}: valor no permitido`);
  }
  if (typeof valor === 'string') {
    anadir(errores, erroresDeTexto(valor, esquema, ruta));
  }
  if (typeof valor === 'number') {
    anadir(errores, erroresDeNumero(valor, esquema, ruta));
  }
  if (Array.isArray(valor)) {
    anadir(errores, erroresDeLista(valor, esquema, ruta));
  }
  if (esObjeto(valor)) {
    anadir(errores, erroresDeObjeto(valor, esquema, ruta));
  }
  return errores;
}
