// Las listas de la copia sin conexión del service worker se calculan desde lo publicado en web/: ARCHIVOS y
// BAJO_DEMANDA guardan recursos públicos; COMPROBADOS añade, con su huella, el motor y las publicaciones compartidas
// vigentes. Los bytes del paquete del navegador y del motor salen del contexto de la construcción (empaquetado.ts),
// nunca de una compilación aparte ni de la salida que se comprueba.
// Al instalar se descarga toda la copia: ARCHIVOS y COMPROBADOS enteros. BAJO_DEMANDA solo lleva las fotografías a
// tamaño completo (FOTO_GRANDE), que se piden la primera vez que se ven. HUELLAS_DE_ARCHIVOS lleva la huella SHA-256 de
// cada archivo de ARCHIVOS y BAJO_DEMANDA tal como se publica: el service worker no guarda en la copia nada que no
// cuadre con la suya (ni al instalar, ni al reparar, ni al guardarlo cuando se usa). La política única excluye rutas
// operativas tanto del CATALOGO como de la captura de peticiones del SW.
// FIRMAS debe estar vacía en esta construcción local: una firma de otra publicación no autoriza una nueva.
// Las listas se escriben juntas en el CATALOGO del service worker (servicio/servicio-publicado.ts, catalogoDeListas):
// una entrada por ruta, con su huella y su clase; la comprobación las vuelve a sacar de él (listasDelCatalogo).
// VERSION es la huella del CATALOGO (ruta, clase y huella de cada entrada), de las páginas con marcador de versión,
// del código del service worker con los valores neutros de su plantilla y de las cabeceras: la regla está en
// version-copia.ts (huellaDeLaCopia). Se calcula con el mismo CATALOGO que se publica, que solo difiere en las huellas
// de las páginas con marcador, y esas se cuentan con el marcador vacío; la comprobación la rehace desde el CATALOGO
// escrito. El service-worker.js de la web construida se construye desde src/service-worker/ con todos esos valores
// (servicio/servicio-publicado.ts), y la comprobación exige que sea, byte a byte, el que da esa construcción. La
// preparación/verificación integrada se ejecuta mediante herramientas/web/preparar.ts (véase docs/construccion-web.md).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { seccionDeLaRuta } from '../../src/administracion/secciones-web.js';
import { cabecerasWeb, politicaDeContenidos } from '../../src/plataforma/cabeceras-web.ts';
import { paqueteParaPublicar } from '../../src/plataforma/node/paquete-publicado.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { PAGINA_NO_EXISTE } from '../../src/plataforma/pagina-no-existe.ts';
import { rutaFueraDeLaCopia } from '../../src/plataforma/politica-cache-web.ts';
import { PUBLICACIONES_CATALOGO } from './catalogo-cursos.ts';
import { PUBLICACIONES_COMUNES } from './comunes.ts';
import type { ContextoWeb } from './contexto.ts';
import { PUBLICACIONES_GLOBALES } from './datos-globales.ts';
import { leer, SERVICE_WORKER } from './publicados.ts';
import {
  type Catalogo,
  CatalogoImposible,
  catalogoDeListas,
  type ListasDelCatalogo,
  listasDelCatalogo,
  ServicioIlegible,
  servicioConValores,
  type ValoresDelServicio,
  valoresDelServicio,
} from './servicio/servicio-publicado.ts';
import {
  fijarMarcador,
  huellaDeLaCopia,
  PAGINAS_CON_VERSION,
  problemasDeMarcadores,
  problemasDeVersion,
  VERSION_VACIA,
} from './version-copia.ts';

/**
 * Lo publicado que no entra en la copia: el service worker, que se publica pero lo conserva el resource map del
 * navegador, fuera de CacheStorage, y la página de una dirección que no existe, que solo entrega el servidor y siempre
 * con 404 (plataforma/pagina-no-existe.ts): precargada, haría fallar la instalación de la copia, y sin conexión no se
 * puede saber si una dirección existe. También quedan fuera las rutas operativas de la política compartida. Al cambiar
 * los recursos públicos se regeneran el CATALOGO y la VERSION con la preparación web.
 */
