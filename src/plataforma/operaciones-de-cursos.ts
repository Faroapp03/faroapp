// Consultas factuales copiables entre la app y su trabajador. Los datos del paquete se envían una vez a cada
// trabajador; los resultados vuelven como valores. Las referencias de recursos y orígenes externos se rechazan.

import type * as Motor from '../../motores/cursos/src/index.ts';
import type { Datos } from '../dominio/tipos-paquete.ts';

/** El motor de cursos: lo que exporta su entrada pública. */
type ElMotor = typeof Motor;

/**
 * Si la función recibe los datos del paquete delante de sus argumentos (`datos`).
 */
export interface FormaDeLaOperacion {
  readonly datos: boolean;
}

/** Las operaciones que la app pide al motor de cursos, por el nombre de su función en la entrada pública. */
export const OPERACIONES_DE_CURSOS = {
  catalogoDeCursos: { datos: true },
  formacionDelInforme: { datos: true },
  formacionDeLaOcupacion: { datos: true },
} as const satisfies Partial<Record<keyof ElMotor, FormaDeLaOperacion>>;

/** El nombre de una operación. */
export type NombreDeOperacion = keyof typeof OPERACIONES_DE_CURSOS;

/** Si un valor es el origen de un archivo del paquete. */
export function esOrigen(valor: unknown): valor is {
  readonly origenDeCursos: { readonly paquete: string; readonly archivo: string; readonly sha256: string };
} {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const origen = (valor as { origenDeCursos?: unknown }).origenDeCursos;
  return (
    typeof origen === 'object' &&
    origen !== null &&
    typeof (origen as { paquete?: unknown }).paquete === 'string' &&
    typeof (origen as { archivo?: unknown }).archivo === 'string' &&
    typeof (origen as { sha256?: unknown }).sha256 === 'string'
  );
}

/** La función del motor de una operación. */
type FuncionDe<N extends NombreDeOperacion> = ElMotor[N] extends (...argumentos: infer A) => infer V
  ? (...argumentos: A) => V
  : never;

/** Los parámetros de la función, sin los datos si la operación los lleva delante. */
type ParametrosDe<N extends NombreDeOperacion> = (typeof OPERACIONES_DE_CURSOS)[N]['datos'] extends true
  ? Parameters<FuncionDe<N>> extends [Datos, ...infer Resto]
    ? Resto
    : never
  : Parameters<FuncionDe<N>>;

/** Los argumentos factuales, sin referencias de recursos de otra operación o paquete. */
export type ArgumentosDe<N extends NombreDeOperacion> = ParametrosDe<N>;
/** El resultado factual de la función. */
export type ValorDe<N extends NombreDeOperacion> = Awaited<ReturnType<FuncionDe<N>>>;

/** Si un valor es la referencia de algo guardado. */
export function esGuardado(valor: unknown): valor is { readonly guardadoDeCursos: string } {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as { guardadoDeCursos?: unknown }).guardadoDeCursos === 'string'
  );
}

/** Si un nombre es el de una operación de la lista. */
export function esOperacion(nombre: unknown): nombre is NombreDeOperacion {
  return typeof nombre === 'string' && Object.hasOwn(OPERACIONES_DE_CURSOS, nombre);
}

/**
 * Ejecuta una consulta factual con los argumentos recibidos.
 *
 * @param motor - El motor cargado.
 * @param nombre - La operación.
 * @param datos - Los datos del paquete, si la operación los lleva.
 * @param argumentos - Sus argumentos, sin los datos.
 * @returns Lo que da la función del motor.
 * @throws {Error} Lo que lance el motor.
 */
export function aplicarOperacion(
  motor: object,
  nombre: NombreDeOperacion,
  datos: unknown,
  argumentos: readonly unknown[],
): unknown {
  const funcion = (motor as Record<string, unknown>)[nombre];
  if (typeof funcion !== 'function') {
    throw new TypeError(`al motor le falta ${nombre}`);
  }
  const conDatos = OPERACIONES_DE_CURSOS[nombre].datos ? [datos, ...argumentos] : argumentos;
  return (funcion as (...valores: unknown[]) => unknown)(...conDatos);
}

/** Lo que la puerta manda al trabajador. */
export type MensajeAlTrabajador =
  /** Guarda en el trabajador un valor que mandan las operaciones que lo usan (los datos del paquete). */
  | { readonly tipo: 'guardar'; readonly clave: string; readonly valor: unknown }
  /** Ejecuta una consulta y devuelve su valor. */
  | {
      readonly tipo: 'operacion';
      readonly id: number;
      readonly nombre: NombreDeOperacion;
      readonly datos: string | null;
      readonly argumentos: readonly unknown[];
    };

/** Lo que el trabajador responde a la puerta. */
export type MensajeDelTrabajador =
  | { readonly tipo: 'listo' }
  | { readonly tipo: 'sin-motor'; readonly motivo: 'ausente' | 'averiado'; readonly detalle: string }
  | { readonly tipo: 'hecho'; readonly id: number; readonly valor: unknown }
  | { readonly tipo: 'fallo'; readonly id: number; readonly detalle: string };
