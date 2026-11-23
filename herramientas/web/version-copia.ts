// La VERSION de la copia sin conexión: la regla de qué cubre su huella vive solo aquí (huellaDeLaCopia).

import { createHash } from 'node:crypto';
import { tokenizer } from 'acorn';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import type { Catalogo } from './servicio/servicio-publicado.ts';

/** Longitud de la huella que se usa como VERSION: 64 bits bastan para distinguir versiones de una web. */
const LETRAS_VERSION = 16;
/** Un terminador de línea de JavaScript, también dentro de un comentario de bloque entre dos piezas. */
const SALTO_DE_LINEA = /[\n\r\u2028\u2029]/;
/** Las páginas con la barrera de versión: la entrada del recorrido real y las que declara cada extensión. */
export const PAGINAS_CON_VERSION: ReadonlySet<string> = new Set([
  'recorrido.html',
  ...EXTENSIONES.flatMap(({ paginasConVersion }) => paginasConVersion),
]);
const MARCADOR_VERSION = /(<meta name="faro-version-copia" content=")([a-f0-9]{16})("\s*\/>)/gu;
/** El valor del marcador con que se cuentan las páginas con versión: la VERSION no puede depender de sí misma. */
export const VERSION_VACIA = '0000000000000000';
export function marcadorNormalizado(archivo: string, bytes: Uint8Array): Uint8Array {
  if (!PAGINAS_CON_VERSION.has(archivo)) {
    return bytes;
  }
  const texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if ([...texto.matchAll(MARCADOR_VERSION)].length !== 1) {
    throw new Error(`${archivo}: marcador de versión inválido`);
  }
  return new TextEncoder().encode(
    texto.replace(MARCADOR_VERSION, (_m, a: string, _v: string, b: string) => `${a}${VERSION_VACIA}${b}`),
  );
}
export function fijarMarcador(archivo: string, bytes: Uint8Array, version: string): Uint8Array {
  if (!/^[a-f0-9]{16}$/u.test(version)) {
    throw new Error('Versión inválida');
  }
  const texto = new TextDecoder().decode(marcadorNormalizado(archivo, bytes));
  return new TextEncoder().encode(
    texto.replace(MARCADOR_VERSION, (_m, a: string, _v: string, b: string) => `${a}${version}${b}`),
  );
}

/**
 * El código clásico del service worker como lo ejecuta el navegador: sus piezas léxicas (acorn), una por línea si las
 * separa un salto de línea (cuenta para la inserción automática de «;») y por un espacio si no, sin comentarios ni el
 * resto de espacios. Así un cambio solo de comentarios o de formato no renueva la copia. El código que llega aquí es
 * el construido con los valores neutros de la plantilla (servicio/servicio-publicado.ts): la VERSION no puede depender
 * de sí misma, y PAQUETE y TAMANOS_DEL_PAQUETE dependen solo del paquete de datos, no de la copia.
 *
 * @param codigo - El código del service worker.
 * @returns El texto que entra en la huella.
 */
export function codigoNormalizado(codigo: string): string {
  const piezas: string[] = [];
  let fin: number | undefined;
  for (const pieza of tokenizer(codigo, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true })) {
    if (fin !== undefined) {
      piezas.push(SALTO_DE_LINEA.test(codigo.slice(fin, pieza.start)) ? '\n' : ' ');
    }
    piezas.push(codigo.slice(pieza.start, pieza.end));
    fin = pieza.end;
  }
  return piezas.join('');
}

/** Lo que determina el comportamiento de una copia sin conexión, que es lo que cubre su VERSION. */
export interface FormaDeLaCopia {
  /**
   * El CATALOGO de la copia, la fuente única de lo que sirve: cada ruta con su huella SHA-256 y su clase. En una
   * página con versión, su huella no se lee del catálogo: depende del marcador, y se cuenta desde sus bytes con el
   * marcador vacío (marcadorNormalizado).
   */
  readonly catalogo: Catalogo;
  /** Las páginas con marcador de versión que hay en la web, estén o no en el catálogo, con sus rutas desde web/. */
  readonly paginasConVersion: readonly string[];
  /**
   * El código del service worker construido con los valores neutros de su plantilla, que lleva dentro la política de
   * caché y el portal, por su ruta.
   */
  readonly codigo: Readonly<Record<string, string>>;
  /** Las cabeceras con que se sirven los archivos de la copia. */
  readonly cabeceras: Readonly<Record<string, string>>;
}

/** Un campo de la huella con su longitud delante: ningún contenido puede hacerse pasar por el siguiente campo. */
function campo(suma: ReturnType<typeof createHash>, contenido: string | Uint8Array): void {
  const bytes = typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido;
  suma.update(`${bytes.length}:`);
  suma.update(bytes);
}

