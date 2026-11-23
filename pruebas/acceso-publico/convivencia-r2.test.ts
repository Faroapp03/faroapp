import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { operarRecorridoDurable } from '../../src/plataforma/acceso-publico/recorrido-durable.ts';
import { AlmacenSesionRecorridoSqlite } from '../../src/plataforma/acceso-publico/sesion-recorrido-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { identificadoresLimiteRecorrido } from '../../src/plataforma/cloudflare/limite-recorrido.ts';
import { escribirSinAlarma } from '../ayudas/alarma-durable.ts';
import { motorPanel } from '../ayudas/persistencia-panel.ts';

const MAX_INTENTOS = 10;
const SECRETO = 'clave-sintetica-del-limite-de-al-menos-32-bytes';
const claveDe = (ip: string) =>
  identificadoresLimiteRecorrido(
    new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': ip } }),
    SECRETO,
  );
function preparar() {
  const db = new DatabaseSync(':memory:');
  const sql = motorPanel(db);
  new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
  return { db, almacen: new AlmacenSesionRecorridoSqlite(sql, { cubrir: escribirSinAlarma }) };
}

test('R2 conserva estado y comparte cuota entre mensajes 12g y con espejo', async () => {
  const { db, almacen } = preparar();
  try {
    const ids = await claveDe('192.0.2.1');
    const antigua = ids.anteriores[0];
    assert.ok(antigua);
    const modo = await almacen.leerRecorrido();
    const viejo = { clave: antigua };
    const espejo = { version: 3, clave: ids, espejo: true };
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(await operarRecorridoDurable(almacen, '/recorrido/intento', viejo), { permitido: true });
    }
    for (let i = 2; i < MAX_INTENTOS; i++) {
      assert.deepEqual(await operarRecorridoDurable(almacen, '/recorrido/intento', espejo), { permitido: true });
    }
    assert.deepEqual(await operarRecorridoDurable(almacen, '/recorrido/intento', viejo), { permitido: false });
    assert.deepEqual(await operarRecorridoDurable(almacen, '/recorrido/intento', espejo), { permitido: false });
    assert.deepEqual(await almacen.leerRecorrido(), modo);
    for (const invalida of [
      { clave: ids },
      { version: 4, clave: ids, espejo: true },
      { version: 3, clave: ids, espejo: false },
    ]) {
      assert.equal(await operarRecorridoDurable(almacen, '/recorrido/intento', invalida), undefined);
    }
  } finally {
    db.close();
  }
});

test('una dirección 12g distinta en la misma red IPv6 no se puede atribuir a la cuota /64', async () => {
  const { db, almacen } = preparar();
  try {
    const a = await claveDe('2001:db8:1234:5678::1');
    const b = await claveDe('2001:db8:1234:5678::2');
    const antigua = a.anteriores[0];
    assert.ok(antigua);
    assert.equal(a.clave, b.clave);
    assert.notEqual(antigua, b.anteriores[0]);
    for (let i = 0; i < MAX_INTENTOS; i++) {
      assert.deepEqual(await operarRecorridoDurable(almacen, '/recorrido/intento', { clave: antigua }), {
        permitido: true,
      });
    }
    assert.deepEqual(
      await operarRecorridoDurable(almacen, '/recorrido/intento', { version: 3, clave: b, espejo: true }),
      { permitido: true },
    );
  } finally {
    db.close();
  }
});
