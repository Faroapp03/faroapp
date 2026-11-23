/** Transporte del compañero de esta composición; nunca una URL aportada por la persona. */
import type { EntregaCatalogo, ReferenciaEntregaCatalogo } from '../catalogo-cursos/contrato.ts';
import { esSha } from '../catalogo-cursos/forma.ts';
import { AprendizajeNoValido, type CompaneroAprendizaje } from './contrato.ts';
import { leerCompanero, type ReferenciaCompanero } from './lectura.ts';
export interface PublicacionAprendizaje extends ReferenciaCompanero {
  readonly ruta: string;
}
const MAX_BYTES = 4_194_304;
const HTTP_BIEN = 200;
const PLAZO_MS = 15_000;
/** Cuerpo leído con cota real, incluso cuando Content-Length no existe o es falso. */
async function cuerpoAcotado(respuesta: Response, maximo: number): Promise<Uint8Array> {
  if (!respuesta.body) {
    throw new AprendizajeNoValido('Respuesta de aprendizaje sin cuerpo');
  }
  const lector = respuesta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  let completado = false;
  try {
    for (;;) {
      const parte = await lector.read();
      if (parte.done) {
        completado = true;
        break;
      }
      total += parte.value.byteLength;
      if (total > maximo) {
        throw new AprendizajeNoValido('Aprendizaje excedido');
      }
      partes.push(parte.value);
    }
  } finally {
    try {
      if (!completado) {
        await lector.cancel().catch(() => undefined);
      }
    } finally {
      lector.releaseLock();
    }
  }
  const cuerpo = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    cuerpo.set(parte, posicion);
    posicion += parte.byteLength;
  }
  return cuerpo;
}
export async function cargarCompanero(
  publicacion: PublicacionAprendizaje,
  entrega: { readonly referencia: ReferenciaEntregaCatalogo; readonly catalogo: EntregaCatalogo },
  base: URL,
  pedir: (peticion: Request) => Promise<Response>,
): Promise<CompaneroAprendizaje> {
  if (
    !esSha(publicacion.sha256) ||
    !Number.isSafeInteger(publicacion.bytes) ||
    publicacion.bytes <= 0 ||
    publicacion.bytes > MAX_BYTES ||
    publicacion.ruta !== `datos/catalogo-aprendizaje/${publicacion.sha256}.json`
  ) {
    throw new AprendizajeNoValido('No hay una publicación de aprendizaje acreditada');
  }
  const respuesta = await pedir(
    new Request(new URL(publicacion.ruta, base), {
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(PLAZO_MS),
    }),
  );
  if (
    respuesta.status !== HTTP_BIEN ||
    respuesta.redirected ||
    respuesta.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    throw new AprendizajeNoValido('No se puede leer el aprendizaje publicado');
  }
  return leerCompanero(
    await cuerpoAcotado(respuesta, publicacion.bytes),
    publicacion,
    entrega.referencia,
    entrega.catalogo,
  );
}
