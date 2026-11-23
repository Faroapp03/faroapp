import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { type EstadoDatosPanel, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import type { ReciboTrabajo } from '../../src/administracion/trabajos.ts';
import { leerObservacionDelPanelSqlite } from '../../src/plataforma/acceso-publico/datos-trabajo-sqlite.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import type { SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { catalogoPrivado } from '../ayudas/catalogo-privado.ts';
import { sembrarSocioPersistido } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = Date.parse('2026-10-16T12:00:00Z');
const TAM_HUELLA = 64;
const TAM_SHA = 40;
const TAM_VERSION = 16;
const SEGUNDO = 1000;
const VALIDEZ_IDENTIDAD = 60;
const MODO_PRIVADO = 0o600;
const TAM_JTI = 22;
const LONGITUD_ID = 55;
const MAX_DOCUMENTO = 8192;
const REVISION_TERMINAL = 3;
const HUELLA = 'f'.repeat(TAM_HUELLA);
const ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const CONFIANZA = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
};
const RECIBO: ReciboTrabajo = {
  solicitudId: ID,
  revisionReserva: 1,
  accion: 'actualizar-datos',
  resultado: 'validado',
  veredicto: 'verde',
  terminadoEn: '2026-10-16T12:00:00Z',
  huellaPaquete: 'a'.repeat(TAM_VERSION),
  error: null,
};
const DATOS = leerEstadoDatosPanel({
  version: 1,
  observadoEn: '2026-10-16T11:59:59Z',
  fuentes: [{ id: 'prueba', politica: 'fija', fecha: null, plazoDias: null }],
  modulos: ['prueba', 'paquete'].map((id) => ({
    id,
    ultimoIntento: '2026-10-16T11:59:59Z',
    veredicto: 'verde',
    ultimaVersionBuena: null,
    fallos: 0,
    proximoReintento: null,
  })),
  formacionAbiertaCaduca: null,
});
function identidad(): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  return {
    ...pins,
    runId: '789',
    runAttempt: '1',
    jti: 'jti-sintetico',
    emitidoEn: AHORA / SEGUNDO,
    caducaEn: AHORA / SEGUNDO + VALIDEZ_IDENTIDAD,
  };
}
async function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'datos-'));
  const archivo = join(dir, 'Año 2026 panel.sqlite');
  const reloj = { ahora: AHORA };
  const opciones = { archivo, maxClientes: 2, ahora: () => reloj.ahora };
  const almacen = crearAlmacenPublicoNode(opciones);
  const db = new DatabaseSync(archivo);
  t.after(() => {
    db.close();
    almacen.close();
    rmSync(dir, { recursive: true });
  });
  await almacen.sesion.prepararPanel(POLITICA);
  await abrirSesionDePrueba(almacen.sesion, ACCESO);
  await almacen.trabajos.prepararTrabajos();
  return { almacen, db, reloj, archivo, opciones };
}
async function iniciar(almacen: ReturnType<typeof crearAlmacenPublicoNode>) {
  assert.equal(
    (
      await almacen.trabajos.reservarTrabajoDeSesion(
        ACCESO,
        { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 },
        CONFIANZA,
      )
    ).estado,
    'nueva',
  );
  assert.equal(
    (
      await almacen.trabajos.confirmarInicio(
        { solicitudId: ID, revisionReserva: 1, accion: RECIBO.accion },
        identidad(),
      )
    ).estado,
    'aplicado',
  );
}
function instantanea(db: DatabaseSync) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((f) => ({ nombre: f.name, filas: db.prepare(`SELECT * FROM ${f.name} ORDER BY 1`).all() }));
}
function motor(db: DatabaseSync, fallo: (sql: string) => boolean): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
      if (fallo(sql)) {
        throw new Error('Fallo sintético');
      }
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = accion();
        db.exec('COMMIT');
        return r;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const DATOS_V4 = leerEstadoDatosPanel({
  ...DATOS,
  version: 4,
  fuentes: DATOS.fuentes.map((f) => ({ ...f, ultimaOperacion: null })),
  comprobaciones: {
    registradoEn: null,
    reconstruccionPendiente: false,
    conjuntos: [
      {
        id: 'prueba',
        fuente: 'prueba',
        alcance: 'copia-local',
        operacion: 'integridad',
        intervaloDias: null,
        revisionNecesaria: false,
        ultimaComprobacion: null,
      },
    ],
  },
  seguimientoRemoto: null,
  catalogoFuentes: [{ id: 'prueba', nombre: 'Fuente de prueba', tema: 'comun', modalidad: 'operativa' }],
});

