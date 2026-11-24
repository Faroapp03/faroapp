/**
 * La autoridad de la reserva a demanda: el run pide su reserva con su identidad ya verificada; la autoridad aplica las
 * guardias comunes y los topes en una sola transacción, anota la solicitud y crea el trabajo con su run fijado. Cada
 * negativa lleva su control positivo. SQL real, sin red; actores, identificadores y revisiones son sintéticos.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { type AccionDemanda, leerConfiguracionDemanda } from '../../src/administracion/configuracion-demanda.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import { VENTANA_TRABAJO_PROGRAMADO_MS } from '../../src/administracion/programacion-trabajos.ts';
import { decidirTopes, MARGEN_MIN_POR_TRABAJO } from '../../src/administracion/topes-demanda.ts';
import { estadoPublicoTrabajos } from '../../src/administracion/trabajos.ts';
import { leerHistorialDelMesSqlite } from '../../src/plataforma/acceso-publico/solicitudes-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import {
  AlmacenSesionDemandaSqlite,
  MAX_RECHAZOS_ANOTADOS_DIA,
  PLAZO_INICIO_DEMANDA_MS,
} from '../../src/plataforma/acceso-publico/trabajos-demanda-sqlite.ts';
import type { PeticionDemanda } from '../../src/plataforma/acceso-publico/trabajos-durable.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const AHORA = Date.parse('2026-10-17T03:00:00Z');
const TICK = { eventoEn: AHORA, cron: '0 3 * * *' };
const TAM_HASH = 64;
const HEXADECIMAL = 16;
const TAM_SHA = 40;
const TAM_PAQUETE = 16;
const VIDA_TOKEN_S = 600;
const ANTES_DEL_PLAZO = PLAZO_INICIO_DEMANDA_MS - MINUTO;
const TRAS_EL_PLAZO = PLAZO_INICIO_DEMANDA_MS + MINUTO;
const DURACION_CICLO_MIN = 25;
const INSISTENCIAS = 2 * MAX_RECHAZOS_ANOTADOS_DIA;
const PANEL = '11111111-1111-4111-8111-111111111111';
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/mantenimiento/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
/** Actores sintéticos: ni los identificadores ni los nombres corresponden a ninguna cuenta. */
const ACTOR = { id: '424242', nombre: 'cuenta-sintetica' };
const OTRO_ACTOR = { id: '434343', nombre: 'otra-cuenta-sintetica' };
const BASE = {
  version: 1,
  habilitada: true,
  actores: [ACTOR.id, OTRO_ACTOR.id],
  separacionMin: 30,
  maxDia: 6,
  maxMes: { 'actualizar-datos': 10, 'comprobar-vencidas': 10, 'actualizar-cursos': 10 },
  presupuestoMinMes: 1800,
  reservaProgramadaMin: 45,
};
const configuracion = (cambios: Partial<typeof BASE> = {}) => JSON.stringify({ ...BASE, ...cambios });

/** Motor SQL real con un fallo provocado en la sentencia que elija la prueba. */
function motor(db: DatabaseSync, fallo: { si: (sentencia: string) => boolean }): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      if (fallo.si(sql)) {
        throw new Error('Fallo provocado por la prueba');
      }
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
async function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  const fallo = { si: (_sentencia: string) => false };
  const sql = motor(db, fallo);
  const reloj = { ahora: AHORA };
  new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => reloj.ahora });
  const backend = new AlmacenSesionDemandaSqlite(sql, {
    ahora: () => reloj.ahora,
    cubrir: async (_fecha, escribir) => escribir(),
  });
  t.after(() => db.close());
  await backend.prepararPanel(POLITICA);
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
  await abrirSesionDePrueba(backend, ACCESO);
  const filas = () =>
    db
      .prepare(
        'SELECT origen, accion, actor_id, actor, run_id, decision, motivo, minutos FROM administracion_solicitudes',
      )
      .all()
      .map((fila) => ({ ...fila }));
  return { db, sql, backend, reloj, fallo, filas, sesiones: 0 };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function ejecucion(runId: string, ahora: number): IdentidadEjecucionGitHub {
  const { audiencia: _, ...pins } = CONFIANZA;
  const emitido = Math.floor(ahora / SEGUNDO);
  return {
    ...pins,
    runId,
    runAttempt: '1',
    jti: `sintetico-${runId}-${ahora}`,
    emitidoEn: emitido,
    caducaEn: emitido + VIDA_TOKEN_S,
  };
}
function peticion(
  f: Fixture,
  runId: string,
  { accion = 'actualizar-cursos', actor = ACTOR, texto = configuracion() as string | null } = {},
): PeticionDemanda {
  const identidad = { ejecucion: ejecucion(runId, f.reloj.ahora), actor };
  return {
    operacion: 'reservar',
    accion: accion as AccionDemanda,
    identidad,
    confianza: CONFIANZA,
    configuracion: texto,
  };
}
const reservar = (f: Fixture, runId: string, opciones: Parameters<typeof peticion>[2] = {}) =>
  f.backend.operarDemanda(peticion(f, runId, opciones));
