// El grafo emitido: el resumen por página (entrada, trozos estáticos y dinámicos, bytes), el código de servidor y los
// módulos privados que han aportado bytes, y las guardias que lo comprueban contra PRESUPUESTOS sobre la web ya
// preparada. Ningún presupuesto admite margen: cualquier caso es un defecto, y los techos de forma son los medidos.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { type Metafile, transformSync } from 'esbuild';
import type { Extension } from '../../../src/plataforma/extension.ts';
import { EXTENSIONES } from '../../../src/plataforma/extensiones.ts';
import { modulosDeLaPagina } from '../grafo-de-paginas.ts';
import { archivosPublicados, WEB } from '../publicados.ts';
import { carpetaDelPaqueteDe, seEmpaqueta } from './zonas.ts';

/** Con trozos compartidos entre las páginas de una zona, o un archivo por página que no comparte nada. */
export type FormaDelPaquete = 'compartida' | 'por-pagina';

/** Lo que la construcción tolera del grafo emitido. */
export const PRESUPUESTOS = Object.freeze({
  /** Módulos de entrada por página. */
  entradasPorPagina: 1,
  /** Archivos de servidor por su ruta de origen, fuera del contrato del motor del dispositivo. */
  servidorPorRuta: 0,
  /** Módulos privados (administración, API de socios, A2A y controles administrativos) en el paquete. */
  privados: 0,
  /** JavaScript publicado al que no llega ninguna página, el Worker ni el motor. */
  inalcanzables: 0,
  /** Referencias a mapas de código en el JavaScript publicado. */
  mapasDeCodigo: 0,
  /** Archivos del paquete que todavía se acortan al quitarles los espacios: los que no salieron minificados. */
  sinMinificar: 0,
  /** Archivos JavaScript del paquete sin un solo byte. */
  vacios: 0,
  /** Archivos del paquete con los mismos bytes que otro de su zona: el mismo código se publica una sola vez. */
  duplicados: 0,
  // Los techos de forma (módulos al abrir y archivos por carpeta) son lo medido sobre la construcción publicable de
  // esta versión, sin margen. Al cambiar, se mide de nuevo y se anota aquí qué páginas o archivos dan la cifra.
  /**
   * Módulos que carga una página al abrirse (su entrada y sus trozos estáticos): 13, en que-es-faro, datos-globales y
   * datos-globales-ue, con trozos compartidos.
   */
  modulosAlAbrir: 13,
  /**
   * Archivos por carpeta, con lo que haya debajo. js/, la de las páginas públicas: 45, que son 17 entradas para 19
   * páginas (la de cursos lleva la tabla de clasificación del lector del catálogo, que solo usa ella), 26 trozos (uno,
   * la vigencia del lector, que comparten cursos y paso-informe; otro, las cifras comunes de cifras.js, que comparten
   * el recorrido, el catálogo y el panel), la entrada estable de paso-informe y la de etapas, que se carga con
   * import(). motor/: 19, sus 8 entradas y 11 trozos. El de la carpeta del paquete de cada extensión
   * lo declara ella (techosDeLasExtensiones).
   */
  archivosPorCarpeta: Object.freeze({ 'js/': 45, 'motor/': 19 }),
});

/**
 * Dónde declara cada extensión, en su carpeta de la web y fuera de lo publicado (servidor/, .assetsignore), el techo
 * de archivos del paquete de sus rutas protegidas: `archivosDelPaquete`, lo medido sin margen, y `medida`, qué es.
 */
export const TECHO_DE_LA_EXTENSION = 'servidor/paquete.json';

/**
 * Los techos de archivos por carpeta de las extensiones instaladas: el de la carpeta de su paquete
 * (carpetaDelPaqueteDe) que declara cada una en TECHO_DE_LA_EXTENSION. Sin extensiones, ninguno. Una extensión que no
 * lo declara detiene la comprobación.
 */
