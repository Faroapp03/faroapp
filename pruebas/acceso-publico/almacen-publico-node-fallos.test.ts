/** Un fallo de reversión no puede ocultar la causa de la transacción fallida. */
import assert from 'node:assert/strict';
import fs, {
  closeSync,
  fstatSync,
  linkSync,
  mkdtempSync,
  openSync,
  type PathLike,
  realpathSync,
  rmSync,
  type StatOptions,
  type Stats,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';

const MINUTO_MS = 60_000;

test('la operación conserva ambas causas si COMMIT y ROLLBACK fallan', async (prueba) => {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'faro-transaccion-'));
  const almacen = crearAlmacenPublicoNode({
    archivo: join(carpeta, 'estado.sqlite'),
    maxClientes: 1,
  });
  const original = new Error('fallo sintético de confirmación');
  const reversion = new Error('fallo sintético de reversión');
  const ejecutar = DatabaseSync.prototype.exec;
  const doble = prueba.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
    if (sql === 'COMMIT') {
      throw original;
    }
    if (sql === 'ROLLBACK') {
      throw reversion;
    }
    return ejecutar.call(this, sql);
  });
  try {
    await assert.rejects(
      almacen.consumir([{ clave: 'consultas:global', limite: 1, ventanaMs: MINUTO_MS }]),
      (error: unknown) =>
        error instanceof AggregateError &&
        error.cause === original &&
        error.errors.length === 2 &&
        error.errors[0] === original &&
        error.errors[1] === reversion,
    );
  } finally {
    doble.mock.restore();
    almacen.close();
    rmSync(carpeta, { recursive: true });
  }
});

/** El descriptor conserva metadatos reales del inode después de quitar su último nombre. */
function observarAuxiliarRetirado(carpeta: string): Stats {
  const archivo = join(carpeta, 'auxiliar-retirado');
  const descriptor = openSync(archivo, 'wx');
  try {
    unlinkSync(archivo);
    const estado = fstatSync(descriptor);
    assert.equal(estado.isFile(), true);
    assert.equal(estado.nlink, 0);
    return estado;
  } finally {
    closeSync(descriptor);
  }
}

/** Fija solo la ventana de lstat; la siguiente observación vuelve al sistema de archivos. */
function intercalarRetirada(prueba: TestContext, rutaAuxiliar: string, retirado: Stats, retiradas = 1) {
  const original = fs.lstatSync;
  let observaciones = 0;
  const doble = prueba.mock.method(fs, 'lstatSync', (ruta: PathLike, opciones?: StatOptions) => {
    if (ruta === rutaAuxiliar && observaciones++ < retiradas) {
      return retirado;
    }
    return original(ruta, opciones);
  });
  syncBuiltinESMExports();
  return {
    observaciones: () => observaciones,
    restaurar: () => {
      doble.mock.restore();
      syncBuiltinESMExports();
    },
  };
}

test('un journal retirado durante lstat no impide abrir otra conexión SQLite', (prueba) => {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'faro-journal-retirado-'));
  const archivo = join(carpeta, 'estado.sqlite');
  const opciones = { archivo, maxClientes: 1 };
  crearAlmacenPublicoNode(opciones).close();
  const intercalacion = intercalarRetirada(prueba, `${archivo}-journal`, observarAuxiliarRetirado(carpeta));
  try {
    crearAlmacenPublicoNode(opciones).close();
    assert.equal(intercalacion.observaciones(), 2);
  } finally {
    intercalacion.restaurar();
    rmSync(carpeta, { recursive: true });
  }
});

test('tras retirar un auxiliar se rechaza un reemplazo por enlace simbólico o duro', async (prueba) => {
  for (const sufijo of ['-journal', '-wal', '-shm']) {
    for (const enlazar of [symlinkSync, linkSync]) {
      await prueba.test(`${sufijo}/${enlazar.name}`, (caso) => {
        const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'faro-journal-sustituido-'));
        const archivo = join(carpeta, 'estado.sqlite');
        const original = join(carpeta, 'original.sqlite');
        const opciones = { maxClientes: 1 };
        crearAlmacenPublicoNode({ ...opciones, archivo: original }).close();
        enlazar(original, `${archivo}${sufijo}`);
        const intercalacion = intercalarRetirada(caso, `${archivo}${sufijo}`, observarAuxiliarRetirado(carpeta));
        try {
          assert.throws(() => crearAlmacenPublicoNode({ ...opciones, archivo }), /Archivo auxiliar/);
          assert.equal(intercalacion.observaciones(), 2);
        } finally {
          intercalacion.restaurar();
          rmSync(carpeta, { recursive: true });
        }
      });
    }
  }
});

test('una segunda observación aún sin enlaces falla cerrado y no se consulta indefinidamente', (prueba) => {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'faro-journal-inestable-'));
  const archivo = join(carpeta, 'estado.sqlite');
  const intercalacion = intercalarRetirada(prueba, `${archivo}-journal`, observarAuxiliarRetirado(carpeta), 2);
  try {
    assert.throws(() => crearAlmacenPublicoNode({ archivo, maxClientes: 1 }), /Archivo auxiliar/);
    assert.equal(intercalacion.observaciones(), 2);
  } finally {
    intercalacion.restaurar();
    rmSync(carpeta, { recursive: true });
  }
});
