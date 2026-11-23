import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  configuracionAdministrativaDelEntorno,
  validarOrigenAdministrativo,
} from '../../src/administracion/configuracion.ts';
import { ADMINISTRADORES_SIN_CONFIGURAR } from '../../src/administracion/configuracion-administradores.ts';
import { leerDocumentoControles, type PoliticaControles } from '../../src/administracion/controles.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = 10_000;
const TAM_HUELLA = 64;
const JTI_TAM = 22;
const CADUCA_S = 100;
const MINUTO = 60_000;
const PLAZO_CONCURRENCIA_MS = 5000;
const CONFIGURACION = {
  FARO_ADMINISTRACION: 'si',
  FARO_ADMIN_ORIGEN: 'https://faro.prueba',
  FARO_SECRETO_FIRMA: 'secreto-sintetico-estable-solo-para-pruebas',
};
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
};
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
function motor(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const salida = accion();
        db.exec('COMMIT');
        return salida;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
async function conBase(
  accion: (db: DatabaseSync, sql: SqlAccesoPublico, publico: AlmacenPublicoSqlite) => Promise<void>,
) {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  try {
    await accion(db, sql, new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => AHORA }));
  } finally {
    db.close();
  }
}
function instantanea(db: DatabaseSync) {
  const esquema = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return esquema.map((fila) => ({ esquema: fila, filas: db.prepare(`SELECT * FROM ${fila.name} ORDER BY 1`).all() }));
}
function publicoOriginal(db: DatabaseSync) {
  return {
    metadata: db.prepare('SELECT id,version,abierto,clientes,contadores,revocaciones FROM publico_estado').all(),
    tablas: ['publico_socios', 'publico_contadores', 'publico_revocados'].map((t) =>
      db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(),
    ),
  };
}

test('configuración exige habilitación exacta, origen seguro y secreto estable, sin permisos IA ni registro', () => {
  assert.equal(configuracionAdministrativaDelEntorno({}), null);
  assert.equal(
    configuracionAdministrativaDelEntorno({ FARO_ADMINISTRACION: 'no', FARO_ADMIN_ORIGEN: 'inválido' }),
    null,
  );
  for (const FARO_ADMINISTRACION of ['', 'SI', 'true', '1', ' si']) {
    assert.throws(() => configuracionAdministrativaDelEntorno({ ...CONFIGURACION, FARO_ADMINISTRACION }));
  }
  for (const FARO_SECRETO_FIRMA of [undefined, '', 'corta']) {
    assert.throws(
      () => configuracionAdministrativaDelEntorno({ ...CONFIGURACION, FARO_SECRETO_FIRMA }),
      /FARO_SECRETO_FIRMA/,
    );
  }
  assert.deepEqual(
    configuracionAdministrativaDelEntorno({
      ...CONFIGURACION,
      FARO_API_SOCIOS: 'no',
    }),
    { origen: 'https://faro.prueba', permitirHttpLocal: false, administradores: ADMINISTRADORES_SIN_CONFIGURAR },
  );
});

test('origen compartido conserva contrato: canónico, HTTPS o loopback HTTP explícito, sin secretos en errores', () => {
  for (const origen of [
    'http://faro.prueba',
    'http://localhost:8787',
    'https://faro.prueba/',
    'https://faro.prueba?',
    'https://faro.prueba#',
    'https://NO-REFLEJAR:secreto@faro.prueba',
    'inválido',
  ]) {
    assert.throws(
      () => validarOrigenAdministrativo(origen),
      (error: unknown) => error instanceof Error && !error.message.includes('NO-REFLEJAR'),
    );
  }
  for (const origen of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
    assert.equal(validarOrigenAdministrativo(origen, true), origen);
  }
  assert.deepEqual(
    configuracionAdministrativaDelEntorno(
      { ...CONFIGURACION, FARO_ADMIN_ORIGEN: 'http://localhost:8787' },
      { permitirHttpLocal: true },
    ),
    { origen: 'http://localhost:8787', permitirHttpLocal: true, administradores: ADMINISTRADORES_SIN_CONFIGURAR },
  );
});

test('preparación única adopta ambos componentes sin reabrir altas ni alterar credenciales, cuotas o revocados', () =>
  conBase(async (db, sql, publico) => {
    sembrarSocioPersistido(db, { id: 'pub-uno', huellas: ['f'.repeat(TAM_HUELLA)], consultasPorHora: 1 });
    await publico.consumir([{ clave: 'consultas:global', limite: 1, ventanaMs: MINUTO }]);
    await publico.revocar('a'.repeat(JTI_TAM), CADUCA_S);
    db.exec('UPDATE publico_estado SET abierto=0');
    const antes = publicoOriginal(db);
    const panel = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
    const documento = await panel.prepararPanel(POLITICA);
    assert.deepEqual(documento, { ...POLITICA, api: 'habilitada', revision: 0 });
    assert.deepEqual(await panel.comprobarSesion(ACCESO), { estado: 'cerrada' });
    assert.deepEqual(publicoOriginal(db), antes);
    assert.equal(db.prepare('SELECT abierto FROM publico_estado').get()?.abierto, 0);
  }));

