/**
 * La reserva a demanda por el enlace privado del objeto durable: la petición y la respuesta se leen con sus claves
 * exactas en los dos lados, y la autoridad es la misma que la de las demás reservas. SQLite real, sin red; actores e
 * identificadores sintéticos.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import {
  AccesoPublicoDurable,
  type EspacioAccesoPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import {
  leerResultadoDemanda,
  pedirDemandaDurable,
} from '../../src/plataforma/acceso-publico/trabajos-demanda-sqlite.ts';
import { type PeticionDemanda, RUTA_DEMANDA } from '../../src/plataforma/acceso-publico/trabajos-durable.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const SEGUNDO = 1000;
const TAM_HASH = 64;
const TAM_SHA = 40;
const VIDA_TOKEN_S = 600;
const HTTP_INVALIDO = 400;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
const CONFIANZA = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
/** Actor sintético: no corresponde a ninguna cuenta. */
const ACTOR = { id: '424242', nombre: 'cuenta-sintetica' };
const CONFIGURACION = JSON.stringify({
  version: 1,
  habilitada: true,
  actores: [ACTOR.id],
  separacionMin: 30,
  maxDia: 2,
  maxMes: { 'actualizar-datos': 2, 'comprobar-vencidas': 6, 'actualizar-cursos': 10 },
  presupuestoMinMes: 1800,
  reservaProgramadaMin: 45,
});

/** El cliente que montará la ruta: la misma operación que las demás, sobre el enlace privado del almacén. */
class ClienteDemanda extends SesionUnicaDurable {
  operarDemanda(peticion: PeticionDemanda) {
    return pedirDemandaDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), peticion);
  }
}
function transaccion<T>(db: DatabaseSync, accion: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = accion();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
async function montaje(t: test.TestContext) {
  const db = new DatabaseSync(':memory:');
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: { exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: <T>(accion: () => T): T => transaccion(db, accion),
    },
  };
  const servidor = new AccesoPublicoDurable(estado, {});
  const espacio: EspacioAccesoPublicoDurable = {
    idFromName: (nombre) => nombre,
    get: () => ({ fetch: (p) => servidor.fetch(p) }),
  };
  t.after(() => db.close());
  const cliente = new ClienteDemanda(espacio);
  await cliente.prepararPanel(POLITICA);
  await abrirSesionDePrueba(cliente, ACCESO);
  await cliente.prepararTrabajos();
  await cliente.prepararActivacion();
  const enviar = (cuerpo: unknown) =>
    servidor.fetch(
      new Request(`https://registro-socios.invalid${RUTA_DEMANDA}`, { method: 'POST', body: JSON.stringify(cuerpo) }),
    );
  const filas = () => db.prepare('SELECT run_id, decision FROM administracion_solicitudes').all();
  return { cliente, enviar, filas };
}
function ejecucion(runId: string): IdentidadEjecucionGitHub {
  const { audiencia: _, ...pins } = CONFIANZA;
  const ahora = Math.floor(Date.now() / SEGUNDO);
  return {
    ...pins,
    runId,
    runAttempt: '1',
    jti: `sintetico-${runId}`,
    emitidoEn: ahora,
    caducaEn: ahora + VIDA_TOKEN_S,
  };
}
function peticion(runId: string): Extract<PeticionDemanda, { operacion: 'reservar' }> {
  const identidad = { ejecucion: ejecucion(runId), actor: ACTOR };
  return {
    operacion: 'reservar',
    accion: 'actualizar-cursos',
    identidad,
    confianza: CONFIANZA,
    configuracion: CONFIGURACION,
  };
}

test('por el enlace privado: reserva, repetida, ocupado para otro run y consulta que no crea nada', async (t) => {
  const m = await montaje(t);
  const reserva = await m.cliente.operarDemanda(peticion('9001'));
  assert.equal(reserva.estado, 'reservada');
  assert.deepEqual(await m.cliente.operarDemanda(peticion('9001')), { ...reserva, estado: 'repetida' });
  assert.deepEqual(await m.cliente.operarDemanda(peticion('9002')), { estado: 'rechazada', motivo: 'ocupado' });
  assert.deepEqual(await m.cliente.operarDemanda({ operacion: 'consultar', runId: '9001' }), reserva);
  assert.deepEqual(await m.cliente.operarDemanda({ operacion: 'consultar', runId: '9003' }), { estado: 'sin_reserva' });
  assert.deepEqual(
    m.filas().map((f) => [f.run_id, f.decision]),
    [
      ['9001', 'admitida'],
      ['9002', 'rechazada'],
    ],
  );
  const trabajo = (await m.cliente.leerTrabajoPrivado()).ultimoTrabajo;
  assert.deepEqual([trabajo?.origen, trabajo?.runId, trabajo?.estado], ['demanda', '9001', 'despachado']);
});

test('el objeto durable lee la petición con sus claves exactas antes de tocar la autoridad', async (t) => {
  const m = await montaje(t);
  const valida = peticion('9001');
  const defectuosas = [
    { ...valida, extra: true },
    { ...valida, accion: 'reintentar-pendientes' },
    { ...valida, operacion: 'borrar' },
    { ...valida, identidad: { ...valida.identidad, actor: { ...ACTOR, correo: 'x' } } },
    { ...valida, identidad: { ...valida.identidad, actor: { id: 'no-numerico', nombre: ACTOR.nombre } } },
    { ...valida, configuracion: 7 },
    { operacion: 'consultar', runId: 'no-numerico' },
    { operacion: 'consultar', runId: '9001', accion: 'actualizar-cursos' },
  ];
  for (const cuerpo of defectuosas) {
    const respuesta = await m.enviar(cuerpo);
    assert.equal(respuesta.status, HTTP_INVALIDO, JSON.stringify(cuerpo));
    assert.deepEqual(await respuesta.json(), { error: 'solicitud_invalida' });
  }
  assert.deepEqual(m.filas(), []);
  const correcta = await m.enviar(valida);
  assert.equal(((await correcta.json()) as { estado: unknown }).estado, 'reservada');
});

test('el cliente lee la respuesta con sus claves exactas y solo los estados de la operación pedida', () => {
  const reservar = peticion('9001');
  const consultar = { operacion: 'consultar', runId: '9001' } as const;
  const reserva = { estado: 'reservada', solicitudId: '11111111-1111-4111-8111-111111111111', revisionReserva: 1 };
  assert.deepEqual(leerResultadoDemanda(reserva, reservar), reserva);
  assert.deepEqual(leerResultadoDemanda({ estado: 'rechazada', motivo: 'tope_dia' }, reservar), {
    estado: 'rechazada',
    motivo: 'tope_dia',
  });
  const defectuosas: [unknown, PeticionDemanda][] = [
    [{ ...reserva, actor: ACTOR }, reservar],
    [{ ...reserva, estado: 'repetida' }, consultar],
    [{ estado: 'rechazada', motivo: 'ocupado' }, consultar],
    [{ estado: 'rechazada', motivo: 'requiere_atencion' }, reservar],
    [{ estado: 'sin_reserva' }, reservar],
    [{ estado: 'cerrada' }, consultar],
    [{ estado: 'cerrada', motivo: 'ausente' }, reservar],
    [null, reservar],
  ];
  for (const [respuesta, pedida] of defectuosas) {
    assert.throws(() => leerResultadoDemanda(respuesta, pedida), JSON.stringify(respuesta));
  }
});
