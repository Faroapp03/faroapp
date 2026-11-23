// Construcción local, sin Wrangler ni despliegue: conserva JSON como módulos separados, nunca dentro del código.
// biome-ignore lint/style/noExcessiveLinesPerFile: La validación y construcción comparten un único contrato de entrega.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { type BuildResult, build, type Plugin } from 'esbuild';
import { exclusionesDeArchivos } from '../../src/comun/exclusiones-de-archivos.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { ACTIVOS_PUBLICOS } from '../../src/plataforma/cloudflare/activos-publicos.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import { comprobarRegistroHechos } from '../web/comprobar-hechos-informe.ts';
import type { ContextoWeb } from '../web/contexto.ts';
import { HUELLA_MAPA } from '../web/huellas-de-los-mapas.ts';
import { listar } from '../web/publicados.ts';
import { comprobarRegistroDeExtensiones, extensionesDeLaRaiz } from '../web/registro-de-extensiones.ts';
import { usaFetchPublico } from './compatibilidad.ts';
import { enlaceDeCorreoAdmitido } from './enlace-de-correo.ts';

const CONFIGURACION = 'config/cloudflare/wrangler.example.jsonc';
const CONFIGURACION_OFICIAL = 'config/cloudflare/wrangler.unificado.example.jsonc';
export type DestinoCloudflare = 'privado' | 'oficial';
const ENTRADA = 'src/plataforma/cloudflare/worker-privado.ts';
const ENTRADA_OFICIAL = 'src/plataforma/cloudflare/worker-oficial.ts';
/**
 * El Worker de Cursos: el motor de cursos, aparte del principal, que lo llama por su enlace de servicio (service
 * binding).
 */
const CONFIGURACION_CURSOS = 'config/cloudflare/wrangler.cursos.example.jsonc';
const ENTRADA_CURSOS = 'src/plataforma/cloudflare/worker-cursos.ts';
const NOMBRE_CURSOS = 'faro-cursos';
const BINDING_CURSOS = 'CURSOS';
/** La entrada pública del motor de cursos: el Worker principal no la lleva; el de Cursos, sí. */
const MOTOR_DE_CURSOS = 'motores/cursos/src/index.ts';
/** La carpeta de la construcción con el Worker de Cursos y sus módulos de datos. */
export const CARPETA_CURSOS = 'cursos';
const GLOB_DATOS = '**/datos/*.json';
const CLASES = ['AccesoPublicoDurable'] as const;
const MAX_WORKER_BYTES = 67_108_864;
const MAX_ASSET_BYTES = 26_214_400;
const MAX_ASSETS_GRATUITOS = 20_000;
/**
 * Tamaño máximo de una tabla JSON del código (src/: marcas, sectores, siglas del buscador…) que va dentro del módulo
 * Worker. Los datos del paquete van siempre aparte, como módulos Data con su huella; una tabla mayor que esto es un
 * dato y debe ir al paquete.
 */
const MAX_TABLA_DEL_CODIGO_BYTES = 262_144;
const USO = 'node herramientas/cloudflare/comprobar-construccion.ts';
/**
 * Web final y huella CSP de su mapa; el Worker sigue usando fuentes y datos canónicos. Este contexto no acredita
 * el gate completo de la web: el consumidor comprueba sus referencias, integridad y artefactos antes de exportar.
 */