async function ultimo(f: Fixture) {
  const t = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(t);
  return t;
}
/** El run pide su permiso de inicio por la vía de siempre, con la referencia que le dio la reserva. */
async function iniciar(f: Fixture, runId: string) {
  const t = await ultimo(f);
  const inicio = { solicitudId: t.solicitudId, revisionReserva: t.revisionReserva, accion: t.accion };
  return (await f.backend.confirmarInicio(inicio, ejecucion(runId, f.reloj.ahora))).estado;
}
async function terminar(f: Fixture, runId: string, resultado: 'validado' | 'sin-pendientes') {
  const t = await ultimo(f);
  const recibo = {
    solicitudId: t.solicitudId,
    revisionReserva: t.revisionReserva,
    accion: t.accion,
    resultado,
    veredicto: resultado === 'validado' ? 'verde' : null,
    terminadoEn: new Date(Math.floor(f.reloj.ahora / SEGUNDO) * SEGUNDO).toISOString().replace('.000Z', 'Z'),
    huellaPaquete: resultado === 'validado' ? 'c'.repeat(TAM_PAQUETE) : null,
    error: null,
  } as const;
  const registro = await f.backend.registrarRecibo(recibo, 'd'.repeat(TAM_HASH), ejecucion(runId, f.reloj.ahora));
  assert.equal(registro.estado, 'aplicado');
  return { solicitudId: t.solicitudId, revisionReserva: t.revisionReserva, runId, revisionEsperada: 0 };
}
/** Un ciclo completo sin candidato que activar: deja la autoridad libre. */
async function cicloSinPendientes(f: Fixture, runId: string) {
  assert.equal((await reservar(f, runId)).estado, 'reservada');
  assert.equal(await iniciar(f, runId), 'aplicado');
  await terminar(f, runId, 'sin-pendientes');
}
/** Reserva y devuelve la referencia con la que el run pediría su inicio. */
async function ultimoTrasReservar(f: Fixture, runId: string) {
  assert.equal((await reservar(f, runId)).estado, 'reservada');
  const t = await ultimo(f);
  return { solicitudId: t.solicitudId, revisionReserva: t.revisionReserva, accion: t.accion };
}
/** Como el navegador: lee el estado y pide la reserva con su revisión. La sesión caduca en un ciclo largo. */
async function pulsar(f: Fixture) {
  f.sesiones += 1;
  const acceso = { ...ACCESO, huellaSesion: f.sesiones.toString(HEXADECIMAL).padStart(TAM_HASH, 'e') };
  await abrirSesionDePrueba(f.backend, acceso);
  const lectura = await f.backend.leerTrabajoDeSesion(acceso);
  assert.ok(lectura.estado === 'activa');
  const revision = lectura.trabajos.revision;
  const solicitud = { solicitudId: PANEL, accion: 'actualizar-datos', revisionEsperada: revision } as const;
  return (await f.backend.reservarTrabajoDeSesion(acceso, solicitud, CONFIANZA)).estado;
}
const rechazo = (motivo: string) => ({ estado: 'rechazada', motivo });