/** El orden de las entradas en la huella: por ruta, unidad a unidad, sin depender del idioma del sistema. */
function porRuta(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** La huella SHA-256 de una página con versión, con su marcador vacío. */
function huellaSinMarcador(ruta: string, bytesDe: (archivo: string) => Uint8Array): string {
  return createHash('sha256')
    .update(marcadorNormalizado(ruta, bytesDe(ruta)))
    .digest('hex');
}

/**
 * La huella de la copia, que es su VERSION. Cubre todo lo que cambia lo que hace la copia en el dispositivo:
 * - el CATALOGO, entrada a entrada y por orden de ruta: la ruta, su clase y su huella. Pasar un archivo de instalar a
 *   adorno o a demanda cambia cuándo se descarga, así que renueva la VERSION aunque los bytes sean los mismos; el
 *   orden en que se escriben las entradas no cuenta. Lo que no está en el catálogo no entra, salvo:
 * - las páginas con marcador de versión de la web, con sus bytes y el marcador vacío, estén o no en el catálogo;
 * - el código del service worker, construido con los valores neutros de su plantilla (codigoNormalizado);
 * - las cabeceras: la copia guarda cada respuesta con las suyas, así que un cambio solo de cabeceras (la CSP) también
 *   la renueva; si no, quien ya tenía la copia seguiría con la política vieja.
 *
 * @param forma - El catálogo, las páginas con versión, el código y las cabeceras de la copia.
 * @param bytesDe - Los bytes de cada página con versión.
 * @returns La VERSION: LETRAS_VERSION cifras hexadecimales.
 */
export function huellaDeLaCopia(forma: FormaDeLaCopia, bytesDe: (archivo: string) => Uint8Array): string {
  const suma = createHash('sha256');
  const entradas = [...forma.catalogo].sort(([a], [b]) => porRuta(a, b));
  campo(suma, `catalogo ${entradas.length}`);
  for (const [ruta, huella, clase] of entradas) {
    campo(suma, ruta);
    campo(suma, clase);
    campo(suma, PAGINAS_CON_VERSION.has(ruta) ? huellaSinMarcador(ruta, bytesDe) : huella);
  }
  const paginas = [...new Set(forma.paginasConVersion)].sort();
  campo(suma, `paginas con version ${paginas.length}`);
  for (const ruta of paginas) {
    campo(suma, ruta);
    campo(suma, huellaSinMarcador(ruta, bytesDe));
  }
  for (const ruta of Object.keys(forma.codigo).sort()) {
    campo(suma, `codigo ${ruta}`);
    campo(suma, codigoNormalizado(forma.codigo[ruta] ?? ''));
  }
  for (const nombre of Object.keys(forma.cabeceras).sort()) {
    campo(suma, `cabecera ${nombre}`);
    campo(suma, forma.cabeceras[nombre] ?? '');
  }
  return suma.digest('hex').slice(0, LETRAS_VERSION);
}

export function problemasDeMarcadores(
  publicados: readonly string[],
  version: string,
  leer: (pagina: string) => string,
): string[] {
  return [...PAGINAS_CON_VERSION]
    .filter((pagina) => publicados.includes(pagina))
    .flatMap((pagina) => {
      const coincidencias = [...leer(pagina).matchAll(MARCADOR_VERSION)];
      return coincidencias.length === 1 && coincidencias[0]?.[2] === version
        ? []
        : [`${pagina}: versión de copia incorrecta`];
    });
}

/**
 * La VERSION escrita frente a la que da el CATALOGO escrito y frente a la que da el contenido publicado. Las dos se
 * calculan con las mismas páginas con marcador, el mismo código neutro y las mismas cabeceras de ahora: la primera
 * diferencia dice que la VERSION no es la de ese CATALOGO con ese código y esas cabeceras (también salta si solo han
 * cambiado el código del service worker o las cabeceras); la segunda, que el CATALOGO ya no es el de la web.
 *
 * @param actual - La VERSION escrita.
 * @param esperadas - La que da el CATALOGO escrito y la que da lo publicado (huellaDeLaCopia en los dos casos).
 * @param ruta - El service worker, para el mensaje.
 * @returns Un problema, o ninguno si las tres coinciden.
 */
export function problemasDeVersion(
  actual: string,
  esperadas: { readonly catalogo: string; readonly contenido: string },
  ruta: string,
): string[] {
  const arreglo = '(corrígelo con npm run web:preparar)';
  if (actual !== esperadas.catalogo) {
    return [`${ruta}: VERSION es «${actual}» y su CATALOGO da «${esperadas.catalogo}» ${arreglo}`];
  }
  return actual === esperadas.contenido
    ? []
    : [`${ruta}: VERSION es «${actual}» y el contenido da «${esperadas.contenido}» ${arreglo}`];
}
