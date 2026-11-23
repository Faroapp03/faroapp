// Plazo y cancelación cooperativa de cada petición.
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { MS_POR_SEGUNDO } from '../comun/tiempo.ts';
import { PeticionCancelada, PlazoAgotado } from './errores.ts';

const MENSAJE_PLAZO_AGOTADO = 'se ha agotado el plazo de la petición';
export const PLAZO_PETICION_MS = 50_000;

export class PlazoInvalido extends Error {}
/** Plazo de servicio en segundos enteros; sin configuración se conservan los 50 segundos. */
export function plazoDelEntorno(env: VariablesDelEntorno): number {
  const texto = env.FARO_PLAZO_PETICION_S?.trim();
  if (!texto) {
    return PLAZO_PETICION_MS;
  }
  const segundos = Number(texto);
  const ms = segundos * MS_POR_SEGUNDO;
  if (!/^\d+$/.test(texto) || !Number.isSafeInteger(ms) || segundos < 1) {
    throw new PlazoInvalido('FARO_PLAZO_PETICION_S tiene que ser un número entero de 1 o más');
  }
  return ms;
}

/**
 * Ejecuta el trabajo con una señal común: al vencer el plazo o retirarse el cliente, rechaza y aborta la señal.
 * Las fases que atienden esa señal pueden interrumpirse; no se espera a las que la ignoran.
 * Los errores tardíos del trabajo quedan atendidos por Promise.race; el reloj y la escucha del cliente se retiran.
 *
 * @param trabajo - El trabajo, que recibe la señal común.
 * @param ms - El plazo, en milisegundos.
 * @param retirada - La señal de la retirada del cliente, si la hay.
 * @returns Lo que devuelve el trabajo.
 * @throws {PlazoAgotado} Si vence el plazo.
 * @throws {PeticionCancelada} Si el cliente se retira.
 */
export async function dentroDelPlazo<Resultado>(
  trabajo: (senal: AbortSignal) => Promise<Resultado>,
  ms: number,
  retirada?: AbortSignal,
): Promise<Resultado> {
  if (retirada?.aborted) {
    throw new PeticionCancelada();
  }
  const cancelacion = new AbortController();
  const retirar = () => cancelacion.abort(new PeticionCancelada());
  const plazo = new Promise<never>((_, agotar) => {
    cancelacion.signal.addEventListener('abort', () => agotar(cancelacion.signal.reason), { once: true });
  });
  const reloj = setTimeout(() => cancelacion.abort(new PlazoAgotado(MENSAJE_PLAZO_AGOTADO)), ms);
  retirada?.addEventListener('abort', retirar, { once: true });
  try {
    const enCurso = Promise.resolve().then(() => {
      cancelacion.signal.throwIfAborted();
      return trabajo(cancelacion.signal);
    });
    return await Promise.race([enCurso, plazo]);
  } finally {
    clearTimeout(reloj);
    retirada?.removeEventListener('abort', retirar);
    cancelacion.abort(new PeticionCancelada());
  }
}
