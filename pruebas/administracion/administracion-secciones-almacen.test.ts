import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import {
  leerResultadoCambioSeccionesSesion,
  leerResultadoLecturaSeccionesSesion,
} from '../../src/administracion/secciones-almacen.ts';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import {
  AlmacenPublicoSqlite,
  type SqlAccesoPublico,
  type ValorSql,
} from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioEnArchivo, socioEnArchivo } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = 1000;
const VERSION_SECCIONES_NUEVAS = 5;
const VERSION_SECCIONES = 3;
const TAM_HUELLA = 64;
const entorno = {};
const politica: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: true,
};
const acceso = (letra = 'a'): AccesoSesionPanel => ({
  huellaSesion: letra.repeat(TAM_HUELLA),
  huellaPrincipal: 'f'.repeat(TAM_HUELLA),
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
function documento(db: DatabaseSync): string {
  const valor = db.prepare('SELECT documento FROM administracion_controles').get()?.documento;
  assert.equal(typeof valor, 'string');
  return valor as string;
}
async function conBase(
  accion: (
    db: DatabaseSync,
    sql: SqlAccesoPublico,
    publico: AlmacenPublicoSqlite,
    sesion: AlmacenSesionPanelSqlite,
  ) => Promise<void>,
) {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  try {
    const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => AHORA });
    const sesion = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
    await accion(db, sql, publico, sesion);
  } finally {
    db.close();
  }
}

test('secciones: consulta de configuración nueva no altera esquema, documento o controles', async () => {
  await conBase(async (db, _sql, publico, sesion) => {
    assert.equal(await sesion.leerSecciones(), null);
    const original = await publico.activarControles(politica);
    const antes = documento(db);
    const esquema = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    assert.deepEqual(await sesion.leerSecciones(), {
      version: VERSION_SECCIONES,
      revision: 0,
      secciones: politicaSeccionesInicial(),
    });
    assert.equal(documento(db), antes);
    assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), esquema);
    assert.deepEqual(await publico.leerControles(), original);
  });
});

test('secciones: escritura de permisos actuales preserva controles; controles antiguos preservan secciones; CAS común y reinicio', async () => {
  await conBase(async (db, sql, publico, sesion) => {
    await sesion.prepararPanel(politica);
    await abrirSesionDePrueba(sesion, acceso());
    const secciones = { ...politicaSeccionesInicial(), recorrido: false, doctor: false, cursos: false };
    const cambio = await sesion.cambiarSeccionesDeSesion(acceso(), 0, secciones);
    assert.equal(cambio.estado, 'cambiado');
    assert.deepEqual(JSON.parse(documento(db)), {
      ...politica,
      version: VERSION_SECCIONES_NUEVAS,
      revision: 1,
      secciones,
    });
    assert.equal(db.prepare('SELECT controles_version FROM publico_estado').get()?.controles_version, 1);
    assert.deepEqual(await publico.leerControles(), { ...politica, revision: 1 });
    const nueva = { ...politica, mcp: true };
    assert.equal((await sesion.cambiarControlesDeSesion(acceso(), 1, nueva)).estado, 'cambiado');
    assert.deepEqual(await sesion.leerSecciones(), { version: VERSION_SECCIONES, revision: 2, secciones });
    const antes = documento(db);
    assert.equal((await sesion.cambiarSeccionesDeSesion(acceso(), 1, politicaSeccionesInicial())).estado, 'conflicto');
    assert.equal((await sesion.cambiarControlesDeSesion(acceso(), 1, politica)).estado, 'conflicto');
    assert.equal(documento(db), antes);
    const reinicio = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
    assert.deepEqual(await reinicio.prepararPanel(politica), { ...nueva, revision: 2 });
    assert.deepEqual(await reinicio.leerSecciones(), { version: VERSION_SECCIONES, revision: 2, secciones });
    assert.equal((await reinicio.cambiarSeccionesDeSesion(acceso(), 2, politicaSeccionesInicial())).estado, 'cambiado');
    assert.deepEqual(await publico.leerControles(), { ...nueva, revision: 3 });
  });
});

