// El Worker construido en workerd local, con la Miniflare fijada en package-lock.json y los bindings de
// config/cloudflare/instalaciones/wrangler.ensayo*.jsonc: módulos de datos, ASSETS detrás del Worker con sus dos
// opciones, objeto durable SQLite, CF_VERSION_METADATA y enlace CURSOS al Worker de cursos si la construcción lo trae.
// Solo loopback; sin red ni Cloudflare. CF_VERSION_METADATA tiene la forma de producción ({ id, tag, timestamp }), pero
// Miniflare da un id aleatorio en cada arranque y la etiqueta vacía: no es la versión desplegada, y
// /mantenimiento/construccion sigue exigiendo el token OIDC de GitHub, que aquí no existe.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

/** Los nombres de las instalaciones de ensayo (wrangler.ensayo.jsonc y wrangler.ensayo-cursos.jsonc). */
export const NOMBRE_DEL_WORKER = 'faro-ensayo';
export const NOMBRE_DEL_WORKER_DE_CURSOS = 'faro-ensayo-cursos';
const FECHA_DE_COMPATIBILIDAD = '2026-10-01';
const BANDERAS_DE_COMPATIBILIDAD = ['global_fetch_strictly_public'];

export interface OpcionesDelWorkerConstruido {
  /** Variables y secretos sintéticos del Worker principal. */
  readonly bindings: Readonly<Record<string, string>>;
  /** Carpeta donde workerd conserva el objeto durable entre arranques; sin ella, el estado es efímero. */
  readonly persistencia?: string;
}

/** Lo que usan los ensayos de la instancia de Miniflare. */
export interface WorkerLocal {
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
}

interface Modulo {
  readonly type: 'ESModule' | 'Data';
  readonly path: string;
}

/**
 * El script y cada `datos/*.json` como módulo Data (ArrayBuffer), igual que la regla `**\/datos/*.json` de wrangler.
 * Esta Miniflare no convierte `modulesRules` sin perder comportamiento y lo rechaza: los módulos se declaran uno a uno.
 *
 * @param carpeta - La carpeta del Worker construido (`worker` o `worker-cursos`).
 * @returns Los módulos, el script primero y los datos en orden.
 */
export function modulosDelWorker(carpeta: string): readonly Modulo[] {
  const script = join(carpeta, 'worker.mjs');
  assert.ok(existsSync(script), `Falta el script del Worker en ${basename(carpeta)}/worker.mjs`);
  const datos = readdirSync(carpeta, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && entrada.name.endsWith('.json') && basename(entrada.parentPath) === 'datos')
    .map((entrada) => join(entrada.parentPath, entrada.name))
    .sort();
  assert.ok(datos.length, `El Worker de ${basename(carpeta)} debe contener módulos de datos`);
  return [{ type: 'ESModule', path: script }, ...datos.map((path): Modulo => ({ type: 'Data', path }))];
}

/**
 * Las opciones de Miniflare (forma v4, la que convierte `convertV4MiniflareOptions`) de una construcción.
 * `routerConfig.has_user_worker` es obligatorio: sin él, ASSETS responde 500 porque no hay Worker de usuario. La
 * persistencia va en `resourcePersistencePath`; la clave v4 `durableObjectsPersist` se descartaría sin aviso.
 *
 * @param directorio - La construcción: `worker/`, `web/` y, si existe, `worker-cursos/`.
 * @param opciones - Los bindings sintéticos y la persistencia.
 * @returns Las opciones v4, el Worker principal primero (el que recibe `dispatchFetch`).
 */
export function opcionesDelWorkerConstruido(directorio: string, opciones: OpcionesDelWorkerConstruido) {
  const worker = join(directorio, 'worker');
  const cursos = join(directorio, 'worker-cursos');
  const conCursos = existsSync(cursos);
  const comunes = { compatibilityDate: FECHA_DE_COMPATIBILIDAD, compatibilityFlags: BANDERAS_DE_COMPATIBILIDAD };
  return {
    workers: [
      {
        ...comunes,
        name: NOMBRE_DEL_WORKER,
        modules: modulosDelWorker(worker),
        modulesRoot: worker,
        assets: {
          directory: join(directorio, 'web'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: { has_user_worker: true },
          assetConfig: { html_handling: 'none', not_found_handling: 'none' },
        },
        durableObjects: { REGISTRO_SOCIOS: { className: 'AccesoPublicoDurable', useSQLite: true } },
        versionMetadata: 'CF_VERSION_METADATA',
        bindings: { ...opciones.bindings },
        ...(conCursos ? { serviceBindings: { CURSOS: NOMBRE_DEL_WORKER_DE_CURSOS } } : {}),
      },
      ...(conCursos
        ? [{ ...comunes, name: NOMBRE_DEL_WORKER_DE_CURSOS, modules: modulosDelWorker(cursos), modulesRoot: cursos }]
        : []),
    ],
    ...(opciones.persistencia === undefined ? {} : { resourcePersistencePath: opciones.persistencia }),
    cf: false,
    telemetry: { enabled: false },
  };
}

/**
 * Arranca workerd con la construcción. Quien la abre la cierra con `dispose()`, también si falla.
 *
 * @param directorio - La construcción.
 * @param opciones - Los bindings sintéticos y la persistencia.
 * @returns La instancia de Miniflare.
 */
export function abrirWorkerConstruido(directorio: string, opciones: OpcionesDelWorkerConstruido): WorkerLocal {
  const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.url)('miniflare');
  return new Miniflare(convertV4MiniflareOptions(opcionesDelWorkerConstruido(directorio, opciones)));
}
