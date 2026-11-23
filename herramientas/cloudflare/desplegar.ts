/** Orden única de despliegue: comprueba perfil, entrega e instalación antes de llamar una sola vez a Wrangler. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ejecutar, orden } from '../comun/opciones.ts';
import {
  comprobarEntrega,
  configuracionParaWrangler,
  type Entorno,
  leerPerfil,
  leerRegistroInstalacion,
  migracionPendiente,
  type Servicio,
  variablesDeDespliegue,
} from './preparar-despliegue.ts';
import { escribirSecretos, leerArchivoPrivadas, leerPrivadas, type Privadas } from './variables-privadas.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const SHA256 = /^[0-9a-f]{64}$/;
const USO = [
  'node herramientas/cloudflare/desplegar.ts comprobar|ensayar|publicar --entorno produccion|ensayo',
  '--servicio principal|cursos --sha256 <sha256Artefacto> [--artefacto <carpeta>] [--instalacion <registro.json>]',
  '[--acceso <parametros.json> (con --instalacion)] [--aplicar-migracion <etiqueta>] [--intencion <solicitudId>]',
  '[--privadas <privadas.json> (ensayar o publicar el principal de produccion)]',
].join(' ');

/** Opciones de la orden; las guías de despliegue se comprueban contra ellas. */
export const OPCIONES = {
  entorno: { type: 'string' },
  servicio: { type: 'string' },
  sha256: { type: 'string' },
  artefacto: { type: 'string' },
  instalacion: { type: 'string' },
  acceso: { type: 'string' },
  'aplicar-migracion': { type: 'string' },
  intencion: { type: 'string' },
  privadas: { type: 'string' },
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Accion = 'comprobar' | 'ensayar' | 'publicar';
export interface SolicitudDespliegue {
  readonly raiz: string;
  readonly accion: Accion;
  readonly entorno: Entorno;
  readonly servicio: Servicio;
  readonly sha256: string;
  readonly artefacto: string;
  readonly instalacion?: unknown;
  readonly acceso?: unknown;
  readonly aplicarMigracion?: string | undefined;
  /**
   * La `solicitudId` de una activación detenida que esta publicación termina: la versión lleva su etiqueta y la huella
   * del artefacto, como las que sube la activación, para que la reconciliación la reconozca.
   */
  readonly intencion?: string | undefined;
  /** Ruta del archivo privado de quien opera con variables y secretos para el principal de producción. */
  readonly privadas?: string | undefined;
}
export interface OrdenDespliegue {
  readonly argumentos: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}
export type EjecutorDespliegue = (orden: OrdenDespliegue) => Promise<number>;
export interface ReciboDespliegue {
  readonly accion: Accion;
  readonly entorno: Entorno;
  readonly servicio: Servicio;
  readonly worker: string;
  readonly destino: string;
  readonly sha256Artefacto: string;
  readonly revisionCodigo: string;
  readonly huellaPaquete: string;
  readonly migracionPendiente: string | null;
  readonly wrangler: boolean;
  /** Solo con `--privadas`: los nombres que se pusieron, nunca sus valores. */
  readonly privadas?: Privadas['nombres'];
}

/** La autenticación legítima se conserva; los destinos y la carga de código no se heredan del proceso llamador. */
export function entornoWrangler(origen: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const entorno = { ...origen };
  for (const nombre of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'CF_ACCOUNT_ID',
    'CLOUDFLARE_ACCOUNT_ID',
    'CF_API_BASE_URL',
    'CLOUDFLARE_API_BASE_URL',
    'CLOUDFLARE_BASE_URL',
    'CLOUDFLARE_API_ENVIRONMENT',
    'WRANGLER_API_ENVIRONMENT',
    'WRANGLER_AUTH_URL',
    'WRANGLER_TOKEN_URL',
    'WRANGLER_REVOKE_URL',
    'CLOUDFLARE_CONFIG_FILE',
    'CLOUDFLARE_CONFIG_FILENAME',
    'WRANGLER_CONFIG_FILENAME',
    'CLOUDFLARE_ENV',
    'CLOUDFLARE_INCLUDE_PROCESS_ENV',
    'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV',
  ]) {
    delete entorno[nombre];
  }
  return {
    ...entorno,
    WRANGLER_HIDE_BANNER: 'true',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false',
    WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_LOG_SANITIZE: 'true',
  };
}

