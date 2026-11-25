// Las pruebas que levantan el servidor local o necesitan una carpeta temporal no dejan nada que no sea suyo: ni el
// almacén privado bajo registro/ de la raíz (que ignora git, y por eso no se ve en el estado del árbol) ni carpetas en
// el temporal del sistema. Lo que pasa hoy con humo-de-datos.test.ts, web-local.test.ts y construir-servicio.test.ts
// ya no puede volver sin que esta prueba lo diga.

import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const REGISTRO = join(RAIZ, 'registro');
const SERVIDOR = join(RAIZ, 'herramientas/servidor/servidor-local.ts');
const ANFITRION = '127.0.0.1';
const ESPERA_MS = 30_000;
const PAUSA_MS = 50;
const CORRECTO = 200;

function carpeta(t: TestContext, prefijo: string): string {
  const ruta = mkdtempSync(join(tmpdir(), prefijo));
  t.after(() => rmSync(ruta, { recursive: true, force: true }));
  return ruta;
}

/** Cada archivo de una carpeta, ignorados incluidos, con su tamaño y su fecha; vacío si la carpeta no existe. */
function huella(ruta: string): string[] {
  if (!existsSync(ruta)) {
    return [];
  }
  return readdirSync(ruta, { recursive: true, encoding: 'utf8' })
    .sort()
    .map((relativa) => {
      const { size, mtimeMs } = statSync(join(ruta, relativa));
      return `${relativa} ${size} ${mtimeMs}`;
    });
}

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

async function esperarA(hijo: ChildProcess, salida: () => string): Promise<void> {
  const limite = Date.now() + ESPERA_MS;
  while (!salida().includes('Faro en http://')) {
    assert.ok(hijo.exitCode === null && Date.now() < limite, salida());
    await new Promise((resolver) => setTimeout(resolver, PAUSA_MS));
  }
}

test('el servidor local con FARO_REGISTRO_DE_PRUEBA guarda su almacén en esa carpeta y no toca registro/ de la raíz', async (t) => {
  const antes = huella(REGISTRO);
  const propio = carpeta(t, 'faro-registro-arbol-');
  const web = carpeta(t, 'faro-web-arbol-');
  mkdirSync(join(web, 'datos'));
  writeFileSync(join(web, 'inicio.html'), '<p>Inicio</p>');
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [SERVIDOR], {
    cwd: RAIZ,
    env: {
      ...process.env,
      FARO_PUERTO: String(puerto),
      FARO_WEB_DE_PRUEBA: web,
      FARO_REGISTRO_DE_PRUEBA: propio,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let texto = '';
  for (const flujo of [hijo.stdout, hijo.stderr]) {
    flujo.setEncoding('utf8').on('data', (trozo: string) => {
      texto += trozo;
    });
  }
  const cerrado = once(hijo, 'close');
  try {
    await esperarA(hijo, () => texto);
    const respuesta = await fetch(`http://${ANFITRION}:${puerto}/secciones.json`, {
      headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'] },
    });
    assert.equal(respuesta.status, CORRECTO, texto);
    await respuesta.arrayBuffer();
  } finally {
    hijo.kill();
    await cerrado;
  }
  assert.ok(existsSync(join(propio, 'clientes.sqlite')), 'el almacén está en la carpeta de la prueba');
  assert.deepEqual(huella(REGISTRO), antes, 'registro/ de la raíz queda igual');
});

test('la prueba que rechaza las líneas con solo espacios retira su carpeta del temporal', (t) => {
  const temporal = carpeta(t, 'faro-temporal-arbol-');
  // Sin el contexto del ejecutor que la lanza, la prueba hija cuenta en su propia salida y no en la de esta.
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  const resultado = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-name-pattern=rechaza quitarlas si están dentro de una cadena de plantilla',
      join(RAIZ, 'pruebas/servicio-construccion/construir-servicio.test.ts'),
    ],
    { cwd: RAIZ, encoding: 'utf8', env: { ...entorno, TMPDIR: temporal } },
  );
  assert.equal(resultado.status, 0, `${resultado.stdout}${resultado.stderr}`);
  assert.match(resultado.stdout, /^ℹ pass 1$/mu);
  assert.deepEqual(readdirSync(temporal), [], 'no deja carpetas en el temporal');
});
