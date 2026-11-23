/** Fallos reales de lectura y autoridad privada; nunca se inventa recuperación o pulso. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
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
import { DatabaseSync } from 'node:sqlite';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ErrorLecturaLocalVigilante,
  ejecutarVigilanteConLecturaLocal,
  ejecutarVigilanteLocal,
} from '../../herramientas/mantenimiento/vigilante.ts';
import { prepararVigilanteSqlite } from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';
import { baseVigilante, CONFIG_VIGILANTE, CORTE_VIGILANTE } from '../ayudas/vigilante.ts';

/** La declaración de servidor de cada extensión del registro, que la copia necesita para importar el registro. */
const SERVIDORES_DE_EXTENSIONES = EXTENSIONES.map(({ entrada }) => `web/${dirname(entrada)}/servidor`);

const MODO_ARCHIVO = 0o600;
const MODO_DIRECTORIO = 0o700;
const CODIGO_FALLO_TECNICO = 2;
const DESPUES_DE_RECUPERAR = 3;
const MAX_FECHA_MS = 8_640_000_000_000_000;
const PLAZO_CLI_MS = 5000;
const ADELANTO_DTO_MS = 1000;
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
async function archivos(t: TestContext) {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'Vigilante fallo Año 2026 '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  chmodSync(dir, MODO_DIRECTORIO);
  const base = join(dir, 'autoridad.sqlite'),
    config = join(dir, 'configuracion.json');
  f.db.prepare('VACUUM INTO ?').run(base);
  chmodSync(base, MODO_ARCHIVO);
  writeFileSync(config, JSON.stringify(CONFIG_VIGILANTE), { mode: MODO_ARCHIVO });
  return { dir, base, config, args: ['verificar-local', base, config] };
}
function historial(f: Awaited<ReturnType<typeof archivos>>, ahora: number) {
  const r = ejecutarVigilanteLocal(['historial', f.base, f.config], {}, () => ahora).resultado;
  assert.ok('decisiones' in r && 'siguiente' in r);
  return r;
}
function autoridades(base: string) {
  const db = new DatabaseSync(base, { readOnly: true });
  try {
    return JSON.stringify(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'administracion_vigilante%' ORDER BY name",
        )
        .all()
        .map(({ name }) => {
          assert.ok(typeof name === 'string' && /^[a-z_]+$/u.test(name));
          return [name, db.prepare(`SELECT * FROM ${name}`).all()];
        }),
    );
  } finally {
    db.close();
  }
}

test('fallo del lector se registra con origen local y conserva causas y autoridad de trabajos', async (t) => {
  const f = await archivos(t),
    antes = autoridades(f.base),
    causa = new Error('fallo sintético privado');
  ejecutarVigilanteLocal(['verificar', f.base, f.config], {}, () => CORTE_VIGILANTE);
  await assert.rejects(
    ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE + 1, {
      leerEstadoDatos: async () => {
        throw causa;
      },
    }),
    { cause: causa },
  );
  const historia = historial(f, CORTE_VIGILANTE + 1);
  const fallo = historia.decisiones.find((d) => d.clave === 'lectura-local');
  assert.equal(fallo?.estado, 'incidencia');
  assert.equal(fallo?.origen, 'lectura-local');
  assert.equal(autoridades(f.base), antes);
  const recibo = ejecutarVigilanteLocal(['verificar', f.base, f.config], {}, () => CORTE_VIGILANTE + 2);
  assert.ok('incidencias' in recibo.resultado && recibo.resultado.incidencias.some((d) => d.clave === 'lectura-local'));
  const recuperacion = await ejecutarVigilanteConLecturaLocal(
    f.args,
    {},
    () => CORTE_VIGILANTE + DESPUES_DE_RECUPERAR,
    {
      leerEstadoDatos: async () => instantaneaSalud(),
    },
  );
  assert.ok('incidencias' in recuperacion.resultado);
  assert.equal(
    recuperacion.resultado.incidencias.some((d) => d.clave === 'lectura-local'),
    false,
  );
  assert.ok(recuperacion.resultado.incidencias.some((d) => d.clave === 'lectura-datos'));
  const bytes = readFileSync(f.base);
  await ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE + DESPUES_DE_RECUPERAR, {
    leerEstadoDatos: async () => instantaneaSalud(),
  });
  assert.deepEqual(readFileSync(f.base), bytes);
});

