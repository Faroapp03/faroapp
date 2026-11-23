// La lectura del cuerpo de una petición POST: limitada en bytes mientras se lee, cancelable y validada con su esquema
// antes de que la ruta lo use. El tipo del cuerpo y el origen se comprueban antes, al recibir la petición
// (api/http.ts).

import { cumple, type EsquemaDe } from '../comun/esquema.ts';
import { MAX_CUERPO_BYTES } from '../seguridad/limites.ts';
import { leerCuerpoLocal } from './cuerpo-local.ts';
import { SolicitudInvalida } from './errores.ts';

/** El mensaje del 400 de un cuerpo que pasa de MAX_CUERPO_BYTES, declarado o leído. */
const DEMASIADO_GRANDE = 'la petición es demasiado grande';

/** Une los trozos leídos del cuerpo en un solo bloque de `total` bytes. */
function unirTrozos(trozos: readonly Uint8Array[], total: number): Uint8Array {
  const todo = new Uint8Array(total);
  let posicion = 0;
  for (const trozo of trozos) {
    todo.set(trozo, posicion);
    posicion += trozo.byteLength;
  }
  return todo;
}

/** Rechaza bytes mal codificados sin sustituirlos por texto que la persona no envió. */
function textoUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    throw new SolicitudInvalida('el cuerpo no es UTF-8 válido');
  }
}

/**
 * El cuerpo de la petición como texto, con el límite de MAX_CUERPO_BYTES aplicado a los bytes leídos. La lectura se
 * corta en cuanto se supera, vence el plazo o se retira el cliente, sin esperar a recibir el cuerpo completo. La
 * cabecera content-length se comprueba aparte en leerCuerpoJson y no sustituye este límite.
 *
 * @param peticion - La petición cuyo cuerpo se lee.
 * @returns El cuerpo como texto; vacío si la petición no lleva cuerpo.
 * @throws {Error} SolicitudInvalida si el cuerpo supera el límite o no es UTF-8; el motivo de la señal (cliente retirado, plazo
 *   vencido) si se aborta la lectura.
 */
export async function leerTextoLimitado(peticion: Request): Promise<string> {
  const local = leerCuerpoLocal(peticion);
  if (local !== null) {
    return local;
  }
  if (!peticion.body) {
    return '';
  }
  const lector = peticion.body.getReader();
  const { signal: senal } = peticion;
  // Cancelar un flujo ya cerrado o con error rechaza la promesa: no hay nada más que cortar, así que se descarta.
  const cancelar = () => {
    void lector.cancel(senal.reason).catch(() => undefined);
  };
  const trozos: Uint8Array[] = [];
  let leidos = 0;
  senal.addEventListener('abort', cancelar, { once: true });
  try {
    // El oyente `once` no se dispara si la señal ya estaba abortada al engancharlo: se corta aquí.
    if (senal.aborted) {
      cancelar();
    }
    senal.throwIfAborted();
    // Termina al acabarse el cuerpo, al pasar de MAX_CUERPO_BYTES o al abortar la señal.
    for (;;) {
      const { done, value } = await lector.read();
      senal.throwIfAborted();
      if (done) {
        break;
      }
      leidos += value.byteLength;
      if (leidos > MAX_CUERPO_BYTES) {
        // Como en cancelar: si el flujo ya no admite cancelarse, no queda nada por leer.
        void lector.cancel().catch(() => undefined);
        throw new SolicitudInvalida(DEMASIADO_GRANDE);
      }
      trozos.push(value);
    }
    return textoUtf8(unirTrozos(trozos, leidos));
  } finally {
    senal.removeEventListener('abort', cancelar);
    lector.releaseLock();
  }
}

/**
 * Lee el cuerpo de la petición como JSON, con un límite en bytes que se aplica mientras se lee, y lo valida con su
 * esquema.
 *
 * @param peticion - La petición cuyo cuerpo se lee.
 * @param esquema - El esquema que ha de cumplir el JSON.
 * @param mensajeSiNoCumple - El texto del error cuando el cuerpo no cumple el esquema.
 * @returns El cuerpo ya validado con el tipo del esquema.
 * @throws {Error} SolicitudInvalida si el cuerpo es demasiado grande, no es JSON o no cumple el esquema.
 */
export async function leerCuerpoJson<T>(
  peticion: Request,
  esquema: EsquemaDe<T>,
  mensajeSiNoCumple: string,
): Promise<T> {
  // Sin cabecera es 0 y un valor no numérico es NaN: los dos siguen a la lectura limitada, que aplica el tope.
  const declarado = Number(peticion.headers.get('content-length'));
  if (declarado > MAX_CUERPO_BYTES) {
    throw new SolicitudInvalida(DEMASIADO_GRANDE);
  }
  const texto = await leerTextoLimitado(peticion);
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new SolicitudInvalida('el cuerpo no es JSON');
  }
  if (!cumple(datos, esquema)) {
    throw new SolicitudInvalida(mensajeSiNoCumple);
  }
  return datos;
}
