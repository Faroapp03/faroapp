import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { AlmacenVigilanteDurable } from '../../src/plataforma/acceso-publico/vigilante-cliente-durable.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';
import { CONFIG_VIGILANTE } from '../ayudas/vigilante.ts';

const LONGITUD_HUELLA = 64;
const SEGUNDO_MS = 1000;
const LIMITE = 50;
const acceso = { huellaSesion: 'a'.repeat(LONGITUD_HUELLA), huellaPrincipal: 'b'.repeat(LONGITUD_HUELLA) };
async function exigirSesionParaPreparar(cliente: AlmacenVigilanteDurable, db: DatabaseSync) {
  await abrirSesionDePrueba(cliente, { ...acceso, huellaSesion: 'c'.repeat(LONGITUD_HUELLA) });
  assert.equal((await cliente.prepararVigilanteDeSesion(acceso)).estado, 'sustituida');
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_vigilante'").get()?.n, 0);
  await abrirSesionDePrueba(cliente, acceso);
}
test('durable requiere preparación explícita y conserva sesión, ausencia de recibo e historial al reiniciar', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: { exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = accion();
          db.exec('COMMIT');
          return r;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
  };
  const variables = { FARO_VIGILANTE: JSON.stringify({ ...CONFIG_VIGILANTE, activadoEn: Date.now() - SEGUNDO_MS }) };
  let servidor = new AccesoPublicoDurable(estado, variables);
  const cliente = new AlmacenVigilanteDurable({ idFromName: () => 'registro-publico-v1', get: () => servidor });
  await cliente.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
  await cliente.prepararTrabajos();
  await cliente.prepararActivacion();
  await abrirSesionDePrueba(cliente, acceso);
  await assert.rejects(cliente.comprobarVigilanteDeSesion(acceso));
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_vigilante'").get()?.n, 0);
  await exigirSesionParaPreparar(cliente, db);
  await cliente.prepararVigilanteDeSesion(acceso);
  const comprobada = await cliente.comprobarVigilanteDeSesion(acceso);
  assert.equal(comprobada.estado, 'activa');
  if (comprobada.estado !== 'activa') {
    throw new Error('sesión inesperada');
  }
  assert.equal(comprobada.vigilante.origenDatos, 'recibo');
  assert.ok(comprobada.vigilante.incidencias.some((i) => i.motivo === 'sin_observacion_correlacionada'));
  servidor = new AccesoPublicoDurable(estado, variables);
  const historia = await cliente.historialVigilanteDeSesion(acceso, { limite: LIMITE });
  assert.equal(historia.estado, 'activa');
  if (historia.estado !== 'activa') {
    throw new Error('sesión inesperada');
  }
  assert.ok(historia.historial.decisiones.length > 0);
  await abrirSesionDePrueba(cliente, { ...acceso, huellaSesion: 'c'.repeat(LONGITUD_HUELLA) });
  assert.equal((await cliente.comprobarVigilanteDeSesion(acceso)).estado, 'sustituida');
});

test('el cliente rechaza DTO remoto inválido sin adoptar una respuesta de éxito', async () => {
  const cliente = new AlmacenVigilanteDurable({
    idFromName: () => 'registro-publico-v1',
    get: () => ({ fetch: async () => Response.json({ estado: 'activa', sesion: {}, vigilante: {} }) }),
  });
  await assert.rejects(cliente.comprobarVigilanteDeSesion(acceso));
});

test('el historial no acepta filas desordenadas ni cursor ajeno a la última decisión', async () => {
  const { leerHistorialVigilantePanel } = await import('../../src/administracion/vigilante-panel.js');
  const fila = {
    id: 1,
    clave: 'lectura-datos',
    estado: 'incidencia',
    motivo: 'sin_observacion_correlacionada',
    observadoEn: 1,
    evaluadoEn: 1,
    origen: 'recibo',
  };
  assert.throws(() => leerHistorialVigilantePanel({ version: 1, revision: 1, decisiones: [fila], siguiente: 2 }));
  assert.throws(() =>
    leerHistorialVigilantePanel({ version: 1, revision: 1, decisiones: [{ ...fila, id: 2 }, fila], siguiente: null }),
  );
});