/** Wrangler fijado en el producto, siempre con la identidad de red de herramientas/red/identidad-wrangler.cjs. */
export function lineaWrangler(raiz: string, argumentos: readonly string[]): string[] {
  return [
    '--require',
    join(raiz, 'herramientas/red/identidad-wrangler.cjs'),
    join(raiz, 'node_modules/wrangler/bin/wrangler.js'),
    ...argumentos,
  ];
}

export function ejecutorWrangler(raiz: string): EjecutorDespliegue {
  return ({ argumentos, cwd, env }) =>
    new Promise<number>((resolver, rechazar) => {
      const proceso = spawn(process.execPath, lineaWrangler(raiz, argumentos), { cwd, stdio: 'inherit', env });
      proceso.once('error', rechazar);
      proceso.once('exit', (codigo) => resolver(codigo ?? 1));
    });
}

function comprobarSolicitud(solicitud: SolicitudDespliegue): void {
  const { accion, entorno, servicio } = solicitud;
  assert.ok(accion === 'comprobar' || accion === 'ensayar' || accion === 'publicar', 'Acción no admitida');
  assert.ok(entorno === 'produccion' || entorno === 'ensayo', 'Indica --entorno produccion o ensayo');
  assert.ok(servicio === 'principal' || servicio === 'cursos', 'Indica --servicio principal o cursos');
  assert.ok(SHA256.test(solicitud.sha256), 'Indica --sha256 con la huella exacta de artefacto.json');
  assert.ok(accion !== 'publicar' || solicitud.instalacion !== undefined, 'Publicar exige --instalacion');
  assert.ok(
    solicitud.privadas === undefined ||
      (entorno === 'produccion' && servicio === 'principal' && accion !== 'comprobar'),
    '--privadas solo se admite al ensayar o publicar el Worker principal de producción',
  );
}

/** Todo lo que se decide antes de Wrangler: perfil, entrega, instalación, migración y variables. */
function preparar(solicitud: SolicitudDespliegue) {
  comprobarSolicitud(solicitud);
  const { accion, entorno, servicio } = solicitud;
  const perfil = leerPerfil(solicitud.raiz);
  const destino = perfil[entorno];
  const entrega = comprobarEntrega(solicitud.artefacto, solicitud.sha256, entorno, servicio);
  const registro = solicitud.instalacion === undefined ? undefined : leerRegistroInstalacion(solicitud.instalacion);
  const pendiente = registro ? migracionPendiente(destino, registro, entorno) : null;
  const aplicada = accion === 'publicar' && servicio === 'principal' ? pendiente : null;
  assert.equal(
    solicitud.aplicarMigracion ?? null,
    aplicada,
    aplicada
      ? `Publicar aplicaría la migración ${aplicada}: revisar docs/migracion-workers.md y repetir con --aplicar-migracion ${aplicada}`
      : '--aplicar-migracion solo se admite al publicar el Worker principal con esa migración pendiente',
  );
  const variables = variablesDeDespliegue(entorno, servicio, entrega.destino, {
    origen: registro?.origen,
    acceso: solicitud.acceso,
  });
  const privadas = solicitud.privadas === undefined ? undefined : leerPrivadas(leerArchivoPrivadas(solicitud.privadas));
  const config = configuracionParaWrangler(destino[servicio], servicio, resolve(solicitud.artefacto));
  return { entrega, pendiente, variables: [...variables, ...(privadas?.variables ?? [])], config, privadas };
}

/** Etiqueta y mensaje de la versión de una activación: su `solicitudId` y la huella del artefacto. */
export function identidadDeLaIntencion(intencion: string | undefined, sha256: string): string[] {
  if (intencion === undefined) {
    return [];
  }
  assert.ok(UUID.test(intencion), '--intencion debe ser la solicitudId de la activación');
  return ['--tag', intencion, '--message', sha256];
}
/**
 * Argumentos completos: código ya construido, variables del alojamiento conservadas y ningún .env heredado. Los
 * secretos solo viajan como la ruta de su archivo temporal, nunca como valores.
 */
