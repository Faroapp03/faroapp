// Publicaciones de utilidades compartidas, generadas desde su única fuente TypeScript, JavaScript o CSS.

import '../../compartido/contacto-publico.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Extension } from '../../src/plataforma/extension.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { formatearTextoConBiome } from '../comun/archivos.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import { conDatosDelRegistro, declaracionDelRegistro } from './politica-cache.ts';

const RAIZ = new URL('../../', import.meta.url);
const USO = 'node herramientas/web/comunes.ts [--comprobar]';
/** Los imports relativos conservan su relación entre los módulos publicados; no se reescriben dependencias. */
export const PUBLICACIONES_COMUNES = {
  'compartido/contacto-publico.js': 'web/scripts/contacto-publico.js',
  'src/comun/base64url.js': 'web/scripts/base64url.js',
  'src/comun/titulo-breve.js': 'web/scripts/titulo-breve.js',
  'src/comun/orden.js': 'web/scripts/orden.js',
  'src/comun/fechas.js': 'web/scripts/fechas.js',
  'src/comun/cifras.js': 'web/scripts/cifras.js',
  'src/comun/texto-buscable.js': 'web/scripts/texto-buscable.js',
  'src/comun/tiempo.ts': 'web/scripts/tiempo.js',
  'src/comun/marcas-de-tiempo.ts': 'web/scripts/marcas-de-tiempo.js',
  'src/comun/sobre-dsse.ts': 'web/scripts/firmas/sobre-dsse.js',
  'src/administracion/vigilante-panel.js': 'web/administracion/vigilante-panel.js',
  'src/administracion/estado-datos.js': 'web/administracion/estado-datos.js',
  'src/administracion/lectura-estricta.js': 'web/administracion/lectura-estricta.js',
  'src/administracion/retenidos-datos.js': 'web/administracion/retenidos-datos.js',
  'src/administracion/retirada-datos.js': 'web/administracion/retirada-datos.js',
  'src/administracion/edicion-nueva-datos.js': 'web/administracion/edicion-nueva-datos.js',
  'src/administracion/catalogo-privado.js': 'web/administracion/catalogo-privado.js',
  'src/administracion/salud-datos.js': 'web/administracion/salud-datos.js',
  'src/administracion/estado-trabajos.js': 'web/administracion/estado-trabajos.js',
  'src/administracion/estado-activacion.js': 'web/administracion/estado-activacion.js',
  'src/administracion/secciones-web.js': 'web/scripts/secciones-contrato.js',
} as const;

/**
 * Copias que cada extensión instalada declara en su registro (`publicacionesComunes`). Una extensión puede importar
 * módulos de la web real; estas copias son las que sirve desde su propia carpeta, y se generan y se comprueban desde
 * su fuente única como las demás.
 */
export const PUBLICACIONES_DE_EXTENSIONES: readonly (readonly [origen: string, destino: string])[] = Object.freeze(
  EXTENSIONES.flatMap(({ publicacionesComunes }) => Object.entries(publicacionesComunes)),
);

/** La primera línea de toda copia publicada: nombra su fuente y avisa de que no se edita. */
export function cabeceraDeCopia(origen: string): string {
  const aviso = `Generado desde ${origen}; no editar esta copia.`;
  return origen.endsWith('.css') ? `/* ${aviso} */\n` : `// ${aviso}\n`;
}

/**
 * El contenido publicado de una fuente, tras su cabecera: el CSS se copia tal cual; el TypeScript pierde sus tipos. Una
 * fuente que lee el registro de extensiones lleva en su lugar la copia de sus datos, porque el registro no se publica.
 */
function publicacion(origen: string, fuente: string): string {
  const conRegistro = conDatosDelRegistro(origen, fuente, declaracionDelRegistro());
  return cabeceraDeCopia(origen) + (origen.endsWith('.css') ? conRegistro : stripTypeScriptTypes(conRegistro));
}

/** Prepara todos los contenidos antes de escribir; conserva los JSDoc necesarios para comprobar sus tipos. */
export function artefactosComunes(raiz: URL = RAIZ): ReadonlyMap<URL, string> {
  return new Map(
    [...Object.entries(PUBLICACIONES_COMUNES), ...PUBLICACIONES_DE_EXTENSIONES].map(([origen, destino]) => {
      const fuente = readFileSync(new URL(origen, raiz), 'utf8');
      return [new URL(destino, raiz), formatearTextoConBiome(publicacion(origen, fuente), destino)];
    }),
  );
}

/** El módulo de la web con las variantes de recorrido que añaden las extensiones instaladas. */
export const VARIANTES_DISPONIBLES = 'web/scripts/variantes-disponibles.js';
const IDIOMAS_DE_LAS_VARIANTES = ['es', 'ca'] as const;
const CABECERA_DE_LAS_VARIANTES = `/**
 * Las variantes de recorrido instaladas además del real, generadas desde el registro de extensiones
 * (src/plataforma/extensiones.ts) y los textos de cada extensión (<carpeta>/idiomas/<idioma>/recorrido.js): no se
 * editan a mano. Cada una lleva la ruta de su entrada, relativa a la web, y en cada idioma el estado que muestra el
 * menú y el nombre de su opción en el panel. Sin extensiones, el objeto está vacío.
 * @type {Readonly<Record<string, VarianteInstalada>>}
 */
`;
/** El tipo de cada variante, que se conserva aunque no haya ninguna instalada. */
const TIPO_DE_LAS_VARIANTES =
  '/** @typedef {{ readonly ruta: string, ' +
  "readonly estado: Readonly<Record<'es' | 'ca', string>>, " +
  "readonly opcion: Readonly<Record<'es' | 'ca', string>> }} VarianteInstalada */\n";