test('reserva el trabajo con su run fijado; el mismo run recibe la misma reserva y pide su inicio de siempre', async (t) => {
  const f = await fixture(t);
  const reserva = await reservar(f, '9001');
  assert.equal(reserva.estado, 'reservada');
  assert.ok(reserva.estado === 'reservada');
  const trabajo = await ultimo(f);
  assert.deepEqual(
    [trabajo.origen, trabajo.runId, trabajo.estado, trabajo.protocoloInicio, trabajo.inicioConfirmado, trabajo.accion],
    ['demanda', '9001', 'despachado', 'obligatorio', false, 'actualizar-cursos'],
  );
  assert.deepEqual(trabajo.confianza, CONFIANZA);
  assert.deepEqual(reserva, {
    estado: 'reservada',
    solicitudId: trabajo.solicitudId,
    revisionReserva: trabajo.revisionReserva,
  });
  const revision = (await f.backend.leerTrabajoPrivado()).revision;
  f.reloj.ahora += MINUTO;
  assert.deepEqual(await reservar(f, '9001'), { ...reserva, estado: 'repetida' });
  assert.equal((await f.backend.leerTrabajoPrivado()).revision, revision);
  assert.deepEqual(await f.backend.operarDemanda({ operacion: 'consultar', runId: '9001' }), reserva);
  assert.deepEqual(await f.backend.operarDemanda({ operacion: 'consultar', runId: '9002' }), { estado: 'sin_reserva' });
  assert.equal(f.filas().length, 1);
  assert.deepEqual(f.filas()[0], {
    origen: 'demanda',
    accion: 'actualizar-cursos',
    actor_id: ACTOR.id,
    actor: ACTOR.nombre,
    run_id: '9001',
    decision: 'admitida',
    motivo: null,
    minutos: null,
  });
  assert.equal(await iniciar(f, '9001'), 'aplicado');
});

test('las guardias comunes rechazan con su motivo exacto y anotan la solicitud; resueltas, se admite', async (t) => {
  const f = await fixture(t);
  assert.equal((await reservar(f, '9001', { accion: 'actualizar-datos' })).estado, 'reservada');
  assert.deepEqual(await reservar(f, '9002'), rechazo('ocupado'));
  assert.equal(await iniciar(f, '9001'), 'aplicado');
  const candidato = await terminar(f, '9001', 'validado');
  assert.deepEqual(await reservar(f, '9003'), rechazo('candidato_en_plazo'));
  assert.equal((await f.backend.reservarActivacion(candidato, ejecucion('9001', f.reloj.ahora))).estado, 'aplicado');
  assert.deepEqual(await reservar(f, '9004'), rechazo('activacion_pendiente'));
  const paso = {
    ...candidato,
    revisionEsperada: 1,
    paso: { tipo: 'rechazar', error: 'candidato_no_verificable' },
  } as const;
  assert.equal((await f.backend.registrarPasoActivacion(paso, ejecucion('9001', f.reloj.ahora))).estado, 'aplicado');
  f.reloj.ahora += HORA;
  assert.equal((await reservar(f, '9005')).estado, 'reservada');
  const motivos = f.filas().map((fila) => [fila.run_id, fila.decision, fila.motivo, fila.actor_id]);
  assert.deepEqual(motivos, [
    ['9001', 'admitida', null, ACTOR.id],
    ['9002', 'rechazada', 'ocupado', ACTOR.id],
    ['9003', 'rechazada', 'candidato_en_plazo', ACTOR.id],
    ['9004', 'rechazada', 'activacion_pendiente', ACTOR.id],
    ['9005', 'admitida', null, ACTOR.id],
  ]);
});

test('los topes rechazan por separación, día, mes y presupuesto; dentro de ellos, se admite', async (t) => {
  const separacion = await fixture(t);
  await cicloSinPendientes(separacion, '9001');
  separacion.reloj.ahora += 10 * MINUTO;
  assert.deepEqual(
    await reservar(separacion, '9002', { texto: configuracion({ separacionMin: 120 }) }),
    rechazo('separacion'),
  );
  separacion.reloj.ahora += 2 * HORA;
  assert.equal(
    (await reservar(separacion, '9003', { texto: configuracion({ separacionMin: 120 }) })).estado,
    'reservada',
  );

  const dia = await fixture(t);
  await cicloSinPendientes(dia, '9001');
  dia.reloj.ahora += HORA;
  assert.deepEqual(await reservar(dia, '9002', { texto: configuracion({ maxDia: 1 }) }), rechazo('tope_dia'));
  dia.reloj.ahora += DIA;
  assert.equal((await reservar(dia, '9003', { texto: configuracion({ maxDia: 1 }) })).estado, 'reservada');

  const mes = await fixture(t);
  const sinCursos = configuracion({ maxMes: { ...BASE.maxMes, 'actualizar-cursos': 0 } });
  assert.deepEqual(await reservar(mes, '9001', { texto: sinCursos }), rechazo('tope_mes'));
  assert.equal((await reservar(mes, '9002', { texto: sinCursos, accion: 'actualizar-datos' })).estado, 'reservada');

  const presupuesto = await fixture(t);
  assert.deepEqual(
    await reservar(presupuesto, '9001', { texto: configuracion({ presupuestoMinMes: 600 }) }),
    rechazo('presupuesto'),
  );
  assert.equal((await reservar(presupuesto, '9002')).estado, 'reservada');
});