export function techosDeLasExtensiones(
  extensiones: readonly Extension[] = EXTENSIONES,
  web: string = WEB,
): Record<string, number> {
  return Object.fromEntries(
    extensiones.map((extension) => {
      const declaracion = join(web, extension.entrada.split('/')[0] ?? '', TECHO_DE_LA_EXTENSION);
      const { archivosDelPaquete } = JSON.parse(readFileSync(declaracion, 'utf8')) as { archivosDelPaquete?: unknown };
      if (typeof archivosDelPaquete !== 'number' || !Number.isInteger(archivosDelPaquete) || archivosDelPaquete < 0) {
        throw new Error(`${declaracion}: no declara archivosDelPaquete, un entero sin signo`);
      }
      return [`${carpetaDelPaqueteDe(extension)}/`, archivosDelPaquete];
    }),
  );
}

/** Los techos de archivos por carpeta: los de la web (PRESUPUESTOS) y los de las extensiones instaladas. */
export function techosPorCarpeta(): Record<string, number> {
  return { ...PRESUPUESTOS.archivosPorCarpeta, ...techosDeLasExtensiones() };
}

/** El código de servidor por su ruta de origen: la API y la administración. */
const SERVIDOR = /^src\/(?:api|administracion)\//;
/**
 * El contrato del motor del dispositivo: las rutas locales de la API que monta src/plataforma/navegador/api-local.ts y
 * el MCP local, que usa WebMCP. Son código de la API, pero el dispositivo responde con ellas sus propias consultas.
 */
const CONTRATO_DEL_DISPOSITIVO: readonly RegExp[] = [
  /^src\/api\/rutas\//,
  /^src\/api\/mcp\//,
  /^src\/api\/(?:http|cuerpo-local|contexto-api|estado-conectividad|campos-operativos)\.ts$/,
  // Lo que esas rutas usan para leer peticiones y escribir respuestas: cuerpos, esquemas, errores y metadatos.
  /^src\/api\/(?:cuerpo|datos-traducidos|errores|esquemas|esquemas-datos-globales|esquemas-formacion)\.ts$/,
  /^src\/api\/(?:estimacion-firmada|fichas|metadatos-http|plazo|problemas|registro-operativo)\.ts$/,
  /^src\/api\/textos-de-la-persona\.ts$/,
];
/** Los módulos privados: la administración, la API de socios, A2A y los controles administrativos. */
const PRIVADOS: readonly RegExp[] = [
  /^src\/administracion\//,
  /^src\/api\/socios\//,
  /^src\/api\/a2a\//,
  /^src\/api\/controles-administrativos\.ts$/,
];

/** El grafo de una página: su entrada, los trozos que importa y lo que pesan. */
export interface GrafoDePagina {
  readonly entrada: string;
  readonly estaticos: readonly string[];
  readonly dinamicos: readonly string[];
  readonly bytesEstaticos: number;
  readonly bytesTotales: number;
}
/** El resumen del grafo emitido. */
export interface ResumenDelGrafo {
  readonly forma: FormaDelPaquete;
  readonly paginas: Readonly<Record<string, GrafoDePagina>>;
  readonly worker: { readonly archivos: readonly string[]; readonly bytes: number };
  readonly motor: {
    readonly entradas: readonly string[];
    readonly archivos: readonly string[];
    readonly bytes: number;
  };
  readonly totales: { readonly js: number; readonly bytes: number; readonly porZona: Readonly<Record<string, number>> };
  readonly servidorPorRuta: readonly string[];
  readonly privados: readonly string[];
  readonly contratoDelDispositivo: readonly string[];
  readonly importacionesCalculadas: readonly { readonly archivo: string; readonly argumento: string }[];
  readonly fuentesEmpaquetadas: number;
  readonly fuentesSinAlcanzar: readonly string[];
}
/** El paquete: los bytes de cada archivo emitido, desde web/, y su resumen. */
export interface PaqueteNavegador {
  readonly archivos: ReadonlyMap<string, Uint8Array>;
  readonly motor: ReadonlyMap<string, Uint8Array>;
  readonly resumen: ResumenDelGrafo;
}

/** Los archivos que una salida importa, de forma estática o con import(), según el metafile. */
function importados(metafile: Metafile, salida: string, tipo: 'import-statement' | 'dynamic-import'): string[] {
  return (metafile.outputs[salida]?.imports ?? [])
    .filter(({ kind, external }) => kind === tipo && !external)
    .map(({ path }) => path);
}