const FUERA_DE_LA_COPIA = new Set([SERVICE_WORKER, PAGINA_NO_EXISTE.slice(1)]);

/**
 * Fotografías a tamaño completo: van en BAJO_DEMANDA, no en ARCHIVOS. Solo las piden las pantallas grandes (srcset) y
 * sin conexión se sirve su versión de 800 px («foto.webp» → «foto-800.webp»), que sí se descarga al instalar.
 */
const FOTO_GRANDE = /^imagenes\/fotografias\/(.+)(?<!-800)\.webp$/;
/** Destinos web que produce herramientas/api/openapi.ts::artefactosDeContrato. */
const PUBLICACIONES_API = ['web/openapi.json', 'web/scripts/protocolo-web.js'];
/**
 * Las publicaciones vigentes de comunes, datos globales y API también
 * van con su huella, aunque no vivan en esas carpetas: así solo se sirve la copia exacta de su fuente única.
 */
const MODULOS_COMPARTIDOS = new Set(
  [
    ...Object.values(PUBLICACIONES_COMUNES),
    ...Object.values(PUBLICACIONES_CATALOGO),
    ...Object.values(PUBLICACIONES_GLOBALES),
    ...PUBLICACIONES_API,
  ].map((ruta) => posix.relative('web', ruta)),
);
/** Los nombres de archivo que admite el service worker dentro del paquete (service-worker.js, urlDelPaquete). */
const NOMBRE_EN_EL_PAQUETE = /^[a-z0-9-]+\.json$/;

/**
 * Lo publicado a mano que no va en ARCHIVOS sino en COMPROBADOS, con su huella: lo que ejecuta el Worker del motor del
 * dispositivo (el propio Worker y los demás scripts de motor-local/) y lo que usa para comprobar las firmas
 * (scripts/firmas/ y sus bibliotecas, terceros/noble/). El Worker no tiene mapa de módulos con SRI: su única
 * comprobación es la huella del service worker (scripts/firmas/manifiesto-firmado.js).
 */
const CARPETAS_COMPROBADAS = /^(scripts\/motor-local|scripts\/firmas|terceros\/noble)\//;

/** Un recurso protegido: el código del Worker o un módulo generado desde su casa común del motor. */
function esComprobado(archivo: string): boolean {
  return (
    CARPETAS_COMPROBADAS.test(archivo) ||
    MODULOS_COMPARTIDOS.has(archivo) ||
    archivo === 'scripts/catalogo-cursos/referencia.js' ||
    archivo.startsWith('datos/catalogo-cursos/')
  );
}

/** Los valores del service worker publicado en `web` (servicio-publicado.ts, valoresDelServicio). */
function leerServiceWorker(web: string): ValoresDelServicio {
  return valoresDelServicio(leer(SERVICE_WORKER, web));
}

/** Los nombres de las listas que salen del CATALOGO del service worker publicado (listasDelCatalogo). */
type NombreDeLista = keyof ListasDelCatalogo;

/**
 * Las cadenas de una lista del CATALOGO del service worker publicado, leído de su línea generada sin ejecutar su
 * código.
 *
 * @param nombre - Lista de rutas, o de rutas y huellas alternadas en las listas con huella.
 * @param web - La carpeta de la web construida (.web-local/web o dist/web).
 * @returns Las cadenas de la lista, en orden.
 * @throws {ServicioIlegible} Si el service worker no declara sus valores en sus líneas generadas.
 */
export function listaDelServicio(nombre: NombreDeLista, web: string): string[] {
  return listasDelCatalogo(leerServiceWorker(web).CATALOGO)[nombre].flat();
}

/** La huella SHA-256 de una captura, en hexadecimal: la que exige el service worker (COMPROBADOS). */
function sha256DeBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Las listas de la copia escritas a mano, desde web/: lo que se precarga, lo que se pide al usarlo y lo comprobado. */
export interface ListasDeLaCopia {
  readonly archivos: readonly string[];
  readonly bajoDemanda: readonly string[];
  /** Lo comprobado publicado a mano; el motor se añade desde el contexto. */
  readonly comprobados: readonly string[];
}