test('sin permiso de inicio en 60 minutos la reserva deja de ocupar y su inicio tardío se rechaza', async (t) => {
  const enPlazo = await fixture(t);
  assert.equal((await reservar(enPlazo, '9001')).estado, 'reservada');
  enPlazo.reloj.ahora += ANTES_DEL_PLAZO;
  assert.equal(await pulsar(enPlazo), 'ocupado');
  assert.deepEqual(await reservar(enPlazo, '9002'), rechazo('ocupado'));
  assert.equal(await iniciar(enPlazo, '9001'), 'aplicado');

  const tardio = await fixture(t);
  assert.equal((await reservar(tardio, '9001')).estado, 'reservada');
  tardio.reloj.ahora += TRAS_EL_PLAZO;
  assert.equal(await iniciar(tardio, '9001'), 'conflicto');
  assert.equal((await ultimo(tardio)).resultado?.resultado, 'retirado');

  for (const via of ['programada', 'panel', 'demanda'] as const) {
    const f = await fixture(t);
    const vencida = await ultimoTrasReservar(f, '9001');
    f.reloj.ahora += TRAS_EL_PLAZO;
    if (via === 'programada') {
      assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'nueva');
    } else if (via === 'panel') {
      assert.equal(await pulsar(f), 'nueva');
    } else {
      assert.equal((await reservar(f, '9002')).estado, 'reservada');
    }
    assert.equal((await ultimo(f)).origen, via);
    const tarde = await f.backend.confirmarInicio(vencida, ejecucion('9001', f.reloj.ahora));
    assert.equal(tarde.estado, 'conflicto');
  }
});

test('un actor que insiste recibe la misma respuesta, pero solo se anotan sus primeros rechazos del día', async (t) => {
  const f = await fixture(t);
  assert.equal((await reservar(f, '9001')).estado, 'reservada');
  assert.equal(await iniciar(f, '9001'), 'aplicado');
  for (let i = 0; i < INSISTENCIAS; i++) {
    assert.deepEqual(await reservar(f, `8${i}`), rechazo('ocupado'));
  }
  const rechazadasDe = (id: string) =>
    f.filas().filter((fila) => fila.decision === 'rechazada' && fila.actor_id === id);
  assert.equal(rechazadasDe(ACTOR.id).length, MAX_RECHAZOS_ANOTADOS_DIA);
  assert.deepEqual(await reservar(f, '7001', { actor: OTRO_ACTOR }), rechazo('ocupado'));
  assert.equal(rechazadasDe(OTRO_ACTOR.id).length, 1);
  f.reloj.ahora += DIA;
  assert.deepEqual(await reservar(f, '7002'), rechazo('ocupado'));
  assert.equal(rechazadasDe(ACTOR.id).length, MAX_RECHAZOS_ANOTADOS_DIA + 1);
});

/**
 * El reloj diario ante una demanda con su run fijado y sin cerrar: la autoridad pide antes consultarlo en GitHub, y el
 * reloj vuelve con la misma solicitud marcada como reconciliada cuando GitHub lo da por en curso.
 */
