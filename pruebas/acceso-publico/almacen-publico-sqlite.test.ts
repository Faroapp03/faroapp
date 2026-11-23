import assert from 'node:assert/strict';
import { linkSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { huellaDelSecreto, type Socio, secretoNuevo } from '../../src/api/socios/registro.ts';
import { RevocacionesLlenas } from '../../src/api/socios/revocaciones.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido, socioPersistido } from '../ayudas/registro-persistido-anterior.ts';

const INSTANTE_INICIAL_MS = 10_000;
const CARACTERES_HUELLA = 64;
const CARACTERES_JTI = 22;
const MASCARA_PERMISOS = 0o777;
const MODO_ARCHIVO = 0o600;
const MODO_DIRECTORIO = 0o700;
const CADUCA_ORIGINAL_S = 100;
const CADUCA_MENOR_S = 50;
const CAMBIO_DE_VENTANA_MS = 11_000;
const CUOTA_NUEVA = 4;
const FECHA_REVOCACION_S = 20;
const FECHA_MENOR_S = 15;
const FECHA_EXTENDIDA_S = 25;
const FECHA_OTRO_S = 30;
const FECHA_INVALIDA_S = 40;
const ANTES_CADUCIDAD_MS = 16_000;
const DESPUES_CADUCIDAD_MS = 21_000;
const CADUCIDAD_EXTENDIDA_MS = 25_000;

const socio = (id = 'pub-uno'): Socio => ({
  id,
  huellas: ['a'.repeat(CARACTERES_HUELLA)],
  consultasPorHora: 10,
});
const cuenta = (clave = 'consultas:global', limite = 2, ventanaMs = 1000) => ({ clave, limite, ventanaMs });
function temporal(): string {
  return mkdtempSync(join(realpathSync(tmpdir()), 'faro-publico-'));
}
function motor(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = accion();
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('SQLite conserva registros anteriores, cuotas y revocación entre conexiones y reinicio sin secretos', async () => {
  const secreto = secretoNuevo(),
    guardado = { ...socio(), huellas: [huellaDelSecreto(secreto)] };
  const dir = temporal(),
    archivo = join(dir, 'privado', 'registro.sqlite');
  const opciones = { archivo, maxClientes: 2, ahora: () => INSTANTE_INICIAL_MS };
  const uno = crearAlmacenPublicoNode(opciones),
    dos = crearAlmacenPublicoNode(opciones);
  const observador = new DatabaseSync(archivo);
  try {
    assert.equal(observador.prepare("SELECT name FROM sqlite_master WHERE name='publico_socios'").get(), undefined);
    sembrarSocioPersistido(observador, guardado);
    observador.exec('UPDATE publico_estado SET abierto=1');
    assert.equal(await uno.consumir([cuenta()]), true);
    assert.equal(await dos.consumir([cuenta()]), true);
    assert.equal(await uno.consumir([cuenta()]), false);
    await uno.revocar('a'.repeat(CARACTERES_JTI), CADUCA_ORIGINAL_S);
    await dos.revocar('a'.repeat(CARACTERES_JTI), CADUCA_MENOR_S);
    assert.equal(await dos.revocado('a'.repeat(CARACTERES_JTI)), true);
    assert.equal(lstatSync(archivo).mode & MASCARA_PERMISOS, MODO_ARCHIVO);
    assert.equal(lstatSync(join(dir, 'privado')).mode & MASCARA_PERMISOS, MODO_DIRECTORIO);
  } finally {
    observador.close();
    uno.close();
    dos.close();
  }
  const reabierto = crearAlmacenPublicoNode(opciones),
    db = new DatabaseSync(archivo, { readOnly: true });
  try {
    assert.deepEqual(socioPersistido(db, guardado.id), guardado);
    assert.equal(db.prepare('SELECT abierto FROM publico_estado').get()?.abierto, 1);
    assert.equal(await reabierto.consumir([cuenta()]), false);
    assert.equal(await reabierto.revocado('a'.repeat(CARACTERES_JTI)), true);
    const texto = readFileSync(archivo).toString('latin1');
    assert(!texto.includes('client_secret'));
    assert(!texto.includes(secreto));
    assert.throws(() => crearAlmacenPublicoNode({ ...opciones, maxClientes: 3 }));
  } finally {
    db.close();
    reabierto.close();
    rmSync(dir, { recursive: true });
  }
});

test('multicontador atómico, ventanas persistentes, políticas y cardinalidad fallan cerrado', async () => {
  const dir = temporal();
  let ahora = 10_000;
  const opciones = {
    archivo: join(dir, 'registro.sqlite'),
    maxClientes: 2,

    maxContadores: 2,
    ahora: () => ahora,
  };
  let almacen = crearAlmacenPublicoNode(opciones);
  try {
    assert.equal(await almacen.consumir([cuenta(), cuenta('consultas:cliente:pub-uno', 1)]), true);
    assert.equal(await almacen.consumir([cuenta(), cuenta('consultas:cliente:pub-uno', 1)]), false);
    // El rechazo anterior no consumió el segundo y último hueco global.
    assert.equal(await almacen.consumir([cuenta()]), true);
    assert.equal(await almacen.consumir([cuenta()]), false);
    assert.equal(await almacen.consumir([cuenta('credenciales:global')]), false);
    assert.equal(await almacen.consumir([cuenta('consultas:cliente:pub-uno', CUOTA_NUEVA)]), false);
    almacen.close();
    almacen = crearAlmacenPublicoNode(opciones);
    assert.equal(await almacen.consumir([cuenta()]), false);
    ahora = CAMBIO_DE_VENTANA_MS;
    assert.equal(await almacen.consumir([cuenta('credenciales:global')]), true);
    assert.equal(await almacen.consumir([cuenta()]), true);
    assert.equal(await almacen.consumir([cuenta('credenciales:global')]), true);
    assert.equal(await almacen.consumir([cuenta('credenciales:global')]), false);
  } finally {
    almacen.close();
    rmSync(dir, { recursive: true });
  }
});

test('rechaza cuentas repetidas, IP, secretos, cuotas y campos ajenos', async () => {
  const db = new DatabaseSync(':memory:');
  const almacen = new AlmacenPublicoSqlite(motor(db), { maxClientes: 2 });
  try {
    for (const cuentas of [
      [],
      [cuenta(), cuenta()],
      [cuenta('consultas:cliente:192.0.2.1')],
      [cuenta('credenciales:cliente:secreto')],
      [{ ...cuenta(), secreto: 'no guardar' }],
      [cuenta('consultas:global', 0)],
      [cuenta('consultas:global', 1, Infinity)],
      [{ ...cuenta(), secreto: 'no guardar' }],
    ]) {
      await assert.rejects(almacen.consumir(cuentas));
    }
  } finally {
    db.close();
  }
});

test('error SQL revierte todos los contadores y nunca degrada a memoria', async () => {
  const db = new DatabaseSync(':memory:');
  const original = motor(db);
  let romper = false;
  let inserciones = 0;
  const almacen = new AlmacenPublicoSqlite(
    {
      ...original,
      ejecutar: (sql, ...valores) => {
        if (romper && sql.startsWith('INSERT INTO publico_contadores') && ++inserciones === 2) {
          throw new Error('fallo sintético');
        }
        original.ejecutar(sql, ...valores);
      },
    },
    { maxClientes: 2 },
  );
  try {
    romper = true;
    await assert.rejects(almacen.consumir([cuenta(), cuenta('credenciales:global')]));
    assert.equal(db.prepare('SELECT count(*) AS n FROM publico_contadores').get()?.n, 0);
    romper = false;
    assert.equal(await almacen.consumir([cuenta(), cuenta('credenciales:global')]), true);
    db.exec('DROP TABLE publico_estado');
    await assert.rejects(almacen.consumir([cuenta()]));
  } finally {
    db.close();
  }
});

test('revocaciones conservan el plazo mayor, purgan y deniegan capacidad sin perder las anteriores', async () => {
  const db = new DatabaseSync(':memory:');
  let ahora = 10_000;
  const almacen = new AlmacenPublicoSqlite(motor(db), {
    maxClientes: 1,

    maxRevocaciones: 1,
    ahora: () => ahora,
  });
  try {
    await almacen.revocar('a'.repeat(CARACTERES_JTI), FECHA_REVOCACION_S);
    await almacen.revocar('a'.repeat(CARACTERES_JTI), FECHA_MENOR_S);
    await assert.rejects(almacen.revocar('b'.repeat(CARACTERES_JTI), FECHA_OTRO_S), RevocacionesLlenas);
    ahora = ANTES_CADUCIDAD_MS;
    assert.equal(await almacen.revocado('a'.repeat(CARACTERES_JTI)), true);
    await almacen.revocar('a'.repeat(CARACTERES_JTI), FECHA_EXTENDIDA_S);
    ahora = DESPUES_CADUCIDAD_MS;
    assert.equal(await almacen.revocado('a'.repeat(CARACTERES_JTI)), true);
    ahora = CADUCIDAD_EXTENDIDA_MS;
    assert.equal(await almacen.revocado('a'.repeat(CARACTERES_JTI)), false);
    await almacen.revocar('b'.repeat(CARACTERES_JTI), FECHA_OTRO_S);
    assert.equal(await almacen.revocado('b'.repeat(CARACTERES_JTI)), true);
    await assert.rejects(almacen.revocar('dato-personal', FECHA_INVALIDA_S));
  } finally {
    db.close();
  }
});

test('Node rechaza symlinks, enlaces duros, rutas relativas y archivos dentro de web', () => {
  const dir = temporal();
  const opciones = { maxClientes: 1 };
  try {
    const real = crearAlmacenPublicoNode({ ...opciones, archivo: join(dir, 'original.sqlite') });
    real.close();
    symlinkSync(join(dir, 'original.sqlite'), join(dir, 'enlace.sqlite'));
    symlinkSync(dir, join(dir, 'directorio'));
    symlinkSync(join(dir, 'original.sqlite'), join(dir, 'otro.sqlite-journal'));
    assert.throws(() => crearAlmacenPublicoNode({ ...opciones, archivo: join(dir, 'otro.sqlite') }));
    linkSync(join(dir, 'original.sqlite'), join(dir, 'duro.sqlite'));
    assert.throws(() => crearAlmacenPublicoNode({ ...opciones, archivo: join(dir, 'duro.sqlite') }));
    assert.throws(() => crearAlmacenPublicoNode({ ...opciones, archivo: join(dir, 'enlace.sqlite') }));
    assert.throws(() => crearAlmacenPublicoNode({ ...opciones, archivo: join(dir, 'directorio', 'otro.sqlite') }));
    assert.throws(() => crearAlmacenPublicoNode({ ...opciones, archivo: 'relativo.sqlite' }));
    assert.throws(() =>
      crearAlmacenPublicoNode({
        ...opciones,
        archivo: fileURLToPath(new URL('../../web/registro.sqlite', import.meta.url)),
      }),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

/** El resultado de un Worker debe esperar también su cierre antes de limpiar sus archivos. */
function resultadoDelWorker(worker: Worker): Promise<number> {
  return new Promise((resolver, rechazar) => {
    let numero: number | undefined;
    let fallo: unknown;
    worker.on('message', (n: number) => {
      numero = n;
    });
    worker.on('error', (error) => {
      fallo = error;
    });
    worker.on('exit', (codigo) =>
      codigo === 0 && numero !== undefined
        ? resolver(numero)
        : rechazar(fallo ?? new Error('Worker de prueba no terminó bien')),
    );
  });
}

test('dos conexiones SQLite desde Workers comparten el último hueco global sin excederlo', async () => {
  const dir = temporal();
  const opciones = { archivo: join(dir, 'registro.sqlite'), maxClientes: 1 };
  const almacen = crearAlmacenPublicoNode(opciones);
  almacen.close();
  const modulo = new URL('../../src/plataforma/acceso-publico/node.ts', import.meta.url).href;
  const ejecutar = (): Promise<number> => {
    const worker = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads');
      import(workerData.modulo).then(async ({crearAlmacenPublicoNode})=>{
        const a=crearAlmacenPublicoNode(workerData.opciones);let n=0;
        try{for(let i=0;i<20;i++) if(await a.consumir([{clave:'consultas:global',limite:10,ventanaMs:86400000}])) n++;}
        finally{a.close();} parentPort.postMessage(n);parentPort.close();
      }).catch(e=>{throw e;});`,
      { eval: true, workerData: { modulo, opciones } },
    );
    return resultadoDelWorker(worker);
  };
  const ejecuciones = [ejecutar(), ejecutar()];
  try {
    const resultados = await Promise.all(ejecuciones);
    assert.equal(
      resultados.reduce((suma, valor) => suma + valor, 0),
      10,
    );
  } finally {
    await Promise.allSettled(ejecuciones);
    rmSync(dir, { recursive: true });
  }
});

test('metadatos perdidos no reinician cuotas al reabrir', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  const opciones = { maxClientes: 1 };
  const almacen = new AlmacenPublicoSqlite(sql, opciones);
  try {
    await almacen.consumir([cuenta()]);
    db.exec('DELETE FROM publico_estado');
    assert.throws(() => new AlmacenPublicoSqlite(sql, opciones));
    assert.equal(db.prepare('SELECT count(*) AS n FROM publico_estado').get()?.n, 0);
  } finally {
    db.close();
  }
});

test('purga indexada acotada y caducidad de una clave fuera del primer lote', async () => {
  const db = new DatabaseSync(':memory:');
  const total = 260;
  const finVentana = 1000;
  const purgadosPorLote = 256;
  let ahora = 0;
  const almacen = new AlmacenPublicoSqlite(motor(db), {
    maxClientes: 1,

    maxContadores: total,
    ahora: () => ahora,
  });
  try {
    for (let i = 0; i < total; i++) {
      assert.equal(await almacen.consumir([cuenta(`consultas:cliente:pub-${i}`, 1)]), true);
    }
    ahora = finVentana;
    const ultimaClave = `consultas:cliente:pub-${total - 1}`;
    assert.equal(await almacen.consumir([cuenta(ultimaClave, 1)]), true);
    const caducados = db.prepare('SELECT count(*) AS n FROM publico_contadores WHERE caduca<=?').get(ahora)?.n;
    assert.equal(caducados, total - purgadosPorLote - 1);
    assert.equal(await almacen.consumir([cuenta(ultimaClave, 1)]), false);
    assert.equal(db.prepare('SELECT count(*) AS n FROM publico_contadores WHERE caduca<=?').get(ahora)?.n, 0);
  } finally {
    db.close();
  }
});

test('consumir solo cuenta cardinalidad si necesita crear contadores y conserva el límite lleno', async (prueba) => {
  prueba.mock.method(console, 'warn', () => {});
  const db = new DatabaseSync(':memory:');
  const original = motor(db);
  let recuentos = 0;
  const sql: SqlAccesoPublico = {
    ...original,
    filas: (sentencia, ...valores) => {
      if (sentencia === 'SELECT count(*) AS numero FROM publico_contadores') {
        recuentos++;
      }
      return original.filas(sentencia, ...valores);
    },
  };
  const almacen = new AlmacenPublicoSqlite(sql, {
    maxClientes: 1,

    maxContadores: 1,
    ahora: () => INSTANTE_INICIAL_MS,
  });
  try {
    assert.equal(await almacen.consumir([cuenta()]), true);
    assert.equal(recuentos, 1);
    recuentos = 0;
    assert.equal(await almacen.consumir([cuenta()]), true);
    assert.equal(recuentos, 0);
    assert.equal(await almacen.consumir([cuenta('credenciales:global')]), false);
    assert.equal(recuentos, 1);
    assert.equal(db.prepare('SELECT usados FROM publico_contadores').get()?.usados, 2);
  } finally {
    db.close();
  }
});

test('el rechazo de un Worker se entrega después de su salida', async () => {
  const worker = new Worker("throw new Error('fallo de Worker controlado');", { eval: true });
  let terminado = false;
  const cierre = new Promise<void>((resolver) => {
    worker.once('exit', () => {
      terminado = true;
      resolver();
    });
  });
  try {
    await assert.rejects(resultadoDelWorker(worker), /fallo de Worker controlado/);
    assert.equal(terminado, true);
  } finally {
    await cierre;
  }
});