for (const datos of [
  DATOS,
  DATOS_V4,
  leerEstadoDatosPanel(JSON.parse(readFileSync(new URL('../fixtures/estado-datos-v2.json', import.meta.url), 'utf8'))),
]) {
  test(`la instantánea v${datos.version} persiste exactamente al reabrir y no cambia por repetición ni conflicto`, async (t) => {
    const f = await fixture(t);
    assert.equal(await f.almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
    await iniciar(f.almacen);
    assert.equal((await f.almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), datos)).estado, 'aplicado');
    const esperado = { version: 1, recibo: RECIBO, huellaRecibo: HUELLA, datos };
    assert.deepEqual(await f.almacen.trabajos.leerDatosDelUltimoTrabajo(), esperado);
    const antes = instantanea(f.db);
    f.reloj.ahora += SEGUNDO;
    assert.equal((await f.almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), datos)).estado, 'repetido');
    assert.equal(
      (await f.almacen.trabajos.registrarRecibo(RECIBO, 'e'.repeat(TAM_HUELLA), identidad(), datos)).estado,
      'conflicto',
    );
    assert.deepEqual(instantanea(f.db), antes);
    const otro = crearAlmacenPublicoNode(f.opciones);
    try {
      await otro.trabajos.prepararTrabajos();
      assert.deepEqual(await otro.trabajos.leerDatosDelUltimoTrabajo(), esperado);
    } finally {
      otro.close();
    }
    assert.equal(statSync(f.archivo).mode & 0o777, MODO_PRIVADO);
  });
}

test('nuevo trabajo y terminal sin instantánea no presentan la observación anterior como actual', async (t) => {
  const { almacen } = await fixture(t);
  await iniciar(almacen);
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS);
  const revisionEsperada = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  const r = await almacen.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO_ID, accion: 'actualizar-datos', revisionEsperada },
    CONFIANZA,
  );
  assert.ok('trabajos' in r && r.trabajos.ultimoTrabajo);
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
  const ref = r.trabajos.ultimoTrabajo;
  await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, {
    solicitudId: ref.solicitudId,
    revisionReserva: ref.revisionReserva,
    revisionEsperada: r.trabajos.revision,
  });
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
});

test('durante una actualización el panel conserva la última observación admitida, marcada como anterior', async (t) => {
  const { almacen, db } = await fixture(t);
  const sql = motor(db, () => false);
  const delPanel = async () => leerObservacionDelPanelSqlite(sql, await almacen.trabajos.leerTrabajoPrivado());
  assert.equal(await delPanel(), null, 'sin ninguna observación admitida no hay nada que enseñar');
  await iniciar(almacen);
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS);
  const esperada = { version: 1, recibo: RECIBO, huellaRecibo: HUELLA, datos: DATOS };
  assert.deepEqual(await delPanel(), { observacion: esperada, deLaActualizacionAnterior: false });
  const revisionEsperada = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  const r = await almacen.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO_ID, accion: 'actualizar-datos', revisionEsperada },
    CONFIANZA,
  );
  assert.ok('trabajos' in r && r.trabajos.ultimoTrabajo);
  // El estado actual de los trabajos sigue sin presentarla como actual; el panel la enseña marcada.
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
  assert.deepEqual(await delPanel(), { observacion: esperada, deLaActualizacionAnterior: true });
  const ref = r.trabajos.ultimoTrabajo;
  await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, {
    solicitudId: ref.solicitudId,
    revisionReserva: ref.revisionReserva,
    revisionEsperada: r.trabajos.revision,
  });
  assert.deepEqual(await delPanel(), { observacion: esperada, deLaActualizacionAnterior: true });
});

test('llamada antigua sin estado cierra y nunca permite añadir una instantánea retroactivamente', async (t) => {
  const { almacen, db } = await fixture(t);
  await iniciar(almacen);
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad());
  const antes = instantanea(db);
  assert.equal((await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS)).estado, 'conflicto');
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
  assert.deepEqual(instantanea(db), antes);
});

