/** Política administrativa portable: no contiene proveedores, secretos ni configuración de despliegue. */

export type ModoApi = 'deshabilitada' | 'habilitada';
export interface PoliticaControles {
  readonly version: 2;
  readonly api: ModoApi;
  readonly mcp: boolean;
  readonly a2a: boolean;
}
export interface DocumentoControles extends PoliticaControles {
  readonly revision: number;
}
export type ResultadoCambioControles = {
  readonly estado: 'cambiado' | 'conflicto';
  readonly controles: DocumentoControles;
};
/** Autoridad de los tres servicios; las instituciones invitadas se gestionan en un contrato separado. */
export interface AlmacenControles {
  /** Una sola vez; no sustituye la política de una instalación ya preparada. */
  activarControles(inicial: PoliticaControles): Promise<DocumentoControles>;
  /** null significa que esta autoridad nunca se habilitó; cualquier estado incompleto provoca error. */
  leerControles(): Promise<DocumentoControles | null>;
  cambiarControles(revisionEsperada: number, politica: PoliticaControles): Promise<ResultadoCambioControles>;
}

function invalido(): never {
  throw new Error('Controles administrativos no válidos');
}
function objetoCerrado(entrada: unknown, claves: readonly string[]): Record<string, unknown> {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    invalido();
  }
  const prototipo: unknown = Object.getPrototypeOf(entrada);
  if (
    (prototipo !== Object.prototype && prototipo !== null) ||
    Object.getOwnPropertySymbols(entrada).length ||
    Object.getOwnPropertyNames(entrada).length !== claves.length
  ) {
    invalido();
  }
  const copia: Record<string, unknown> = {};
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      invalido();
    }
    copia[clave] = descriptor.value;
  }
  return copia;
}
export function esRevisionControles(entrada: unknown): entrada is number {
  return typeof entrada === 'number' && Number.isSafeInteger(entrada) && entrada >= 0;
}
const CLAVES_POLITICA = ['version', 'api', 'mcp', 'a2a'] as const;
function politicaDelObjeto(objeto: Record<string, unknown>): PoliticaControles {
  if (
    objeto.version !== 2 ||
    (objeto.api !== 'deshabilitada' && objeto.api !== 'habilitada') ||
    typeof objeto.mcp !== 'boolean' ||
    typeof objeto.a2a !== 'boolean'
  ) {
    invalido();
  }
  return {
    version: 2,
    api: objeto.api as ModoApi,
    mcp: objeto.mcp,
    a2a: objeto.a2a,
  };
}
/** Valida una política completa y devuelve una copia sin accesores ni propiedades ajenas. */
export function leerPoliticaControles(entrada: unknown): PoliticaControles {
  return politicaDelObjeto(objetoCerrado(entrada, CLAVES_POLITICA));
}
/** Valida también revisiones de lecturas durables o remotas; nunca corrige entradas. */
export function leerDocumentoControles(entrada: unknown): DocumentoControles {
  const objeto = objetoCerrado(entrada, [...CLAVES_POLITICA, 'revision']);
  if (!esRevisionControles(objeto.revision)) {
    invalido();
  }
  return { ...politicaDelObjeto(objeto), revision: objeto.revision };
}