async function programadaTrasConsultar(f: Fixture) {
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'pendiente-reconciliacion');
  return (await f.backend.reservarTrabajoProgramado({ ...TICK, reconciliada: true }, CONFIANZA)).estado;
}
test('convive con la programada y el panel; al terminar, todo vuelve a admitirse y sus minutos quedan anotados', async (t) => {
  const conProgramada = await fixture(t);
  assert.equal((await conProgramada.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'nueva');
  assert.deepEqual(await reservar(conProgramada, '9001'), rechazo('ocupado'));

  const conPanel = await fixture(t);
  assert.equal(await pulsar(conPanel), 'nueva');
  assert.deepEqual(await reservar(conPanel, '9001'), rechazo('ocupado'));

  // Una demanda ya iniciada sigue ocupando: la programada se omite, como ante cualquier trabajo en marcha.
  const f = await fixture(t);
  assert.equal((await reservar(f, '9001', { accion: 'actualizar-datos' })).estado, 'reservada');
  assert.equal(await iniciar(f, '9001'), 'aplicado');
  assert.equal(await programadaTrasConsultar(f), 'omitida-ocupado');
  assert.equal((await ultimo(f)).origen, 'demanda');
  assert.equal(await pulsar(f), 'ocupado');
  f.reloj.ahora += DURACION_CICLO_MIN * MINUTO;
  const candidato = await terminar(f, '9001', 'validado');
  assert.equal((await f.backend.reservarActivacion(candidato, ejecucion('9001', f.reloj.ahora))).estado, 'aplicado');
  const paso = {
    ...candidato,
    revisionEsperada: 1,
    paso: { tipo: 'rechazar', error: 'candidato_no_verificable' },
  } as const;
  assert.equal((await f.backend.registrarPasoActivacion(paso, ejecucion('9001', f.reloj.ahora))).estado, 'aplicado');
  assert.equal(await pulsar(f), 'nueva');
  const demanda = f.filas().find((fila) => fila.origen === 'demanda');
  assert.equal(demanda?.minutos, DURACION_CICLO_MIN + MARGEN_MIN_POR_TRABAJO);
});

/** El motivo con el que el registro anota la demanda liberada, fila a fila. */
function liberaciones(f: Fixture) {
  return f.db
    .prepare("SELECT run_id, decision, motivo_liberacion FROM administracion_solicitudes WHERE origen='demanda'")
    .all()
    .map((fila) => ({ ...fila }));
}
test('la programada tiene prioridad sobre una demanda sin iniciar: la libera, reserva y deja anotado el motivo', async (t) => {
  const f = await fixture(t);
  const demanda = await ultimoTrasReservar(f, '9001');
  f.reloj.ahora += ANTES_DEL_PLAZO;
  assert.equal(await programadaTrasConsultar(f), 'nueva');
  assert.equal((await ultimo(f)).origen, 'programada');
  assert.deepEqual(liberaciones(f), [{ run_id: '9001', decision: 'admitida', motivo_liberacion: 'ciclo_programado' }]);
  // El run a demanda pide después su permiso: lo ve rechazado como cualquier reserva superada.
  const tarde = await f.backend.confirmarInicio(demanda, ejecucion('9001', f.reloj.ahora));
  assert.equal(tarde.estado, 'conflicto');
  assert.equal((await ultimo(f)).origen, 'programada');
  // Y su consulta dice que ya no tiene reserva; pedir otra con el mismo run no la recupera.
  assert.deepEqual(await f.backend.operarDemanda({ operacion: 'consultar', runId: '9001' }), { estado: 'sin_reserva' });
  assert.deepEqual(await reservar(f, '9001'), rechazo('ocupado'));
});

test('la demanda liberada por la programada sigue contando en los topes del día y del mes de quien la pidió', async (t) => {
  const f = await fixture(t);
  assert.equal((await reservar(f, '9001')).estado, 'reservada');
  assert.equal(await programadaTrasConsultar(f), 'nueva');
  assert.equal(liberaciones(f)[0]?.motivo_liberacion, 'ciclo_programado');
  f.reloj.ahora += 2 * HORA;
  const historial = f.sql.transaccion(() => leerHistorialDelMesSqlite(f.sql, f.reloj.ahora));
  // La demanda liberada sigue en el historial como admitida, delante de la programada que la sustituyó.
  assert.deepEqual(
    historial.map(({ accion }) => accion),
    ['actualizar-cursos', null],
  );
  const topes = (cambios: Partial<typeof BASE>) => {
    const lectura = leerConfiguracionDemanda(configuracion(cambios));
    assert.ok(lectura.estado === 'abierta');
    return decidirTopes(lectura.configuracion, 'actualizar-cursos', f.reloj.ahora, historial);
  };
  const mes = { ...BASE.maxMes, 'actualizar-cursos': 1 };
  assert.deepEqual(topes({ maxDia: 1 }), { decision: 'rechazada', motivo: 'tope_dia' });
  assert.deepEqual(topes({ maxMes: mes }), { decision: 'rechazada', motivo: 'tope_mes' });
  // Control positivo: con un cupo más, la misma petición cabe.
  assert.deepEqual(topes({ maxDia: 2, maxMes: { ...mes, 'actualizar-cursos': 2 } }), { decision: 'admitida' });
});

test('una programada fuera de su ventana se omite y no libera la demanda sin iniciar', async (t) => {
  const f = await fixture(t);
  f.reloj.ahora += VENTANA_TRABAJO_PROGRAMADO_MS + MINUTO;
  assert.equal((await reservar(f, '9001')).estado, 'reservada');
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'omitida-tardia');
  assert.deepEqual(liberaciones(f), [{ run_id: '9001', decision: 'admitida', motivo_liberacion: null }]);
  assert.equal(await iniciar(f, '9001'), 'aplicado');
});

