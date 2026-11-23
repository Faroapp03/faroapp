/** Documentos persistidos sintéticos: lectura sin escrituras, permisos actuales y CAS común. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { leerPoliticaControles } from '../../src/administracion/controles.ts';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import { cambiarSeccionesSqlite, leerSeccionesSqlite } from '../../src/plataforma/acceso-publico/controles-sqlite.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { AlmacenPublicoSqlite, type ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { motorPanel, OPCIONES_PANEL, POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';

const REVISION = 7;
const VERSION_ACTUAL = 3;
const VERSION_SECCIONES = 3;
const VERSION_SIN_ENCUESTA = 4;
const VERSION_ESCRITURA = 5;
const PERMISOS = { recorrido: true, mcp: true, a2a: true, api: true };
const CASOS = [
  { version: 1, cursos: false },
  { version: 2, cursos: false },
  { version: VERSION_ACTUAL, cursos: false },
  { version: VERSION_ACTUAL, cursos: true },
];
function documento(version: number, cursos: boolean, habilitados = true) {
  const permisosIa = Object.fromEntries(Object.keys(PERMISOS).map((clave) => [clave, habilitados]));
  const { cursos: _curso, encuesta: _encuesta, ...legadas } = politicaSeccionesInicial();
  return {
    ...POLITICA_PANEL,
    version,
    revision: REVISION,
    api: 'habilitada-altas-cerradas',
    permisosIa,
    ...(version === 2 ? { secciones: { ...legadas, biblioteca: false } } : {}),
    ...(version === VERSION_ACTUAL ? { secciones: { ...legadas, cursos, biblioteca: false } } : {}),
  };
}
function texto(db: DatabaseSync) {
  return db.prepare('SELECT documento FROM administracion_controles WHERE id=1').get()?.documento;
}
function guardar(db: DatabaseSync, entrada: unknown) {
  db.prepare('UPDATE administracion_controles SET documento=? WHERE id=1').run(JSON.stringify(entrada));
}
for (const { version, cursos } of CASOS) {
  for (const habilitados of [true, false]) {
    test(`SQLite lee controles v${version}, cursos ${cursos} y permisos ${habilitados}, sin reescribir`, async () => {
      const db = new DatabaseSync(':memory:');
      try {
        const sql = motorPanel(db);
        const almacen = new AlmacenPublicoSqlite(sql, OPCIONES_PANEL);
        await almacen.activarControles(POLITICA_PANEL);
        guardar(db, documento(version, cursos, habilitados));
        const antes = texto(db);
        const reabierto = new AlmacenPublicoSqlite(sql, OPCIONES_PANEL);
        assert.deepEqual(await reabierto.leerControles(), { ...POLITICA_PANEL, revision: REVISION });
        const secciones = leerSeccionesSqlite(sql);
        assert.ok(secciones);
        assert.equal(secciones.version, VERSION_SECCIONES);
        assert.equal(secciones.secciones.biblioteca, version === 1);
        assert.equal(secciones.secciones.cursos, cursos);
        // Ningún documento anterior conocía la Encuesta: se lee visible, como se publicaba.
        assert.equal(secciones.secciones.encuesta, true);
        assert.equal(texto(db), antes);
        assert.equal((await reabierto.cambiarControles(0, POLITICA_PANEL)).estado, 'conflicto');
        assert.equal(texto(db), antes);
        const cambiado = await reabierto.cambiarControles(REVISION, { ...POLITICA_PANEL, mcp: true });
        assert.equal(cambiado.estado, 'cambiado');
        assert.equal(cambiado.controles.revision, REVISION + 1);
        const actual = JSON.parse(String(texto(db)));
        assert.equal(Object.hasOwn(actual, 'permisosIa'), false);
        assert.equal(actual.version, VERSION_ESCRITURA);
        assert.deepEqual(leerSeccionesSqlite(sql)?.secciones, secciones.secciones);
        const cambioSecciones = sql.transaccion(() => cambiarSeccionesSqlite(sql, REVISION + 1, secciones.secciones));
        assert.equal(cambioSecciones.estado, 'cambiado');
        assert.equal(JSON.parse(String(texto(db))).version, VERSION_ESCRITURA);
        assert.deepEqual(leerSeccionesSqlite(sql)?.secciones, secciones.secciones);
      } finally {
        db.close();
      }
    });
  }
}
test('un campo persistido incompleto o desconocido falla sin modificarlo; el contrato público lo rechaza', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const almacen = new AlmacenPublicoSqlite(motorPanel(db), OPCIONES_PANEL);
    await almacen.activarControles(POLITICA_PANEL);
    assert.throws(() => leerPoliticaControles({ ...POLITICA_PANEL, permisosIa: PERMISOS }));
    for (const permisosIa of [{}, { ...PERMISOS, api: 'si' }, { ...PERMISOS, otro: true }]) {
      guardar(db, { ...documento(VERSION_ACTUAL, true), permisosIa });
      const antes = texto(db);
      await assert.rejects(almacen.leerControles());
      assert.equal(texto(db), antes);
    }
  } finally {
    db.close();
  }
});
for (const { version, cursos } of CASOS) {
  test(`DO entrega controles v${version} y cursos ${cursos} sin alterar el documento persistido`, async () => {
    const db = new DatabaseSync(':memory:');
    const sql = motorPanel(db);
    const estado: EstadoAccesoPublicoDurable = {
      storage: {
        sql: {
          exec: (sentencia: string, ...valores: ValorSql[]) => ({
            toArray: () => db.prepare(sentencia).all(...valores),
          }),
        },
        transactionSync: (accion) => sql.transaccion(accion),
      },
    };
    const servidor = new AccesoPublicoDurable(estado, {});
    const almacen = new AlmacenPublicoDurable({ idFromName: () => 'registro-publico-v1', get: () => servidor });
    try {
      await almacen.prepararPanel(POLITICA_PANEL);
      guardar(db, documento(version, cursos));
      const antes = texto(db);
      assert.deepEqual(await almacen.leerControles(), { ...POLITICA_PANEL, revision: REVISION });
      const secciones = await almacen.leerSecciones();
      assert.ok(secciones);
      assert.equal(secciones.version, VERSION_SECCIONES);
      assert.equal(secciones.secciones.biblioteca, version === 1);
      assert.equal(secciones.secciones.cursos, cursos);
      assert.equal(secciones.secciones.encuesta, true);
      assert.equal(texto(db), antes);
    } finally {
      db.close();
    }
  });
}

for (const api of ['deshabilitada', 'habilitada-altas-cerradas', 'habilitada-altas-abiertas'] as const) {
  test(`el formato persistido anterior ${api} conserva el interruptor y no migra durante lectura`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const almacen = new AlmacenPublicoSqlite(motorPanel(db), OPCIONES_PANEL);
      await almacen.activarControles(POLITICA_PANEL);
      guardar(db, { ...documento(VERSION_ACTUAL, true), api });
      const antes = texto(db);
      assert.deepEqual(await almacen.leerControles(), {
        ...POLITICA_PANEL,
        revision: REVISION,
        api: api === 'deshabilitada' ? 'deshabilitada' : 'habilitada',
      });
      assert.equal(texto(db), antes);
    } finally {
      db.close();
    }
  });
}
for (const { version, conEncuesta } of [
  { version: VERSION_SIN_ENCUESTA, conEncuesta: false },
  { version: VERSION_ESCRITURA, conEncuesta: true },
]) {
  test(`v${version} exige política V2 y sus secciones completas, sin aceptar permisos ni modos retirados`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const sql = motorPanel(db),
        almacen = new AlmacenPublicoSqlite(sql, OPCIONES_PANEL);
      await almacen.activarControles(POLITICA_PANEL);
      const { encuesta: _encuesta, ...sinEncuesta } = politicaSeccionesInicial();
      const valido = {
        ...POLITICA_PANEL,
        version,
        revision: REVISION,
        secciones: conEncuesta ? { ...politicaSeccionesInicial(), encuesta: false } : { ...sinEncuesta, cursos: true },
      };
      guardar(db, valido);
      const antes = texto(db);
      assert.deepEqual(await almacen.leerControles(), { ...POLITICA_PANEL, revision: REVISION });
      assert.equal(leerSeccionesSqlite(sql)?.secciones.cursos, true);
      // La v4 no tenía la Encuesta y la lee visible; la v5 guarda su interruptor, también apagado.
      assert.equal(leerSeccionesSqlite(sql)?.secciones.encuesta, !conEncuesta);
      assert.equal(texto(db), antes);
      const { cursos: _curso, ...incompletas } = valido.secciones;
      const otraVersion = conEncuesta
        ? { ...valido, secciones: sinEncuesta }
        : { ...valido, secciones: { ...valido.secciones, encuesta: true } };
      for (const invalido of [
        { ...valido, api: 'habilitada-altas-abiertas' },
        { ...valido, permisosIa: PERMISOS },
        { ...valido, secciones: incompletas },
        otraVersion,
        { ...valido, version: 6 },
      ]) {
        guardar(db, invalido);
        const escrito = texto(db);
        await assert.rejects(almacen.leerControles());
        assert.equal(texto(db), escrito);
      }
    } finally {
      db.close();
    }
  });
}