test('fallo después de escribir la instantánea revierte recibo, instantánea y revisión juntos', async (t) => {
  const { almacen, db } = await fixture(t);
  await iniciar(almacen);
  const panel = new AlmacenSesionPanelSqlite(
    motor(db, (sql) => sql.startsWith('UPDATE administracion_datos_trabajo')),
    { ahora: () => AHORA },
  );
  const antes = instantanea(db);
  await assert.rejects(panel.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS), /Fallo sintético/);
  assert.deepEqual(instantanea(db), antes);
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
});

test('migración explícita de instalación previa conserva trabajos, autoridad, claves y cuotas', async (t) => {
  const { almacen, db } = await fixture(t);
  await iniciar(almacen);
  sembrarSocioPersistido(db, { id: 'pub-uno', huellas: [HUELLA], consultasPorHora: 2 });
  await almacen.consumir([{ clave: 'consultas:global', limite: 2, ventanaMs: 60_000 }]);
  await almacen.revocar('a'.repeat(TAM_JTI), AHORA / SEGUNDO + VALIDEZ_IDENTIDAD);
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad());
  db.exec('DROP TABLE administracion_datos_trabajo');
  db.exec('ALTER TABLE publico_estado DROP COLUMN datos_trabajo_version');
  const anterior = instantanea(db);
  await assert.rejects(almacen.trabajos.leerDatosDelUltimoTrabajo());
  await almacen.trabajos.prepararTrabajos();
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
  const posterior = instantanea(db)
    .filter((f) => f.nombre !== 'administracion_datos_trabajo')
    .map((f) =>
      f.nombre === 'publico_estado'
        ? { ...f, filas: f.filas.map(({ datos_trabajo_version: _v, ...fila }) => fila) }
        : f,
    );
  assert.deepEqual(JSON.parse(JSON.stringify(posterior)), JSON.parse(JSON.stringify(anterior)));
  const estable = instantanea(db);
  await almacen.trabajos.prepararTrabajos();
  assert.deepEqual(instantanea(db), estable);
});

test('fallo de migración revierte también marcador y esquema sin reparar parcialmente', async (t) => {
  const { almacen, db } = await fixture(t);
  db.exec('DROP TABLE administracion_datos_trabajo');
  db.exec('ALTER TABLE publico_estado DROP COLUMN datos_trabajo_version');
  const antes = instantanea(db);
  const panel = new AlmacenSesionPanelSqlite(
    motor(db, (sql) => sql.startsWith('UPDATE publico_estado SET datos_trabajo_version')),
    { ahora: () => AHORA },
  );
  await assert.rejects(panel.prepararTrabajos(), /Fallo sintético/);
  assert.deepEqual(instantanea(db), antes);
  await almacen.trabajos.prepararTrabajos();
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
});

const CORRUPCIONES = [
  'DROP TABLE administracion_datos_trabajo',
  'DELETE FROM administracion_datos_trabajo',
  'UPDATE publico_estado SET datos_trabajo_version=0',
  'ALTER TABLE publico_estado DROP COLUMN datos_trabajo_version',
  "UPDATE administracion_datos_trabajo SET documento='{}'",
  "UPDATE administracion_datos_trabajo SET sha='cccccccccccccccccccccccccccccccccccccccc'",
  "UPDATE administracion_datos_trabajo SET documento=json_set(documento,'$.recibo.solicitudId','22222222-2222-4222-8222-222222222222')",
  "UPDATE administracion_datos_trabajo SET documento=json_set(documento,'$.huellaRecibo','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')",
  "UPDATE administracion_datos_trabajo SET documento=json_set(documento,'$.recibo.terminadoEn','2026-10-16T12:00:01Z')",
];
for (const corrupcion of CORRUPCIONES) {
  test(`una instantánea corrupta falla cerrada y no se repara: ${corrupcion}`, async (t) => {
    const { almacen, db } = await fixture(t);
    await iniciar(almacen);
    await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS);
    db.exec(corrupcion);
    const antes = instantanea(db);
    await assert.rejects(almacen.trabajos.leerDatosDelUltimoTrabajo());
    await assert.rejects(almacen.trabajos.prepararTrabajos());
    assert.deepEqual(instantanea(db), antes);
  });
}

