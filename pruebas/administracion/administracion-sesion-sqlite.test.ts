import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import {
  type AccesoSesionPanel,
  DURACION_MAXIMA_SESION_PANEL_MS,
  INACTIVIDAD_SESION_PANEL_MS,
  leerAccesoSesionPanel,
  leerEstadoSesionPanel,
  leerResultadoCambioControlesSesion,
  leerResultadoLecturaControlesSesion,
} from '../../src/administracion/sesion.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const INICIO = 10_000;
const MINUTO = 60_000;
const JTI_TAM = 22;
const CADUCA_S = 100;
const politica: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
const acceso = (sesion = 'a', principal = 'b'): AccesoSesionPanel => ({
  huellaSesion: sesion.repeat(TAM_HUELLA),
  huellaPrincipal: principal.repeat(TAM_HUELLA),
});
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
interface Contexto {
  db: DatabaseSync;
  sql: SqlAccesoPublico;
  publico: AlmacenPublicoSqlite;
  sesiones: AlmacenSesionPanelSqlite;
  reloj: { ahora: number };
}
function conBase(accion: (contexto: Contexto) => Promise<void>) {
  return async () => {
    const db = new DatabaseSync(':memory:');
    const sql = motor(db);
    const reloj = { ahora: INICIO };
    const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: () => reloj.ahora });
    const sesiones = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
    try {
      await publico.activarControles(politica);
      await accion({ db, sql, publico, sesiones, reloj });
    } finally {
      db.close();
    }
  };
}
function fila(db: DatabaseSync) {
  return db.prepare('SELECT * FROM administracion_sesion').all();
}
function esquema(db: DatabaseSync) {
  return db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
}

// Hashes de prueba, nunca tokens ni identidad del proveedor.
test('constructor pasivo y adopción explícita única requieren controles ya adoptados', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  const s = new AlmacenSesionPanelSqlite(sql, { ahora: () => INICIO });
  try {
    assert.deepEqual(esquema(db), []);
    const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 1 });
    const antes = esquema(db);
    await assert.rejects(s.activarSesionPanel());
    await assert.rejects(abrirSesionDePrueba(s, acceso()));
    assert.deepEqual(esquema(db), antes);
    await publico.activarControles(politica);
    await s.activarSesionPanel();
    await assert.rejects(s.activarSesionPanel());
    assert.deepEqual(await s.comprobarSesion(acceso()), { estado: 'cerrada' });
  } finally {
    db.close();
  }
});

test('dos conexiones: la misma persona en otra pestaña y otra persona tras el cierre sustituyen globalmente', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-sesion-'));
  const archivo = join(dir, 'registro.sqlite');
  const db1 = new DatabaseSync(archivo);
  const db2 = new DatabaseSync(archivo);
  const sql1 = motor(db1);
  const sql2 = motor(db2);
  const a = new AlmacenSesionPanelSqlite(sql1, { ahora: () => INICIO });
  const b = new AlmacenSesionPanelSqlite(sql2, { ahora: () => INICIO });
  try {
    await new AlmacenPublicoSqlite(sql1, { maxClientes: 1 }).activarControles(politica);
    await a.activarSesionPanel();
    assert.equal((await abrirSesionDePrueba(a, acceso())).estado, 'activa');
    assert.equal((await abrirSesionDePrueba(b, acceso('c'))).estado, 'activa');
    assert.deepEqual(await a.comprobarSesion(acceso()), { estado: 'sustituida' });
    // Con la sesión viva otra persona queda bloqueada: solo puede abrir cuando su titular la cierra.
    await b.cerrarSesion(acceso('c'));
    assert.equal((await abrirSesionDePrueba(a, acceso('d', 'e'))).estado, 'activa');
    assert.deepEqual(await b.comprobarSesion(acceso('c')), { estado: 'sustituida' });
    assert.equal((await b.comprobarSesion(acceso('d', 'e'))).estado, 'activa');
  } finally {
    db1.close();
    db2.close();
  }
  const reinicio = new DatabaseSync(archivo);
  try {
    const s = new AlmacenSesionPanelSqlite(motor(reinicio), { ahora: () => INICIO });
    assert.equal((await s.comprobarSesion(acceso('d', 'e'))).estado, 'activa');
    await assert.rejects(s.activarSesionPanel());
  } finally {
    reinicio.close();
    rmSync(dir, { recursive: true });
  }
});

test(
  'mantener, cerrar y cambiar desde sesión anterior nunca tocan el nuevo slot',
  conBase(async ({ db, sesiones: s, reloj }) => {
    await s.activarSesionPanel();
    await abrirSesionDePrueba(s, acceso());
    await abrirSesionDePrueba(s, acceso('c'));
    const antes = fila(db);
    reloj.ahora += MINUTO;
    assert.deepEqual(await s.mantenerSesion(acceso()), { estado: 'sustituida' });
    assert.deepEqual(await s.cerrarSesion(acceso()), { estado: 'sustituida' });
    assert.deepEqual(await s.cambiarControlesDeSesion(acceso(), 0, politica), { estado: 'sustituida' });
    assert.deepEqual(await s.leerControlesDeSesion(acceso()), { estado: 'sustituida' });
    assert.deepEqual(await s.comprobarSesion(acceso('c', 'd')), { estado: 'sustituida' });
    assert.deepEqual(fila(db), antes);
    assert.equal((await s.leerControlesDeSesion(acceso('c'))).estado, 'activa');
  }),
);

