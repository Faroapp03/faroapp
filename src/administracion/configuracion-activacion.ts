/** La activación es una capacidad explícita; su configuración no bloquea consultas ni construcción. */
import type { VariablesDelEntorno } from '../comun/entorno.ts';

export function configuracionActivacionDiferida(variables: VariablesDelEntorno): (() => boolean) | undefined {
  const valor = variables.FARO_ACTIVACION_AUTOMATICA;
  if (valor === undefined || valor === 'no') {
    return undefined;
  }
  return () => {
    if (valor !== 'si') {
      throw new Error('FARO_ACTIVACION_AUTOMATICA debe ser si o no');
    }
    return true;
  };
}
