// Solo la frontera local conoce el cuerpo antes de construir Request. Algunos Firefox ofrecen text() pero no body:
// aquí se acredita su cota sin guardar otra copia del texto ni cambiar Request/Body globalmente.

import { MAX_CUERPO_BYTES } from '../seguridad/limites.ts';
import { SolicitudInvalida } from './errores.ts';

/** Los mismos datos que la página entrega al Worker local; nunca un cuerpo de red arbitrario. */
export interface PeticionLocal {
  readonly url: string;
  readonly method: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string | null;
}

interface CotaLocal {
  readonly bytes: number;
  consumido: boolean;
}

// Solo crearPeticionLocal puede acreditar un cuerpo. El registro no contiene el texto y desaparece con la petición.
const cotas = new WeakMap<Request, CotaLocal>();

/** Construye y acredita un cuerpo local; el exceso queda como error de entrada dentro de la API, sin copiarlo. */
export function crearPeticionLocal({ url, method, headers, body }: PeticionLocal): Request {
  if (body !== null && typeof body !== 'string') {
    throw new TypeError('el cuerpo local debe ser texto o null');
  }
  // UTF-8 nunca ocupa menos que las unidades UTF-16. Solo se codifican como máximo MAX unidades (3×MAX bytes).
  let bytes = body?.length ?? 0;
  if (body !== null && bytes <= MAX_CUERPO_BYTES) {
    bytes = new TextEncoder().encode(body).length;
  }
  // Incluso el exceso pasa por el constructor nativo con cuerpo: GET/HEAD, métodos y cabeceras inválidos siguen
  // rechazándose. El cuerpo vacío evita duplicar una entrada excesiva; su marcador dará el mismo 400 al leerla.
  const peticion = new Request(url, {
    method,
    headers: headers.map(([nombre, valor]) => [nombre, valor]),
    body: bytes > MAX_CUERPO_BYTES ? '' : body,
  });
  if (body !== null) {
    cotas.set(peticion, { bytes, consumido: false });
  }
  return peticion;
}

/** Conserva la acreditación al transferir el cuerpo a la petición con el plazo de la API. */
export function clonarPeticionConSenal(peticion: Request, signal: AbortSignal): Request {
  const cota = cotas.get(peticion);
  if (cota?.consumido) {
    throw new TypeError('el cuerpo ya se ha consumido');
  }
  const copia = new Request(peticion, { signal });
  if (cota) {
    cotas.set(copia, { bytes: cota.bytes, consumido: false });
    cota.consumido = true;
  }
  return copia;
}

/** null significa que no hay cuerpo local acreditado: nunca habilita text() para una petición de red. */
export function leerCuerpoLocal(peticion: Request): Promise<string> | null {
  const cota = cotas.get(peticion);
  return cota && (!peticion.body || cota.bytes > MAX_CUERPO_BYTES) ? leerConCota(peticion, cota) : null;
}

async function leerConCota(peticion: Request, cota: CotaLocal): Promise<string> {
  const { signal } = peticion;
  signal.throwIfAborted();
  if (cota.consumido || peticion.bodyUsed) {
    throw new TypeError('el cuerpo ya se ha consumido');
  }
  cota.consumido = true;
  if (cota.bytes > MAX_CUERPO_BYTES) {
    throw new SolicitudInvalida('la petición es demasiado grande');
  }
  const retirada = Promise.withResolvers<never>();
  const cancelar = () => retirada.reject(signal.reason);
  signal.addEventListener('abort', cancelar, { once: true });
  try {
    signal.throwIfAborted();
    // No es una alternativa general: solo este cuerpo string, ya acotado antes de su construcción, puede llegar aquí.
    // text() conserva bodyUsed y el consumo único nativos. No hay flujo de red pendiente que cancelar en esta vía.
    const texto = await Promise.race([peticion.text(), retirada.promise]);
    signal.throwIfAborted();
    return texto;
  } finally {
    signal.removeEventListener('abort', cancelar);
  }
}
