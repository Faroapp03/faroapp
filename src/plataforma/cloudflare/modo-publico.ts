import type { EspacioAccesoPublicoDurable } from '../acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../acceso-publico/recorrido-cliente-durable.ts';
import { varianteInstalada } from '../variantes-recorrido.ts';

export const RUTA_MODO_RECORRIDO = '/modo-recorrido.json';
export async function leerModoDelEntorno(espacio: EspacioAccesoPublicoDurable | undefined) {
  if (!espacio) {
    throw new Error('Autoridad de recorrido no disponible');
  }
  return new AlmacenRecorridoDurable(espacio).leerRecorrido();
}

export async function responderModoRecorrido(
  peticion: Request,
  espacio: EspacioAccesoPublicoDurable | undefined,
): Promise<Response> {
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  };
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
  }
  try {
    const modo = await leerModoDelEntorno(espacio);
    if (!varianteInstalada(modo.modo)) {
      throw new Error('Modo de recorrido no disponible');
    }
    return new Response(peticion.method === 'HEAD' ? null : JSON.stringify(modo), { status: 200, headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
