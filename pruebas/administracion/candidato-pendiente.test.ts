import assert from 'node:assert/strict';
import test from 'node:test';
import type { SolicitudActualizacion } from '../../src/administracion/ejecutor-github.ts';
import { crearComprobadorProgramado } from '../../src/administracion/programada.ts';
import type { ReciboTrabajo, TrabajoPrivado } from '../../src/administracion/trabajos.ts';
import {
  candidatoSinIntencion,
  retirarMarcaCandidato,
} from '../../src/plataforma/acceso-publico/candidato-pendiente-sqlite.ts';
import {
  comprobarVigilanteSqlite,
  prepararVigilanteSqlite,
  registrarFalloLecturaLocalVigilanteSqlite,
} from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';
import {
  baseVigilante,
  CONFIANZA_VIGILANTE,
  CONFIG_VIGILANTE,
  CORTE_VIGILANTE,
  DIA_VIGILANTE,
  PROGRAMADA_VIGILANTE,
} from '../ayudas/vigilante.ts';

type Base = Awaited<ReturnType<typeof baseVigilante>>;
const TAM_HASH = 64;
const TAM_PAQUETE = 16;
const TAM_SHA = 40;
const VEREDICTO = { validado: 'verde', rechazado: 'rojo', 'sin-pendientes': null } as const;
const SEGUNDO = 1000;
const VIDA = 600;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
const TICK = Date.parse('2026-10-24T03:00:00Z');
const INICIAL: SolicitudActualizacion = {
  solicitudId: '11111111-1111-4111-8111-111111111111',
  accion: 'actualizar-datos',
  revisionReserva: 1,
};
function identidad(f: Base, runId: string) {
  const { audiencia: _, ...pins } = CONFIANZA_VIGILANTE;
  const emitidoEn = Math.floor(f.reloj.ahora / SEGUNDO);
  return { ...pins, runId, runAttempt: '1', jti: 'sintetico', emitidoEn, caducaEn: emitidoEn + VIDA };
}
function resultado(f: Base, t: SolicitudActualizacion, valor: ReciboTrabajo['resultado']): ReciboTrabajo {
  return {
    solicitudId: t.solicitudId,
    accion: t.accion,
    revisionReserva: t.revisionReserva,
    resultado: valor,
    terminadoEn: new Date(f.reloj.ahora).toISOString().replace('.000Z', 'Z'),
    veredicto: VEREDICTO[valor],
    huellaPaquete: valor === 'validado' ? 'c'.repeat(TAM_PAQUETE) : null,
    error: valor === 'rechazado' ? 'candidato_no_verificable' : null,
  };
}
async function recibir(f: Base, t: SolicitudActualizacion, runId: string, valor: ReciboTrabajo['resultado']) {
  const oidc = identidad(f, runId);
  const inicio = { solicitudId: t.solicitudId, accion: t.accion, revisionReserva: t.revisionReserva };
  assert.equal((await f.almacen.confirmarInicio(inicio, oidc)).estado, 'aplicado');
  const recibo = resultado(f, t, valor);
  assert.equal(
    (await f.almacen.registrarRecibo(recibo, 'd'.repeat(TAM_HASH), { ...oidc, sha: '0'.repeat(TAM_SHA) })).estado,
    'conflicto',
  );
  assert.equal((await f.almacen.registrarRecibo(recibo, 'd'.repeat(TAM_HASH), oidc)).estado, 'aplicado');
  assert.equal((await f.almacen.registrarRecibo(recibo, 'd'.repeat(TAM_HASH), oidc)).estado, 'repetido');
}
async function corte(f: Base) {
  await abrirSesionDePrueba(f.almacen, ACCESO);
  await f.almacen.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: INICIAL.solicitudId, accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA_VIGILANTE,
  );
  await recibir(f, INICIAL, '101', 'validado');
  const trabajo = (await f.almacen.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(trabajo);
  return trabajo;
}
async function tick(f: Base, instante: number, runId: string, habilitada: boolean) {
  const envios: SolicitudActualizacion[] = [];
  const comprobar = crearComprobadorProgramado({
    almacen: f.almacen,
    confianza: CONFIANZA_VIGILANTE,
    activacionHabilitada: () => habilitada,
    reconciliar: async () => {
      throw new Error('no se necesita reconciliación');
    },
    despachar: async (s) => {
      envios.push(s);
      return { estado: 'despachada', runId };
    },
  });
  f.reloj.ahora = instante;
  const solicitud = { eventoEn: instante, cron: PROGRAMADA_VIGILANTE.cron };
  const estados = await Promise.all([
    comprobar(solicitud, new AbortController().signal),
    comprobar(solicitud, new AbortController().signal),
  ]);
  assert.deepEqual(estados.sort(), ['nueva', 'repetida']);
  assert.equal(envios.length, 1);
  const envio = envios[0];
  assert.ok(envio);
  return envio;
}
function comprobarAviso(f: Base) {
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, f.reloj.ahora);
  for (const comprobar of [comprobarVigilanteSqlite, registrarFalloLecturaLocalVigilanteSqlite]) {
    f.reloj.ahora++;
    const r = comprobar(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, f.reloj.ahora);
    const aviso = r.evaluacion.decisiones.find((d) => d.clave === 'activacion');
    assert.equal(aviso?.motivo, 'datos_validados_sin_publicar');
    assert.equal(aviso.estado, 'incidencia');
    assert.equal(aviso.referencia, new Date(CORTE_VIGILANTE).toISOString());
  }
}
async function comprobarAutoridad(f: Base, anterior: TrabajoPrivado, siguiente: SolicitudActualizacion) {
  const nueva = {
    solicitudId: siguiente.solicitudId,
    revisionReserva: siguiente.revisionReserva,
    runId: '103',
    revisionEsperada: 0,
  };
  assert.equal(
    (
      await f.almacen.reservarActivacion(
        { ...nueva, solicitudId: anterior.solicitudId, revisionReserva: anterior.revisionReserva, runId: '101' },
        identidad(f, '101'),
      )
    ).estado,
    'conflicto',
  );
  assert.equal((await f.almacen.reservarActivacion(nueva, identidad(f, '101'))).estado, 'conflicto');
  const reservada = await f.almacen.reservarActivacion(nueva, identidad(f, '103'));
  assert.equal(reservada.estado, 'aplicado');
  assert.equal(reservada.activacion.ultimaActivacion?.fase, 'reservada');
  comprobarAviso(f);
  assert.equal((await f.almacen.reservarActivacion(nueva, identidad(f, '103'))).estado, 'repetido');
  assert.equal(candidatoSinIntencion(f.sql, reservada.activacion.ultimaActivacion), null);
  assert.equal(
    (
      await f.almacen.registrarPasoActivacion(
        { ...nueva, revisionEsperada: 1, paso: { tipo: 'rechazar', error: 'candidato_no_verificable' } },
        identidad(f, '103'),
      )
    ).activacion.ultimaActivacion?.fase,
    'rechazada',
  );
}
test('corte después del recibo, rechazo, relevo con el mismo paquete y confirmación obsoleta', async (t) => {
  const f = await baseVigilante(t);
  const anterior = await corte(f);
  const primero = await tick(f, TICK, '102', true);
  assert.equal(primero.revisarPaquetePendiente, true);
  await recibir(f, primero, '102', 'rechazado');
  assert.equal(candidatoSinIntencion(f.sql, null)?.solicitudId, anterior.solicitudId);
  comprobarAviso(f);
  const siguiente = await tick(f, TICK + DIA_VIGILANTE, '103', true);
  assert.equal(siguiente.revisarPaquetePendiente, true);
  await recibir(f, siguiente, '103', 'validado');
  comprobarAviso(f);
  // Una confirmación tardía del lote anterior no consume el candidato más reciente ni siquiera con la misma huella de paquete.
  retirarMarcaCandidato(f.sql, anterior);
  assert.equal(candidatoSinIntencion(f.sql, null)?.solicitudId, siguiente.solicitudId);
  await comprobarAutoridad(f, anterior, siguiente);
  const trasRechazo = await tick(f, TICK + 2 * DIA_VIGILANTE, '104', true);
  assert.equal(trasRechazo.revisarPaquetePendiente, undefined);
});
test('activación deshabilitada conserva la prueba y no solicita publicar; al habilitarla se revalida', async (t) => {
  const f = await baseVigilante(t);
  await corte(f);
  const parado = await tick(f, TICK, '102', false);
  assert.equal(parado.revisarPaquetePendiente, undefined);
  await recibir(f, parado, '102', 'sin-pendientes');
  assert.equal(candidatoSinIntencion(f.sql, null)?.solicitudId, INICIAL.solicitudId);
  assert.equal((await tick(f, TICK + DIA_VIGILANTE, '103', true)).revisarPaquetePendiente, true);
});
test('fallo al conservar la marca revierte el recibo; reenvío y migración conservan la prueba una sola vez', async (t) => {
  const f = await baseVigilante(t);
  await abrirSesionDePrueba(f.almacen, ACCESO);
  await f.almacen.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: INICIAL.solicitudId, accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA_VIGILANTE,
  );
  await f.almacen.confirmarInicio(INICIAL, identidad(f, '101'));
  const recibo = resultado(f, INICIAL, 'validado');
  const guardar = () => f.almacen.registrarRecibo(recibo, 'd'.repeat(TAM_HASH), identidad(f, '101'));
  f.db.exec(
    "CREATE TRIGGER corte BEFORE INSERT ON administracion_candidato_pendiente BEGIN SELECT RAISE(ABORT,'corte'); END",
  );
  await assert.rejects(guardar);
  assert.equal((await f.almacen.leerTrabajoPrivado()).ultimoTrabajo?.resultado, null);
  assert.equal(candidatoSinIntencion(f.sql, null), null);
  f.db.exec('DROP TRIGGER corte');
  assert.equal((await guardar()).estado, 'aplicado');
  const esperada = candidatoSinIntencion(f.sql, null);
  assert.equal(esperada?.solicitudId, INICIAL.solicitudId);
  f.db.exec('DROP TABLE administracion_candidato_pendiente');
  await assert.rejects(() => f.almacen.prepararTrabajos());
  f.db.exec('ALTER TABLE publico_estado DROP COLUMN candidato_pendiente_version');
  await f.almacen.prepararTrabajos();
  await f.almacen.prepararTrabajos();
  assert.deepEqual(candidatoSinIntencion(f.sql, null), esperada);
  assert.equal((await guardar()).estado, 'repetido');
});