test(
  'sondeo y lectura no renuevan actividad; caduca en el límite y no resucita con retroceso',
  conBase(async ({ sesiones: s, reloj, sql }) => {
    await s.activarSesionPanel();
    const inicial = await abrirSesionDePrueba(s, acceso());
    reloj.ahora += INACTIVIDAD_SESION_PANEL_MS - 1;
    assert.deepEqual(await s.comprobarSesion(acceso()), inicial);
    assert.equal((await s.leerControlesDeSesion(acceso())).estado, 'activa');
    reloj.ahora++;
    assert.deepEqual(await s.comprobarSesion(acceso()), { estado: 'caducada' });
    assert.deepEqual(await s.mantenerSesion(acceso()), { estado: 'caducada' });
    const reinicio = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
    assert.deepEqual(await reinicio.comprobarSesion(acceso()), { estado: 'caducada' });
    reloj.ahora--;
    await assert.rejects(reinicio.comprobarSesion(acceso()));
  }),
);

test(
  'actividad renueva solo inactividad; límite absoluto ocho horas permanece',
  conBase(async ({ sesiones: s, reloj }) => {
    await s.activarSesionPanel();
    await abrirSesionDePrueba(s, acceso());
    for (let tiempo = MINUTO; tiempo < DURACION_MAXIMA_SESION_PANEL_MS; tiempo += MINUTO) {
      reloj.ahora = INICIO + tiempo;
      const estado = await s.mantenerSesion(acceso());
      assert.equal(estado.estado, 'activa');
      if (estado.estado === 'activa') {
        assert.equal(estado.caducaAbsolutaEn, INICIO + DURACION_MAXIMA_SESION_PANEL_MS);
        assert.equal(estado.ultimaActividadEn, reloj.ahora);
      }
    }
    reloj.ahora = INICIO + DURACION_MAXIMA_SESION_PANEL_MS;
    assert.deepEqual(await s.mantenerSesion(acceso()), { estado: 'caducada' });
    assert.deepEqual(await s.cambiarControlesDeSesion(acceso(), 0, politica), { estado: 'caducada' });
  }),
);

test(
  'cierre es idempotente y no permite mantener ni escribir; huella de sesión no se reutiliza',
  conBase(async ({ sesiones: s }) => {
    await s.activarSesionPanel();
    await abrirSesionDePrueba(s, acceso());
    assert.deepEqual(await s.cerrarSesion(acceso()), { estado: 'cerrada' });
    assert.deepEqual(await s.cerrarSesion(acceso()), { estado: 'cerrada' });
    assert.deepEqual(await s.mantenerSesion(acceso()), { estado: 'cerrada' });
    assert.deepEqual(await s.cambiarControlesDeSesion(acceso(), 0, politica), { estado: 'cerrada' });
    await assert.rejects(abrirSesionDePrueba(s, acceso()));
  }),
);

test(
  'sesión y CAS están en una transacción: conflicto conserva política y gasto público exacto',
  conBase(async ({ db, publico, sesiones: s }) => {
    // Semilla pública previa a adoptar sesión: ningún cambio administrativo puede reiniciar estos registros.
    const id = 'pub-uno';
    await publico.cambiarControles(0, { ...politica, api: 'habilitada' });
    sembrarSocioPersistido(db, { id, huellas: ['f'.repeat(TAM_HUELLA)], consultasPorHora: 1 });
    await publico.consumir([{ clave: 'consultas:global', limite: 1, ventanaMs: MINUTO }]);
    await publico.revocar('a'.repeat(JTI_TAM), CADUCA_S);
    const tablas = ['publico_socios', 'publico_contadores', 'publico_revocados'];
    const antes = tablas.map((tabla) => db.prepare(`SELECT * FROM ${tabla}`).all());
    await s.activarSesionPanel();
    await abrirSesionDePrueba(s, acceso());
    const cambio = await s.cambiarControlesDeSesion(acceso(), 1, politica);
    assert.equal(cambio.estado, 'cambiado');
    const conflicto = await s.cambiarControlesDeSesion(acceso(), 1, { ...politica, mcp: true });
    assert.equal(conflicto.estado, 'conflicto');
    if (cambio.estado === 'cambiado' && conflicto.estado === 'conflicto') {
      assert.deepEqual(conflicto.controles, cambio.controles);
    }
    assert.deepEqual(
      tablas.map((tabla) => db.prepare(`SELECT * FROM ${tabla}`).all()),
      antes,
    );
  }),
);