/** Las listas de la copia y las páginas de PAGINAS_DE_SECCIONES (rutasDeSecciones de lo publicado). */
export interface FormaPublicada extends ListasDeLaCopia {
  readonly secciones: readonly string[];
}

/**
 * El código del service worker que entra en la VERSION (version-copia.ts): el construido con los valores neutros de
 * su plantilla, que ya lleva la política y el portal, y no depende de la VERSION ni del paquete de datos.
 */
function codigoDeLaCopia(neutro: string): Record<string, string> {
  return { [SERVICE_WORKER]: neutro };
}

/**
 * Lo que sale de la captura de la web: la VERSION y lo que deben tener COMPROBADOS, HUELLAS_DE_ARCHIVOS y
 * PAGINAS_DE_SECCIONES.
 */
interface CopiaCalculada {
  version: string;
  comprobados: Map<string, string>;
  archivos: Map<string, string>;
  secciones: Map<string, string>;
}

/**
 * La huella de cada archivo de `rutas` tal como se publica: sus bytes de la captura y, en una página con versión, con
 * el marcador ya fijado a `version` (fijarMarcador), como lo escribe generarCatalogos.
 */
function huellasDeLoPublicado(
  rutas: readonly string[],
  bytesDe: (archivo: string) => Uint8Array,
  version: string,
): Map<string, string> {
  const publicado = (ruta: string) =>
    PAGINAS_CON_VERSION.has(ruta) ? fijarMarcador(ruta, bytesDe(ruta), version) : bytesDe(ruta);
  return new Map([...rutas].sort().map((ruta) => [ruta, sha256DeBytes(publicado(ruta))]));
}

/**
 * Lo que deben tener HUELLAS_DE_ARCHIVOS (ARCHIVOS y BAJO_DEMANDA) y PAGINAS_DE_SECCIONES, de una sola cuenta de lo
 * publicado (huellasDeLoPublicado): las páginas de las secciones también están, casi todas, en ARCHIVOS.
 */
function huellasDeLasListas(
  listas: FormaPublicada,
  bytesDe: (archivo: string) => Uint8Array,
  version: string,
): { archivos: Map<string, string>; secciones: Map<string, string> } {
  const publicado = huellasDeLoPublicado(
    [...new Set([...listas.archivos, ...listas.bajoDemanda, ...listas.secciones])],
    bytesDe,
    version,
  );
  const deLista = (rutas: readonly string[]) =>
    new Map(
      [...rutas].sort().map((ruta) => {
        const huella = publicado.get(ruta);
        if (huella === undefined) {
          throw new Error(`Falta la huella de lo publicado para ${ruta}`);
        }
        return [ruta, huella] as const;
      }),
    );
  return { archivos: deLista([...listas.archivos, ...listas.bajoDemanda]), secciones: deLista(listas.secciones) };
}

/**
 * VERSION, COMPROBADOS y HUELLAS_DE_ARCHIVOS comparten la misma captura; el motor de referencia no se lee de la salida
 * candidata.
 */
