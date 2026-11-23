/**
 * El arranque común de la construcción en Miniflare (worker-miniflare.ts) con la versión fijada, sobre una construcción
 * sintética con la misma forma que dist/: un módulo de datos, ASSETS detrás del Worker con html_handling y
 * not_found_handling en «none» (sin index.html implícito, sin quitar .html, sin página 404 ni SPA), el objeto durable
 * SQLite conservado entre dos arranques, CF_VERSION_METADATA y el enlace CURSOS al Worker de cursos. Solo loopback.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { abrirWorkerConstruido, type WorkerLocal } from './worker-miniflare.ts';

const PLAZO_MS = 60_000;
const ORIGEN = 'https://ensayo.invalid';
const CORRECTO = 200;
const NO_ENCONTRADO = 404;
/** Las visitas al objeto durable tras dos en el primer arranque y una en el segundo. */
const VISITAS_TRAS_REINICIAR = 3;
const SALUDO = '{"saludo":"hola desde los datos"}';
const CATALOGO = '{"cursos":["sintetico"]}';
const BINDINGS = { FARO_PRUEBA: 'valor-sintetico-del-ensayo' };

const WORKER = `import { DurableObject } from 'cloudflare:workers';
import saludo from './datos/saludo.json';
export class AccesoPublicoDurable extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS visitas (n INTEGER)');
  }
  async fetch() {
    this.ctx.storage.sql.exec('INSERT INTO visitas VALUES (1)');
    return Response.json({ visitas: this.ctx.storage.sql.exec('SELECT count(*) AS n FROM visitas').one().n });
  }
}
export default {
  async fetch(peticion, env) {
    const { pathname } = new URL(peticion.url);
    if (pathname === '/datos') {
      return Response.json({ arrayBuffer: saludo instanceof ArrayBuffer, texto: new TextDecoder().decode(saludo), valor: env.FARO_PRUEBA });
    }
    if (pathname === '/visita') {
      return env.REGISTRO_SOCIOS.get(env.REGISTRO_SOCIOS.idFromName('unico')).fetch(peticion);
    }
    if (pathname === '/cursos') {
      return env.CURSOS.fetch(peticion);
    }
    if (pathname === '/version') {
      return Response.json(env.CF_VERSION_METADATA ?? null);
    }
    const archivo = await env.ASSETS.fetch(peticion);
    const headers = new Headers(archivo.headers);
    headers.set('x-paso-por-el-worker', 'si');
    return new Response(archivo.body, { status: archivo.status, headers });
  },
};`;
const WORKER_DE_CURSOS = `import catalogo from './datos/catalogo.json';
export default { fetch: () => new Response(catalogo, { headers: { 'content-type': 'application/json' } }) };`;

function construccion(carpeta: string): void {
  for (const [ruta, contenido] of Object.entries({
    'worker/worker.mjs': WORKER,
    'worker/datos/saludo.json': SALUDO,
    'worker-cursos/worker.mjs': WORKER_DE_CURSOS,
    'worker-cursos/datos/catalogo.json': CATALOGO,
    'web/hola.txt': 'archivo de ASSETS',
    'web/index.html': 'portada',
    'web/pagina.html': 'pagina',
    'web/carpeta/index.html': 'carpeta',
    'web/404.html': 'pagina de error',
  })) {
    mkdirSync(join(carpeta, ruta, '..'), { recursive: true });
    writeFileSync(join(carpeta, ruta), contenido);
  }
}

