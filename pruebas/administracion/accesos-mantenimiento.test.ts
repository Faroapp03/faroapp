/** Retención física con reloj sintético: no depende de una nueva consulta ni acredita un despliegue remoto. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { sanearClienteDeclarado } from '../../src/administracion/accesos.ts';
import { DIA_CONECTIVIDAD_MS, LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import {
  accesosConAlarma,
  ProgramadorAlarmaDurable,
} from '../../src/plataforma/acceso-publico/mantenimiento-durable.ts';
import { crearMantenimientoAccesosNode } from '../../src/plataforma/acceso-publico/mantenimiento-node.ts';
import { abrirSqlAdministrativoNode, crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import {
  AlmacenPublicoSqlite,
  type SqlAccesoPublico,
  type ValorSql,
} from '../../src/plataforma/acceso-publico/sqlite.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';

const AHORA = Date.parse('2026-10-23T00:00:00Z');
const RETENCION_MS = LIMITES_CONECTIVIDAD.retencionDias * DIA_CONECTIVIDAD_MS;
const REINTENTO_MS = 3_600_000;
const politica = { version: 2, api: 'deshabilitada', mcp: true, a2a: true } as const;
const uso = { canal: 'mcp', consulta: 'ficha_grupo', ...sanearClienteDeclarado('cliente-sdk') } as const;
function sqlEnMemoria(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (s, ...v) => db.prepare(s).all(...v),
    ejecutar: (s, ...v) => {
      db.prepare(s).run(...v);
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
test('Node depura físicamente al vencer sin otra petición, supera el máximo de un timeout y retira el temporizador al cerrar', async (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'retencion-node-')),
    archivo = join(dir, 'registro.sqlite');
  let ahora = AHORA;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const almacen = crearAlmacenPublicoNode({ archivo, maxClientes: 100, ahora: () => ahora });
  const observador = abrirSqlAdministrativoNode(archivo);
  let cerrado = false;
  try {
    await almacen.sesion.prepararPanel(politica);
    await almacen.accesos.registrarAcceso(uso);
    ahora += RETENCION_MS - 1;
    t.mock.timers.tick(RETENCION_MS - 1);
    await turno();
    assert.equal(observador.sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 1);
    ahora++;
    t.mock.timers.tick(1);
    await turno();
    assert.equal(observador.sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 0);
    await almacen.accesos.registrarAcceso(uso);
    almacen.close();
    cerrado = true;
    ahora += RETENCION_MS;
    t.mock.timers.tick(RETENCION_MS);
    await turno();
    assert.equal(observador.sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 1);
    await assert.rejects(almacen.accesos.registrarAcceso(uso));
  } finally {
    if (!cerrado) {
      almacen.close();
    }
    observador.close();
    rmSync(dir, { recursive: true });
  }
});
const privado = 'NO-GUARDAR persona@example.invalid';
const tareaDeAccesos = (sesion: AlmacenSesionPanelSqlite) =>
  ({
    operacion: 'registro-conectividad',
    vencimiento: () => sesion.siguienteVencimientoAccesos(),
    ejecutar: () => sesion.depurarAccesos(),
  }) as const;
/** Alarma en memoria cuya programación puede fallar con un mensaje que no debe salir del manejador. */
function alarmasRompibles(mensaje: string) {
  const base = alarmaDurableDePrueba();
  let rota = false;
  return {
    alarmas: {
      ...base,
      setAlarm: async (fecha: number) => {
        if (rota) {
          throw new Error(mensaje);
        }
        await base.setAlarm(fecha);
      },
    },
    romper: (valor: boolean) => {
      rota = valor;
    },
  };
}
test('DO: alarma repetible, fallo con reintento persistido y error neutro sin contenido privado', async () => {
  const db = new DatabaseSync(':memory:'),
    sql = sqlEnMemoria(db),
    { alarmas, romper } = alarmasRompibles(privado);
  let ahora = AHORA;
  new AlmacenPublicoSqlite(sql, { maxClientes: 100, ahora: () => ahora });
  const sesion = new AlmacenSesionPanelSqlite(sql, { ahora: () => ahora });
  const mantenimiento = new ProgramadorAlarmaDurable(alarmas, [tareaDeAccesos(sesion)], () => ahora);
  const accesos = accesosConAlarma(sesion, mantenimiento);
  try {
    await sesion.prepararPanel(politica);
    await sesion.prepararInstituciones();
    await accesos.prepararAccesos();
    await accesos.registrarAcceso(uso);
    assert.equal(await alarmas.getAlarm(), AHORA + RETENCION_MS);
    ahora += RETENCION_MS;
    db.exec(
      `CREATE TRIGGER fallo_retencion BEFORE DELETE ON conectividad_uso BEGIN SELECT RAISE(ABORT, '${privado}'); END`,
    );
    // Si no puede dejar programada la alarma, el manejador lanza para que Cloudflare lo reintente, sin datos privados.
    romper(true);
    await assert.rejects(mantenimiento.alarm(), (error: unknown) => {
      assert(error instanceof Error);
      assert(!error.message.includes(privado));
      return true;
    });
    romper(false);
    // Si la tarea falla pero la alarma queda programada, el reintento es suyo: una hora después.
    await mantenimiento.alarm();
    const siguiente = await alarmas.getAlarm();
    assert(siguiente !== null && siguiente > ahora);
    assert.equal(siguiente, ahora + REINTENTO_MS);
    assert.equal(sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 1);
    db.exec('DROP TRIGGER fallo_retencion');
    await mantenimiento.alarm();
    await mantenimiento.alarm();
    assert.equal(sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 0);
    assert.equal(await alarmas.getAlarm(), null);
  } finally {
    db.close();
  }
});
test('binding sin alarmas conserva controles pero no da Accesos por operativo; al reparar la capacidad reintenta sin duplicar tablas', async () => {
  const db = new DatabaseSync(':memory:'),
    sql = sqlEnMemoria(db);
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: { exec: (s: string, ...v: ValorSql[]) => ({ toArray: () => db.prepare(s).all(...v) }) },
      transactionSync: sql.transaccion,
    },
  };
  const servidor = new AccesoPublicoDurable(estado, {});
  const almacen = new AlmacenPublicoDurable({ idFromName: (n) => n, get: () => servidor });
  try {
    await almacen.prepararPanel(politica);
    await assert.rejects(almacen.prepararAccesos(), AlmacenPublicoNoDisponible);
    assert.equal((await almacen.leerControles())?.mcp, true);
    await assert.rejects(almacen.registrarAcceso(uso), AlmacenPublicoNoDisponible);
    assert.equal(sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 0);
    Object.assign(estado.storage, alarmaDurableDePrueba());
    await almacen.prepararAccesos();
    await almacen.registrarAcceso(uso);
    assert.equal(sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 1);
    assert.equal(typeof (await estado.storage.getAlarm?.()), 'number');
  } finally {
    db.close();
  }
});