/** Los textos de una extensión por idioma y por clave. */
type TextosDeExtension = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Si un error de import() dice que no existe el módulo pedido, y no otro que este importe. */
function faltaElModulo(error: unknown, modulo: URL): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_MODULE_NOT_FOUND' &&
    'url' in error &&
    error.url === modulo.href
  );
}

/**
 * Los textos de una extensión instalada, leídos de su carpeta de la web solo cuando se genera el módulo de variantes:
 * importar estas publicaciones no los carga. Si falta el archivo de un idioma, el error nombra la extensión y la ruta.
 */
async function textosDeLaExtension(raiz: URL, { id, entrada }: Extension): Promise<TextosDeExtension> {
  const carpeta = posix.dirname(entrada);
  const porIdioma: [string, Readonly<Record<string, string>>][] = [];
  for (const idioma of IDIOMAS_DE_LAS_VARIANTES) {
    const ruta = `web/${carpeta}/idiomas/${idioma}/recorrido.js`;
    const modulo = new URL(ruta, raiz);
    try {
      const { TEXTOS_EXTENSION } = (await import(modulo.href)) as { TEXTOS_EXTENSION: Record<string, string> };
      porIdioma.push([idioma, TEXTOS_EXTENSION]);
    } catch (error) {
      if (faltaElModulo(error, modulo)) {
        throw new Error(`Faltan los textos de la extensión ${id} en ${idioma}: ${ruta}`, { cause: error });
      }
      throw error;
    }
  }
  return Object.fromEntries(porIdioma);
}

/** Un texto obligatorio de una extensión; su ausencia es un error del registro o de sus textos. */
function textoDeExtension(textos: TextosDeExtension, id: string, idioma: string, clave: string): string {
  const texto = textos[idioma]?.[clave];
  if (typeof texto !== 'string') {
    throw new Error(`La extensión ${id} no define ${clave} en ${idioma}`);
  }
  return texto;
}

/** Un texto de una extensión en cada idioma, como objeto congelado del módulo generado. */
function textoPorIdioma(textos: TextosDeExtension, id: string, clave: string): string {
  const pares = IDIOMAS_DE_LAS_VARIANTES.map(
    (idioma) => `${idioma}: ${JSON.stringify(textoDeExtension(textos, id, idioma, clave))}`,
  );
  return `Object.freeze({ ${pares.join(', ')} })`;
}

/** La línea de una variante del módulo generado: ruta de entrada, estado del menú y opción del panel. */
function lineaDeVariante({ id, entrada }: Extension, textos: TextosDeExtension): string {
  const estado = textoPorIdioma(textos, id, `comun.menu.recorrido.${id}`);
  const opcion = textoPorIdioma(textos, id, `panel.recorrido.${id}`);
  const ruta = JSON.stringify(entrada);
  return `${JSON.stringify(id)}: Object.freeze({ ruta: ${ruta}, estado: ${estado}, opcion: ${opcion} }),`;
}

/** Genera el módulo de variantes desde el registro: ruta de entrada, estado del menú y opción del panel. */
export async function textoVariantesDisponibles(raiz: URL = RAIZ): Promise<string> {
  const lineas: string[] = [];
  for (const extension of EXTENSIONES) {
    lineas.push(lineaDeVariante(extension, await textosDeLaExtension(raiz, extension)));
  }
  const declaracion = `export const VARIANTES_INSTALADAS = Object.freeze({${lineas.join('\n')}});\n`;
  const texto = `${TIPO_DE_LAS_VARIANTES}${CABECERA_DE_LAS_VARIANTES}${declaracion}`;
  return formatearTextoConBiome(texto, VARIANTES_DISPONIBLES);
}

/** Lo que se genera desde el registro de extensiones, además de las copias. */
export async function artefactosDelRegistro(raiz: URL = RAIZ): Promise<ReadonlyMap<URL, string>> {
  return new Map([[new URL(VARIANTES_DISPONIBLES, raiz), await textoVariantesDisponibles(raiz)]]);
}

/** Comprueba sin escribir, o actualiza las publicaciones locales sin desplegarlas. */
async function principal(): Promise<void> {
  const { values } = orden(USO).leer({ options: { comprobar: { type: 'boolean' } } });
  for (const [archivo, contenido] of [...artefactosComunes(), ...(await artefactosDelRegistro())]) {
    if (values.comprobar) {
      if (readFileSync(archivo, 'utf8') !== contenido) {
        throw new Error(`Publicación desactualizada: ${fileURLToPath(archivo)}`);
      }
    } else {
      mkdirSync(dirname(fileURLToPath(archivo)), { recursive: true });
      writeFileSync(archivo, contenido);
    }
  }
  console.log(values.comprobar ? 'Utilidades web publicadas al día' : 'Utilidades web generadas');
}

if (import.meta.main) {
  await ejecutar(principal, 'Utilidades web');
}