function versionConContexto(
  listas: FormaPublicada,
  cabeceras: Readonly<Record<string, string>>,
  contexto: ContextoWeb,
  neutro: string,
): CopiaCalculada {
  const paginas = [...PAGINAS_CON_VERSION].filter((pagina) => existsSync(join(contexto.web, pagina)));
  const motor = [...contexto.motor.keys()].sort();
  const enLaWeb = [...listas.archivos, ...listas.bajoDemanda, ...listas.comprobados, ...listas.secciones];
  const enDisco = [...new Set([...enLaWeb, ...paginas])].filter(
    (archivo) => !contexto.motor.has(archivo) && !contexto.paqueteNavegador?.has(archivo),
  );
  const leidos = new Map<string, Uint8Array>(
    enDisco.map((archivo) => [archivo, readFileSync(join(contexto.web, archivo))]),
  );
  for (const [archivo, bytes] of [...(contexto.paqueteNavegador ?? []), ...contexto.motor]) {
    leidos.set(archivo, bytes);
  }
  const bytesDe = (archivo: string): Uint8Array => {
    const bytes = leidos.get(archivo);
    if (bytes === undefined) {
      throw new Error(`Falta la captura de ${archivo}`);
    }
    return bytes;
  };
  const comprobados = [...new Set([...[...listas.comprobados].sort(), ...motor])];
  const huellasDeComprobados = new Map(comprobados.map((archivo) => [archivo, sha256DeBytes(bytesDe(archivo))]));
  const sinMarcador = huellasDeLasListas(listas, bytesDe, VERSION_VACIA);
  const catalogo = catalogoDeListas({
    ARCHIVOS: listas.archivos,
    BAJO_DEMANDA: listas.bajoDemanda,
    PAGINAS_DE_SECCIONES: [...sinMarcador.secciones],
    HUELLAS_DE_ARCHIVOS: [...sinMarcador.archivos],
    COMPROBADOS: [...huellasDeComprobados],
  });
  const version = huellaDeLaCopia(
    { catalogo, paginasConVersion: paginas, codigo: codigoDeLaCopia(neutro), cabeceras },
    bytesDe,
  );
  return { version, comprobados: huellasDeComprobados, ...huellasDeLasListas(listas, bytesDe, version) };
}

/**
 * La VERSION que da un CATALOGO ya escrito (huellaDeLaCopia), con los bytes de las páginas con marcador de `web`: la
 * que debe llevar el service worker que lo publica.
 */
function versionDelCatalogo(
  catalogo: Catalogo,
  web: string,
  cabeceras: Readonly<Record<string, string>>,
  neutro: string,
): string {
  const paginas = [...PAGINAS_CON_VERSION].filter((pagina) => existsSync(join(web, pagina)));
  return huellaDeLaCopia(
    { catalogo, paginasConVersion: paginas, codigo: codigoDeLaCopia(neutro), cabeceras },
    (archivo) => readFileSync(join(web, archivo)),
  );
}

/**
 * La VERSION de la web con unas cabeceras y lo que debe tener COMPROBADOS. La VERSION cubre lo que dice
 * huellaDeLaCopia (version-copia.ts): el CATALOGO que se publica (ruta, clase y huella), las páginas con marcador, el
 * código del service worker construido con los valores neutros (primera pasada) y las cabeceras. Usa los bytes del
 * paquete y del motor empaquetado del contexto; nunca compila el motor.
 *
 * @param listas - Las listas de la copia escritas a mano y las páginas de secciones, con sus rutas desde web/.
 * @param cabeceras - Las cabeceras con que se sirven (entran en la huella: un cambio de CSP renueva la copia).
 * @param contexto - La candidata y la captura independiente del motor.
 * @returns La VERSION; lo que debe tener COMPROBADOS: cada archivo de las carpetas protegidas, de las copias
 *   compartidas y del motor, con su huella SHA-256; y lo que debe tener HUELLAS_DE_ARCHIVOS: cada archivo de ARCHIVOS y
 *   BAJO_DEMANDA, con la huella SHA-256 de lo publicado.
 */
export async function versionDeLaWeb(
  listas: FormaPublicada,
  cabeceras: Readonly<Record<string, string>>,
  contexto: ContextoWeb,
): Promise<CopiaCalculada> {
  return versionConContexto(listas, cabeceras, contexto, await servicioConValores());
}

/** Los archivos de la lista `nombre` (COMPROBADOS o HUELLAS_DE_ARCHIVOS) cuya huella no es la de lo publicado. */
function huellasQueNoCuadran(
  nombre: string,
  escritas: readonly (readonly [string, string])[],
  calculados: ReadonlyMap<string, string>,
): string[] {
  return escritas
    .filter(([archivo, huella]) => calculados.has(archivo) && calculados.get(archivo) !== huella)
    .map(([archivo]) => `${SERVICE_WORKER}: la huella de «${archivo}» en ${nombre} no es la de lo publicado`);
}

