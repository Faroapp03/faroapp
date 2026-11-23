/** Ejecuciones privadas reales: productor Python del producto e instalaciones aisladas con ejecutable sintético. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  crearLectorEstadoDatosNode,
  MAX_SALIDA_ESTADO_DATOS_BYTES,
  PLAZO_ESTADO_DATOS_MS,
} from '../../src/plataforma/node/estado-datos.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const MARGEN_PRUEBA_MS = 3000;
const ESPERA_ARRANQUE_MS = 10;
const MAX_ESPERA_ARRANQUE_MS = 1000;
const AHORA = '2026-10-16T14:20:00Z';
function salidaValida(): string {
  return JSON.stringify({
    version: 1,
    observadoEn: AHORA,
    fuentes: [{ id: 'citilab', politica: 'mensual', fecha: null, plazoDias: null }],
    modulos: ['citilab', 'paquete'].map((id) => ({
      id,
      ultimoIntento: null,
      veredicto: null,
      ultimaVersionBuena: null,
      fallos: 0,
      proximoReintento: null,
    })),
    formacionAbiertaCaduca: null,
  });
}
async function instalacion(
  programa: string,
  accion: (leer: ReturnType<typeof crearLectorEstadoDatosNode>, dir: string) => Promise<void>,
) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'estado datos Año-'));
  for (const ruta of [
    'src/plataforma/node/estado-datos.ts',
    'src/plataforma/node/rutas.ts',
    'src/administracion/estado-datos.js',
    'src/administracion/lectura-estricta.js',
    'src/administracion/retenidos-datos.js',
    'src/administracion/retirada-datos.js',
    'src/administracion/edicion-nueva-datos.js',
  ]) {
    const destino = join(dir, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(join(RAIZ, ruta), destino);
  }
  mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(dir, '.venv', 'bin', 'python'),
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(dir, 'pid'))},String(process.pid));\n${programa}`,
    { mode: 0o700 },
  );
  try {
    const modulo: typeof import('../../src/plataforma/node/estado-datos.ts') = await import(
      pathToFileURL(join(dir, 'src/plataforma/node/estado-datos.ts')).href
    );
    assert.equal(existsSync(join(dir, 'pid')), false);
    await accion(modulo.crearLectorEstadoDatosNode(), dir);
  } finally {
    rmSync(dir, { recursive: true });
  }
}
function comprobarRecolectado(dir: string) {
  const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'));
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}
async function arrancado(dir: string) {
  const limite = Date.now() + MAX_ESPERA_ARRANQUE_MS;
  while (!existsSync(join(dir, 'pid'))) {
    assert.ok(Date.now() < limite);
    await new Promise((resolve) => setTimeout(resolve, ESPERA_ARRANQUE_MS));
  }
}
test('Python real conserva todas las fuentes y módulos del registro sin depender del almacén instalado', async (t) => {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'Estado aislado Año-'));
  t.after(() => rmSync(raiz, { recursive: true }));
  const preparada = join(raiz, 'var/actualizacion/preparados/abierta');
  mkdirSync(preparada, { recursive: true });
  writeFileSync(join(preparada, 'fichas.json'), '{"fichas":[]}');
  const programa = [
    'import json,sys',
    'from pathlib import Path',
    'from datetime import datetime',
    'from plataforma_datos.orquestacion.estado_panel import estado_panel',
    'print(json.dumps(estado_panel(Path(sys.argv[1]),datetime.fromisoformat(sys.argv[2]))))',
  ].join('\n');
  const bytes = execFileSync(join(RAIZ, '.venv/bin/python'), ['-B', '-c', programa, raiz, AHORA], {
    cwd: RAIZ,
    timeout: PLAZO_ESTADO_DATOS_MS,
    maxBuffer: MAX_SALIDA_ESTADO_DATOS_BYTES,
  });
  const salida = await crearLectorEstadoDatosNode(async () => bytes)(new AbortController().signal);
  const documento = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(
    salida.fuentes.map((fuente) => fuente.id),
    documento.fuentes.map((fuente: { id: string }) => fuente.id),
  );
  assert.deepEqual(
    salida.modulos.map((modulo) => modulo.id),
    documento.modulos.map((modulo: { id: string }) => modulo.id),
  );
  assert.ok(salida.fuentes.some((fuente) => fuente.id === 'enlaces_lecturas'));
  assert.ok(salida.modulos.some((modulo) => modulo.id === 'enlaces_lecturas'));
  assert.ok(Object.isFrozen(salida));
});
test('instalación portable usa ejecutable/argv/cwd fijos y entorno mínimo sin secretos', async () => {
  const secreto = process.env.FARO_ESTADO_PRUEBA;
  process.env.FARO_ESTADO_PRUEBA = 'sintetico-no-heredar';
  try {
    await instalacion(
      `writeFileSync('metadatos',JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),env:Object.keys(process.env)}));console.log(${JSON.stringify(salidaValida())});`,
      async (leer, dir) => {
        assert.equal((await leer(new AbortController().signal)).observadoEn, AHORA);
        const meta = JSON.parse(readFileSync(join(dir, 'metadatos'), 'utf8'));
        assert.equal(meta.cwd, dir);
        assert.deepEqual(meta.args, ['-m', 'plataforma_datos.orquestacion.estado_panel']);
        assert.equal(
          meta.env.some((nombre: string) => /FARO|CEREBRO|PYTHONPATH|PYTHONHOME/.test(nombre)),
          false,
        );
        comprobarRecolectado(dir);
      },
    );
  } finally {
    if (secreto === undefined) {
      delete process.env.FARO_ESTADO_PRUEBA;
    } else {
      process.env.FARO_ESTADO_PRUEBA = secreto;
    }
  }
});
test('salida inválida/noUTF8/código no cero/stderr no se reflejan y el hijo queda recolectado', async () => {
  for (const programa of [
    "console.log('{')",
    'process.stdout.write(Buffer.from([255]))',
    "process.stderr.write('secreto-sintetico');process.exit(1)",
    "console.log('{}')",
  ]) {
    await instalacion(programa, async (leer, dir) => {
      await assert.rejects(leer(new AbortController().signal), {
        message: 'El estado de los datos no está disponible',
      });
      comprobarRecolectado(dir);
    });
  }
});
test('salida excesiva se corta sin esperar al plazo y no deja proceso', async () => {
  await instalacion(
    `process.stdout.write('x'.repeat(${MAX_SALIDA_ESTADO_DATOS_BYTES + 1}));setInterval(()=>{},1000);`,
    async (leer, dir) => {
      const inicio = Date.now();
      await assert.rejects(leer(new AbortController().signal));
      assert.ok(Date.now() - inicio < PLAZO_ESTADO_DATOS_MS);
      comprobarRecolectado(dir);
    },
  );
});
test('timeout 3 s mata solo hijo propio y espera su cierre incluso si ignora SIGTERM', {
  timeout: PLAZO_ESTADO_DATOS_MS + MARGEN_PRUEBA_MS,
}, async () => {
  await instalacion("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)", async (leer, dir) => {
    await assert.rejects(leer(new AbortController().signal));
    comprobarRecolectado(dir);
  });
});
test('cancelación antes de consulta no crea hijo; durante consulta mata y recolecta', async () => {
  await instalacion('setInterval(()=>{},1000)', async (leer, dir) => {
    const previa = new AbortController();
    previa.abort();
    await assert.rejects(leer(previa.signal));
    assert.equal(existsSync(join(dir, 'pid')), false);
    const retirada = new AbortController();
    const resultado = leer(retirada.signal);
    await arrancado(dir);
    retirada.abort();
    await assert.rejects(resultado);
    comprobarRecolectado(dir);
  });
});

test('ejecutable ausente falla neutro sin proceso nuevo', async () => {
  await instalacion('', async (leer, dir) => {
    rmSync(join(dir, '.venv', 'bin', 'python'));
    await assert.rejects(leer(new AbortController().signal), { message: 'El estado de los datos no está disponible' });
    assert.equal(existsSync(join(dir, 'pid')), false);
  });
});

test('un fallo se registra con su fase, sin reflejar el error privado ni la salida del proceso', async (t) => {
  const registro = t.mock.method(console, 'error', () => {});
  const fallo = new Error('credencial-sintética-que-no-debe-salir');
  for (const consulta of [
    async () => {
      throw fallo;
    },
    async () => Buffer.from('{salida-privada'),
  ]) {
    await assert.rejects(crearLectorEstadoDatosNode(consulta)(new AbortController().signal), {
      message: 'El estado de los datos no está disponible',
    });
  }
  assert.deepEqual(
    registro.mock.calls.map((c) => c.arguments),
    [
      ['Faro: el estado de los datos no está disponible.', { fase: 'ejecución' }],
      ['Faro: el estado de los datos no está disponible.', { fase: 'validación de la salida' }],
    ],
  );
});