export interface WebConstruida extends ContextoWeb {
  readonly huellaMapaModulos: string;
  readonly destinoCloudflare?: DestinoCloudflare | undefined;
}
interface ModuloDatos {
  ruta: string;
  bytes: number;
  sha256: string;
}
/** El Worker de Cursos construido: su código y sus módulos de datos, en CARPETA_CURSOS. */
export interface ConstruccionDeCursos {
  readonly codigoBytes: number;
  readonly datos: readonly ModuloDatos[];
  readonly totalWorkerBytes: number;
}
export interface ConstruccionCloudflare {
  readonly codigoBytes: number;
  readonly cursos: ConstruccionDeCursos;
  readonly datos: readonly ModuloDatos[];
  readonly totalWorkerBytes: number;
  readonly construccionMs: number;
  readonly assets: { archivos: number; bytes: number; mayorBytes: number };
  readonly workersEnsayado: false;
}
function exigir(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) {
    throw new Error(mensaje);
  }
}
function leerConfiguracion(archivo = CONFIGURACION): unknown {
  // La plantilla usa el subconjunto JSON de JSONC: ninguna sustitución de comentarios ni lectura de perfiles.
  return JSON.parse(readFileSync(join(RUTAS.raiz, archivo), 'utf8'));
}
/** La plantilla es para una instalación nueva; no mezcla cuentas, secretos ni historia de otra instalación. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Verifica de forma cerrada la plantilla completa.
export function comprobarPlantillaCloudflare(valor: unknown, destino: DestinoCloudflare = 'privado'): void {
  exigir(esObjeto(valor), 'La plantilla debe ser un objeto');
  const permitidas = [
    'name',
    'main',
    'compatibility_date',
    'compatibility_flags',
    'workers_dev',
    'preview_urls',
    'version_metadata',
    'assets',
    'rules',
    'durable_objects',
    'migrations',
    'services',
    'send_email',
  ];
  exigir(
    Object.keys(valor).every((c) => permitidas.includes(c)),
    'La plantilla no admite cuentas, rutas o variables privadas',
  );
  const carpeta = dirname(join(RUTAS.raiz, CONFIGURACION));
  exigir(
    typeof valor.main === 'string' &&
      resolve(carpeta, valor.main) === join(RUTAS.raiz, destino === 'oficial' ? ENTRADA_OFICIAL : ENTRADA),
    'Entrada Worker incorrecta',
  );
  exigir(
    valor.workers_dev === false && valor.preview_urls === false,
    'La plantilla no habilita URLs públicas de prueba',
  );
  exigir(
    typeof valor.compatibility_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor.compatibility_date),
    'Falta fecha de compatibilidad',
  );
  exigir(
    objetoCerrado(valor.version_metadata, ['binding']) && valor.version_metadata.binding === 'CF_VERSION_METADATA',
    'Falta el enlace del entorno oficial de identidad de la construcción',
  );
  comprobarAssetsConfigurados(valor.assets, carpeta);
  exigir(usaFetchPublico(valor.compatibility_flags), 'La construcción exige fetch estrictamente público');
  exigir(reglasData(valor.rules), 'Los JSON de datos requieren módulos Data');
  comprobarBindings(valor);
}
/** Los enlaces del entorno del Worker principal: sus almacenes durables y el Worker de Cursos. */
function comprobarBindings(valor: Record<string, unknown>): void {
  comprobarDurables(valor);
  comprobarBindingDeCursos(valor.services);
  exigir(enlaceDeCorreoAdmitido(valor.send_email), 'El enlace de correo solo lleva su nombre, sin direcciones');
}
/** El Worker principal llama al de Cursos por un único enlace de servicio, CURSOS, a su entrada por defecto. */
function comprobarBindingDeCursos(servicios: unknown): void {
  exigir(
    Array.isArray(servicios) &&
      servicios.length === 1 &&
      objetoCerrado(servicios[0], ['binding', 'service']) &&
      servicios[0].binding === BINDING_CURSOS &&
      servicios[0].service === NOMBRE_CURSOS,
    `El Worker principal llama al de Cursos por el enlace de servicio ${BINDING_CURSOS} a ${NOMBRE_CURSOS}`,
  );
}
/**
 * La plantilla del Worker de Cursos: sin URLs públicas, rutas, recursos estáticos, almacenes ni enlaces del entorno;
 * la misma fecha y las mismas banderas de compatibilidad que el principal, y sus datos como módulos Data.
 */