/**
 * Una lista con huella del service worker (COMPROBADOS, HUELLAS_DE_ARCHIVOS o PAGINAS_DE_SECCIONES) frente a lo
 * calculado: los archivos que le faltan o le sobran y las huellas que no son las de lo publicado.
 */
function listaConHuellas(
  nombre: string,
  escritas: readonly (readonly [string, string])[],
  calculadas: ReadonlyMap<string, string>,
  web: string,
): string[] {
  return [
    ...diferenciasDeLista(
      nombre,
      escritas.map(([archivo]) => archivo),
      new Set(calculadas.keys()),
      web,
    ),
    ...huellasQueNoCuadran(nombre, escritas, calculadas),
  ];
}

/** Por qué sobra un archivo de una lista: no existe (se movió o se renombró) o existe pero no va en esa lista. */
function porQueSobra(nombre: string, archivo: string, web: string): string {
  return existsSync(join(web, archivo))
    ? `${SERVICE_WORKER}: «${archivo}» está en ${nombre} y no debería`
    : `${SERVICE_WORKER}: ${nombre} cita «${archivo}», que no existe en web/`;
}

/** Diferencias entre una lista del service worker y lo que debería tener. */
function diferenciasDeLista(
  nombre: string,
  lista: readonly string[],
  esperados: ReadonlySet<string>,
  web: string,
): string[] {
  const faltan = [...esperados].filter((archivo) => !lista.includes(archivo));
  const sobran = lista.filter((archivo) => !esperados.has(archivo));
  const problemas = [
    ...faltan.map((archivo) => `${SERVICE_WORKER}: falta «${archivo}» en ${nombre}`),
    ...sobran.map((archivo) => porQueSobra(nombre, archivo, web)),
  ];
  if (new Set(lista).size !== lista.length) {
    problemas.push(`${SERVICE_WORKER}: ${nombre} repite algún archivo`);
  }
  return problemas;
}

/**
 * Lo publicado a mano que va en la copia, salvo las carpetas protegidas y las copias compartidas: van en COMPROBADOS.
 */
function enLaCopiaSinHuella(publicados: readonly string[]): string[] {
  return publicados.filter(
    (archivo) => !FUERA_DE_LA_COPIA.has(archivo) && !rutaFueraDeLaCopia(archivo) && !esComprobado(archivo),
  );
}

/** Lo publicado a mano que va en COMPROBADOS (el resto de COMPROBADOS es el motor). */
function comprobadosDeLaWeb(publicados: readonly string[]): string[] {
  return publicados.filter((archivo) => esComprobado(archivo) && !rutaFueraDeLaCopia(archivo));
}

/**
 * Listas de recursos de la selección admitida, calculadas desde lo publicado y no desde el CATALOGO ya escrito.
 * Todo se precarga salvo las fotografías grandes, que van en BAJO_DEMANDA; lo comprobado va en COMPROBADOS con su
 * huella.
 */
export function listasDeLaCopia(publicados: readonly string[]): {
  archivos: string[];
  bajoDemanda: string[];
  comprobados: string[];
} {
  const sinHuella = enLaCopiaSinHuella(publicados);
  return {
    archivos: sinHuella.filter((archivo) => !FOTO_GRANDE.test(archivo)).sort(),
    bajoDemanda: sinHuella.filter((archivo) => FOTO_GRANDE.test(archivo)).sort(),
    comprobados: comprobadosDeLaWeb(publicados).sort(),
  };
}

/**
 * ARCHIVOS es lo publicado que va en la copia, salvo las fotografías grandes y lo comprobado; BAJO_DEMANDA, esas
 * fotografías. Cada una necesita su versión de 800 px en ARCHIVOS, que es la que se sirve sin conexión si la grande no
 * se llegó a ver.
 */
