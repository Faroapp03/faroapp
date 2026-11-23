// Guardas de forma para valores externos ya deserializados, sin normalizar ni sustituir los datos.
// Los límites de tamaño y rango corresponden al consumidor. Las excepciones de accesores y guardas se propagan.
// El JSDoc tipado permite generar JavaScript comprobable después de borrar los tipos de TypeScript.

/** Una comprobación de la forma completa de un valor antes de usarlo con su tipo. */
export type Guarda<Forma> = (valor: unknown) => valor is Forma;

/**
 * Los campos que admiten undefined son opcionales; los demás son obligatorios.
 * Solo se infieren claves string o numéricas, que Object.entries convierte a string; omite los símbolos.
 * TypeScript y el JavaScript generado conservan este nombre para reconocer la misma forma.
 * @template Campos
 * @typedef {{
 *   [Clave in Extract<keyof Campos, string | number> as undefined extends (Campos[Clave] extends
 *     ((valor: unknown) => valor is infer Forma) ? Forma : never) ? never : Clave]:
 *       Campos[Clave] extends ((valor: unknown) => valor is infer Forma) ? Forma : never
 * } & {
 *   [Clave in Extract<keyof Campos, string | number> as undefined extends (Campos[Clave] extends
 *     ((valor: unknown) => valor is infer Forma) ? Forma : never) ? Clave : never]?:
 *       Campos[Clave] extends ((valor: unknown) => valor is infer Forma) ? Forma : never
 * }} FormaDe
 */
type FormaDe<Campos> = {
  [Clave in Extract<keyof Campos, string | number> as undefined extends (
    Campos[Clave] extends Guarda<infer Forma>
      ? Forma
      : never
  )
    ? never
    : Clave]: Campos[Clave] extends Guarda<infer Forma> ? Forma : never;
} & {
  [Clave in Extract<keyof Campos, string | number> as undefined extends (
    Campos[Clave] extends Guarda<infer Forma>
      ? Forma
      : never
  )
    ? Clave
    : never]?: Campos[Clave] extends Guarda<infer Forma> ? Forma : never;
};

/**
 * Un valor del que se pueden leer campos unknown; también una lista tiene campos.
 * @param {unknown} valor
 * @returns {valor is Record<string, unknown>}
 */
function tieneCampos(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

/**
 * Texto, sin añadir límites al contrato de string.
 * @param {unknown} valor
 * @returns {valor is string}
 */
export function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string';
}

/**
 * Número, sin sustituir las políticas numéricas del dominio.
 * @param {unknown} valor
 * @returns {valor is number}
 */
export function esNumero(valor: unknown): valor is number {
  return typeof valor === 'number';
}

/**
 * Booleano, sin admitir otros valores verdaderos o falsos.
 * @param {unknown} valor
 * @returns {valor is boolean}
 */
export function esBooleano(valor: unknown): valor is boolean {
  return typeof valor === 'boolean';
}

/**
 * Un objeto del que se leen campos unknown: ni null ni una lista, que también son `object`.
 * @param {unknown} valor
 * @returns {valor is Record<string, unknown>}
 */
export function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return tieneCampos(valor) && !Array.isArray(valor);
}

/**
 * Los campos del objeto original, incluidas las listas, o un objeto vacío si el valor no los tiene.
 * @param {unknown} valor
 * @returns {Readonly<Record<string, unknown>>}
 */
export function camposDe(valor: unknown): Readonly<Record<string, unknown>> {
  return tieneCampos(valor) ? valor : {};
}

/**
 * La lista original, con elementos todavía unknown, o una lista vacía si no es una lista.
 * @param {unknown} valor
 * @returns {readonly unknown[]}
 */
export function listaDe(valor: unknown): readonly unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/**
 * El texto original o un texto vacío si el valor no es un texto.
 * @param {unknown} valor
 * @returns {string}
 */
export function textoDe(valor: unknown): string {
  return esTexto(valor) ? valor : '';
}

/**
 * Lista cuyos elementos cumplen todos la misma guarda, sin cambiar la lista recibida.
 * @template Forma
 * @param {(valor: unknown) => valor is Forma} esForma
 * @returns {(valor: unknown) => valor is Forma[]}
 */
export function esListaDe<Forma>(esForma: Guarda<Forma>): Guarda<Forma[]> {
  return /** @param {unknown} valor @returns {valor is Forma[]} */ (valor): valor is Forma[] => {
    if (!Array.isArray(valor)) {
      return false;
    }
    for (const elemento of valor) {
      if (!esForma(elemento)) {
        return false;
      }
    }
    return true;
  };
}

/**
 * Objeto cuyas propiedades propias de clave string cumplen la guarda, incluidas las no enumerables.
 * Lee todos sus valores antes de comprobarlos, conservando el orden y los efectos de sus accesores.
 *
 * @template Forma
 * @param {(valor: unknown) => valor is Forma} esForma Guarda de cada valor.
 * @returns {(valor: unknown) => valor is Record<string, Forma>} La guarda del objeto entero.
 */
export function esRegistroDe<Forma>(esForma: Guarda<Forma>): Guarda<Record<string, Forma>> {
  return /** @param {unknown} valor @returns {valor is Record<string, Forma>} */ (
    valor,
  ): valor is Record<string, Forma> =>
    esObjeto(valor) &&
    Object.getOwnPropertyNames(valor)
      .map((clave) => valor[clave])
      .every(esForma);
}

/**
 * Un campo que puede faltar o valer undefined; cualquier otro valor tiene que cumplir su guarda.
 * @template Forma
 * @param {(valor: unknown) => valor is Forma} esForma
 * @returns {(valor: unknown) => valor is Forma | undefined}
 */
export function esOpcional<Forma>(esForma: Guarda<Forma>): Guarda<Forma | undefined> {
  return /** @param {unknown} valor @returns {valor is Forma | undefined} */ (valor): valor is Forma | undefined =>
    valor === undefined || esForma(valor);
}

/**
 * Un campo que admite null además de los valores que comprueba su guarda.
 * @template Forma
 * @param {(valor: unknown) => valor is Forma} esForma
 * @returns {(valor: unknown) => valor is Forma | null}
 */
export function esNuloO<Forma>(esForma: Guarda<Forma>): Guarda<Forma | null> {
  return /** @param {unknown} valor @returns {valor is Forma | null} */ (valor): valor is Forma | null =>
    valor === null || esForma(valor);
}

/**
 * Objeto con una guarda por campo; permite extras y solo lee propiedades propias del valor.
 * La configuración debe declarar sus campos como propiedades propias enumerables de clave string o numérica.
 * Los símbolos no se recorren ni se incluyen en la forma inferida; no se valida la configuración en ejecución.
 * Una guarda cuyo tipo admite undefined produce un campo opcional, sin añadirlo al objeto recibido.
 * @template {Record<string, (valor: unknown) => valor is unknown>} Campos
 * @param {Campos} campos
 * @returns {(valor: unknown) => valor is FormaDe<Campos>}
 */
export function esFormaDe<Campos extends Record<string, Guarda<unknown>>>(campos: Campos): Guarda<FormaDe<Campos>> {
  return (
    /**
     * @param {unknown} valor
     * @returns {valor is FormaDe<Campos>}
     */
    (valor): valor is FormaDe<Campos> =>
      esObjeto(valor) &&
      Object.entries(campos).every(([clave, esCampo]) =>
        esCampo(Object.hasOwn(valor, clave) ? valor[clave] : undefined),
      )
  );
}