export function comprobarPlantillaDeCursos(valor: unknown, principal: unknown): void {
  exigir(esObjeto(valor) && esObjeto(principal), 'La plantilla del Worker de Cursos debe ser un objeto');
  exigir(
    objetoCerrado(valor, [
      'name',
      'main',
      'compatibility_date',
      'compatibility_flags',
      'workers_dev',
      'preview_urls',
      'rules',
    ]),
    'La plantilla del Worker de Cursos no admite cuentas, rutas, recursos estáticos, almacenes ni enlaces del entorno',
  );
  exigir(valor.name === NOMBRE_CURSOS, `El Worker de Cursos se llama ${NOMBRE_CURSOS}`);
  const carpeta = dirname(join(RUTAS.raiz, CONFIGURACION_CURSOS));
  exigir(
    typeof valor.main === 'string' && resolve(carpeta, valor.main) === join(RUTAS.raiz, ENTRADA_CURSOS),
    'Entrada del Worker de Cursos incorrecta',
  );
  exigir(
    valor.workers_dev === false && valor.preview_urls === false,
    'El Worker de Cursos no tiene URLs públicas: solo lo llama el principal',
  );
  exigir(
    valor.compatibility_date === principal.compatibility_date,
    'El Worker de Cursos usa la fecha de compatibilidad del principal',
  );
  exigir(
    usaFetchPublico(valor.compatibility_flags) &&
      JSON.stringify(valor.compatibility_flags) === JSON.stringify(principal.compatibility_flags),
    'El Worker de Cursos usa las banderas de compatibilidad del principal',
  );
  exigir(reglasData(valor.rules), 'Los JSON de datos del Worker de Cursos requieren módulos Data');
}
function comprobarAssetsConfigurados(valor: unknown, carpeta: string): void {
  const assets = valor;
  exigir(
    esObjeto(assets) &&
      typeof assets.directory === 'string' &&
      resolve(carpeta, assets.directory) === RUTAS.web.replace(/\/$/, ''),
    'Los recursos estáticos solo pueden salir de web/',
  );
  exigir(
    assets.binding === 'ASSETS' && assets.run_worker_first === true,
    'Todos los recursos pasan por el Worker antes de ASSETS',
  );
  exigir(
    assets.html_handling === 'none' && assets.not_found_handling === 'none',
    'ASSETS no redirige HTML ni sustituye archivos ausentes',
  );
}
function objetoCerrado(valor: unknown, claves: readonly string[]): valor is Record<string, unknown> {
  return (
    esObjeto(valor) &&
    Object.keys(valor).length === claves.length &&
    Object.keys(valor).every((c) => claves.includes(c))
  );
}
function reglasData(valor: unknown): boolean {
  if (!Array.isArray(valor) || valor.length !== 1) {
    return false;
  }
  const regla: unknown = valor[0];
  return (
    objetoCerrado(regla, ['type', 'globs', 'fallthrough']) &&
    regla.type === 'Data' &&
    regla.fallthrough === true &&
    Array.isArray(regla.globs) &&
    regla.globs.length === 1 &&
    regla.globs[0] === GLOB_DATOS
  );
}
function comprobarDurables(valor: Record<string, unknown>): void {
  exigir(objetoCerrado(valor.durable_objects, ['bindings']), 'Faltan los enlaces del entorno a los almacenes durables');
  const bindings = valor.durable_objects.bindings;
  exigir(
    Array.isArray(bindings) && bindings.length === CLASES.length,
    'Enlaces del entorno a los almacenes durables incompletos',
  );
  const esperados = new Map([['REGISTRO_SOCIOS', CLASES[0]]]);
  for (const binding of bindings) {
    exigir(
      objetoCerrado(binding, ['name', 'class_name']) && typeof binding.name === 'string',
      'Enlace del entorno a un almacén durable inválido',
    );
    exigir(
      esperados.get(binding.name) === binding.class_name,
      'Enlace del entorno a un almacén durable que no corresponde a su clase',
    );
    exigir(esperados.delete(binding.name), 'Enlace del entorno a un almacén durable duplicado');
  }
  exigir(esperados.size === 0, 'Falta un enlace del entorno a un almacén durable');
  const migraciones = valor.migrations;
  exigir(Array.isArray(migraciones) && migraciones.length === 1, 'La plantilla nueva exige su migración inicial');
  const primera: unknown = migraciones[0];
  exigir(
    objetoCerrado(primera, ['tag', 'new_sqlite_classes']) && primera.tag === 'faro-inicial-v1',
    'Migración inicial inválida',
  );
  const clases = primera.new_sqlite_classes;
  exigir(
    Array.isArray(clases) &&
      clases.length === CLASES.length &&
      new Set(clases).size === CLASES.length &&
      CLASES.every((c) => clases.includes(c)),
    'La clase nueva debe tener almacenamiento SQLite',
  );
}
/**
 * Cada activo público (activos-publicos.ts) está en la web que publica el Worker oficial, como archivo regular y con
 * los bytes de su huella: el Worker oficial lo sirve como inmutable con esa huella en el nombre, y un archivo ausente
 * o distinto dejaría la portada y el acceso sin fotografía.
 */