function comprobarListasDeArchivos(
  archivos: readonly string[],
  bajoDemanda: readonly string[],
  publicados: readonly string[],
  web: string,
): string[] {
  const esperadas = listasDeLaCopia(publicados);
  const grandes = enLaCopiaSinHuella(publicados).filter((archivo) => FOTO_GRANDE.test(archivo));
  const sinReducida = grandes
    .map((archivo) => archivo.replace(/\.webp$/, '-800.webp'))
    .filter((reducida) => !archivos.includes(reducida))
    .map(
      (reducida) => `${SERVICE_WORKER}: falta «${reducida}» en ARCHIVOS (se sirve sin conexión en lugar de la grande)`,
    );
  return [
    ...diferenciasDeLista('ARCHIVOS', archivos, new Set(esperadas.archivos), web),
    ...diferenciasDeLista('BAJO_DEMANDA', bajoDemanda, new Set(esperadas.bajoDemanda), web),
    ...sinReducida,
  ];
}

/**
 * TAMANOS_DEL_PAQUETE del paquete de `carpeta`, como JSON: lo que pesa en bytes cada archivo que nombra su
 * manifiesto, por orden alfabético. Un nombre que el service worker no admitiría o un archivo que no está no llevan
 * tamaño: el service worker los cuenta por su parte proporcional.
 */
export function tamanosDelPaquete(carpeta: string = RUTAS.paquete): string {
  const manifiesto: unknown = JSON.parse(readFileSync(join(carpeta, 'manifiesto.json'), 'utf8'));
  const nombres = typeof manifiesto === 'object' && manifiesto !== null ? Object.keys(manifiesto) : [];
  const tamanos = Object.fromEntries(
    nombres
      .filter((archivo) => NOMBRE_EN_EL_PAQUETE.test(archivo) && existsSync(join(carpeta, archivo)))
      .sort()
      .map((archivo) => [archivo, statSync(join(carpeta, archivo)).size]),
  );
  return JSON.stringify(tamanos);
}

/** PAQUETE identifica el manifiesto vigente de datos/, el mismo que se publica, y TAMANOS_DEL_PAQUETE, sus tamaños. */
function comprobarVersionDelPaquete(servicio: ValoresDelServicio, paquete: string = RUTAS.paquete): string[] {
  const escrita = servicio.PAQUETE;
  const actual = paqueteParaPublicar(paquete).version;
  const problemas =
    escrita === actual
      ? []
      : [
          `${SERVICE_WORKER}: PAQUETE es «${escrita}» y el paquete de datos es «${actual}» (corrígelo con npm run web:preparar)`,
        ];
  if (servicio.TAMANOS_DEL_PAQUETE !== tamanosDelPaquete(paquete)) {
    problemas.push(
      `${SERVICE_WORKER}: TAMANOS_DEL_PAQUETE no son los del paquete de datos (corrígelo con npm run web:preparar)`,
    );
  }
  return problemas;
}

/** Un catálogo nunca autoriza a guardar una ruta operativa, aunque su huella sea correcta. */
function problemasDeRutasOperativas(servicio: ListasDelCatalogo): string[] {
  const rutas = [...servicio.ARCHIVOS, ...servicio.BAJO_DEMANDA, ...servicio.COMPROBADOS.map(([ruta]) => ruta)];
  return rutas.filter(rutaFueraDeLaCopia).map((ruta) => `${SERVICE_WORKER}: «${ruta}» es operativa y no admite caché`);
}

/** Lo que impide fiarse del CATALOGO escrito: una ruta operativa o una clase u orden que no dan sus listas. */
function problemasDelCatalogo(catalogo: Catalogo, escritas: ListasDelCatalogo): string[] {
  const operativas = problemasDeRutasOperativas(escritas);
  return operativas.length ? operativas : problemasDeClases(catalogo, escritas);
}

/**
 * El CATALOGO escrito es, entrada a entrada, el que dan sus propias listas (catalogoDeListas): la clase de cada ruta
 * (instalar o adorno, por ejemplo) y el orden no se pueden escribir a mano.
 */
