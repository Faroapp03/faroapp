/** Cuotas y revocaciones persistentes de la conectividad, fuera de los datos de orientación. */
import type { RevocacionesDeTokens } from './revocaciones.ts';
/** Clave técnica acotada: no contiene direcciones IP, parámetros ni secretos. */
export interface CuentaDeAcceso {
  readonly clave: string;
  readonly limite: number;
  readonly ventanaMs: number;
}
export interface AlmacenAccesoPublico extends RevocacionesDeTokens {
  /** Comprueba e incrementa todos los contadores en la misma transacción, o ninguno. */
  consumir(cuentas: readonly CuentaDeAcceso[]): Promise<boolean>;
}
