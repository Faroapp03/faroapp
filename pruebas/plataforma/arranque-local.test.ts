import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
// Arranque real desde una copia autónoma: perfiles sintéticos, HTTP local y proveedor de red prohibido.

import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { esObjeto } from '../../src/comun/json.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PROGRAMA = 'herramientas/servidor/servidor-local.ts';
const ANFITRION = '127.0.0.1';
const ESPERA_MS = 20_000;
const CIERRE_MS = 3_000;
const CORRECTO = 200;
const AUSENTE = 404;
const SALIDA_FALLO = 1;
const SALIDA_USO = 2;
const CABECERAS = { 'User-Agent': IDENTIDAD_WEB['User-Agent'], [CABECERA_CONTRATO]: String(CONTRATO_API) };

interface Proceso {
  hijo: ChildProcess;
  termina: Promise<[number | null, NodeJS.Signals | null]>;
  salida: () => string;
}

/** Copia únicamente piezas propias; no enlaza datos, módulos, dependencias ni secretos del equipo. */
function copia(t: TestContext): string {
  const temporal = mkdtempSync(join(tmpdir(), 'faro-arranque-'));
  t.after(() => rmSync(temporal, { recursive: true, force: true }));
  const raiz = join(temporal, 'Mis documentos', 'Año 2026', 'FARO APP V1.0.0');
  mkdirSync(raiz, { recursive: true });
  for (const ruta of [
    'src',
    'motores',
    'compartido',
    'herramientas',
    'datos',
    'web',
    'package.json',
    'config/identidad-web.json',
    'plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json',
  ]) {
    const destino = join(raiz, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    cpSync(join(RAIZ, ruta), destino, { recursive: true });
  }
  writeFileSync(
    join(raiz, 'sin-red.mjs'),
    'globalThis.fetch = async () => { process.stderr.write("RED_PROHIBIDA\\n"); throw new Error("Red prohibida"); };\n',
  );
  return raiz;
}

/** La reserva efímera elige un puerto del sistema; el servidor de la reserva termina antes del arranque. */
async function puertoLibre(): Promise<number> {
  const reserva = createServer();
  reserva.listen(0, ANFITRION);
  await once(reserva, 'listening');
  const direccion = reserva.address();
  assert.ok(direccion && typeof direccion !== 'string');
  const cerrado = once(reserva, 'close');
  reserva.close();
  await cerrado;
  return direccion.port;
}

/** El hijo no hereda configuración Faro, credenciales ni opciones Node del equipo. */
function lanzar(raiz: string, variables: Record<string, string>, args: string[] = []): Proceso {
  let salida = '';
  const hijo = spawn(process.execPath, ['--import', join(raiz, 'sin-red.mjs'), join(raiz, PROGRAMA), ...args], {
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? '', TMPDIR: tmpdir(), FARO_PERFIL: 'prueba', ...variables },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  hijo.stdout?.setEncoding('utf8').on('data', (texto: string) => {
    salida += texto;
  });
  hijo.stderr?.setEncoding('utf8').on('data', (texto: string) => {
    salida += texto;
  });
  const termina = new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    hijo.once('error', reject);
    hijo.once('close', (codigo, senal) => resolve([codigo, senal]));
  });
  return { hijo, termina, salida: () => salida };
}

/** Un fallo de arranque o un plazo vencido interrumpe la espera; no deja una prueba colgada. */
async function hastaEscuchar(proceso: Proceso): Promise<void> {
  const senal = AbortSignal.timeout(ESPERA_MS);
  assert.ok(proceso.hijo.stdout);
  while (!proceso.salida().includes('Faro en http://')) {
    if (proceso.hijo.exitCode !== null || proceso.hijo.signalCode !== null) {
      assert.fail(proceso.salida());
    }
    senal.throwIfAborted();
    await Promise.race([once(proceso.hijo.stdout, 'data', { signal: senal }), proceso.termina]);
  }
}

/** Termina únicamente el hijo propio y comprueba su cierre, incluso si no llegó a escuchar. */
async function parar(proceso: Proceso): Promise<void> {
  if (proceso.hijo.exitCode === null && proceso.hijo.signalCode === null) {
    proceso.hijo.kill('SIGTERM');
  }
  const plazo = setTimeout(() => proceso.hijo.kill('SIGKILL'), CIERRE_MS);
  try {
    await proceso.termina;
  } finally {
    clearTimeout(plazo);
  }
  assert.doesNotMatch(proceso.salida(), /RED_PROHIBIDA/);
}