test('secciones: sesión sustituida no lee ni escribe; revisión agotada conserva documento', async () => {
  await conBase(async (db, _sql, publico, sesion) => {
    await sesion.prepararPanel(politica);
    await abrirSesionDePrueba(sesion, acceso());
    await abrirSesionDePrueba(sesion, acceso('b'));
    const antes = documento(db);
    const fila = db.prepare('SELECT * FROM administracion_sesion').all();
    assert.deepEqual(await sesion.leerSeccionesDeSesion(acceso()), { estado: 'sustituida' });
    assert.deepEqual(await sesion.cambiarSeccionesDeSesion(acceso(), 0, politicaSeccionesInicial()), {
      estado: 'sustituida',
    });
    assert.equal(documento(db), antes);
    assert.deepEqual(db.prepare('SELECT * FROM administracion_sesion').all(), fila);
    db.prepare('UPDATE administracion_controles SET documento=?').run(
      JSON.stringify({ ...JSON.parse(documento(db)), revision: Number.MAX_SAFE_INTEGER }),
    );
    const agotado = documento(db);
    await assert.rejects(
      sesion.cambiarSeccionesDeSesion(acceso('b'), Number.MAX_SAFE_INTEGER, politicaSeccionesInicial()),
    );
    assert.equal(documento(db), agotado);
    assert.deepEqual(await publico.leerControles(), { ...politica, revision: Number.MAX_SAFE_INTEGER });
  });
});

test('secciones: formato actual incompleto, desconocido o con extras falla cerrado sin reconstruirlo', async () => {
  await conBase(async (db, _sql, publico, sesion) => {
    await sesion.prepararPanel(politica);
    await abrirSesionDePrueba(sesion, acceso());
    const vigente = {
      ...politica,
      version: VERSION_SECCIONES_NUEVAS,
      revision: 0,
      secciones: politicaSeccionesInicial(),
    };
    for (const corrupto of [
      { ...politica, version: 2, revision: 0 },
      { ...vigente, version: VERSION_SECCIONES_NUEVAS + 1 },
      { ...vigente, extra: true },
      { ...vigente, secciones: { recorrido: false } },
    ]) {
      const antes = JSON.stringify(corrupto);
      db.prepare('UPDATE administracion_controles SET documento=?').run(antes);
      await assert.rejects(sesion.leerSecciones());
      await assert.rejects(publico.leerControles());
      await assert.rejects(sesion.cambiarSeccionesDeSesion(acceso(), 0, politicaSeccionesInicial()));
      assert.equal(documento(db), antes);
    }
  });
});

test('secciones: fallo tras UPDATE revierte migración y reloj', async () => {
  await conBase(async (db, sql, _publico, sesion) => {
    await sesion.prepararPanel(politica);
    await abrirSesionDePrueba(sesion, acceso());
    const antes = documento(db);
    const fila = db.prepare('SELECT * FROM administracion_sesion').all();
    const roto = new AlmacenSesionPanelSqlite(
      {
        ...sql,
        ejecutar: (sentencia, ...valores) => {
          sql.ejecutar(sentencia, ...valores);
          if (sentencia.startsWith('UPDATE administracion_controles')) {
            throw new Error('fallo sintético');
          }
        },
      },
      { ahora: () => AHORA + 1 },
    );
    await assert.rejects(roto.cambiarSeccionesDeSesion(acceso(), 0, politicaSeccionesInicial()));
    assert.equal(documento(db), antes);
    assert.deepEqual(db.prepare('SELECT * FROM administracion_sesion').all(), fila);
  });
});