/** Cada ruta y lo que sirve ASSETS con html_handling y not_found_handling en «none»: null es 404 sin cuerpo. */
const RUTAS_DE_ASSETS: readonly (readonly [string, string | null])[] = [
  ['/index.html', 'portada'],
  ['/pagina.html', 'pagina'],
  ['/carpeta/index.html', 'carpeta'],
  ['/', null],
  ['/pagina', null],
  ['/pagina/', null],
  ['/carpeta/', null],
  ['/carpeta', null],
  ['/no-existe', null],
  ['/no-existe.txt', null],
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function visitas(worker: WorkerLocal): Promise<number> {
  const respuesta = await worker.dispatchFetch(`${ORIGEN}/visita`);
  assert.equal(respuesta.status, CORRECTO, 'el objeto durable responde');
  return ((await respuesta.json()) as { visitas: number }).visitas;
}

/** ASSETS después del Worker, con html_handling y not_found_handling en «none». */
async function comprobarAssets(worker: WorkerLocal): Promise<void> {
  const archivo = await worker.dispatchFetch(`${ORIGEN}/hola.txt`);
  assert.equal(archivo.status, CORRECTO, 'ASSETS sirve el archivo');
  assert.equal(await archivo.text(), 'archivo de ASSETS');
  assert.equal(archivo.headers.get('x-paso-por-el-worker'), 'si', 'el Worker va antes que ASSETS');
  for (const [ruta, esperado] of RUTAS_DE_ASSETS) {
    const respuesta = await worker.dispatchFetch(`${ORIGEN}${ruta}`, { redirect: 'manual' });
    const cuerpo = await respuesta.text();
    assert.deepEqual(
      { estado: respuesta.status, cuerpo },
      esperado === null ? { estado: NO_ENCONTRADO, cuerpo: '' } : { estado: CORRECTO, cuerpo: esperado },
      `ASSETS ${ruta}: html_handling y not_found_handling en «none»`,
    );
  }
}

/** CF_VERSION_METADATA con la forma de producción; su id es aleatorio en cada arranque. */
async function comprobarVersion(worker: WorkerLocal): Promise<void> {
  const version = (await (await worker.dispatchFetch(`${ORIGEN}/version`)).json()) as Record<string, unknown> | null;
  assert.ok(version, 'el Worker recibe CF_VERSION_METADATA');
  assert.deepEqual(Object.keys(version).sort(), ['id', 'tag', 'timestamp'], 'CF_VERSION_METADATA con su forma');
  assert.match(String(version.id), UUID, 'CF_VERSION_METADATA.id es un UUID');
  assert.ok(!Number.isNaN(Date.parse(String(version.timestamp))), 'CF_VERSION_METADATA.timestamp es una fecha');
}

test('datos, ASSETS, CURSOS y objeto durable entre arranques', { timeout: PLAZO_MS }, async (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'faro-worker-miniflare-'));
  const abiertos = new Set<WorkerLocal>();
  t.after(async () => {
    await Promise.allSettled([...abiertos].map((worker) => worker.dispose()));
    rmSync(carpeta, { recursive: true, force: true });
  });
  const dist = join(carpeta, 'dist');
  const persistencia = join(carpeta, 'persistencia');
  construccion(dist);
  const abrir = (conPersistencia: boolean) => {
    const worker = abrirWorkerConstruido(dist, { bindings: BINDINGS, ...(conPersistencia ? { persistencia } : {}) });
    abiertos.add(worker);
    return worker;
  };
  const cerrar = async (worker: WorkerLocal) => {
    abiertos.delete(worker);
    await worker.dispose();
  };

  let worker = abrir(true);
  await comprobarAssets(worker);
  await comprobarVersion(worker);
  const datos = await worker.dispatchFetch(`${ORIGEN}/datos`);
  assert.deepEqual(await datos.json(), { arrayBuffer: true, texto: SALUDO, valor: BINDINGS.FARO_PRUEBA });
  const cursos = await worker.dispatchFetch(`${ORIGEN}/cursos`);
  assert.equal(await cursos.text(), CATALOGO, 'CURSOS llega al Worker de cursos');
  assert.equal(await visitas(worker), 1);
  assert.equal(await visitas(worker), 2);
  await cerrar(worker);

  worker = abrir(true);
  assert.equal(await visitas(worker), VISITAS_TRAS_REINICIAR, 'el objeto durable conserva su SQLite entre arranques');
  await cerrar(worker);

  worker = abrir(false);
  assert.equal(await visitas(worker), 1, 'sin persistencia el estado empieza de cero');
  await cerrar(worker);
});

test('los ensayos con Miniflare de la construcción arrancan por worker-miniflare.ts', () => {
  const ajenos = ['unificado-miniflare.mjs', 'portal-fixture.mjs', '../ensayo-miniflare-privado.mjs'].filter(
    (archivo) => {
      const fuente = readFileSync(fileURLToPath(new URL(archivo, import.meta.url)), 'utf8');
      return (
        !/from '\.\/(?:navegadores\/)?worker-miniflare\.ts'/.test(fuente) ||
        /convertV4MiniflareOptions|modulesRules/.test(fuente)
      );
    },
  );
  assert.deepEqual(ajenos, [], 'Estos ensayos no usan el arranque común o repiten la configuración');
});