/** El cierre de importaciones de una salida: las estáticas y, si se piden, también las de import(). */
export function cierre(metafile: Metafile, entrada: string, conDinamicas: boolean): string[] {
  const vistos = new Set<string>();
  const pendientes = [entrada];
  for (let actual = pendientes.pop(); actual !== undefined; actual = pendientes.pop()) {
    if (vistos.has(actual)) {
      continue;
    }
    vistos.add(actual);
    pendientes.push(...importados(metafile, actual, 'import-statement'));
    if (conDinamicas) {
      pendientes.push(...importados(metafile, actual, 'dynamic-import'));
    }
  }
  return [...vistos].sort();
}

/**
 * El grafo de una página a partir del metafile de su zona.
 *
 * @param metafile - El metafile de la zona.
 * @param salida - La entrada de la página tal como la emite esbuild, antes de llevar su huella.
 * @param nombre - El nombre publicado de cada salida (las entradas de página llevan su huella).
 * @param peso - Los bytes de cada archivo publicado.
 * @returns La entrada, los trozos estáticos y dinámicos y lo que pesan.
 */
export function grafoDePagina(
  metafile: Metafile,
  salida: string,
  nombre: (ruta: string) => string,
  peso: (ruta: string) => number,
): GrafoDePagina {
  const estaticos = cierre(metafile, salida, false).map(nombre);
  const todos = cierre(metafile, salida, true).map(nombre);
  const entrada = nombre(salida);
  return {
    entrada,
    estaticos: estaticos.filter((ruta) => ruta !== entrada),
    dinamicos: todos.filter((ruta) => !estaticos.includes(ruta)),
    bytesEstaticos: estaticos.reduce((suma, ruta) => suma + peso(ruta), 0),
    bytesTotales: todos.reduce((suma, ruta) => suma + peso(ruta), 0),
  };
}

/** Las entradas de servidor y privadas que han aportado bytes a las salidas de un metafile. */
export function codigoDeServidor(metafile: Metafile): { servidor: string[]; privados: string[]; contrato: string[] } {
  const aportados = new Set(
    Object.values(metafile.outputs).flatMap(({ inputs }) =>
      Object.entries(inputs).flatMap(([entrada, { bytesInOutput }]) => (bytesInOutput > 0 ? [entrada] : [])),
    ),
  );
  const deServidor = [...aportados].filter((entrada) => SERVIDOR.test(entrada)).sort();
  const enContrato = (entrada: string) => CONTRATO_DEL_DISPOSITIVO.some((patron) => patron.test(entrada));
  return {
    servidor: deServidor.filter((entrada) => !enContrato(entrada)),
    privados: [...aportados].filter((entrada) => PRIVADOS.some((patron) => patron.test(entrada))).sort(),
    contrato: deServidor.filter(enContrato),
  };
}

/** Si un archivo JavaScript se acorta al quitarle los espacios: entonces no salió minificado. */
export function sinMinificar(bytes: Uint8Array): boolean {
  const { code } = transformSync(new TextDecoder().decode(bytes), {
    minifyWhitespace: true,
    legalComments: 'eof',
    charset: 'utf8',
    format: 'esm',
    loader: 'js',
    logLevel: 'silent',
  });
  return new TextEncoder().encode(code).byteLength < bytes.byteLength;
}

/** Lo medido si supera su presupuesto; vacío si no. */
function porEncima(medido: readonly string[], maximo: number): readonly string[] {
  return medido.length > maximo ? medido : [];
}

/** Las páginas publicadas con más módulos de entrada de los que admite su presupuesto. */
function entradasDePagina(web: string, publicados: readonly string[]): string[] {
  return publicados
    .filter((archivo) => archivo.endsWith('.html'))
    .flatMap((pagina) => {
      const n = modulosDeLaPagina(pagina, readFileSync(join(web, pagina), 'utf8')).length;
      return n > PRESUPUESTOS.entradasPorPagina ? [`${pagina}: ${n} módulos de entrada`] : [];
    });
}