test('Node registra el fallo de su mantenimiento como tarea, sin estado HTTP ni contenido privado', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const registros: string[] = [];
  t.mock.method(console, 'error', (...partes: unknown[]) => {
    registros.push(partes.map(String).join(' '));
  });
  let proximoFalla = true;
  const almacen = {
    depurarAccesos: async () => {
      throw new Error(privado);
    },
  } as unknown as Parameters<typeof crearMantenimientoAccesosNode>[0];
  const mantenimiento = crearMantenimientoAccesosNode(
    almacen,
    async () => {
      if (proximoFalla) {
        throw new Error(privado);
      }
      return AHORA;
    },
    () => AHORA,
  );
  try {
    // Al reanudar falla el cálculo del próximo vencimiento; con el reintento, la depuración.
    mantenimiento.reanudar();
    await turno();
    proximoFalla = false;
    t.mock.timers.tick(REINTENTO_MS);
    await turno();
    assert.deepEqual(
      registros.map((linea) => {
        const { suceso, operacion, estado } = JSON.parse(linea) as Record<string, unknown>;
        return [suceso, operacion, estado];
      }),
      [
        ['fallo operativo', 'registro-conectividad', null],
        ['fallo operativo', 'registro-conectividad', null],
      ],
    );
    assert.doesNotMatch(registros.join('\n'), /persona@example/u, 'el registro no copia el mensaje');
  } finally {
    mantenimiento.cerrar();
  }
});
test('Node reanuda la retención al reabrir sin que otra petición lea ni registre Accesos', async (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'retencion-reinicio-'));
  const archivo = join(dir, 'registro.sqlite');
  let ahora = AHORA;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const opciones = { archivo, maxClientes: 100, ahora: () => ahora };
  let almacen = crearAlmacenPublicoNode(opciones);
  try {
    await almacen.sesion.prepararPanel(politica);
    await almacen.accesos.registrarAcceso(uso);
    almacen.close();
    ahora += RETENCION_MS - 1;
    almacen = crearAlmacenPublicoNode(opciones);
    await turno();
    const observador = abrirSqlAdministrativoNode(archivo);
    try {
      assert.equal(observador.sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 1);
      ahora++;
      t.mock.timers.tick(1);
      await turno();
      assert.equal(observador.sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n, 0);
      assert.equal((await almacen.leerControles())?.mcp, true);
    } finally {
      observador.close();
    }
  } finally {
    almacen.close();
    rmSync(dir, { recursive: true });
  }
});