async function objetoDe(respuesta: Response): Promise<Record<string, unknown>> {
  assert.equal(respuesta.status, CORRECTO, await respuesta.clone().text());
  const valor: unknown = await respuesta.json();
  assert.ok(esObjeto(valor));
  return valor;
}

/** Mismo origen y protocolo del navegador; ningún proveedor interviene en las peticiones comprobadas. */
function pedir(url: string, ruta: string, opciones: RequestInit = {}): Promise<Response> {
  return fetch(`${url}${ruta}`, {
    ...opciones,
    headers: { ...CABECERAS, origin: url, ...opciones.headers },
    signal: AbortSignal.timeout(ESPERA_MS),
  });
}

for (const seleccionManual of [false, true]) {
  test(`perfil factual apagado conserva los datos desde otra carpeta, sin el relato, y selección manual=${seleccionManual}`, async (t) => {
    const raiz = copia(t);
    const puerto = await puertoLibre();
    writeFileSync(
      join(raiz, '.dev.vars.prueba'),
      `FARO_ADMINISTRACION=no\nFARO_MCP=no\nFARO_A2A=no\nFARO_API_SOCIOS=no\nFARO_CAMINO_A_MANO=${seleccionManual ? 'si' : 'no'}\n`,
    );
    // La copia no lleva dependencias para construir la web local; esta prueba solo pide la API.
    const proceso = lanzar(raiz, { FARO_PUERTO: String(puerto), FARO_WEB_DE_PRUEBA: join(raiz, 'web') });
    const url = `http://${ANFITRION}:${puerto}`;
    try {
      await hastaEscuchar(proceso);
      const salud = await objetoDe(await pedir(url, '/api/salud'));
      for (const campo of ['cerebro', 'ia', 'estimador', 'turnstile', 'proveedor_ia']) {
        assert.equal(Object.hasOwn(salud, campo), false);
      }
      assert.equal((await pedir(url, '/api/grupos')).status, CORRECTO);
      await comprobarCatalogo(url);
      await comprobarSinRelato(url);
    } finally {
      await parar(proceso);
    }
  });
}

async function comprobarCatalogo(url: string): Promise<void> {
  const respuesta = await objetoDe(await pedir(url, '/.well-known/api-catalog'));
  assert(Array.isArray(respuesta.linkset) && respuesta.linkset.length > 0);
  const texto = JSON.stringify(respuesta);
  assert.match(texto, /openapi.json/);
  assert.doesNotMatch(texto, /\/mcp|\/a2a|\/api\/socios/);
  assert.equal((await pedir(url, '/mcp', { method: 'POST', body: '{}' })).status, AUSENTE);
}

/** El servidor local no recibe el relato: la clasificación y el informe no existen en él, como cualquier otra ruta. */
async function comprobarSinRelato(url: string): Promise<void> {
  for (const ruta of ['/api/clasificar', '/api/informe?formato=html']) {
    const respuesta = await pedir(url, ruta, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texto: 'recepcionista' }),
    });
    assert.equal(respuesta.status, AUSENTE, ruta);
    assert.equal(respuesta.headers.get('allow'), null, ruta);
  }
}

test('un campo de registro retirado impide arrancar con el contrato cerrado', async (t) => {
  const raiz = copia(t);
  writeFileSync(join(raiz, '.dev.vars.prueba'), 'FARO_API_SOCIOS=si\nFARO_API_SOCIOS_REGISTRO={\n');
  const proceso = lanzar(raiz, { FARO_PUERTO: String(await puertoLibre()) });
  try {
    const plazo = setTimeout(() => proceso.hijo.kill('SIGKILL'), ESPERA_MS);
    const [codigo] = await proceso.termina.finally(() => clearTimeout(plazo));
    assert.equal(codigo, SALIDA_FALLO, proceso.salida());
    assert.doesNotMatch(proceso.salida(), /Faro en http:\/\//);
    assert.match(proceso.salida(), /Faro no arranca|Error/);
  } finally {
    await parar(proceso);
  }
});

test('la orden rechaza argumentos desconocidos antes de abrir el servidor', async (t) => {
  const proceso = lanzar(copia(t), {}, ['--desconocida']);
  try {
    const plazo = setTimeout(() => proceso.hijo.kill('SIGKILL'), ESPERA_MS);
    const [codigo] = await proceso.termina.finally(() => clearTimeout(plazo));
    assert.equal(codigo, SALIDA_USO, proceso.salida());
    assert.match(proceso.salida(), /Uso:/);
  } finally {
    await parar(proceso);
  }
});