/** Los archivos del paquete con los mismos bytes que otro de su misma carpeta, salvo el primero de cada grupo. */
function duplicadosDe(archivos: ReadonlyMap<string, Uint8Array>): string[] {
  const vistos = new Map<string, string>();
  return [...archivos].flatMap(([archivo, bytes]) => {
    const clave = `${posix.dirname(archivo)}\n${createHash('sha256').update(bytes).digest('hex')}`;
    const primero = vistos.get(clave);
    vistos.set(clave, primero ?? archivo);
    return primero ? [`${archivo}: los mismos bytes que ${primero}`] : [];
  });
}

/** Las carpetas con más archivos JavaScript, con lo que haya debajo, que su techo. */
function carpetasPorEncima(js: readonly string[]): string[] {
  return Object.entries(techosPorCarpeta()).flatMap(([carpeta, maximo]) => {
    const n = js.filter((archivo) => archivo.startsWith(carpeta)).length;
    return n > maximo ? [`${carpeta}: ${n} archivos; el máximo es ${maximo}`] : [];
  });
}

/** Los incumplimientos de la forma del paquete: vacíos, duplicados, trozos al abrir y archivos por carpeta. */
function problemasDeForma({ archivos, resumen }: PaqueteNavegador): string[] {
  const js = new Map([...archivos].filter(([archivo]) => archivo.endsWith('.js')));
  const vacios = [...js].filter(([, bytes]) => bytes.byteLength === 0).map(([archivo]) => archivo);
  const alAbrir = Object.entries(resumen.paginas).filter(
    ([, { estaticos }]) => 1 + estaticos.length > PRESUPUESTOS.modulosAlAbrir,
  );
  return [
    ...porEncima(vacios, PRESUPUESTOS.vacios).map((archivo) => `${archivo}: JavaScript vacío`),
    ...porEncima(duplicadosDe(js), PRESUPUESTOS.duplicados),
    ...alAbrir.map(
      ([pagina, { estaticos }]) =>
        `${pagina}: carga ${1 + estaticos.length} módulos al abrirse; el máximo es ${PRESUPUESTOS.modulosAlAbrir}`,
    ),
    ...carpetasPorEncima([...js.keys()]),
  ];
}

/**
 * Los incumplimientos del grafo emitido frente a PRESUPUESTOS, sobre la web ya preparada.
 *
 * @param web - La candidata preparada.
 * @param paquete - El paquete con que se construyó.
 * @returns Un problema por incumplimiento; vacío si el grafo cumple.
 */
export function comprobarGrafoEmitido(web: string, paquete: PaqueteNavegador): string[] {
  const { resumen } = paquete;
  const publicados = archivosPublicados(web);
  const js = publicados.filter((archivo) => archivo.endsWith('.js'));
  const inalcanzables = js.filter((archivo) => seEmpaqueta(archivo) && !paquete.archivos.has(archivo));
  const conMapa = [...js, ...paquete.motor.keys()].filter((archivo) =>
    /sourceMappingURL=/.test(new TextDecoder().decode(paquete.motor.get(archivo) ?? readFileSync(join(web, archivo)))),
  );
  const noMinificados = [...paquete.archivos]
    .filter(([archivo, bytes]) => archivo.endsWith('.js') && sinMinificar(bytes))
    .map(([archivo]) => archivo);
  return [
    ...entradasDePagina(web, publicados),
    ...porEncima(resumen.servidorPorRuta, PRESUPUESTOS.servidorPorRuta).map(
      (entrada) => `${entrada}: código de servidor en el motor del navegador`,
    ),
    ...porEncima(resumen.privados, PRESUPUESTOS.privados).map((entrada) => `${entrada}: módulo privado en el paquete`),
    ...porEncima(inalcanzables, PRESUPUESTOS.inalcanzables).map(
      (archivo) => `${archivo}: JavaScript publicado al que no llega ninguna página`,
    ),
    ...porEncima(conMapa, PRESUPUESTOS.mapasDeCodigo).map((archivo) => `${archivo}: referencia a un mapa de código`),
    ...porEncima(noMinificados, PRESUPUESTOS.sinMinificar).map((archivo) => `${archivo}: JavaScript sin minificar`),
    ...problemasDeForma(paquete),
    ...(paquete.motor.size === 0 ? ['El paquete no tiene motor'] : []),
  ];
}