test('migración legítima desde controles 64 preserva revisión y política existente', () =>
  conBase(async (db, sql, publico) => {
    await publico.activarControles(POLITICA);
    const vigente = await publico.cambiarControles(0, { ...POLITICA, mcp: true });
    const panel = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
    assert.deepEqual(await panel.prepararPanel({ ...POLITICA, api: 'deshabilitada' }), vigente.controles);
    assert.equal(db.prepare('SELECT count(*) AS n FROM administracion_sesion').get()?.n, 1);
  }));

test('repetir desde dos conexiones y reiniciar conserva sesión activa, revisión y reloj exactamente', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-preparacion-'));
  const archivo = join(dir, 'panel.sqlite');
  const a = new DatabaseSync(archivo);
  const b = new DatabaseSync(archivo);
  try {
    const sql = motor(a);
    new AlmacenPublicoSqlite(sql, { maxClientes: 1 });
    const panel = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
    const segundo = new AlmacenSesionPanelSqlite(motor(b), { ahora: () => AHORA + MINUTO });
    const preparados = await Promise.all([panel.prepararPanel(POLITICA), segundo.prepararPanel(POLITICA)]);
    assert.deepEqual(preparados[0], preparados[1]);
    await abrirSesionDePrueba(panel, ACCESO);
    await panel.cambiarControlesDeSesion(ACCESO, 0, { ...POLITICA, mcp: true });
    const antes = instantanea(a);
    const documento = await segundo.prepararPanel(POLITICA);
    assert.equal(documento.revision, 1);
    assert.deepEqual(instantanea(a), antes);
    assert.equal((await segundo.comprobarSesion(ACCESO)).estado, 'activa');
  } finally {
    a.close();
    b.close();
  }
  const reinicio = new DatabaseSync(archivo);
  try {
    const antes = instantanea(reinicio);
    await new AlmacenSesionPanelSqlite(motor(reinicio), { ahora: () => AHORA + MINUTO }).prepararPanel(POLITICA);
    assert.deepEqual(instantanea(reinicio), antes);
  } finally {
    reinicio.close();
    rmSync(dir, { recursive: true });
  }
});

const CORRUPCIONES = [
  'DROP TABLE administracion_sesion',
  'DELETE FROM administracion_sesion',
  'UPDATE publico_estado SET sesion_panel_version=0',
  'ALTER TABLE publico_estado DROP COLUMN sesion_panel_version',
  "UPDATE administracion_sesion SET huella_sesion='token-en-claro'",
  'UPDATE administracion_sesion SET actividad=iniciada-1',
  'DROP TABLE administracion_controles',
  'DELETE FROM administracion_controles',
  'UPDATE publico_estado SET controles_version=0',
  'ALTER TABLE publico_estado DROP COLUMN controles_version',
  "UPDATE administracion_controles SET documento='{}'",
  'DELETE FROM publico_estado',
];
for (const corrupcion of CORRUPCIONES) {
  test(`preparar no repara ni sobrescribe estado incompleto: ${corrupcion}`, () =>
    conBase(async (db, sql) => {
      const panel = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
      await panel.prepararPanel(POLITICA);
      await abrirSesionDePrueba(panel, ACCESO);
      db.exec(corrupcion);
      const antes = instantanea(db);
      await assert.rejects(panel.prepararPanel(POLITICA));
      assert.deepEqual(instantanea(db), antes);
    }));
}

test('fallo a mitad de preparación revierte controles, sesión y metadata juntos; reintento limpio funciona', () =>
  conBase(async (db, sql, publico) => {
    let romper = true;
    const roto: SqlAccesoPublico = {
      ...sql,
      ejecutar: (sentencia, ...valores) => {
        sql.ejecutar(sentencia, ...valores);
        if (romper && sentencia.startsWith('UPDATE publico_estado SET sesion_panel_version')) {
          throw new Error('fallo sintético');
        }
      },
    };
    const panel = new AlmacenSesionPanelSqlite(roto, { ahora: () => AHORA });
    const antes = instantanea(db);
    await assert.rejects(panel.prepararPanel(POLITICA));
    assert.deepEqual(instantanea(db), antes);
    assert.equal(await publico.leerControles(), null);
    romper = false;
    assert.equal((await panel.prepararPanel(POLITICA)).revision, 0);
  }));

