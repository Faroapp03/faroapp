/**
 * La pieza común decide si cabe un trabajo nuevo sin quitarle su publicación al anterior. La programada la obedece;
 * el botón del panel no, porque la persona puede sustituir a propósito un candidato atascado. SQL real, sin red.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { AccionActualizacion } from '../../src/administracion/ejecutor-github.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import { admitirReservaSqlite } from '../../src/plataforma/acceso-publico/admision-reserva-sqlite.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const SEGUNDO = 1000;
const AHORA = Date.parse('2026-10-17T03:00:00Z');
const DIA = 24 * 60 * 60 * SEGUNDO;
const TICK = { eventoEn: AHORA, cron: '0 3 * * *' };
const PRIMERA = '11111111-1111-4111-8111-111111111111';
const SEGUNDA = '22222222-2222-4222-8222-222222222222';
const TAM_HASH = 64;
const TAM_SHA = 40;
const TAM_PAQUETE = 16;
const VIDA_TOKEN_S = 600;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/mantenimiento/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };

function motor(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
    },
    transaccion: (accion) => {
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
async function fixture(t: TestContext, { conActivacion = true } = {}) {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  const reloj = { ahora: AHORA };
  new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => reloj.ahora });
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
  t.after(() => db.close());
  await backend.prepararPanel(POLITICA);
  await backend.prepararTrabajos();
  if (conActivacion) {
    await backend.prepararActivacion();
  }
  await abrirSesionDePrueba(backend, ACCESO);
  const eventos = () =>
    db
      .prepare('SELECT resultado, motivo FROM administracion_programacion_eventos ORDER BY evento_en')
      .all()
      .map(({ resultado, motivo }) => [resultado, motivo]);
  return { sql, backend, reloj, eventos };
}
function identidad(): IdentidadEjecucionGitHub {
  const { audiencia: _, ...pins } = CONFIANZA;
  return {
    ...pins,
    runId: '123',
    runAttempt: '1',
    jti: 'sintetico',
    emitidoEn: AHORA / SEGUNDO,
    caducaEn: AHORA / SEGUNDO + VIDA_TOKEN_S,
  };
}
type Backend = AlmacenSesionPanelSqlite;
async function pulsar(backend: Backend, solicitudId: string) {
  const { revision } = await backend.leerTrabajoPrivado();
  const solicitud = { solicitudId, accion: 'actualizar-datos', revisionEsperada: revision } as const;
  const reserva = await backend.reservarTrabajoDeSesion(ACCESO, solicitud, CONFIANZA);
  assert.ok('trabajos' in reserva);
  return reserva.estado;
}
/** Lleva el trabajo indicado hasta un recibo validado: el candidato queda listo para su activación. */
async function validar(backend: Backend, solicitudId: string, accion: AccionActualizacion) {
  const t = (await backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(t);
  assert.equal(t.solicitudId, solicitudId);
  const referencia = { solicitudId, revisionReserva: t.revisionReserva };
  assert.equal((await backend.confirmarInicio({ ...referencia, accion }, identidad())).estado, 'aplicado');
  const recibo = {
    ...referencia,
    accion,
    resultado: 'validado',
    veredicto: 'verde',
    terminadoEn: new Date(AHORA).toISOString().replace('.000Z', 'Z'),
    huellaPaquete: 'c'.repeat(TAM_PAQUETE),
    error: null,
  } as const;
  assert.equal((await backend.registrarRecibo(recibo, 'd'.repeat(TAM_HASH), identidad())).estado, 'aplicado');
  return { ...referencia, runId: '123', revisionEsperada: 0 };
}
async function candidatoDelPanel(backend: Backend) {
  assert.equal(await pulsar(backend, PRIMERA), 'nueva');
  return validar(backend, PRIMERA, 'actualizar-datos');
}

test('sin nada pendiente se admite; con un trabajo abierto, ocupado', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(admitirReservaSqlite(f.sql, AHORA), { admitida: true });
  assert.equal(await pulsar(f.backend, PRIMERA), 'nueva');
  assert.deepEqual(admitirReservaSqlite(f.sql, AHORA), { admitida: false, motivo: 'ocupado' });
  assert.equal(await pulsar(f.backend, SEGUNDA), 'ocupado');
});

test('sin la activación preparada no hay ninguna pendiente', async (t) => {
  const f = await fixture(t, { conActivacion: false });
  assert.deepEqual(admitirReservaSqlite(f.sql, AHORA), { admitida: true });
});

test('con un candidato validado en plazo la programada se omite y el panel, aun así, reserva: la persona decide', async (t) => {
  const f = await fixture(t);
  await candidatoDelPanel(f.backend);
  assert.deepEqual(admitirReservaSqlite(f.sql, AHORA), { admitida: false, motivo: 'candidato_en_plazo' });
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'omitida-candidato');
  assert.deepEqual(f.eventos(), [['omitida-candidato', 'candidato-en-plazo']]);
  assert.equal(await pulsar(f.backend, SEGUNDA), 'nueva');
  assert.equal((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.solicitudId, SEGUNDA);
});

test('con una activación sin resolver no se admite, y la programada se omite con su motivo', async (t) => {
  const f = await fixture(t);
  const solicitud = await candidatoDelPanel(f.backend);
  assert.equal((await f.backend.reservarActivacion(solicitud, identidad())).estado, 'aplicado');
  assert.deepEqual(admitirReservaSqlite(f.sql, AHORA), { admitida: false, motivo: 'activacion_pendiente' });
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'omitida-candidato');
  assert.deepEqual(f.eventos(), [['omitida-candidato', 'activacion-sin-resolver']]);
});

test('una activación resuelta o un candidato fuera de plazo dejan de impedir la reserva', async (t) => {
  const resuelta = await fixture(t);
  const solicitud = await candidatoDelPanel(resuelta.backend);
  assert.equal((await resuelta.backend.reservarActivacion(solicitud, identidad())).estado, 'aplicado');
  const rechazo = { tipo: 'rechazar', error: 'candidato_no_verificable' } as const;
  const paso = { ...solicitud, revisionEsperada: 1, paso: rechazo };
  assert.equal((await resuelta.backend.registrarPasoActivacion(paso, identidad())).estado, 'aplicado');
  assert.deepEqual(admitirReservaSqlite(resuelta.sql, AHORA), { admitida: true });
  const vencido = await fixture(t);
  await candidatoDelPanel(vencido.backend);
  vencido.reloj.ahora += DIA;
  assert.deepEqual(admitirReservaSqlite(vencido.sql, vencido.reloj.ahora), { admitida: true });
});