const corrupciones = [
  'DROP TABLE administracion_sesion',
  'DELETE FROM administracion_sesion',
  'DELETE FROM publico_estado',
  'UPDATE publico_estado SET sesion_panel_version=0',
  'ALTER TABLE publico_estado DROP COLUMN sesion_panel_version',
  "UPDATE administracion_sesion SET huella_sesion='token-en-claro'",
  'UPDATE administracion_sesion SET actividad=iniciada-1',
];
for (const corrupcion of corrupciones) {
  test(
    `pérdida/corrupción no regenera ni autoriza: ${corrupcion}`,
    conBase(async ({ db, sql, sesiones: s }) => {
      await s.activarSesionPanel();
      await abrirSesionDePrueba(s, acceso());
      db.exec(corrupcion);
      const antes = esquema(db);
      const reinicio = new AlmacenSesionPanelSqlite(sql, { ahora: () => INICIO });
      await assert.rejects(reinicio.activarSesionPanel());
      await assert.rejects(abrirSesionDePrueba(reinicio, acceso('c')));
      await assert.rejects(reinicio.comprobarSesion(acceso()));
      await assert.rejects(reinicio.mantenerSesion(acceso()));
      await assert.rejects(reinicio.cerrarSesion(acceso()));
      await assert.rejects(reinicio.leerControlesDeSesion(acceso()));
      await assert.rejects(reinicio.cambiarControlesDeSesion(acceso(), 0, politica));
      assert.deepEqual(esquema(db), antes);
    }),
  );
}

test(
  'fallo después del UPDATE revierte control y reloj; fallo de adopción revierte esquema',
  conBase(async ({ db, sql, reloj }) => {
    let romper = 'UPDATE publico_estado SET sesion_panel_version';
    const roto = {
      ...sql,
      ejecutar: (sentencia: string, ...valores: (string | number | null)[]) => {
        sql.ejecutar(sentencia, ...valores);
        if (sentencia.startsWith(romper)) {
          throw new Error('fallo sintético');
        }
      },
    };
    const s = new AlmacenSesionPanelSqlite(roto, { ahora: () => reloj.ahora });
    const antes = esquema(db);
    await assert.rejects(s.activarSesionPanel());
    assert.deepEqual(esquema(db), antes);
    romper = 'UPDATE administracion_controles';
    await s.activarSesionPanel();
    await abrirSesionDePrueba(s, acceso());
    const original = fila(db);
    const documentoOriginal = db.prepare('SELECT documento FROM administracion_controles').get()?.documento;
    reloj.ahora += MINUTO;
    await assert.rejects(s.cambiarControlesDeSesion(acceso(), 0, { ...politica, mcp: true }));
    assert.deepEqual(fila(db), original);
    assert.equal(db.prepare('SELECT documento FROM administracion_controles').get()?.documento, documentoOriginal);
  }),
);

test(
  'relojes inválidos o retrocedidos fallan cerrado sin sobrescribir sesión',
  conBase(async ({ db, sesiones: s, reloj }) => {
    await s.activarSesionPanel();
    await abrirSesionDePrueba(s, acceso());
    const original = fila(db);
    for (const ahora of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER, INICIO - 1]) {
      reloj.ahora = ahora;
      await assert.rejects(s.comprobarSesion(acceso()));
      await assert.rejects(abrirSesionDePrueba(s, acceso('c')));
      assert.deepEqual(fila(db), original);
    }
  }),
);

test('lectores estrictos copian respuestas y rechazan extras, herencia y accesores', () => {
  const activa = {
    estado: 'activa',
    iniciadaEn: INICIO,
    ultimaActividadEn: INICIO,
    caducaPorInactividadEn: INICIO + INACTIVIDAD_SESION_PANEL_MS,
    caducaAbsolutaEn: INICIO + DURACION_MAXIMA_SESION_PANEL_MS,
  };
  const controles = { ...politica, revision: 0 };
  const lectura = { estado: 'activa', sesion: activa, controles };
  const cambio = { estado: 'cambiado', sesion: activa, controles };
  assert.deepEqual(leerResultadoLecturaControlesSesion(lectura), lectura);
  assert.deepEqual(leerResultadoCambioControlesSesion(cambio), cambio);
  assert.notEqual(leerAccesoSesionPanel(acceso()), acceso());
  assert.notEqual(leerEstadoSesionPanel(activa), activa);
  assert.throws(() => leerEstadoSesionPanel({ ...activa, caducaAbsolutaEn: 1 }));
  assert.throws(() => leerResultadoLecturaControlesSesion({ ...lectura, secreto: 'x' }));
  assert.throws(() => leerResultadoCambioControlesSesion({ estado: 'cerrada', controles }));
  for (const valor of [null, [], Object.create(acceso()), { ...acceso(), token: 'claro' }, acceso('X')]) {
    assert.throws(() => leerAccesoSesionPanel(valor));
  }
  let llamadas = 0;
  const getter = Object.defineProperty({ huellaPrincipal: acceso().huellaPrincipal }, 'huellaSesion', {
    enumerable: true,
    get: () => ++llamadas,
  });
  assert.throws(() => leerAccesoSesionPanel(getter));
  assert.equal(llamadas, 0);
});