test('base ausente, corrupta o bloqueada no crea autoridad ni ejecuta el lector', async (t) => {
  const f = await archivos(t);
  const inexistente = join(f.dir, 'ausente.sqlite'),
    corrupta = join(f.dir, 'corrupta.sqlite');
  writeFileSync(corrupta, 'no es una base SQLite', { mode: MODO_ARCHIVO });
  const vacia = join(f.dir, 'vacia.sqlite'),
    sinPreparar = join(f.dir, 'sin-preparar.sqlite');
  writeFileSync(vacia, '', { mode: MODO_ARCHIVO });
  const sqlite = new DatabaseSync(sinPreparar);
  sqlite.exec('CREATE TABLE ajena (id INTEGER)');
  sqlite.close();
  let lecturas = 0;
  for (const base of [inexistente, corrupta, vacia, sinPreparar]) {
    const antes = existsSync(base) ? readFileSync(base) : null;
    await assert.rejects(
      ejecutarVigilanteConLecturaLocal(['verificar-local', base, f.config], {}, () => CORTE_VIGILANTE, {
        leerEstadoDatos: async () => {
          lecturas++;
          return instantaneaSalud();
        },
      }),
    );
    if (antes === null) {
      assert.equal(existsSync(base), false);
    } else {
      assert.deepEqual(readFileSync(base), antes);
    }
  }
  const bloqueo = new DatabaseSync(f.base);
  try {
    bloqueo.exec('BEGIN EXCLUSIVE');
    await assert.rejects(
      ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE, {
        leerEstadoDatos: async () => {
          lecturas++;
          return instantaneaSalud();
        },
      }),
    );
  } finally {
    bloqueo.exec('ROLLBACK');
    bloqueo.close();
  }
  assert.equal(lecturas, 0);
});

test('reloj inválido anterior no consulta; reloj inválido posterior no guarda una lectura ni una recuperación', async (t) => {
  const f = await archivos(t),
    antes = readFileSync(f.base);
  let lecturas = 0;
  for (const ahora of [NaN, Infinity, -1, MAX_FECHA_MS + 1]) {
    await assert.rejects(
      ejecutarVigilanteConLecturaLocal(f.args, {}, () => ahora, {
        leerEstadoDatos: async () => {
          lecturas++;
          return instantaneaSalud();
        },
      }),
    );
  }
  assert.equal(lecturas, 0);
  let ahora = CORTE_VIGILANTE;
  await assert.rejects(
    ejecutarVigilanteConLecturaLocal(f.args, {}, () => ahora, {
      leerEstadoDatos: async () => {
        ahora = NaN;
        return instantaneaSalud();
      },
    }),
  );
  assert.deepEqual(readFileSync(f.base), antes);
});

test('fallo al registrar fallo conserva la causa original y no confirma una evaluación', async (t) => {
  const f = await archivos(t),
    antes = readFileSync(f.base),
    causa = new Error('lectura fallida');
  const bloqueo = new DatabaseSync(f.base);
  try {
    await assert.rejects(
      ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE, {
        leerEstadoDatos: async () => {
          bloqueo.exec('BEGIN EXCLUSIVE');
          throw causa;
        },
      }),
      (error: unknown) =>
        error instanceof AggregateError && error.cause === causa && error.errors.length === CODIGO_FALLO_TECNICO,
    );
  } finally {
    bloqueo.exec('ROLLBACK');
    bloqueo.close();
  }
  assert.deepEqual(readFileSync(f.base), antes);
});

test('CLI diferencia fallo propio de incidencia sin leer datos reales', async (t) => {
  const f = await archivos(t);
  for (const ruta of [
    'src',
    'compartido',
    'datos/nombres.json',
    'config/identidad-web.json',
    'web/terceros/noble/hashes',
    'herramientas/mantenimiento/vigilante.ts',
    ...SERVIDORES_DE_EXTENSIONES,
  ]) {
    mkdirSync(dirname(join(f.dir, ruta)), { recursive: true });
    cpSync(join(RAIZ, ruta), join(f.dir, ruta), { recursive: true });
  }
  writeFileSync(join(f.dir, 'package.json'), '{"type":"module"}');
  mkdirSync(join(f.dir, '.venv/bin'), { recursive: true });
  writeFileSync(
    join(f.dir, '.venv/bin/python'),
    `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(instantaneaSalud()))});`,
    { mode: MODO_DIRECTORIO },
  );
  const cli = join(f.dir, 'herramientas/mantenimiento/vigilante.ts');
  const fallo = spawnSync(process.execPath, [cli, 'verificar-local', join(f.dir, 'ausente.sqlite'), f.config], {
    cwd: '/',
    env: { TMPDIR: f.dir },
    encoding: 'utf8',
    timeout: PLAZO_CLI_MS,
  });
  assert.equal(fallo.status, CODIGO_FALLO_TECNICO);
  assert.match(fallo.stderr, /no se confirma recuperación/u);
});

test('DTO temporalmente futuro registra fallo local sin resolver el recibo ni tocar trabajos', async (t) => {
  const f = await archivos(t);
  await ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE, {
    leerEstadoDatos: async () => instantaneaSalud(),
  });
  const antes = autoridades(f.base);
  await assert.rejects(
    ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE + 1, {
      leerEstadoDatos: async () =>
        instantaneaSalud({
          observadoEn: new Date(CORTE_VIGILANTE + ADELANTO_DTO_MS).toISOString().replace('.000Z', 'Z'),
        }),
    }),
    (error: unknown) =>
      error instanceof ErrorLecturaLocalVigilante && error.codigo === 2 && error.cause instanceof Error,
  );
  const h = historial(f, CORTE_VIGILANTE + 1);
  assert.equal(h.decisiones.filter((d) => d.clave === 'lectura-local').at(-1)?.estado, 'incidencia');
  assert.equal(autoridades(f.base), antes);
});
