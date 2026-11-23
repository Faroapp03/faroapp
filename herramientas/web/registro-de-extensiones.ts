/**
 * Coincidencia entre las extensiones registradas y sus carpetas de la web, en los dos sentidos. Una carpeta con
 * `servidor/extension.ts` que no figura en el registro publicaría sus páginas como recursos ordinarios, sin la
 * autoridad de recorrido que las protege; un registro sin su carpeta apunta a una variante que no existe. Además,
 * solo las carpetas del real de `CARPETAS_DEL_REAL_CON_PAGINAS` y las de extensiones registradas pueden tener
 * páginas: una carpeta con páginas sin su `servidor/extension.ts` es una retirada a medias.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { esObjeto } from '../../src/comun/json.ts';
import type { Extension } from '../../src/plataforma/extension.ts';

const SERVIDOR_DE_EXTENSION = join('servidor', 'extension.ts');
const REGISTRO = 'src/plataforma/extensiones-instaladas.ts';
/** El módulo que reúne las líneas del registro en `EXTENSIONES`. */
const EXTENSIONES_DE_LA_RAIZ = 'src/plataforma/extensiones.ts';
/**
 * Lista cerrada de las carpetas de primer nivel de la web real que contienen páginas HTML. Cualquier otra carpeta con
 * páginas tiene que ser una extensión registrada. Una carpeta nueva del real con páginas se añade aquí.
 */
export const CARPETAS_DEL_REAL_CON_PAGINAS: readonly string[] = Object.freeze(['administracion']);
const DE_ESTE_ARCHIVO = 'herramientas/web/registro-de-extensiones.ts';

type ExtensionRegistrada = Pick<Extension, 'id' | 'entrada'>;

function esExtensionRegistrada(valor: unknown): valor is ExtensionRegistrada {
  return esObjeto(valor) && typeof valor.id === 'string' && typeof valor.entrada === 'string';
}

/**
 * Las extensiones registradas en una raíz, cargadas de su propio `src/plataforma/extensiones.ts`: el registro que
 * corresponde a las fuentes que se construyen, y no el de la instalación que ejecuta la herramienta. Para la propia
 * instalación es el mismo módulo que `EXTENSIONES`. Una raíz sin ese módulo no tiene extensiones instaladas.
 *
 * @param raiz - La raíz de la instalación que se comprueba.
 * @returns Las extensiones registradas, en el orden del registro.
 */
export async function extensionesDeLaRaiz(raiz: string): Promise<readonly ExtensionRegistrada[]> {
  const archivo = join(raiz, EXTENSIONES_DE_LA_RAIZ);
  if (!existsSync(archivo)) {
    return [];
  }
  const modulo: unknown = await import(pathToFileURL(archivo).href);
  const extensiones = esObjeto(modulo) ? modulo.EXTENSIONES : undefined;
  if (!(Array.isArray(extensiones) && extensiones.every(esExtensionRegistrada))) {
    throw new Error(
      `${EXTENSIONES_DE_LA_RAIZ} debe exportar EXTENSIONES como una lista de extensiones con id y entrada.`,
    );
  }
  return extensiones;
}