function problemasDeClases(catalogo: Catalogo, escritas: ListasDelCatalogo): string[] {
  try {
    if (isDeepStrictEqual(catalogo, catalogoDeListas(escritas))) {
      return [];
    }
  } catch (error) {
    if (!(error instanceof CatalogoImposible)) {
      throw error;
    }
    return [`${SERVICE_WORKER}: ${error.message} (corrígelo con npm run web:preparar)`];
  }
  return [
    `${SERVICE_WORKER}: el CATALOGO no lleva la clase o el orden que dan sus listas (corrígelo con npm run web:preparar)`,
  ];
}

/** Las páginas de lo publicado que pertenecen a una sección: las de PAGINAS_DE_SECCIONES, en orden. */
function rutasDeSecciones(publicados: readonly string[]): string[] {
  return publicados.filter((ruta) => ruta.endsWith('.html') && seccionDeLaRuta(`/${ruta}`)).sort();
}

/**
 * Los valores del service worker que salen de lo publicado: las listas calculadas, la VERSION y las huellas de una
 * misma captura (versionDeLaWeb), el paquete de datos vigente y FIRMAS vacía, la de esta construcción local.
 */
function valoresCalculados(
  listas: ReturnType<typeof listasDeLaCopia>,
  calculada: CopiaCalculada,
  paquete: string,
): ValoresDelServicio {
  return {
    VERSION: calculada.version,
    FIRMAS: [],
    PAQUETE: paqueteParaPublicar(paquete).version,
    TAMANOS_DEL_PAQUETE: tamanosDelPaquete(paquete),
    CATALOGO: catalogoDeListas({
      ARCHIVOS: listas.archivos,
      BAJO_DEMANDA: listas.bajoDemanda,
      PAGINAS_DE_SECCIONES: [...calculada.secciones],
      HUELLAS_DE_ARCHIVOS: [...calculada.archivos],
      COMPROBADOS: [...calculada.comprobados],
    }),
  };
}

/** Los valores del service worker publicado, o el problema que impide leerlos sin ejecutar su código. */
function servicioLeido(publicados: readonly string[], web: string): ValoresDelServicio | string[] {
  if (!publicados.includes(SERVICE_WORKER) || !existsSync(join(web, SERVICE_WORKER))) {
    return [`${SERVICE_WORKER}: falta el service worker publicado (corrígelo con npm run web:preparar)`];
  }
  try {
    return leerServiceWorker(web);
  } catch (error) {
    if (error instanceof ServicioIlegible) {
      return [`${SERVICE_WORKER}: ${error.message} (corrígelo con npm run web:preparar)`];
    }
    throw error;
  }
}

/** Lo que da la captura de la web con las listas escritas, con el mismo código neutro que la VERSION del CATALOGO. */
function versionDeLoEscrito(
  escritas: ListasDelCatalogo,
  publicados: readonly string[],
  copia: { readonly cabeceras: Readonly<Record<string, string>>; readonly neutro: string },
  contexto: ContextoWeb,
): CopiaCalculada {
  const listas = {
    archivos: escritas.ARCHIVOS,
    bajoDemanda: escritas.BAJO_DEMANDA,
    comprobados: comprobadosDeLaWeb(publicados),
    secciones: rutasDeSecciones(publicados),
  };
  return versionConContexto(listas, copia.cabeceras, contexto, copia.neutro);
}

/**
 * Las listas del service worker tienen lo que deben, su VERSION es la que da su CATALOGO escrito, su PAQUETE, la
 * versión del paquete de datos, y el archivo entero es, byte a byte, el que se construye desde src/service-worker/
 * con esos valores: un cambio en el código del service worker sin npm run web:preparar tampoco pasa.
 *
 * @param publicados - Lo publicado de web/, con su ruta desde web/.
 * @param huellaDelMapa - La huella del mapa de módulos con la que se calcula la CSP de las cabeceras.
 * @param contexto - La candidata, su paquete y el motor final.
 * @returns Un problema por diferencia; vacío si el service worker está al día.
 */