export function argumentosDespliegue(
  accion: Accion,
  config: string,
  vacio: string,
  extra: {
    readonly variables: readonly string[];
    readonly identidad: readonly string[];
    readonly secretos?: string | undefined;
  },
) {
  const { variables, identidad, secretos } = extra;
  return [
    'deploy',
    ...(accion === 'ensayar' ? ['--dry-run'] : []),
    '--no-bundle',
    '--keep-vars',
    ...identidad,
    '--config',
    config,
    ...variables.flatMap((variable) => ['--var', variable]),
    ...(secretos === undefined ? [] : ['--secrets-file', secretos]),
    '--env-file',
    vacio,
  ];
}

/** Comprueba y, si la acción lo pide, ejecuta una sola orden de Wrangler; después vuelve a comprobar la entrega. */
export async function desplegarEntrega(
  solicitud: SolicitudDespliegue,
  ejecutor: EjecutorDespliegue,
): Promise<ReciboDespliegue> {
  const { entrega, pendiente, variables, config, privadas } = preparar(solicitud);
  const identidad = identidadDeLaIntencion(solicitud.intencion, solicitud.sha256);
  const recibo = {
    accion: solicitud.accion,
    entorno: solicitud.entorno,
    servicio: solicitud.servicio,
    worker: config.name as string,
    destino: entrega.destino,
    sha256Artefacto: entrega.sha256Artefacto,
    revisionCodigo: entrega.revisionCodigo,
    huellaPaquete: entrega.huellaPaquete,
    migracionPendiente: pendiente,
    ...(privadas ? { privadas: privadas.nombres } : {}),
  };
  if (solicitud.accion === 'comprobar') {
    return { ...recibo, wrangler: false };
  }
  const temporal = mkdtempSync(join(tmpdir(), 'faro-despliegue-'));
  try {
    const archivo = join(temporal, 'wrangler.json');
    const vacio = join(temporal, 'vacio.env');
    writeFileSync(archivo, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
    writeFileSync(vacio, '', { flag: 'wx', mode: 0o600 });
    const secretos =
      privadas && privadas.nombres.secretos.length > 0
        ? escribirSecretos(temporal, privadas.secretos, [solicitud.raiz, solicitud.artefacto])
        : undefined;
    const argumentos = argumentosDespliegue(solicitud.accion, archivo, vacio, { variables, identidad, secretos });
    const codigo = await ejecutor({ argumentos, cwd: solicitud.raiz, env: entornoWrangler(process.env) });
    assert.equal(codigo, 0, 'Wrangler no terminó correctamente; comprobar el estado remoto antes de repetir');
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
  comprobarEntrega(solicitud.artefacto, solicitud.sha256, solicitud.entorno, solicitud.servicio);
  return { ...recibo, wrangler: true };
}

function leerJson(ruta: string | undefined, que: string): unknown {
  if (ruta === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch {
    throw new Error(`No se pudo leer ${que} como JSON: ${ruta}`);
  }
}

async function principal(): Promise<void> {
  const { values, positionals } = orden(USO).leer({ allowPositionals: true, options: OPCIONES });
  assert.equal(positionals.length, 1, 'Indica una sola acción: comprobar, ensayar o publicar');
  const solicitud = {
    raiz: RAIZ,
    accion: positionals[0] as Accion,
    entorno: values.entorno as Entorno,
    servicio: values.servicio as Servicio,
    sha256: values.sha256 ?? '',
    artefacto: resolve(values.artefacto ?? join(RAIZ, 'dist')),
    instalacion: leerJson(values.instalacion, 'el registro de instalación'),
    acceso: leerJson(values.acceso, 'los parámetros de Access'),
    aplicarMigracion: values['aplicar-migracion'],
    intencion: values.intencion,
    privadas: values.privadas,
  };
  console.log(JSON.stringify(await desplegarEntrega(solicitud, ejecutorWrangler(RAIZ))));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ejecutar(principal, 'Despliegue detenido');
}