test('secciones DO: misma sesión y revisión, protocolo cerrado y controles v1 conservados', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: {
        exec: (sentencia: string, ...valores: ValorSql[]) => ({ toArray: () => sql.filas(sentencia, ...valores) }),
      },
      transactionSync: sql.transaccion,
    },
  };
  let servidor = new AccesoPublicoDurable(estado, entorno);
  const almacen = new SesionUnicaDurable({ idFromName: () => 'registro-publico-v1', get: () => servidor });
  try {
    await almacen.prepararPanel(politica);
    await abrirSesionDePrueba(almacen, acceso());
    assert.equal((await almacen.leerSeccionesDeSesion(acceso())).estado, 'activa');
    const secciones = { ...politicaSeccionesInicial(), guias: false };
    assert.equal((await almacen.cambiarSeccionesDeSesion(acceso(), 0, secciones)).estado, 'cambiado');
    assert.deepEqual(await almacen.leerControles(), { ...politica, revision: 1 });
    servidor = new AccesoPublicoDurable(estado, entorno);
    assert.deepEqual(await almacen.leerSecciones(), { version: VERSION_SECCIONES, revision: 1, secciones });
    assert.equal((await almacen.cambiarSeccionesDeSesion(acceso(), 0, politicaSeccionesInicial())).estado, 'conflicto');
    const antes = documento(db);
    for (const cuerpo of [
      { acceso: acceso(), revisionEsperada: -1, secciones },
      { acceso: acceso(), revisionEsperada: 1, secciones: { guias: true } },
      { acceso: acceso(), revisionEsperada: 1, secciones, extra: true },
    ]) {
      const respuesta = await servidor.fetch(
        new Request('https://registro-socios.invalid/secciones/cambiar-sesion', {
          method: 'POST',
          body: JSON.stringify(cuerpo),
        }),
      );
      assert.equal(respuesta.status, ESTADO_HTTP.solicitudIncorrecta);
      assert.equal(documento(db), antes);
    }
    await abrirSesionDePrueba(almacen, acceso('b'));
    assert.deepEqual(await almacen.cambiarSeccionesDeSesion(acceso(), 1, secciones), { estado: 'sustituida' });
  } finally {
    db.close();
  }
});

test('secciones Node: dos conexiones comparten CAS, preservan acceso público y reabren v2', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-secciones-'));
  const opciones = { archivo: join(dir, 'clientes.sqlite'), maxClientes: 2, ahora: () => AHORA };
  const uno = crearAlmacenPublicoNode(opciones);
  let dos = crearAlmacenPublicoNode(opciones);
  const abierta = { ...politica, api: 'habilitada' as const };
  const cuenta = { clave: 'consultas:global', limite: 1, ventanaMs: AHORA };
  const socio = { id: 'pub-uno', huellas: ['c'.repeat(TAM_HUELLA)], consultasPorHora: 1 };
  try {
    await uno.sesion.prepararPanel(abierta);
    await abrirSesionDePrueba(uno.sesion, acceso());
    sembrarSocioEnArchivo(opciones.archivo, socio);
    assert.equal(await uno.consumir([cuenta]), true);
    const caducaS = 100;
    const tamJti = 22;
    const jti = 'a'.repeat(tamJti);
    await uno.revocar(jti, caducaS);
    const secciones = { ...politicaSeccionesInicial(), biblioteca: false };
    const cambios = await Promise.all([
      uno.secciones.cambiarSeccionesDeSesion(acceso(), 0, secciones),
      dos.sesion.cambiarControlesDeSesion(acceso(), 0, politica),
    ]);
    assert.deepEqual(
      cambios.map(({ estado }) => estado),
      ['cambiado', 'conflicto'],
    );
    dos.close();
    dos = crearAlmacenPublicoNode(opciones);
    assert.deepEqual(await dos.secciones.leerSecciones(), { version: VERSION_SECCIONES, revision: 1, secciones });
    assert.deepEqual(await dos.leerControles(), { ...abierta, revision: 1 });
    assert.deepEqual(socioEnArchivo(opciones.archivo, socio.id), socio);
    assert.equal(await dos.consumir([cuenta]), false);
    assert.equal(await dos.revocado(jti), true);
  } finally {
    uno.close();
    dos.close();
    rmSync(dir, { recursive: true });
  }
});

