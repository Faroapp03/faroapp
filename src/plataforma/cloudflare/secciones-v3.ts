import type { DocumentoSecciones } from '../../administracion/secciones-web.js';
import { dentroDelPlazo } from '../../api/plazo.ts';
import type { EspacioAccesoPublicoDurable } from '../acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../acceso-publico/recorrido-cliente-durable.ts';
import { PLAZO_SECCIONES_MS } from '../secciones-web.ts';

export async function respuestaSeccionesV3(
  peticion: Request,
  espacio: EspacioAccesoPublicoDurable | undefined,
  preparar: () => Promise<unknown>,
  permitirInicial: boolean,
): Promise<Response> {
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  }
  try {
    if (!espacio) {
      throw new Error('Autoridad no disponible');
    }
    const documento = await dentroDelPlazo(
      async (senal) => {
        await preparar();
        senal.throwIfAborted();
        const resultado = await new AlmacenRecorridoDurable(espacio).leerSeccionesConAutoridad(permitirInicial);
        senal.throwIfAborted();
        return resultado;
      },
      PLAZO_SECCIONES_MS,
      peticion.signal,
    );
    return new Response(peticion.method === 'HEAD' ? null : JSON.stringify(documento), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch {
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

/** Sin panel, la guardia usa el mismo almacén y conserva cualquier retirada previa. */
export function lectorSeccionesSinPanel(espacio: EspacioAccesoPublicoDurable) {
  return async (senal: AbortSignal) => {
    const dato = await new AlmacenRecorridoDurable(espacio).leerSeccionesConAutoridad(true);
    senal.throwIfAborted();
    return { version: 3 as const, revision: dato.revision, secciones: dato.secciones };
  };
}

export function lectorSeccionesDelEntorno(
  administrado: boolean,
  espacio: EspacioAccesoPublicoDurable | undefined,
  panel: () => Promise<{ leerSecciones: (senal: AbortSignal) => Promise<DocumentoSecciones> }>,
) {
  if (!administrado) {
    return espacio ? lectorSeccionesSinPanel(espacio) : undefined;
  }
  return async (senal: AbortSignal) => {
    const montado = await panel();
    senal.throwIfAborted();
    return montado.leerSecciones(senal);
  };
}