test('una instantánea inválida y un null incoherente no cierran recibo ni modifican estado', async (t) => {
  const { almacen, db } = await fixture(t);
  await iniciar(almacen);
  const antes = instantanea(db);
  for (const datos of [null, { ...DATOS, observadoEn: '2026-10-16T12:00:01Z' }, { ...DATOS, version: 2 }]) {
    await assert.rejects(
      almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), datos as EstadoDatosPanel | null),
    );
    assert.deepEqual(instantanea(db), antes);
  }
});

test('rechazo sin observación no recicla la instantánea previa y conserva fecha del trabajo anterior', async (t) => {
  const { almacen, db } = await fixture(t);
  await iniciar(almacen);
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS);
  const previo = db.prepare('SELECT * FROM administracion_datos_trabajo').all();
  const revisionEsperada = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  await almacen.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO_ID, accion: 'actualizar-datos', revisionEsperada },
    CONFIANZA,
  );
  const rechazo: ReciboTrabajo = {
    ...RECIBO,
    solicitudId: OTRO_ID,
    revisionReserva: revisionEsperada + 1,
    resultado: 'rechazado',
    veredicto: null,
    huellaPaquete: null,
    error: 'actualizacion_no_completada',
  };
  assert.equal((await almacen.trabajos.registrarRecibo(rechazo, HUELLA, identidad(), null)).estado, 'aplicado');
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
  assert.deepEqual(db.prepare('SELECT * FROM administracion_datos_trabajo').all(), previo);
  const antesReplay = instantanea(db);
  assert.equal((await almacen.trabajos.registrarRecibo(rechazo, HUELLA, identidad(), null)).estado, 'repetido');
  assert.deepEqual(instantanea(db), antesReplay);
});

test('una instantánea mayor que el documento de trabajo se almacena separado sin truncar datos', async (t) => {
  const { almacen, db } = await fixture(t);
  await iniciar(almacen);
  const cantidad = 60;
  const fuentes = Array.from({ length: cantidad }, (_, i) => ({
    ...DATOS.fuentes[0],
    id: `fuente_${String(i).padStart(LONGITUD_ID, '0')}`,
  }));
  const modulos = [...fuentes.map((f) => ({ ...DATOS.modulos[0], id: f.id })), DATOS.modulos[1]];
  const datos = leerEstadoDatosPanel({ ...DATOS, fuentes, modulos });
  assert.ok(JSON.stringify(datos).length > MAX_DOCUMENTO);
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), datos);
  assert.deepEqual((await almacen.trabajos.leerDatosDelUltimoTrabajo())?.datos, datos);
  const documento = db.prepare('SELECT documento FROM administracion_trabajo').get()?.documento;
  assert.ok(typeof documento === 'string' && documento.length <= MAX_DOCUMENTO);
});

function observarWorker(worker: Worker) {
  const listo = Promise.withResolvers<void>();
  const terminado = Promise.withResolvers<unknown>();
  let salida: unknown;
  worker.on('message', (m: unknown) => {
    if (m === 'listo') {
      listo.resolve();
    } else {
      salida = m;
    }
  });
  worker.on('error', (error) => {
    listo.reject(error);
    terminado.reject(error);
  });
  worker.on('exit', (code) => {
    if (code === 0 && salida !== undefined) {
      terminado.resolve(salida);
    } else {
      const error = new Error('Worker incompleto');
      listo.reject(error);
      terminado.reject(error);
    }
  });
  return { listo: listo.promise, terminado: terminado.promise };
}

