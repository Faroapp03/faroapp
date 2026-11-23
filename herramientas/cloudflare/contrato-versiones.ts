/** Errores y lectura estricta que comparten el adaptador de versiones y los perfiles de cada Worker. */

export type CodigoError =
  | 'entrada-invalida'
  | 'configuracion-incompatible'
  | 'artefacto-invalido'
  | 'wrangler-incierto'
  | 'resultado-invalido'
  | 'deployment-distinto';
/**
 * Qué se sabe del efecto en Cloudflare: `ninguno` si el fallo es anterior a lanzar la orden que lo cambia,
 * `rechazado` si Cloudflare la rechazó de forma explícita y completa, e `incierto` en cualquier otro caso.
 */
export type EfectoError = 'ninguno' | 'rechazado' | 'incierto';
export class ErrorVersionesCloudflare extends Error {
  readonly codigo: CodigoError;
  efecto: EfectoError;
  constructor(codigo: CodigoError, efecto: EfectoError = 'ninguno') {
    super(codigo);
    this.codigo = codigo;
    this.efecto = efecto;
  }
}
export function exigir(condicion: unknown, codigo: CodigoError): asserts condicion {
  if (!condicion) {
    throw new ErrorVersionesCloudflare(codigo);
  }
}
export function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}
export function cerrado(valor: unknown, campos: string): valor is Record<string, unknown> {
  return objeto(valor) && Object.keys(valor).sort().join(',') === campos.split(',').sort().join(',');
}
export function texto(valor: unknown, patron: RegExp): valor is string {
  return typeof valor === 'string' && patron.test(valor);
}
