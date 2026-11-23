/** Transporte acotado del recurso estático de composición; no acepta URLs elegidas por el visitante. */
import {
  CatalogoNoValido,
  type EntregaCatalogo,
  MAX_BYTES_CATALOGO,
  type ReferenciaEntregaCatalogo,
} from './contrato.ts';
import { esSha } from './forma.ts';
import { leerCatalogo } from './lectura.ts';

export interface PublicacionCatalogo extends ReferenciaEntregaCatalogo {
  readonly ruta: string;
}
const HTTP_CORRECTO = 200;
const PLAZO_MS = 15_000;

async function cuerpoAcotado(respuesta: Response, maximo: number): Promise<Uint8Array> {
  if (!respuesta.body) {
    throw new CatalogoNoValido('Respuesta del catálogo sin cuerpo');
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
        throw new CatalogoNoValido('Respuesta del catálogo excedida');
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

/** Referencia importada del grafo SRI de publicación, nunca reconstruida desde la propia respuesta. */
export async function cargarCatalogo(
  publicacion: PublicacionCatalogo | null,
  base: URL,
  pedir: (peticion: Request) => Promise<Response>,
): Promise<EntregaCatalogo> {
  if (
    !publicacion ||
    !esSha(publicacion.sha256) ||
    !esSha(publicacion.revision) ||
    !Number.isSafeInteger(publicacion.bytes) ||
    publicacion.bytes <= 0 ||
    publicacion.bytes > MAX_BYTES_CATALOGO ||
    publicacion.ruta !== `datos/catalogo-cursos/${publicacion.sha256}.json`
  ) {
    throw new CatalogoNoValido('No hay una publicación de Cursos acreditada');
  }
  const peticion = new Request(new URL(publicacion.ruta, base), {
    credentials: 'same-origin',
    mode: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(PLAZO_MS),
  });
  const respuesta = await pedir(peticion);
  if (
    respuesta.status !== HTTP_CORRECTO ||
    respuesta.redirected ||
    respuesta.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    throw new CatalogoNoValido('No se puede leer la publicación de Cursos');
  }
  return leerCatalogo(await cuerpoAcotado(respuesta, publicacion.bytes), publicacion);
}