test('recibos concurrentes en conexiones aisladas guardan un único par de recibo e instantánea', async (t) => {
  const f = await fixture(t);
  await iniciar(f.almacen);
  const barrera = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const modulo = new URL('../../src/plataforma/acceso-publico/node.ts', import.meta.url).href;
  const codigo = `import {parentPort,workerData as d} from 'node:worker_threads';
import {crearAlmacenPublicoNode} from ${JSON.stringify(modulo)};
const a=crearAlmacenPublicoNode({archivo:d.archivo,maxClientes:2,altasIniciales:true,ahora:()=>d.ahora});
parentPort.postMessage('listo'); Atomics.wait(new Int32Array(d.barrera),0,0);
try{parentPort.postMessage(await a.trabajos.registrarRecibo(d.recibo,d.huella,d.identidad,d.datos))}finally{a.close()}`;
  const workers: Worker[] = [];
  const listos: Promise<void>[] = [];
  const resultados: Promise<unknown>[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(codigo)}`), {
        workerData: {
          archivo: f.archivo,
          ahora: AHORA,
          barrera,
          recibo: RECIBO,
          identidad: identidad(),
          datos: DATOS,
          huella: (i === 0 ? 'e' : 'f').repeat(TAM_HUELLA),
        },
      });
      workers.push(worker);
      const observado = observarWorker(worker);
      listos.push(observado.listo);
      resultados.push(observado.terminado);
    }
    const todos = Promise.all(resultados);
    void todos.catch(() => undefined);
    await Promise.all(listos);
    Atomics.store(new Int32Array(barrera), 0, 1);
    Atomics.notify(new Int32Array(barrera), 0);
    const salidas = (await todos) as { estado: string }[];
    assert.deepEqual(salidas.map((r) => r.estado).sort(), ['aplicado', 'conflicto']);
    const privado = await f.almacen.trabajos.leerTrabajoPrivado();
    const observacion = await f.almacen.trabajos.leerDatosDelUltimoTrabajo();
    assert.equal(privado.revision, REVISION_TERMINAL);
    assert.equal(observacion?.huellaRecibo, privado.ultimoTrabajo?.huellaRecibo);
    assert.deepEqual(observacion?.datos, DATOS);
  } finally {
    Atomics.store(new Int32Array(barrera), 0, 1);
    Atomics.notify(new Int32Array(barrera), 0);
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
});

test('replay con una instantánea distinta es conflicto y undefined conserva compatibilidad sin mutaciones', async (t) => {
  const { almacen, db } = await fixture(t);
  await iniciar(almacen);
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS);
  const antes = instantanea(db);
  const otrosDatos = leerEstadoDatosPanel({ ...DATOS, observadoEn: '2026-10-16T12:00:00Z' });
  assert.equal((await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), otrosDatos)).estado, 'conflicto');
  assert.equal((await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad())).estado, 'repetido');
  assert.deepEqual(instantanea(db), antes);
});

test('catálogo privado v2 comparte transacción, replay exacto y única observación conservada', async (t) => {
  const f = await fixture(t);
  await iniciar(f.almacen);
  const catalogo = catalogoPrivado();
  assert.equal(
    (await f.almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS, catalogo)).estado,
    'aplicado',
  );
  const guardado = await f.almacen.trabajos.leerDatosDelUltimoTrabajo();
  assert.equal(guardado?.version, 2);
  assert.deepEqual(guardado?.catalogo, catalogo);
  const antes = f.db.prepare('SELECT * FROM administracion_datos_trabajo').all();
  assert.equal(antes.length, 1);
  assert.equal(
    (await f.almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS, catalogo)).estado,
    'repetido',
  );
  assert.deepEqual(f.db.prepare('SELECT * FROM administracion_datos_trabajo').all(), antes);
  const distinto = { ...catalogo, revision: '0'.repeat(TAM_HUELLA) };
  assert.equal(
    (await f.almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS, distinto)).estado,
    'conflicto',
  );
  assert.deepEqual(f.db.prepare('SELECT * FROM administracion_datos_trabajo').all(), antes);
});

test('catálogo y recibo revierten juntos si se interrumpe la sustitución de su única observación', async (t) => {
  const { almacen, db } = await fixture(t);
  await iniciar(almacen);
  const panel = new AlmacenSesionPanelSqlite(
    motor(db, (sql) => sql.startsWith('UPDATE administracion_datos_trabajo')),
    { ahora: () => AHORA },
  );
  const antes = instantanea(db);
  await assert.rejects(panel.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS, catalogoPrivado()), /Fallo sintético/);
  assert.deepEqual(instantanea(db), antes);
  assert.equal(await almacen.trabajos.leerDatosDelUltimoTrabajo(), null);
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad(), DATOS, catalogoPrivado())).estado,
    'aplicado',
  );
});
