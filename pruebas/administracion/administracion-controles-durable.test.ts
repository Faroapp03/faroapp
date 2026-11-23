/** Ensayo del protocolo privado con SQLite real; no simula un despliegue en Cloudflare. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido, socioPersistido } from '../ayudas/registro-persistido-anterior.ts';

const HUELLAS_CARACTERES = 64;
const JTI_CARACTERES = 22;
const MS_POR_SEGUNDO = 1000;
const VIDA_TOKEN_S = 60;
const PLAZO_DOBLE_MS = 20;
const TAMANO_EXCESIVO = 3000;
const politica = (): PoliticaControles => ({
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
});
const entorno = {
  FARO_API_ALTAS: 'si',
  FARO_API_PUBLICO_LIMITES: JSON.stringify({
    clientes: 2,
    altasPorDia: 10,
    altasPorRedPorDia: 1,
    consultasPorHora: 3,
    consultasGlobalesPorHora: 10,
    credencialesPorHora: 4,
  }),
};

function estadoSqlite(db: DatabaseSync): EstadoAccesoPublicoDurable {
  return {
    storage: {
      sql: {
        exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }),
      },
      transactionSync: <T>(accion: () => T): T => {
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
    },
  };
}

test('controles DO: dos lectores y reinicio conservan política, clientes, cuotas y revocaciones', async () => {
  const db = new DatabaseSync(':memory:');
  const estado = estadoSqlite(db);
  let durable = new AccesoPublicoDurable(estado, entorno);
  const espacio = {
    idFromName: (nombre: string) => {
      assert.equal(nombre, 'registro-publico-v1');
      return nombre;
    },
    get: () => ({ fetch: (peticion: Request) => durable.fetch(peticion) }),
  };
  const uno = new AlmacenPublicoDurable(espacio);
  const dos = new AlmacenPublicoDurable(espacio);
  const socio = { id: 'pub-uno', huellas: ['a'.repeat(HUELLAS_CARACTERES)], consultasPorHora: 3 };
  const cuentas = [{ clave: 'consultas:global', limite: 1, ventanaMs: 86_400_000 }];
  const jti = 'a'.repeat(JTI_CARACTERES);
  try {
    assert.equal(await uno.leerControles(), null);
    sembrarSocioPersistido(db, socio);
    assert.equal(await uno.consumir(cuentas), true);
    await uno.revocar(jti, Math.floor(Date.now() / MS_POR_SEGUNDO) + VIDA_TOKEN_S);
    const inicial = await uno.activarControles(politica());
    assert.deepEqual(inicial, { ...politica(), revision: 0 });
    assert.deepEqual(await dos.leerControles(), inicial);
    await assert.rejects(dos.activarControles(politica()), AlmacenPublicoNoDisponible);
    const cerrada = { ...politica(), api: 'habilitada' as const, mcp: true };
    const cambio = await uno.cambiarControles(inicial.revision, cerrada);
    assert.deepEqual(cambio, { estado: 'cambiado', controles: { ...cerrada, revision: 1 } });
    assert.deepEqual(await dos.cambiarControles(inicial.revision, politica()), {
      estado: 'conflicto',
      controles: cambio.controles,
    });
    durable = new AccesoPublicoDurable(estado, entorno);
    assert.deepEqual(await dos.leerControles(), cambio.controles);
    assert.deepEqual(socioPersistido(db, socio.id), socio);
    assert.equal(await dos.consumir(cuentas), false);
    assert.equal(await dos.revocado(jti), true);
  } finally {
    db.close();
  }
});

test('controles DO: migración conserva altas cerradas y entradas defectuosas no escriben', async () => {
  const db = new DatabaseSync(':memory:');
  const durable = new AccesoPublicoDurable(estadoSqlite(db), entorno);
  const enviar = (ruta: string, cuerpo: unknown, origen = 'https://registro-socios.invalid') =>
    durable.fetch(new Request(`${origen}${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }));
  const almacen = new AlmacenPublicoDurable({ idFromName: () => 'registro-publico-v1', get: () => durable });
  try {
    await almacen.leerControles();
    db.exec('UPDATE publico_estado SET abierto=0');
    const estado = await almacen.activarControles(politica());
    assert.equal(estado.api, 'habilitada');
    for (const [ruta, cuerpo] of [
      ['/controles/leer', { extra: true }],
      ['/controles/activar', { politica: { ...politica(), secreto: 'no-admitido' } }],
      ['/controles/cambiar', { revisionEsperada: -1, politica: politica() }],
      ['/controles/cambiar', { revisionEsperada: 0, politica: { ...politica(), mcp: 'si' } }],
      ['/controles/cambiar', { revisionEsperada: 0, politica: politica(), extra: true }],
    ] as const) {
      assert.equal((await enviar(ruta, cuerpo)).status, ESTADO_HTTP.solicitudIncorrecta);
      assert.deepEqual(await almacen.leerControles(), estado);
    }
    assert.equal(
      (await enviar('/controles/leer', {}, 'https://publico.example')).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
  } finally {
    db.close();
  }
});

test('cliente de controles DO rechaza lecturas defectuosas o agotadas sin alternativa en memoria', async () => {
  for (const responder of [
    () => new Response('{'),
    () => new Response(JSON.stringify({ controles: { ...politica(), revision: -1 } })),
    () => new Response(JSON.stringify({ controles: null, extra: true })),
    () => new Response(JSON.stringify({ controles: { ...politica(), revision: 0, extra: true } })),
    () => new Response(JSON.stringify({ controles: null, relleno: 'x'.repeat(TAMANO_EXCESIVO) })),
    () => new Response('{}', { status: ESTADO_HTTP.noDisponible }),
    () => Promise.reject(new Error('fallo sintético privado')),
    () => new Promise<Response>(() => undefined),
    () => new Response(new ReadableStream({ start() {} })),
  ]) {
    const almacen = new AlmacenPublicoDurable(
      { idFromName: () => 'id', get: () => ({ fetch: async () => responder() }) },
      { tiempoLimiteMs: PLAZO_DOBLE_MS },
    );
    await assert.rejects(almacen.leerControles(), AlmacenPublicoNoDisponible);
  }
});

test('controles DO: perder la política adoptada cierra lectura y altas sin volver al estado heredado', async () => {
  for (const romper of ['DELETE FROM administracion_controles', 'DROP TABLE administracion_controles']) {
    const db = new DatabaseSync(':memory:');
    const estado = estadoSqlite(db);
    const durable = new AccesoPublicoDurable(estado, entorno);
    const almacen = new AlmacenPublicoDurable({ idFromName: () => 'registro-publico-v1', get: () => durable });
    try {
      await almacen.activarControles(politica());
      db.exec(romper);
      await assert.rejects(almacen.leerControles(), AlmacenPublicoNoDisponible);
      assert.throws(() => new AccesoPublicoDurable(estado, entorno));
      assert.equal(db.prepare('SELECT count(*) AS total FROM publico_contadores').get()?.total, 0);
    } finally {
      db.close();
    }
  }
});

test('cliente de controles valida entradas y revisiones de confirmación', async () => {
  let llamadas = 0;
  const almacen = new AlmacenPublicoDurable({
    idFromName: () => 'id',
    get: () => ({
      fetch: async () => {
        llamadas++;
        return new Response(JSON.stringify({ estado: 'cambiado', controles: { ...politica(), revision: 0 } }));
      },
    }),
  });
  await assert.rejects(almacen.cambiarControles(-1, politica()));
  await assert.rejects(almacen.activarControles({ ...politica(), mcp: 'si' } as unknown as PoliticaControles));
  assert.equal(llamadas, 0);
  await assert.rejects(almacen.cambiarControles(0, politica()), AlmacenPublicoNoDisponible);
});