export async function comprobarServiceWorker(
  publicados: readonly string[],
  huellaDelMapa: string,
  contexto: ContextoWeb,
): Promise<string[]> {
  const { web } = contexto;
  const servicio = servicioLeido(publicados, web);
  if (Array.isArray(servicio)) {
    return servicio;
  }
  const escritas = listasDelCatalogo(servicio.CATALOGO);
  const delCatalogo = problemasDelCatalogo(servicio.CATALOGO, escritas);
  if (delCatalogo.length) {
    return delCatalogo;
  }
  const paquete = comprobarVersionDelPaquete(servicio, contexto.paquete);
  if (servicio.FIRMAS.length) {
    return [...paquete, `${SERVICE_WORKER}: FIRMAS debe estar declarada como lista vacía en la construcción local`];
  }
  const listas = comprobarListasDeArchivos(escritas.ARCHIVOS, escritas.BAJO_DEMANDA, publicados, web);
  // Con las listas mal, la huella no dice nada útil: primero se arreglan las listas.
  if (listas.length) {
    return [...paquete, ...listas];
  }
  const cabeceras = cabecerasWeb(politicaDeContenidos(huellaDelMapa));
  const neutro = await servicioConValores();
  const calculada = versionDeLoEscrito(escritas, publicados, { cabeceras, neutro }, contexto);
  const problemas = [
    ...problemasDeMarcadores(publicados, calculada.version, (pagina) => leer(pagina, web)),
    ...paquete,
    ...listaConHuellas('COMPROBADOS', escritas.COMPROBADOS, calculada.comprobados, web),
    ...listaConHuellas('HUELLAS_DE_ARCHIVOS', escritas.HUELLAS_DE_ARCHIVOS, calculada.archivos, web),
    ...listaConHuellas('PAGINAS_DE_SECCIONES', escritas.PAGINAS_DE_SECCIONES, calculada.secciones, web),
    ...problemasDeVersion(
      servicio.VERSION,
      { catalogo: versionDelCatalogo(servicio.CATALOGO, web, cabeceras, neutro), contenido: calculada.version },
      SERVICE_WORKER,
    ),
  ];
  if (problemas.length) {
    return problemas;
  }
  const esperado = await servicioConValores(
    valoresCalculados(listasDeLaCopia(publicados), calculada, contexto.paquete),
  );
  return leer(SERVICE_WORKER, web) === esperado
    ? []
    : [
        `${SERVICE_WORKER}: no es el que se construye desde src/service-worker/ con sus valores (corrígelo con npm run web:preparar)`,
      ];
}

/**
 * Construye el service worker desde src/service-worker/ con el CATALOGO de lo publicado admitido, sin partir de
 * listas ni firmas ya escritas, en dos pasadas: la VERSION sale del construido con los valores neutros, y el que se
 * escribe lleva los reales. Fija también el marcador de versión de las páginas que lo llevan. Prepara todo antes de
 * escribir; no promete atomicidad frente a errores de disco durante las escrituras.
 * Prepara la candidata del contexto y reutiliza su captura del motor.
 */
export async function generarCatalogos(
  publicados: readonly string[],
  huellaDelMapa: string,
  contexto: ContextoWeb,
): Promise<void> {
  const { web } = contexto;
  const listas = listasDeLaCopia(publicados);
  const problemasDeListas = comprobarListasDeArchivos(listas.archivos, listas.bajoDemanda, publicados, web);
  if (problemasDeListas.length) {
    throw new Error(problemasDeListas.join('\n'));
  }
  const cabeceras = cabecerasWeb(politicaDeContenidos(huellaDelMapa));
  const calculada = await versionDeLaWeb({ ...listas, secciones: rutasDeSecciones(publicados) }, cabeceras, contexto);
  const servicio = await servicioConValores(valoresCalculados(listas, calculada, contexto.paquete));
  for (const pagina of PAGINAS_CON_VERSION) {
    if (publicados.includes(pagina)) {
      writeFileSync(join(web, pagina), fijarMarcador(pagina, readFileSync(join(web, pagina)), calculada.version));
    }
  }
  writeFileSync(join(web, SERVICE_WORKER), servicio);
}
