/** Adaptador del CLI oficial. La autorización y la exclusión de efectos pertenecen al consumidor privado. */
import { type SpawnSyncOptionsWithBufferEncoding, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { comprobarArtefactoCloudflare } from './artefacto.ts';
import { cerrado, ErrorVersionesCloudflare, exigir, objeto, texto } from './contrato-versiones.ts';
import { comprobarPareja, configuracionDe, SERVICIOS_CLOUDFLARE, type ServicioCloudflare } from './perfil-versiones.ts';

export { ErrorVersionesCloudflare } from './contrato-versiones.ts';

const MAX_SOLICITUD = 16_384;
const MAX_CONFIGURACION = 1_048_576;
const MAX_SALIDA = 16_777_216;
const MAX_VERSIONES = 10;
const MAX_TAG = 256;
const MAX_MENSAJE = 1_024;
const PORCENTAJE_TOTAL = 100;
const PLAZO_MS = 120_000;
const PLAZO_LECTURA_MS = 30_000;
const PRIVADO = 0o600;
const DIRECTORIO_PRIVADO = 0o700;
const MASCARA_PERMISOS = 0o777;
const ARGUMENTOS_CLI = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const PERFIL_WRANGLER = fileURLToPath(new URL('../red/identidad-wrangler.cjs', import.meta.url));
const WRANGLER = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url));
type Operacion = 'subir' | 'estado' | 'desplegar' | 'versiones';
interface IdentidadArtefacto {
  readonly revisionCodigo: string;
  readonly huellaPaquete: string;
  readonly sha256Artefacto: string;
}
interface Solicitud {
  readonly version: 1;
  readonly operacion: Operacion;
  readonly servicio: ServicioCloudflare;
  readonly intencionId: string;
  /** Configuración del principal y del Worker de Cursos: las dos se comprueban como pareja en cada operación. */
  readonly configuracion: string;
  readonly configuracionCursos: string;
  readonly artefacto: IdentidadArtefacto & { readonly ruta: string };
  readonly versionId?: string;
  readonly anteriorDeploymentId?: string;
}
interface Deployment {
  readonly deploymentId: string;
  readonly versiones: readonly { readonly versionId: string; readonly porcentaje: number }[];
}
interface Versiones {
  readonly versiones: readonly {
    readonly versionId: string;
    readonly tag: string | null;
    readonly message: string | null;
  }[];
}
export interface RespuestaVersionesCloudflare {
  readonly version: 1;
  readonly operacion: Operacion;
  readonly servicio: ServicioCloudflare;
  readonly intencionId: string;
  readonly artefacto: IdentidadArtefacto | null;
  readonly resultado: Deployment | Versiones | { readonly versionId: string };
}
export interface OrdenWrangler {
  readonly argumentos: readonly string[];
  readonly cwd: string;
  readonly entorno: NodeJS.ProcessEnv;
  readonly stdout: string;
  readonly stderr: string;
  readonly ndjson: string;
}
/** Punto de sustitución para pruebas: la CLI siempre utiliza el ejecutor oficial, nunca una ruta del solicitante. */
export type EjecutorWrangler = (orden: OrdenWrangler) => { readonly status: number | null };
type LanzadorWrangler = (
  argumentos: readonly string[],
  opciones: SpawnSyncOptionsWithBufferEncoding,
) => SpawnSyncReturns<Buffer>;
function ruta(valor: unknown): valor is string {
  return typeof valor === 'string' && isAbsolute(valor) && !valor.includes('\0');
}
function identidad(valor: unknown): asserts valor is Solicitud['artefacto'] {
  exigir(cerrado(valor, 'ruta,revisionCodigo,huellaPaquete,sha256Artefacto'), 'entrada-invalida');
  exigir(ruta(valor.ruta) && texto(valor.revisionCodigo, SHA40), 'entrada-invalida');
  exigir(texto(valor.huellaPaquete, HEX16) && texto(valor.sha256Artefacto, SHA64), 'entrada-invalida');
}
/** La lectura del estado de un Worker no necesita el artefacto: así se observa aunque su retención haya vencido. */
type SolicitudSinArtefacto = Omit<Solicitud, 'artefacto' | 'operacion'> & {
  readonly operacion: 'estado';
  readonly artefacto: null;
};
function solicitudDe(valor: unknown): Solicitud | SolicitudSinArtefacto {
  exigir(objeto(valor), 'entrada-invalida');
  const campos = 'version,operacion,servicio,intencionId,configuracion,configuracionCursos,artefacto';
  exigir(
    cerrado(valor, valor.operacion === 'desplegar' ? `${campos},versionId,anteriorDeploymentId` : campos),
    'entrada-invalida',
  );
  exigir(valor.version === 1 && texto(valor.intencionId, UUID) && ruta(valor.configuracion), 'entrada-invalida');
  exigir(ruta(valor.configuracionCursos) && valor.configuracionCursos !== valor.configuracion, 'entrada-invalida');
  exigir(['subir', 'estado', 'desplegar', 'versiones'].includes(String(valor.operacion)), 'entrada-invalida');
  exigir(SERVICIOS_CLOUDFLARE.includes(valor.servicio as ServicioCloudflare), 'entrada-invalida');
  if (valor.operacion === 'estado' && valor.artefacto === null) {
    return valor as unknown as SolicitudSinArtefacto;
  }
  identidad(valor.artefacto);
  if (valor.operacion === 'desplegar') {
    exigir(texto(valor.versionId, UUID) && texto(valor.anteriorDeploymentId, UUID), 'entrada-invalida');
  }
  return valor as unknown as Solicitud;
}
function leerPrivado(archivo: string, maximo: number): Buffer {
  const estado = lstatSync(archivo);
  exigir(estado.isFile() && !estado.isSymbolicLink() && estado.nlink === 1, 'entrada-invalida');
  exigir((estado.mode & MASCARA_PERMISOS) === PRIVADO && estado.size <= maximo, 'entrada-invalida');
  exigir(realpathSync(archivo) === resolve(archivo), 'entrada-invalida');
  const bytes = readFileSync(archivo);
  exigir(bytes.byteLength <= maximo, 'entrada-invalida');
  return bytes;
}
function json(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function comprobarArtefacto(solicitud: Solicitud): void {
  try {
    const resumen = comprobarArtefactoCloudflare(solicitud.artefacto.ruta, solicitud.artefacto.sha256Artefacto);
    exigir(
      resumen.revisionCodigo === solicitud.artefacto.revisionCodigo &&
        resumen.huellaPaquete === solicitud.artefacto.huellaPaquete,
      'artefacto-invalido',
    );
  } catch {
    throw new ErrorVersionesCloudflare('artefacto-invalido');
  }
}
function dentro(raiz: string, destino: string): boolean {
  const desde = relative(realpathSync(raiz), realpathSync(destino));
  return desde === '' || (!isAbsolute(desde) && desde !== '..' && !desde.startsWith(`..${sep}`));
}
function temporalExterno(solicitud: Solicitud): string {
  const padre = realpathSync(tmpdir());
  exigir(!dentro(RUTAS.raiz, padre) && !dentro(solicitud.artefacto.ruta, padre), 'entrada-invalida');
  return mkdtempSync(join(padre, 'cloudflare-versiones-'));
}
function entornoPrivado(temporal: string): NodeJS.ProcessEnv {
  const entorno: NodeJS.ProcessEnv = {};
  for (const nombre of ['PATH', 'SYSTEMROOT', 'CLOUDFLARE_API_TOKEN']) {
    if (process.env[nombre] !== undefined) {
      entorno[nombre] = process.env[nombre];
    }
  }
  return {
    ...entorno,
    HOME: temporal,
    TMPDIR: temporal,
    CI: 'true',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: join(temporal, 'wrangler.log'),
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  };
}
function lanzarOficial(argumentos: readonly string[], opciones: SpawnSyncOptionsWithBufferEncoding) {
  return spawnSync(process.execPath, ['--require', PERFIL_WRANGLER, WRANGLER, ...argumentos], opciones);
}
/** Los dobles sustituyen solo el lanzamiento; la CLI nunca acepta un ejecutable ni opciones libres. */
export function crearEjecutorWrangler(lanzar: LanzadorWrangler = lanzarOficial): EjecutorWrangler {
  return (orden) => {
    const mutacion = orden.argumentos[0] === 'versions' && ['upload', 'deploy'].includes(orden.argumentos[1] ?? '');
    const resultado = lanzar(orden.argumentos, {
      cwd: orden.cwd,
      env: orden.entorno,
      timeout: mutacion ? PLAZO_MS : PLAZO_LECTURA_MS,
      maxBuffer: MAX_SALIDA,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    writeFileSync(orden.stdout, (resultado.stdout ?? Buffer.alloc(0)).subarray(0, MAX_SALIDA), {
      flag: 'wx',
      mode: PRIVADO,
    });
    writeFileSync(orden.stderr, (resultado.stderr ?? Buffer.alloc(0)).subarray(0, MAX_SALIDA), {
      flag: 'wx',
      mode: PRIVADO,
    });
    return { status: resultado.error ? null : resultado.status };
  };
}
function leerSalida(archivo: string): Buffer {
  const estado = lstatSync(archivo);
  exigir(estado.isFile() && !estado.isSymbolicLink() && estado.size <= MAX_SALIDA, 'resultado-invalido');
  const bytes = readFileSync(archivo);
  exigir(bytes.byteLength <= MAX_SALIDA, 'resultado-invalido');
  return bytes;
}
function registroNDJSON(archivo: string, tipo: string, nombre: unknown): Record<string, unknown> {
  const registros = new TextDecoder('utf-8', { fatal: true })
    .decode(leerSalida(archivo))
    .trim()
    .split('\n')
    .map((linea) => json(Buffer.from(linea)));
  const encontrados = registros.filter((r) => objeto(r) && r.type === tipo);
  exigir(encontrados.length === 1, 'resultado-invalido');
  const registro = encontrados[0];
  exigir(objeto(registro) && registro.version === 1 && registro.worker_name === nombre, 'resultado-invalido');
  return registro;
}
function migracionPendiente(orden: OrdenWrangler, status: number | null): boolean {
  if (status !== 1 || orden.argumentos[0] !== 'versions' || orden.argumentos[1] !== 'upload') {
    return false;
  }
  return leerSalida(orden.stderr).includes(
    Buffer.from('This Worker has a pending Durable Object migration, which cannot be applied by'),
  );
}
function deploymentDe(valor: unknown): Deployment {
  exigir(objeto(valor) && texto(valor.id, UUID) && Array.isArray(valor.versions), 'resultado-invalido');
  exigir(valor.versions.length > 0 && valor.versions.length <= MAX_VERSIONES, 'resultado-invalido');
  const versiones = valor.versions.map((v: unknown) => {
    exigir(objeto(v) && texto(v.version_id, UUID), 'resultado-invalido');
    exigir(
      typeof v.percentage === 'number' &&
        Number.isFinite(v.percentage) &&
        v.percentage > 0 &&
        v.percentage <= PORCENTAJE_TOTAL,
      'resultado-invalido',
    );
    return { versionId: v.version_id, porcentaje: v.percentage };
  });
  exigir(new Set(versiones.map((v) => v.versionId)).size === versiones.length, 'resultado-invalido');
  exigir(versiones.reduce((s, v) => s + v.porcentaje, 0) === PORCENTAJE_TOTAL, 'resultado-invalido');
  return { deploymentId: valor.id, versiones };
}
function anotacion(valor: unknown, maximo: number): string | null {
  exigir(valor === undefined || (typeof valor === 'string' && valor.length <= maximo), 'resultado-invalido');
  return valor ?? null;
}
function versionesDe(valor: unknown): Versiones {
  exigir(Array.isArray(valor) && valor.length <= MAX_VERSIONES, 'resultado-invalido');
  const versiones = valor.map((v: unknown) => {
    exigir(objeto(v) && texto(v.id, UUID), 'resultado-invalido');
    exigir(v.annotations === undefined || objeto(v.annotations), 'resultado-invalido');
    const annotations = v.annotations as Record<string, unknown> | undefined;
    return {
      versionId: v.id,
      tag: anotacion(annotations?.['workers/tag'], MAX_TAG),
      message: anotacion(annotations?.['workers/message'], MAX_MENSAJE),
    };
  });
  exigir(new Set(versiones.map((v) => v.versionId)).size === versiones.length, 'resultado-invalido');
  return { versiones };
}
interface Contexto {
  readonly solicitud: Solicitud;
  readonly configuracion: Record<string, unknown>;
  readonly temporal: string;
  readonly ejecutar: EjecutorWrangler;
  contador: number;
  /** Se marca antes de lanzar `versions upload` o `versions deploy`: desde ahí, un fallo deja el efecto incierto. */
  mutacionLanzada: boolean;
}
function invocar(contexto: Contexto, argumentos: string[]): OrdenWrangler {
  const prefijo = join(contexto.temporal, `salida-${contexto.contador++}`);
  const ndjson = `${prefijo}.ndjson`;
  writeFileSync(ndjson, '', { flag: 'wx', mode: PRIVADO });
  const orden: OrdenWrangler = {
    argumentos: [
      ...argumentos,
      '--config',
      join(contexto.temporal, 'wrangler.json'),
      '--env-file',
      join(contexto.temporal, 'vacio.env'),
    ],
    cwd: contexto.temporal,
    entorno: { ...entornoPrivado(contexto.temporal), WRANGLER_OUTPUT_FILE_PATH: ndjson },
    stdout: `${prefijo}.stdout`,
    stderr: `${prefijo}.stderr`,
    ndjson,
  };
  let status: number | null = null;
  contexto.mutacionLanzada ||= argumentos[0] === 'versions' && ['upload', 'deploy'].includes(argumentos[1] ?? '');
  try {
    status = contexto.ejecutar(orden).status;
  } catch {
    throw new ErrorVersionesCloudflare('wrangler-incierto');
  }
  if (status !== 0) {
    // La migración pendiente es el único rechazo de Cloudflare que se reconoce completo: no sube nada.
    if (migracionPendiente(orden, status)) {
      throw new ErrorVersionesCloudflare('configuracion-incompatible', 'rechazado');
    }
    throw new ErrorVersionesCloudflare('wrangler-incierto');
  }
  return orden;
}
function estado(contexto: Contexto): Deployment {
  const salida = invocar(contexto, ['deployments', 'status', '--json']);
  return deploymentDe(json(leerSalida(salida.stdout)));
}
function subir(contexto: Contexto): { versionId: string } {
  const { solicitud } = contexto;
  const salida = invocar(contexto, [
    'versions',
    'upload',
    '--no-bundle',
    '--keep-vars',
    '--tag',
    solicitud.intencionId,
    '--message',
    solicitud.artefacto.sha256Artefacto,
  ]);
  const registro = registroNDJSON(salida.ndjson, 'version-upload', contexto.configuracion.name);
  exigir(texto(registro.version_id, UUID), 'resultado-invalido');
  return { versionId: registro.version_id };
}
function desplegar(contexto: Contexto): Deployment {
  const { solicitud } = contexto;
  exigir(estado(contexto).deploymentId === solicitud.anteriorDeploymentId, 'deployment-distinto');
  const salida = invocar(contexto, ['versions', 'deploy', `${solicitud.versionId}@100%`, '--yes']);
  const registro = registroNDJSON(salida.ndjson, 'version-deploy', contexto.configuracion.name);
  exigir(texto(registro.deployment_id, UUID), 'resultado-invalido');
  const actual = estado(contexto);
  exigir(actual.deploymentId === registro.deployment_id && actual.versiones.length === 1, 'resultado-invalido');
  const unica = actual.versiones[0];
  exigir(
    unica && unica.versionId === solicitud.versionId && unica.porcentaje === PORCENTAJE_TOTAL,
    'resultado-invalido',
  );
  return actual;
}
function operar(contexto: Contexto): RespuestaVersionesCloudflare['resultado'] {
  switch (contexto.solicitud.operacion) {
    case 'estado':
      return estado(contexto);
    case 'subir':
      return subir(contexto);
    case 'desplegar':
      return desplegar(contexto);
    case 'versiones':
      return versionesDe(json(leerSalida(invocar(contexto, ['versions', 'list', '--json']).stdout)));
  }
}
/** Cada servicio sube solo su carpeta del artefacto; la web va únicamente con el principal. */
function copiaDeLaConfiguracion(solicitud: Solicitud, configuracion: Record<string, unknown>) {
  const artefacto = solicitud.artefacto.ruta;
  if (solicitud.servicio === 'cursos') {
    const codigo = lstatSync(join(artefacto, 'worker-cursos/worker.mjs'), { throwIfNoEntry: false });
    exigir(codigo?.isFile() && !codigo.isSymbolicLink(), 'artefacto-invalido');
    return {
      ...configuracion,
      main: join(artefacto, 'worker-cursos/worker.mjs'),
      base_dir: join(artefacto, 'worker-cursos'),
    };
  }
  return {
    ...configuracion,
    main: join(artefacto, 'worker/worker.mjs'),
    base_dir: join(artefacto, 'worker'),
    assets: { ...(configuracion.assets as Record<string, unknown>), directory: join(artefacto, 'web') },
  };
}
function prepararConfiguracion(temporal: string, configuracion: Record<string, unknown>, solicitud: Solicitud): void {
  const copia = copiaDeLaConfiguracion(solicitud, configuracion);
  writeFileSync(join(temporal, 'wrangler.json'), JSON.stringify(copia), { flag: 'wx', mode: PRIVADO });
  writeFileSync(join(temporal, 'vacio.env'), '', { flag: 'wx', mode: PRIVADO });
}
function operarComprobado(contexto: Contexto): RespuestaVersionesCloudflare['resultado'] {
  try {
    const resultado = operar(contexto);
    comprobarArtefacto(contexto.solicitud);
    return resultado;
  } catch (error) {
    if (error instanceof ErrorVersionesCloudflare) {
      throw error;
    }
    throw new ErrorVersionesCloudflare('resultado-invalido');
  }
}
/** Una respuesta que no cabe tras lanzar la orden no prueba que no hubiera efecto: se declara incierta. */
export function respuestaAcotada(
  respuesta: RespuestaVersionesCloudflare,
  mutacionLanzada: boolean,
): RespuestaVersionesCloudflare {
  if (Buffer.byteLength(JSON.stringify(respuesta)) > MAX_SOLICITUD) {
    throw new ErrorVersionesCloudflare('resultado-invalido', mutacionLanzada ? 'incierto' : 'ninguno');
  }
  return respuesta;
}
/** Tras lanzar la orden que cambia Cloudflare, cualquier fallo que no sea su rechazo explícito queda incierto. */
function operarConEfecto(contexto: Contexto): RespuestaVersionesCloudflare['resultado'] {
  try {
    return operarComprobado(contexto);
  } catch (error) {
    if (error instanceof ErrorVersionesCloudflare && contexto.mutacionLanzada && error.efecto === 'ninguno') {
      error.efecto = 'incierto';
    }
    throw error;
  }
}
/** Lee las dos configuraciones con su perfil y su pareja; devuelve la del servicio que se opera. */
function configuracionDelServicio(
  solicitud: Pick<Solicitud, 'configuracion' | 'configuracionCursos' | 'servicio'>,
): Record<string, unknown> {
  const principal = configuracionDe(json(leerPrivado(solicitud.configuracion, MAX_CONFIGURACION)), 'principal');
  const cursos = configuracionDe(json(leerPrivado(solicitud.configuracionCursos, MAX_CONFIGURACION)), 'cursos');
  comprobarPareja(principal, cursos);
  return solicitud.servicio === 'cursos' ? cursos : principal;
}
/**
 * Lee lo que sirve un Worker sin el artefacto. La configuración apunta a una entrega vacía en la carpeta temporal:
 * la lectura no sube nada, pero Wrangler necesita rutas que existan.
 */
function estadoSinArtefacto(
  solicitud: SolicitudSinArtefacto,
  configuracion: Record<string, unknown>,
  ejecutar: EjecutorWrangler,
): RespuestaVersionesCloudflare {
  const padre = realpathSync(tmpdir());
  exigir(!dentro(RUTAS.raiz, padre), 'entrada-invalida');
  const temporal = mkdtempSync(join(padre, 'cloudflare-versiones-'));
  chmodSync(temporal, DIRECTORIO_PRIVADO);
  try {
    const vacia = join(temporal, 'sin-artefacto');
    for (const carpeta of ['worker', 'worker-cursos', 'web']) {
      mkdirSync(join(vacia, carpeta), { recursive: true, mode: DIRECTORIO_PRIVADO });
    }
    for (const codigo of ['worker/worker.mjs', 'worker-cursos/worker.mjs']) {
      writeFileSync(join(vacia, codigo), '', { flag: 'wx', mode: PRIVADO });
    }
    const artefacto = { ruta: vacia, revisionCodigo: '', huellaPaquete: '', sha256Artefacto: '' };
    const conRuta = { ...solicitud, artefacto } as Solicitud;
    prepararConfiguracion(temporal, configuracion, conRuta);
    const contexto: Contexto = {
      solicitud: conRuta,
      configuracion,
      temporal,
      ejecutar,
      contador: 0,
      mutacionLanzada: false,
    };
    let resultado: Deployment;
    try {
      resultado = estado(contexto);
    } catch (error) {
      throw error instanceof ErrorVersionesCloudflare ? error : new ErrorVersionesCloudflare('resultado-invalido');
    }
    const { version, operacion, servicio, intencionId } = { ...solicitud, version: 1 as const };
    return respuestaAcotada({ version, operacion, servicio, intencionId, artefacto: null, resultado }, false);
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}
/** Verifica los bytes antes y después. No reconstruye ni modifica configuración, artefacto o secretos remotos. */
export function ejecutarVersionesCloudflare(
  valor: unknown,
  ejecutar: EjecutorWrangler = crearEjecutorWrangler(),
): RespuestaVersionesCloudflare {
  const solicitud = solicitudDe(valor);
  const configuracion = configuracionDelServicio(solicitud);
  if (solicitud.artefacto === null) {
    return estadoSinArtefacto(solicitud as SolicitudSinArtefacto, configuracion, ejecutar);
  }
  comprobarArtefacto(solicitud);
  const temporal = temporalExterno(solicitud);
  chmodSync(temporal, DIRECTORIO_PRIVADO);
  try {
    prepararConfiguracion(temporal, configuracion, solicitud);
    const contexto: Contexto = { solicitud, configuracion, temporal, ejecutar, contador: 0, mutacionLanzada: false };
    const resultado = operarConEfecto(contexto);
    const { revisionCodigo, huellaPaquete, sha256Artefacto } = solicitud.artefacto;
    const respuesta: RespuestaVersionesCloudflare = {
      version: 1,
      operacion: solicitud.operacion,
      servicio: solicitud.servicio,
      intencionId: solicitud.intencionId,
      artefacto: { revisionCodigo, huellaPaquete, sha256Artefacto },
      resultado,
    };
    return respuestaAcotada(respuesta, contexto.mutacionLanzada);
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}
if (import.meta.main) {
  try {
    exigir(process.argv.length === ARGUMENTOS_CLI && ruta(process.argv[2]), 'entrada-invalida');
    console.log(JSON.stringify(ejecutarVersionesCloudflare(json(leerPrivado(process.argv[2], MAX_SOLICITUD)))));
  } catch (error) {
    console.log(
      JSON.stringify({
        version: 1,
        error: error instanceof ErrorVersionesCloudflare ? error.codigo : 'entrada-invalida',
        efecto: error instanceof ErrorVersionesCloudflare ? error.efecto : 'incierto',
      }),
    );
    process.exitCode = 1;
  }
}
