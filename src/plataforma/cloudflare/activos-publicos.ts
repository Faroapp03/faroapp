/**
 * Los archivos de la web que la portada y la pantalla de acceso comparten antes de iniciar sesión. Es la única lista
 * de lo que el Worker oficial sirve sin sesión fuera de esas dos páginas y de robots.txt: cada archivo, con la huella
 * de su contenido en el nombre, se guarda un año en el navegador sin volver a preguntar. Así la visita que pasa de la
 * portada al acceso, o la que recarga, no vuelve a descargarlo; las dos páginas siguen sin guardarse (no-store).
 */
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { CACHE_DEL_PAQUETE } from '../paquete-publicado.ts';

/** Un archivo compartido: dónde está en la web, con qué tipo se sirve y la huella SHA-256 de sus bytes. */
export interface ActivoPublico {
  readonly archivo: string;
  readonly tipo: string;
  readonly sha256: string;
}

/** La huella de la fotografía de la portada; la recalcula desde web/ npm run cloudflare:actualizar-portada. */
export const HUELLA_FOTOGRAFIA_PORTADA = 'e49d4a55f350ce610ca09851466f0ddeb9b1b9e862057d2fa35e8728c777d6b3';

/** La fotografía del faro de Penmon, fondo de la portada y de la pantalla de acceso. */
export const FOTOGRAFIA_PORTADA: ActivoPublico = Object.freeze({
  archivo: 'imagenes/fotografias/faro-penmon.webp',
  tipo: 'image/webp',
  sha256: HUELLA_FOTOGRAFIA_PORTADA,
});

export const ACTIVOS_PUBLICOS: readonly ActivoPublico[] = Object.freeze([FOTOGRAFIA_PORTADA]);

/** La carpeta virtual de los activos públicos: no existe en la web y solo la atiende el Worker oficial. */
const CARPETA_PUBLICA = '/publico/';
/** Las cifras de la huella que lleva el nombre, como en las entradas de página con huella. */
const CIFRAS_EN_EL_NOMBRE = 16;

/** La dirección pública de un activo: su nombre con el principio de su huella, faro-penmon-e49d4a55f350ce61.webp. */
export function rutaDeActivo(activo: ActivoPublico): string {
  const nombre = activo.archivo.slice(activo.archivo.lastIndexOf('/') + 1);
  const punto = nombre.lastIndexOf('.');
  return `${CARPETA_PUBLICA}${nombre.slice(0, punto)}-${activo.sha256.slice(0, CIFRAS_EN_EL_NOMBRE)}${nombre.slice(punto)}`;
}

const POR_RUTA: ReadonlyMap<string, ActivoPublico> = new Map(
  ACTIVOS_PUBLICOS.map((activo) => [rutaDeActivo(activo), activo]),
);

/** El activo que nombra exactamente una ruta; cualquier otra, también con otra huella, no es pública. */
export function activoDeRuta(ruta: string): ActivoPublico | undefined {
  return POR_RUTA.get(ruta);
}

/** Lo que el Worker necesita para leer el archivo: el enlace ASSETS de la configuración. */
export interface AlmacenDeArchivos {
  fetch(peticion: Request): Promise<Response>;
}

function noDisponible(): Response {
  return new Response(null, { status: ESTADO_HTTP.noDisponible, headers: { 'cache-control': 'no-store' } });
}

const BASE_HEXADECIMAL = 16;
const CIFRAS_POR_BYTE = 2;

function hexadecimal(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(BASE_HEXADECIMAL).padStart(CIFRAS_POR_BYTE, '0'),
  ).join('');
}

/** Los bytes del activo en la web publicada si existen y cuadran con su huella; null si faltan o no cuadran. */
async function bytesComprobados(
  peticion: Request,
  activo: ActivoPublico,
  almacen: AlmacenDeArchivos,
): Promise<ArrayBuffer | null> {
  const archivo = await almacen.fetch(new Request(new URL(`/${activo.archivo}`, peticion.url), { method: 'GET' }));
  if (archivo.status !== ESTADO_HTTP.correcto) {
    await archivo.body?.cancel();
    return null;
  }
  const bytes = await archivo.arrayBuffer();
  return hexadecimal(await crypto.subtle.digest('SHA-256', bytes)) === activo.sha256 ? bytes : null;
}

/**
 * El activo, leído de la web publicada y comprobado contra su huella antes de servirlo como inmutable: un nombre con
 * huella no se publica nunca con otros bytes. Si el archivo falta o no cuadra, o falla el almacén, la lectura o la
 * huella, 503 sin guardar: la página se carga entera y solo le falta la fotografía de fondo; un fallo deja una línea
 * en el registro con la ruta pública del activo. No mira la cookie ni pone ninguna: la misma respuesta vale para
 * cualquier visita.
 */
export async function responderActivoPublico(
  peticion: Request,
  activo: ActivoPublico,
  almacen: AlmacenDeArchivos | undefined,
): Promise<Response> {
  if (!almacen) {
    return noDisponible();
  }
  let bytes: ArrayBuffer | null;
  try {
    bytes = await bytesComprobados(peticion, activo, almacen);
  } catch {
    // Sin el mensaje del fallo ni nada de la petición: solo qué activo no se ha podido servir.
    console.error('Faro: el activo público no está disponible.', { activo: rutaDeActivo(activo) });
    return noDisponible();
  }
  if (!bytes) {
    return noDisponible();
  }
  return new Response(peticion.method === 'HEAD' ? null : bytes, {
    headers: { 'content-type': activo.tipo, 'cache-control': CACHE_DEL_PAQUETE },
  });
}