test('secciones: revisión extrema discordante devuelve el mismo conflicto SQL y DO; agotada no escribe', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: {
        exec: (sentencia: string, ...valores: ValorSql[]) => ({ toArray: () => sql.filas(sentencia, ...valores) }),
      },
      transactionSync: sql.transaccion,
    },
  };
  const servidor = new AccesoPublicoDurable(estado, entorno);
  const durable = new SesionUnicaDurable({ idFromName: () => 'registro-publico-v1', get: () => servidor });
  const directo = new AlmacenSesionPanelSqlite(sql);
  try {
    await durable.prepararPanel(politica);
    await abrirSesionDePrueba(durable, acceso());
    const secciones = politicaSeccionesInicial();
    const antes = documento(db);
    const resultadoSql = await directo.cambiarSeccionesDeSesion(acceso(), Number.MAX_SAFE_INTEGER, secciones);
    assert.equal(resultadoSql.estado, 'conflicto');
    const resultadoDo = await durable.cambiarSeccionesDeSesion(acceso(), Number.MAX_SAFE_INTEGER, secciones);
    assert.equal(resultadoDo.estado, 'conflicto');
    assert('secciones' in resultadoSql && 'secciones' in resultadoDo);
    assert.deepEqual(resultadoSql.secciones, resultadoDo.secciones);
    assert.equal(documento(db), antes);
    db.prepare('UPDATE administracion_controles SET documento=?').run(
      JSON.stringify({ ...JSON.parse(documento(db)), revision: Number.MAX_SAFE_INTEGER }),
    );
    const agotado = documento(db);
    await assert.rejects(directo.cambiarSeccionesDeSesion(acceso(), Number.MAX_SAFE_INTEGER, secciones));
    await assert.rejects(
      durable.cambiarSeccionesDeSesion(acceso(), Number.MAX_SAFE_INTEGER, secciones),
      AlmacenPublicoNoDisponible,
    );
    assert.equal(documento(db), agotado);
  } finally {
    db.close();
  }
});

test('secciones DO: cliente rechaza DTO o confirmación defectuosos y no envía entradas inválidas', async () => {
  let llamadas = 0;
  const almacen = new SesionUnicaDurable({
    idFromName: () => 'id',
    get: () => ({
      fetch: async () => {
        llamadas++;
        return Response.json({ secciones: { version: 1, revision: 0, secciones: { recorrido: false } } });
      },
    }),
  });
  await assert.rejects(almacen.cambiarSeccionesDeSesion(acceso(), -1, politicaSeccionesInicial()));
  assert.equal(llamadas, 0);
  await assert.rejects(almacen.leerSecciones(), AlmacenPublicoNoDisponible);
  assert.throws(() => leerResultadoLecturaSeccionesSesion({ estado: 'activa' }));
  assert.throws(() => leerResultadoCambioSeccionesSesion({ estado: 'cerrada', secciones: politicaSeccionesInicial() }));
  let accesos = 0;
  const getter = Object.defineProperty({}, 'estado', { enumerable: true, get: () => ++accesos });
  assert.throws(() => leerResultadoLecturaSeccionesSesion(getter));
  assert.equal(accesos, 0);
});

test('Cursos: leer controles v1 y secciones v1 no escribe ni concede permiso; guardar migra bajo sesión/revisión', async () => {
  await conBase(async (db, _sql, publico, sesion) => {
    await sesion.prepararPanel(politica);
    await abrirSesionDePrueba(sesion, acceso());
    const { cursos: _curso, encuesta: _encuesta, ...legadas } = politicaSeccionesInicial();
    for (const antiguo of [
      { ...politica, version: 1, revision: 0 },
      { ...politica, version: 2, revision: 0, secciones: legadas },
    ]) {
      const bytes = JSON.stringify(antiguo);
      db.prepare('UPDATE administracion_controles SET documento=?').run(bytes);
      const leida = await sesion.leerSecciones();
      assert.equal(leida?.version, VERSION_SECCIONES);
      assert.equal(leida?.secciones.cursos, false);
      assert.equal(leida?.secciones.encuesta, true);
      assert.equal(documento(db), bytes);
      assert.equal((await publico.leerControles())?.revision, 0);
    }
    const antes = documento(db);
    const adulterada = politicaSeccionesInicial();
    Reflect.set(adulterada, 'cursos', 'true');
    await assert.rejects(sesion.cambiarSeccionesDeSesion(acceso(), 0, adulterada));
    assert.equal(documento(db), antes);
    assert.equal((await sesion.cambiarSeccionesDeSesion(acceso(), 1, politicaSeccionesInicial())).estado, 'conflicto');
    assert.equal(documento(db), antes);
    assert.equal(
      (await sesion.cambiarSeccionesDeSesion(acceso(), 0, { ...politicaSeccionesInicial(), cursos: true })).estado,
      'cambiado',
    );
    assert.equal(JSON.parse(documento(db)).version, VERSION_SECCIONES_NUEVAS);
    assert.equal((await sesion.leerSecciones())?.secciones.cursos, true);
    assert.equal((await sesion.leerSecciones())?.revision, 1);
  });
});