test('política inicial o reloj defectuoso rechazan sin tocar instalación nueva o adoptada', () =>
  conBase(async (db, sql) => {
    const panel = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
    const antes = instantanea(db);
    await assert.rejects(panel.prepararPanel({ ...POLITICA, secreto: 'ajeno' } as PoliticaControles));
    assert.deepEqual(instantanea(db), antes);
    await panel.prepararPanel(POLITICA);
    await abrirSesionDePrueba(panel, ACCESO);
    const preparado = instantanea(db);
    for (const ahora of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER, AHORA - 1]) {
      await assert.rejects(new AlmacenSesionPanelSqlite(sql, { ahora: () => ahora }).prepararPanel(POLITICA));
      assert.deepEqual(instantanea(db), preparado);
    }
  }));

// Aislados distintos comparten únicamente SQLite; la barrera fuerza dos comienzos de preparación simultáneos.
function observarTrabajador(worker: Worker, senal: AbortSignal) {
  const listo = Promise.withResolvers<void>();
  const final = Promise.withResolvers<unknown>();
  let preparado = false;
  let documento: unknown;
  const fallar = (error: unknown) => {
    listo.reject(error);
    final.reject(error);
  };
  const retirar = () => fallar(senal.reason);
  senal.addEventListener('abort', retirar, { once: true });
  worker.on('message', (mensaje: unknown) => {
    if (mensaje === 'listo') {
      preparado = true;
      listo.resolve();
    } else {
      documento = mensaje;
    }
  });
  worker.on('error', fallar);
  worker.on('exit', (code) => {
    senal.removeEventListener('abort', retirar);
    if (code !== 0 || !preparado) {
      fallar(new Error('Trabajador de prueba terminó sin completar la preparación'));
    } else {
      final.resolve(documento);
    }
  });
  // Las promesas conservan su rechazo para el await, incluso si el otro trabajador falla antes de esperarlas.
  void listo.promise.catch(() => undefined);
  void final.promise.catch(() => undefined);
  return { worker, listo: listo.promise, final: final.promise };
}
function trabajador(archivo: string, barrera: SharedArrayBuffer, senal: AbortSignal) {
  const modulo = new URL('../../src/plataforma/acceso-publico/sesion-sqlite.ts', import.meta.url).href;
  const codigo = `import { parentPort,workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { AlmacenSesionPanelSqlite } from ${JSON.stringify(modulo)};
const db=new DatabaseSync(workerData.archivo,{timeout:1000});
const sql={filas:(s,...v)=>db.prepare(s).all(...v),ejecutar:(s,...v)=>{db.prepare(s).run(...v)},
transaccion:(f)=>{db.exec('BEGIN IMMEDIATE');try{const r=f();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
parentPort.postMessage('listo');Atomics.wait(new Int32Array(workerData.barrera),0,0);
try{parentPort.postMessage(await new AlmacenSesionPanelSqlite(sql,{ahora:()=>10000}).prepararPanel(workerData.politica))}finally{db.close()}`;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(codigo)}`), {
    workerData: { archivo, barrera, politica: POLITICA },
  });
  return observarTrabajador(worker, senal);
}

test('dos aislados preparan concurrentemente una sola autoridad sin conflicto ni reinicialización', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-preparacion-concurrente-'));
  const archivo = join(dir, 'panel.sqlite');
  const db = new DatabaseSync(archivo);
  new AlmacenPublicoSqlite(motor(db), { maxClientes: 1 });
  db.close();
  const barrera = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const cancelacion = new AbortController();
  const reloj = setTimeout(() => cancelacion.abort(new Error('Plazo de concurrencia agotado')), PLAZO_CONCURRENCIA_MS);
  const trabajos: ReturnType<typeof trabajador>[] = [];
  try {
    trabajos.push(trabajador(archivo, barrera, cancelacion.signal));
    trabajos.push(trabajador(archivo, barrera, cancelacion.signal));
    const terminados = Promise.all(trabajos.map((t) => t.final));
    // Se atenderá también con await; evita rechazo sin manejar mientras se espera la barrera de listo.
    void terminados.catch(() => undefined);
    await Promise.all(trabajos.map((t) => t.listo));
    Atomics.store(new Int32Array(barrera), 0, 1);
    Atomics.notify(new Int32Array(barrera), 0);
    const resultados = (await terminados).map(leerDocumentoControles);
    assert.deepEqual(resultados[0], resultados[1]);
    const consulta = new DatabaseSync(archivo);
    try {
      assert.equal(consulta.prepare('SELECT count(*) AS n FROM administracion_sesion').get()?.n, 1);
      assert.equal(consulta.prepare('SELECT count(*) AS n FROM administracion_controles').get()?.n, 1);
    } finally {
      consulta.close();
    }
  } finally {
    clearTimeout(reloj);
    await Promise.all(trabajos.map((t) => t.worker.terminate()));
    rmSync(dir, { recursive: true });
  }
});