/** Si la carpeta tiene `servidor/extension.ts`. Solo su ausencia cuenta como «no»; otro error se propaga con su causa. */
function tieneServidor(web: string, carpeta: string): boolean {
  try {
    return statSync(join(web, carpeta, SERVIDOR_DE_EXTENSION)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw new Error(`No se puede comprobar si web/${carpeta}/ tiene ${SERVIDOR_DE_EXTENSION}`, { cause: error });
  }
}

/** Cuántas páginas HTML hay dentro de una carpeta, a cualquier profundidad. */
function paginasDe(carpeta: string): number {
  return readdirSync(carpeta, { withFileTypes: true }).reduce((total, entrada) => {
    if (entrada.isDirectory()) {
      return total + paginasDe(join(carpeta, entrada.name));
    }
    return total + Number(entrada.isFile() && entrada.name.endsWith('.html'));
  }, 0);
}

/**
 * Las carpetas de primer nivel con páginas que no son del real ni tienen `servidor/extension.ts` (estas últimas ya
 * cuentan como carpeta sin registro), con un problema por carpeta.
 */
function carpetasConPaginasSinAutoridad(web: string, registradas: ReadonlySet<string>): string[] {
  const admitidas = new Set([...CARPETAS_DEL_REAL_CON_PAGINAS, ...registradas]);
  return (existsSync(web) ? readdirSync(web, { withFileTypes: true }) : [])
    .filter((entrada) => entrada.isDirectory() && !admitidas.has(entrada.name) && !tieneServidor(web, entrada.name))
    .map(({ name }) => ({ carpeta: name, paginas: paginasDe(join(web, name)) }))
    .filter(({ paginas }) => paginas > 0)
    .sort((a, b) => (a.carpeta < b.carpeta ? -1 : Number(a.carpeta > b.carpeta)))
    .map(
      ({ carpeta, paginas }) =>
        `La carpeta web/${carpeta}/ tiene páginas (${paginas}) pero no es una carpeta del real ni de una extensión ` +
        'registrada, y se servirían sin la autoridad de recorrido. ' +
        `Si es una retirada a medias, borra web/${carpeta}/; si es una extensión, restaura su ` +
        `${SERVIDOR_DE_EXTENSION} y su línea en ${REGISTRO}; si es del real, añádela a ` +
        `CARPETAS_DEL_REAL_CON_PAGINAS en ${DE_ESTE_ARCHIVO}.`,
    );
}

/** La carpeta de primer nivel de la entrada; vacía si la entrada no está dentro de una carpeta. */
function carpetaDeEntrada(entrada: string): string {
  const barra = entrada.indexOf('/');
  return barra > 0 ? entrada.slice(0, barra) : '';
}

/**
 * Lee la web indicada sin modificarla y devuelve un problema por cada carpeta de primer nivel con
 * `servidor/extension.ts` sin registro, por cada carpeta con páginas que no es del real ni de una extensión y por
 * cada extensión registrada cuya carpeta no tiene `servidor/extension.ts`. Una web que no
 * existe no tiene carpetas: cada extensión registrada cuenta entonces como registro sin carpeta.
 *
 * @param web - La raíz de la web que se comprueba.
 * @param extensiones - Las extensiones registradas.
 * @returns Los problemas encontrados, cada uno con su arreglo; vacía si el registro y las carpetas coinciden.
 */
export function comprobarRegistroDeExtensiones(web: string, extensiones: readonly ExtensionRegistrada[]): string[] {
  const registradas = new Set(extensiones.map(({ entrada }) => carpetaDeEntrada(entrada)));
  const sinRegistro = (existsSync(web) ? readdirSync(web, { withFileTypes: true }) : [])
    .filter((entrada) => entrada.isDirectory() && !registradas.has(entrada.name) && tieneServidor(web, entrada.name))
    .map(({ name }) => name)
    .sort()
    .map(
      (carpeta) =>
        `La carpeta web/${carpeta}/ tiene ${SERVIDOR_DE_EXTENSION} pero no figura en ${REGISTRO}, y sus páginas se ` +
        `servirían sin la autoridad de recorrido: retira la carpeta web/${carpeta}/ o añade su línea a ${REGISTRO}.`,
    );
  const sinCarpeta = extensiones
    .filter(({ entrada }) => {
      const carpeta = carpetaDeEntrada(entrada);
      return !carpeta || !tieneServidor(web, carpeta);
    })
    .map(
      ({ id, entrada }) =>
        `La extensión «${id}» está registrada con la entrada ${entrada}, pero web/${carpetaDeEntrada(entrada)}/ no ` +
        `tiene ${SERVIDOR_DE_EXTENSION}: quita su línea de ${REGISTRO} o restaura su carpeta.`,
    );
  return [...sinRegistro, ...carpetasConPaginasSinAutoridad(web, registradas), ...sinCarpeta];
}