test('la reserva es atómica: si falla un paso no queda ni la fila admitida ni el trabajo', async (t) => {
  for (const [sentencia, vez] of [
    ['INSERT INTO administracion_solicitudes', 1],
    ['UPDATE administracion_trabajo', 1],
    ['UPDATE administracion_trabajo', 2],
  ] as const) {
    const f = await fixture(t);
    let vistas = 0;
    f.fallo.si = (sql) => sql.startsWith(sentencia) && ++vistas === vez;
    await assert.rejects(reservar(f, '9001'));
    assert.deepEqual(f.filas(), []);
    assert.deepEqual(await f.backend.leerTrabajoPrivado(), { version: 2, revision: 0, ultimoTrabajo: null });
    f.fallo.si = () => false;
    assert.equal((await reservar(f, '9001')).estado, 'reservada');
  }
});

test('dos runs a la vez: uno reserva y el otro recibe ocupado', async (t) => {
  const f = await fixture(t);
  const resultados = await Promise.all([reservar(f, '9001'), reservar(f, '9002')]);
  assert.deepEqual(resultados.map((r) => r.estado).sort(), ['rechazada', 'reservada']);
  assert.deepEqual(
    resultados.find((r) => r.estado === 'rechazada'),
    rechazo('ocupado'),
  );
});

test('una acción fuera de la lista se rechaza antes de tocar nada', async (t) => {
  const f = await fixture(t);
  for (const accion of ['reintentar-pendientes', 'comprobar-programada', 'borrar-todo']) {
    await assert.rejects(reservar(f, '9001', { accion }));
  }
  assert.deepEqual(f.filas(), []);
  assert.equal((await f.backend.leerTrabajoPrivado()).revision, 0);
  assert.equal((await reservar(f, '9001', { accion: 'comprobar-vencidas' })).estado, 'reservada');
});

test('con la configuración ausente, deshabilitada o inválida no se reserva ni se anota nada', async (t) => {
  const f = await fixture(t);
  const cerradas = [null, configuracion({ habilitada: false }), configuracion({ maxDia: 99 }), '{'];
  for (const texto of cerradas) {
    assert.deepEqual(await reservar(f, '9001', { texto }), { estado: 'cerrada' });
  }
  assert.deepEqual(f.filas(), []);
  assert.equal((await f.backend.leerTrabajoPrivado()).revision, 0);
  assert.equal((await reservar(f, '9001')).estado, 'reservada');
});

test('una identidad que no encaja con la confianza o un actor fuera de la lista son un error, no un rechazo', async (t) => {
  const f = await fixture(t);
  const ajeno = { id: '454545', nombre: 'cuenta-ajena' };
  await assert.rejects(reservar(f, '9001', { actor: ajeno }));
  const vieja = peticion(f, '9001');
  f.reloj.ahora += HORA;
  await assert.rejects(f.backend.operarDemanda(vieja));
  assert.deepEqual(f.filas(), []);
  assert.equal((await reservar(f, '9001')).estado, 'reservada');
});

test('nada del actor sale en el estado público ni en la respuesta', async (t) => {
  const f = await fixture(t);
  const reserva = await reservar(f, '9001');
  const rechazada = await reservar(f, '9002');
  const panel = await f.backend.leerTrabajoDeSesion(ACCESO);
  const publico = estadoPublicoTrabajos(await f.backend.leerTrabajoPrivado());
  for (const visto of [reserva, rechazada, panel, publico]) {
    const texto = JSON.stringify(visto);
    assert.ok(!texto.includes(ACTOR.nombre) && !texto.includes(ACTOR.id) && !texto.includes('"actor'), texto);
  }
  assert.equal(f.filas()[0]?.actor, ACTOR.nombre);
});