export function comprobarActivosPublicos(web: string, rutas: readonly string[]): void {
  for (const activo of ACTIVOS_PUBLICOS) {
    const archivo = join(web, activo.archivo);
    exigir(
      rutas.includes(activo.archivo) && lstatSync(archivo).isFile(),
      `Falta en la web publicada el activo público ${activo.archivo}`,
    );
    exigir(
      createHash('sha256').update(readFileSync(archivo)).digest('hex') === activo.sha256,
      `El activo público ${activo.archivo} no coincide con su huella`,
    );
  }
}
function assetsPublicados(web: string): { rutas: readonly string[]; metricas: ConstruccionCloudflare['assets'] } {
  const estadoWeb = lstatSync(resolve(web));
  exigir(estadoWeb.isDirectory() && !estadoWeb.isSymbolicLink(), 'La raíz web debe ser un directorio regular');
  const archivoExclusiones = join(web, '.assetsignore');
  exigir(lstatSync(archivoExclusiones).isFile(), 'Las exclusiones de recursos estáticos deben ser un archivo regular');
  const exclusiones = exclusionesDeArchivos(readFileSync(archivoExclusiones, 'utf8'));
  const archivos = listar('', web)
    .filter((ruta) => !exclusiones.some((patron) => patron.test(ruta)))
    .sort();
  let bytes = 0,
    mayorBytes = 0;
  for (const ruta of archivos) {
    const estado = lstatSync(join(web, ruta));
    exigir(estado.isFile() && !estado.isSymbolicLink(), `Asset no regular: ${ruta}`);
    exigir(estado.size <= MAX_ASSET_BYTES, `Asset supera 25MiB: ${ruta}`);
    bytes += estado.size;
    mayorBytes = Math.max(mayorBytes, estado.size);
  }
  exigir(archivos.length <= MAX_ASSETS_GRATUITOS, 'La construcción supera 20.000 recursos estáticos');
  exigir(
    archivos.includes('firmas/manifiesto.json') &&
      archivos.some((r) => r.startsWith('motor/')) &&
      archivos.some((r) => r.startsWith('paquete/')),
    'Faltan artefactos preparados del dispositivo',
  );
  return { rutas: Object.freeze(archivos), metricas: { archivos: archivos.length, bytes, mayorBytes } };
}
function comprobarContexto(contexto: WebConstruida): void {
  exigir(
    realpathSync(contexto.paquete) === realpathSync(RUTAS.paquete),
    'El Worker requiere el paquete canónico de la instalación',
  );
  exigir(
    HUELLA_MAPA.test(contexto.huellaMapaModulos),
    'La huella CSP del mapa debe ser SHA-256 en base64 entre comillas simples',
  );
}
/** El filtro de esbuild que solo reconoce esa ruta real. */
function filtroExacto(origen: string): RegExp {
  return new RegExp(`^${origen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}
/** Sustituye solo el módulo físico de la huella durante el empaquetado; no escribe su fuente. */
function mapaDeLaWeb(huella: string): { readonly plugin: Plugin; readonly aplicado: () => boolean } {
  const origen = realpathSync(join(RUTAS.raiz, 'src/plataforma/mapa-de-modulos.ts'));
  const filtro = filtroExacto(origen);
  let sustituido = false;
  const plugin: Plugin = {
    name: 'mapa-de-la-web-construida',
    setup(compilador) {
      compilador.onLoad({ filter: filtro, namespace: 'file' }, (entrada) => {
        exigir(realpathSync(entrada.path) === origen, 'El módulo de la huella no corresponde a su fuente');
        sustituido = true;
        return { contents: `export const HUELLA_DEL_MAPA_DE_MODULOS = ${JSON.stringify(huella)};`, loader: 'ts' };
      });
    },
  };
  return { plugin, aplicado: () => sustituido };
}
/** El protocolo entre los dos Workers y su plantilla neutra de la huella del paquete. */
const PROTOCOLO_CURSOS = 'src/plataforma/cloudflare/protocolo-cursos.ts';
const PLANTILLA_HUELLA = "export const HUELLA_DEL_PAQUETE = '';";
/**
 * El protocolo de Cursos con la huella del paquete construido en lugar de su plantilla neutra.
 *
 * @param fuente - El código del protocolo, que lleva una sola vez la plantilla.
 * @param huella - La huella del paquete (16 cifras hexadecimales).
 * @returns El código que se empaqueta en los dos Workers.
 */
export function protocoloConHuella(fuente: string, huella: string): string {
  exigir(/^[0-9a-f]{16}$/.test(huella), 'La huella del paquete construido debe tener 16 cifras hexadecimales');
  const partes = fuente.split(PLANTILLA_HUELLA);
  exigir(partes.length === 2, 'El protocolo de Cursos debe llevar una sola vez la plantilla neutra de su huella');
  return partes.join(`export const HUELLA_DEL_PAQUETE = ${JSON.stringify(huella)};`);
}
/** La huella del paquete canónico, la misma que nombra su versión publicada: la de su manifiesto. */
function huellaDelPaqueteCanonico(): string {
  const manifiesto = readFileSync(join(RUTAS.paquete, 'manifiesto.json'));
  return versionDelPaquete(createHash('sha256').update(manifiesto).digest('hex'));
}
/**
 * Cada Worker lleva la huella del paquete con el que se construye; así el principal reconoce un Worker de Cursos de
 * otra publicación. Sustituye solo el módulo durante el empaquetado; no escribe su fuente.
 */
function huellaEnElProtocolo(huella: string): { readonly plugin: Plugin; readonly aplicado: () => boolean } {
  const origen = realpathSync(join(RUTAS.raiz, PROTOCOLO_CURSOS));
  const filtro = filtroExacto(origen);
  let sustituido = false;
  const plugin: Plugin = {
    name: 'huella-del-paquete-en-el-protocolo',
    setup(compilador) {
      compilador.onLoad({ filter: filtro, namespace: 'file' }, (entrada) => {
        exigir(realpathSync(entrada.path) === origen, 'El protocolo de Cursos no corresponde a su fuente');
        sustituido = true;
        return { contents: protocoloConHuella(readFileSync(origen, 'utf8'), huella), loader: 'ts' };
      });
    },
  };
  return { plugin, aplicado: () => sustituido };
}
/** Las carpetas del código con tablas JSON propias: la app y el motor de ocupaciones (su código y sus modelos). */
const CARPETAS_DEL_CODIGO = ['src', 'motores/ocupaciones/src', 'motores/ocupaciones/modelos'] as const;
/** Única política pública fuera del código; no habilita otros JSON de configuración. */
const POLITICA_PUBLICA = 'config/identidad-web.json';
/** Registro editorial exacto consumido por el informe; no habilita otros archivos de la plataforma. */
const HECHOS_EDITORIALES = 'plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json';

/** Tablas, política pública y registro editorial exactos: mismo límite y sin admitir destinos enlazados ajenos. */
function esTablaDelCodigo(origen: string): boolean {
  const real = realpathSync(origen);
  const esPoliticaPublica =
    origen === resolve(RUTAS.raiz, POLITICA_PUBLICA) && real === join(realpathSync(RUTAS.raiz), POLITICA_PUBLICA);
  const esRegistroEditorial =
    origen === resolve(RUTAS.raiz, HECHOS_EDITORIALES) && real === join(realpathSync(RUTAS.raiz), HECHOS_EDITORIALES);
  if (
    !esPoliticaPublica &&
    !esRegistroEditorial &&
    !CARPETAS_DEL_CODIGO.some((carpeta) => real.startsWith(`${realpathSync(join(RUTAS.raiz, carpeta))}/`))
  ) {
    return false;
  }
  exigir(
    lstatSync(real).size <= MAX_TABLA_DEL_CODIGO_BYTES,
    `Tabla del código demasiado grande para el Worker: ${real}`,
  );
  if (esRegistroEditorial) {
    comprobarRegistroHechos(real);
  }
  return true;
}

function modulosData(destino: string, datos: Map<string, ModuloDatos>): Plugin {
  return {
    name: 'datos-como-modulos-data',
    setup(compilador) {
      compilador.onResolve({ filter: /\.json$/ }, (entrada) => {
        const origen = resolve(entrada.resolveDir, entrada.path);
        // Las tablas pequeñas del código (CARPETAS_DEL_CODIGO) van dentro del módulo Worker, como el resto del código
        // revisado.
        if (esTablaDelCodigo(origen)) {
          return undefined;
        }
        exigir(dirname(origen) === RUTAS.paquete.replace(/\/$/, ''), 'JSON ajeno al paquete en el grafo Worker');
        const nombre = basename(origen),
          ruta = `datos/${nombre}`,
          contenido = readFileSync(origen);
        datos.set(ruta, {
          ruta,
          bytes: contenido.byteLength,
          sha256: createHash('sha256').update(contenido).digest('hex'),
        });
        copyFileSync(origen, join(destino, ruta));
        return { path: `./${ruta}`, external: true };
      });
    },
  };
}
function guardarCodigo(
  resultado: BuildResult,
  destino: string,
  datos: ReadonlyMap<string, ModuloDatos>,
  exportaciones: readonly string[] = ['default', ...CLASES],
): number {
  const codigo = resultado.outputFiles?.[0];
  exigir(codigo && resultado.outputFiles?.length === 1, 'Esbuild debe generar solo el módulo Worker, sin mapas');
  const salidas = Object.values(resultado.metafile?.outputs ?? {});
  exigir(
    salidas.length === 1 &&
      salidas[0]?.imports.length === datos.size &&
      salidas[0].imports.every((i) => i.external && datos.has(i.path.replace(/^\.\//, ''))),
    'El paquete construido solo puede importar módulos Data separados',
  );
  exigir(
    exportaciones.every((nombre) => salidas[0]?.exports.includes(nombre)) &&
      salidas[0]?.exports.length === exportaciones.length,
    'Faltan exports Worker o Durable Objects, o sobran',
  );
  writeFileSync(join(destino, 'worker.mjs'), codigo.contents);
  return codigo.contents.byteLength;
}
/**
 * El paquete construido y sus módulos existen solo durante la función que los consume; no publica ni modifica la
 * instalación.
 */
export async function conConstruccionCloudflare<T>(
  consumir: (directorio: string, resultado: ConstruccionCloudflare, rutasAssets: readonly string[]) => Promise<T>,
  contexto: WebConstruida,
  destino: DestinoCloudflare = 'privado',
): Promise<T> {
  const principal = leerConfiguracion(destino === 'oficial' ? CONFIGURACION_OFICIAL : CONFIGURACION);
  comprobarPlantillaCloudflare(principal, destino);
  comprobarContexto(contexto);
  const assets = assetsPublicados(contexto.web);
  if (destino === 'oficial') {
    comprobarActivosPublicos(contexto.web, assets.rutas);
  }
  comprobarPlantillaDeCursos(leerConfiguracion(CONFIGURACION_CURSOS), principal);
  // Registro y carpetas de extensión de la raíz que se construye, leídos de sus fuentes (la web construida ya no
  // lleva su servidor/), una vez validadas la raíz web, el contexto y las plantillas.
  const registro = comprobarRegistroDeExtensiones(RUTAS.web, await extensionesDeLaRaiz(RUTAS.raiz));
  exigir(registro.length === 0, registro.join('\n'));
  const tipo = destino;
  const carpetaTemporal = mkdtempSync(join(realpathSync(tmpdir()), 'cloudflare-construccion-'));
  try {
    mkdirSync(join(carpetaTemporal, 'datos'));
    mkdirSync(join(carpetaTemporal, CARPETA_CURSOS, 'datos'), { recursive: true });
    return await consumir(
      carpetaTemporal,
      await construir(carpetaTemporal, assets.metricas, contexto, tipo),
      assets.rutas,
    );
  } finally {
    rmSync(carpetaTemporal, { recursive: true });
  }
}
async function construir(
  destino: string,
  assets: ConstruccionCloudflare['assets'],
  contexto: WebConstruida,
  tipo: DestinoCloudflare = 'privado',
): Promise<ConstruccionCloudflare> {
  const datos = new Map<string, ModuloDatos>(),
    inicio = performance.now();
  const mapa = mapaDeLaWeb(contexto.huellaMapaModulos);
  const huella = huellaDelPaqueteCanonico();
  const protocolo = huellaEnElProtocolo(huella);
  const resultado = await build({
    ...opcionesDeEsbuild(tipo === 'oficial' ? ENTRADA_OFICIAL : ENTRADA, destino),
    plugins: [modulosData(destino, datos), sinMotorDeCursos(), mapa.plugin, protocolo.plugin],
  });
  exigir(mapa.aplicado(), 'El Worker no lleva la huella de los mapas de la web construida (mapaDeLaWeb no se aplicó)');
  exigir(
    protocolo.aplicado(),
    'El Worker principal no lleva la huella de su paquete (huellaEnElProtocolo no se aplicó)',
  );
  exigirSinMotorDeCursos(resultado);
  const codigoBytes = guardarCodigo(resultado, destino, datos);
  const modulos = [...datos.values()].sort((a, b) => a.ruta.localeCompare(b.ruta));
  const totalWorkerBytes = codigoBytes + modulos.reduce((suma, fila) => suma + fila.bytes, 0);
  exigir(totalWorkerBytes <= MAX_WORKER_BYTES, 'El Worker y sus módulos superan 64MiB sin comprimir');
  const cursos = await construirCursos(join(destino, CARPETA_CURSOS), huella);
  return {
    codigoBytes,
    cursos,
    datos: modulos,
    totalWorkerBytes,
    construccionMs: performance.now() - inicio,
    assets,
    workersEnsayado: false,
  };
}
/** Las opciones de esbuild comunes a los dos Workers. */
function opcionesDeEsbuild(entrada: string, destino: string) {
  return {
    entryPoints: [join(RUTAS.raiz, entrada)],
    outfile: join(destino, 'worker.mjs'),
    absWorkingDir: RUTAS.raiz,
    bundle: true,
    platform: 'browser' as const,
    format: 'esm' as const,
    target: 'es2024',
    write: false as const,
    metafile: true as const,
    logLevel: 'silent' as const,
    sourcemap: false,
    legalComments: 'inline' as const,
    minifyWhitespace: true,
    minifySyntax: false,
    minifyIdentifiers: false,
  };
}
/** Los módulos del motor de cursos que lleva un paquete construido (rutas relativas a la raíz). */
function modulosDelMotor(resultado: BuildResult): string[] {
  return Object.keys(resultado.metafile?.inputs ?? {}).filter((ruta) => ruta.startsWith('motores/cursos/'));
}
/**
 * En el Worker principal, la entrada del motor de cursos es un módulo que no existe: la puerta del enlace de servicio
 * (puerta-cursos.ts) nunca la importa, y si algo la importara, la puerta la daría por «ausente».
 */
function sinMotorDeCursos(): Plugin {
  const origen = realpathSync(join(RUTAS.raiz, MOTOR_DE_CURSOS));
  return {
    name: 'sin-motor-de-cursos',
    setup(compilador) {
      compilador.onResolve({ filter: /motores\/cursos\/src\/index\.ts$/ }, (entrada) =>
        realpathSync(resolve(entrada.resolveDir, entrada.path)) === origen
          ? { path: MOTOR_DE_CURSOS, namespace: 'sin-motor-de-cursos' }
          : undefined,
      );
      compilador.onLoad({ filter: /.*/, namespace: 'sin-motor-de-cursos' }, () => ({
        contents:
          "const error = new Error('Cannot find module: el motor de cursos va en el Worker de Cursos');\n" +
          "error.code = 'ERR_MODULE_NOT_FOUND';\nthrow error;\n",
        loader: 'js',
      }));
    },
  };
}
/** El Worker principal no lleva nada del motor de cursos. */
function exigirSinMotorDeCursos(resultado: BuildResult): void {
  const llevados = modulosDelMotor(resultado);
  exigir(llevados.length === 0, `El Worker principal no puede llevar el motor de cursos: ${llevados.join(', ')}`);
}
/** El Worker de Cursos: el motor y sus datos como módulos Data, en su carpeta, con la huella del mismo paquete. */
async function construirCursos(destino: string, huella: string): Promise<ConstruccionDeCursos> {
  const datos = new Map<string, ModuloDatos>();
  const protocolo = huellaEnElProtocolo(huella);
  const resultado = await build({
    ...opcionesDeEsbuild(ENTRADA_CURSOS, destino),
    plugins: [modulosData(destino, datos), protocolo.plugin],
  });
  exigir(
    protocolo.aplicado(),
    'El Worker de Cursos no lleva la huella de su paquete (huellaEnElProtocolo no se aplicó)',
  );
  exigir(
    modulosDelMotor(resultado).includes(MOTOR_DE_CURSOS),
    'El Worker de Cursos tiene que llevar la entrada pública del motor de cursos',
  );
  const codigoBytes = guardarCodigo(resultado, destino, datos, ['default']);
  comprobarDatosDelWorker(datos);
  const modulos = [...datos.values()].sort((a, b) => a.ruta.localeCompare(b.ruta));
  const totalWorkerBytes = codigoBytes + modulos.reduce((suma, fila) => suma + fila.bytes, 0);
  exigir(totalWorkerBytes <= MAX_WORKER_BYTES, 'El Worker de Cursos y sus módulos superan 64MiB sin comprimir');
  return { codigoBytes, datos: modulos, totalWorkerBytes };
}
/**
 * El Worker de Cursos lleva los datos de la hoja de ruta personal, y cada uno de sus módulos de datos es, byte a byte,
 * el del paquete: su huella es la del manifiesto (datos/manifiesto.json).
 */
function comprobarDatosDelWorker(datos: ReadonlyMap<string, ModuloDatos>): void {
  const manifiesto: unknown = JSON.parse(readFileSync(join(RUTAS.paquete, 'manifiesto.json'), 'utf8'));
  exigir(esObjeto(manifiesto), 'El manifiesto del paquete debe ser un objeto');
  for (const { ruta, sha256 } of datos.values()) {
    const entrada = manifiesto[basename(ruta)];
    exigir(esObjeto(entrada) && entrada.sha256 === sha256, `${ruta} no coincide con su huella del manifiesto`);
  }
}
/** Solo crea un temporal propio y devuelve sus métricas; no conserva ni publica el paquete construido. */
export async function comprobarConstruccionCloudflare(contexto: WebConstruida): Promise<ConstruccionCloudflare> {
  return conConstruccionCloudflare(async (_directorio, resultado) => resultado, contexto);
}
if (import.meta.main) {
  await ejecutar(async () => {
    orden(USO).leer({});
    const { contextoDeLaWebLocal } = await import('../web/construir.ts');
    console.log(JSON.stringify(await comprobarConstruccionCloudflare(contextoDeLaWebLocal()), null, 2));
  });
}
