/**
 * Registro de solicitudes: cada vía deja su fila con su origen, el trabajo lleva su origen sin dejar de leer lo
 * guardado antes, el panel recibe `origen` e `iniciado` y nunca al actor, y el historial del mes tiene la forma que
 * espera `decidirTopes`. SQL real, sin red; el actor es sintético.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { leerConfiguracionDemanda } from '../../src/administracion/configuracion-demanda.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { accion, leerEstadoTrabajos } from '../../src/administracion/estado-trabajos.js';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import { decidirTopes, MARGEN_MIN_POR_TRABAJO } from '../../src/administracion/topes-demanda.ts';
import {
  estadoPublicoTrabajos,
  leerEstadoTrabajosPrivado,
  leerSolicitudTrabajo,
} from '../../src/administracion/trabajos.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import {
  anotarSolicitudSqlite,
  leerHistorialDelMesSqlite,
  MAX_FILAS_SOLICITUDES,
} from '../../src/plataforma/acceso-publico/solicitudes-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { reservarTrabajoSqlite } from '../../src/plataforma/acceso-publico/trabajos-sqlite.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const DIA = 24 * 60 * MINUTO;
/**
 * Un ciclo de 25 minutos y un segundo factura 26; uno de 40 exactos, 40. A lo medido se suma el margen de lo que la
 * autoridad no ve.
 */
const MINUTOS_CON_SEGUNDO = 26;
const DURACION_CON_SEGUNDO = (MINUTOS_CON_SEGUNDO - 1) * MINUTO + SEGUNDO;
const MINUTOS_EXACTOS = 40;
/** Por encima de la separación mínima de la configuración de ejemplo (120 minutos). */
const MINUTOS_TRAS_LA_SEPARACION = 180;
const TRAS_LA_SEPARACION = MINUTOS_TRAS_LA_SEPARACION * MINUTO;
/** Filas de octubre por encima del tope: ninguna se poda. */
const EXCESO = 20;
const AHORA = Date.parse('2026-10-17T03:00:00Z');
const PRIMERA = '11111111-1111-4111-8111-111111111111';
const SEGUNDA = '22222222-2222-4222-8222-222222222222';
const TAM_HASH = 64;
const TAM_SHA = 40;
const TAM_PAQUETE = 16;
const VIDA_TOKEN_S = 600;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
/** La sesión caduca durante un ciclo largo: quien vuelve al panel abre otra. */
const OTRO_ACCESO = { huellaSesion: 'e'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
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
/** Actor sintético: ni el identificador ni el nombre corresponden a ninguna cuenta. */
const ACTOR = { id: '1001', nombre: 'cuenta-sintetica' };
const CONFIGURACION = `{"version":1,"habilitada":true,"actores":["1001"],"separacionMin":120,"maxDia":2,"maxMes":{"actualizar-datos":2,"comprobar-vencidas":6,"actualizar-cursos":10},"presupuestoMinMes":1800,"reservaProgramadaMin":45}`;

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
async function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  const reloj = { ahora: AHORA };
  new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => reloj.ahora });
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
  t.after(() => db.close());
  await backend.prepararPanel(POLITICA);
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
  await abrirSesionDePrueba(backend, ACCESO);
  const filas = () =>
    db
      .prepare(
        'SELECT origen, accion, actor_id, actor, solicitud_id, run_id, decision, motivo, minutos FROM administracion_solicitudes ORDER BY id',
      )
      .all()
      .map((fila) => ({ ...fila }));
  return { db, sql, backend, reloj, filas };
}
function identidad(ahora: number): IdentidadEjecucionGitHub {
  const { audiencia: _, ...pins } = CONFIANZA;
  return {
    ...pins,
    runId: '123',
    runAttempt: '1',
    jti: `sintetico-${ahora}`,
    emitidoEn: Math.floor(ahora / SEGUNDO),
    caducaEn: Math.floor(ahora / SEGUNDO) + VIDA_TOKEN_S,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function pulsar(f: Fixture, solicitudId: string, acceso = ACCESO) {
  const { revision } = await f.backend.leerTrabajoPrivado();
  const solicitud = { solicitudId, accion: 'actualizar-datos', revisionEsperada: revision } as const;
  const reserva = await f.backend.reservarTrabajoDeSesion(acceso, solicitud, CONFIANZA);
  assert.ok('trabajos' in reserva);
  return reserva;
}
/** Concede el inicio, espera `duracion` y entrega un recibo validado con el reloj de la autoridad. */
async function ejecutar(f: Fixture, solicitudId: string, duracion: number) {
  const t = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(t);
  const referencia = { solicitudId, revisionReserva: t.revisionReserva };
  const inicio = await f.backend.confirmarInicio({ ...referencia, accion: t.accion }, identidad(f.reloj.ahora));
  assert.equal(inicio.estado, 'aplicado');
  f.reloj.ahora += duracion;
  const recibo = {
    ...referencia,
    accion: t.accion,
    resultado: 'validado',
    veredicto: 'verde',
    terminadoEn: new Date(Math.floor(f.reloj.ahora / SEGUNDO) * SEGUNDO).toISOString().replace('.000Z', 'Z'),
    huellaPaquete: 'c'.repeat(TAM_PAQUETE),
    error: null,
  } as const;
  const registro = await f.backend.registrarRecibo(recibo, 'd'.repeat(TAM_HASH), identidad(f.reloj.ahora));
  assert.equal(registro.estado, 'aplicado');
  return inicio;
}

test('el panel deja su fila; el trabajo lleva su origen y el panel ve origen e iniciado', async (t) => {
  const f = await fixture(t);
  const reserva = await pulsar(f, PRIMERA);
  assert.equal(reserva.estado, 'nueva');
  assert.ok('trabajos' in reserva);
  assert.equal(reserva.trabajos.ultimoTrabajo?.origen, 'panel');
  assert.equal(reserva.trabajos.ultimoTrabajo?.iniciado, false);
  assert.equal((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.origen, 'panel');
  assert.deepEqual(f.filas(), [
    {
      origen: 'panel',
      accion: 'actualizar-datos',
      actor_id: null,
      actor: null,
      solicitud_id: PRIMERA,
      run_id: null,
      decision: 'admitida',
      motivo: null,
      minutos: null,
    },
  ]);
  const inicio = await ejecutar(f, PRIMERA, DURACION_CON_SEGUNDO);
  assert.equal(inicio.trabajos.ultimoTrabajo?.iniciado, true);
  assert.deepEqual(
    f.filas().map(({ run_id, minutos }) => ({ run_id, minutos })),
    [{ run_id: '123', minutos: MINUTOS_CON_SEGUNDO + MARGEN_MIN_POR_TRABAJO }],
  );
});

test('la programada deja su fila al reservar y, si se omite, su motivo', async (t) => {
  const f = await fixture(t);
  const programada = await f.backend.reservarTrabajoProgramado({ eventoEn: AHORA, cron: '0 3 * * *' }, CONFIANZA);
  assert.equal(programada.estado, 'nueva');
  const t1 = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.equal(t1?.origen, 'programada');
  assert.ok(t1);
  const referencia = { solicitudId: t1.solicitudId, revisionReserva: t1.revisionReserva, accion: t1.accion };
  assert.equal((await f.backend.confirmarInicio(referencia, identidad(AHORA))).estado, 'aplicado');
  f.reloj.ahora += DIA;
  const tick = { eventoEn: f.reloj.ahora, cron: '0 3 * * *', reconciliada: true } as const;
  const omitida = await f.backend.reservarTrabajoProgramado(tick, CONFIANZA);
  assert.equal(omitida.estado, 'omitida-ocupado');
  assert.deepEqual(
    f
      .filas()
      .map(({ origen, accion, solicitud_id, decision, motivo }) => [origen, accion, decision, motivo, !!solicitud_id]),
    [
      ['programada', 'comprobar-programada', 'admitida', null, true],
      ['programada', 'comprobar-programada', 'rechazada', 'requiere_atencion', false],
    ],
  );
});

test('la programada omitida por un trabajo del panel en plazo queda como ocupado', async (t) => {
  const f = await fixture(t);
  await pulsar(f, PRIMERA);
  const omitida = await f.backend.reservarTrabajoProgramado({ eventoEn: AHORA, cron: '0 3 * * *' }, CONFIANZA);
  assert.equal(omitida.estado, 'omitida-ocupado');
  assert.deepEqual(
    f.filas().map(({ origen, decision, motivo }) => [origen, decision, motivo]),
    [
      ['panel', 'admitida', null],
      ['programada', 'rechazada', 'ocupado'],
    ],
  );
});

test('el contrato rechaza un origen o una acción desconocidos y admite las dos acciones nuevas', async (t) => {
  const f = await fixture(t);
  await pulsar(f, PRIMERA);
  const guardado = JSON.parse(JSON.stringify(await f.backend.leerTrabajoPrivado()));
  assert.throws(() =>
    leerEstadoTrabajosPrivado({ ...guardado, ultimoTrabajo: { ...guardado.ultimoTrabajo, origen: 'otro' } }),
  );
  assert.throws(() =>
    leerEstadoTrabajosPrivado({ ...guardado, ultimoTrabajo: { ...guardado.ultimoTrabajo, accion: 'borrar-todo' } }),
  );
  const publico = JSON.parse(JSON.stringify(estadoPublicoTrabajos(leerEstadoTrabajosPrivado(guardado))));
  assert.throws(() => leerEstadoTrabajos({ ...publico, ultimoTrabajo: { ...publico.ultimoTrabajo, origen: 'otro' } }));
  assert.throws(() => leerEstadoTrabajos({ ...publico, ultimoTrabajo: { ...publico.ultimoTrabajo, iniciado: 'sí' } }));
  assert.equal(accion('comprobar-vencidas') && accion('actualizar-cursos'), true);
  assert.equal(accion('borrar-todo'), false);
  for (const nueva of ['comprobar-vencidas', 'actualizar-cursos']) {
    assert.throws(() => leerSolicitudTrabajo({ solicitudId: SEGUNDA, accion: nueva, revisionEsperada: 1 }));
  }
  const otra = { origen: 'otra', accion: 'actualizar-datos', decision: 'rechazada', motivo: 'ocupado' };
  assert.throws(() => anotarSolicitudSqlite(f.sql, otra as never, AHORA));
  const sinActor = {
    origen: 'demanda',
    accion: 'actualizar-cursos',
    decision: 'rechazada',
    motivo: 'separacion',
  } as const;
  assert.throws(() => anotarSolicitudSqlite(f.sql, sinActor, AHORA));
  const panelConActor = { ...sinActor, origen: 'panel', actor: ACTOR } as const;
  assert.throws(() => anotarSolicitudSqlite(f.sql, panelConActor, AHORA));
});

test('un trabajo guardado sin origen se sigue leyendo y el panel lo recibe sin origen', async (t) => {
  const f = await fixture(t);
  await pulsar(f, PRIMERA);
  const guardado = JSON.parse(JSON.stringify(await f.backend.leerTrabajoPrivado()));
  delete guardado.ultimoTrabajo.origen;
  f.db.prepare('UPDATE administracion_trabajo SET documento=? WHERE id=1').run(JSON.stringify(guardado));
  const leido = await f.backend.leerTrabajoPrivado();
  assert.equal(leido.ultimoTrabajo?.solicitudId, PRIMERA);
  assert.equal(Object.hasOwn(leido.ultimoTrabajo ?? {}, 'origen'), false);
  const publico = estadoPublicoTrabajos(leido);
  assert.equal(Object.hasOwn(publico.ultimoTrabajo ?? {}, 'origen'), false);
  assert.deepEqual(leerEstadoTrabajos(JSON.parse(JSON.stringify(publico))), publico);
  const sinCampos = JSON.parse(JSON.stringify(publico));
  delete sinCampos.ultimoTrabajo.iniciado;
  assert.equal(leerEstadoTrabajos(sinCampos).ultimoTrabajo?.solicitudId, PRIMERA);
});

test('el historial del mes sale en la forma de decidirTopes y esta lo acepta', async (t) => {
  const f = await fixture(t);
  await f.backend.reservarTrabajoProgramado({ eventoEn: AHORA, cron: '0 3 * * *' }, CONFIANZA);
  await ejecutar(f, (await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.solicitudId ?? '', MINUTOS_EXACTOS * MINUTO);
  f.reloj.ahora += TRAS_LA_SEPARACION;
  const historial = f.sql.transaccion(() => leerHistorialDelMesSqlite(f.sql, f.reloj.ahora));
  assert.deepEqual(historial, [{ en: AHORA, accion: null, minutos: MINUTOS_EXACTOS + MARGEN_MIN_POR_TRABAJO }]);
  const configuracion = leerConfiguracionDemanda(CONFIGURACION);
  assert.equal(configuracion.estado, 'abierta');
  assert.ok(configuracion.estado === 'abierta');
  const decision = decidirTopes(configuracion.configuracion, 'actualizar-cursos', f.reloj.ahora, historial);
  assert.deepEqual(decision, { decision: 'admitida' });
  await abrirSesionDePrueba(f.backend, OTRO_ACCESO);
  await pulsar(f, SEGUNDA, OTRO_ACCESO);
  const conPanel = f.sql.transaccion(() => leerHistorialDelMesSqlite(f.sql, f.reloj.ahora));
  assert.deepEqual(conPanel.at(-1), { en: f.reloj.ahora, accion: 'actualizar-datos', minutos: null });
  const tras = decidirTopes(configuracion.configuracion, 'actualizar-cursos', f.reloj.ahora + MINUTO, conPanel);
  assert.deepEqual(tras, { decision: 'rechazada', motivo: 'separacion' });
});

test('la poda conserva el mes en curso entero y la última solicitud del mes anterior', async (t) => {
  const f = await fixture(t);
  const finDeSeptiembre = Date.parse('2026-09-30T20:00:00Z');
  const enOctubre = Date.parse('2026-10-01T00:00:00Z');
  const rechazada = {
    origen: 'programada',
    accion: 'comprobar-programada',
    decision: 'rechazada',
    motivo: 'ocupado',
  } as const;
  f.sql.transaccion(() => {
    for (let i = 0; i < MAX_FILAS_SOLICITUDES; i += 1) {
      anotarSolicitudSqlite(f.sql, rechazada, finDeSeptiembre - DIA + i);
    }
    const ultima = { origen: 'panel', accion: 'actualizar-datos', decision: 'admitida', solicitudId: PRIMERA } as const;
    anotarSolicitudSqlite(f.sql, ultima, finDeSeptiembre);
    for (let i = 0; i < MAX_FILAS_SOLICITUDES + EXCESO; i += 1) {
      anotarSolicitudSqlite(f.sql, rechazada, enOctubre + i);
    }
  });
  const meses = f.db
    .prepare(
      "SELECT substr(datetime(en/1000,'unixepoch'),1,7) AS mes, count(*) AS n FROM administracion_solicitudes GROUP BY mes",
    )
    .all()
    .map(({ mes, n }) => [mes, n]);
  assert.deepEqual(meses, [
    ['2026-09', 1],
    ['2026-10', MAX_FILAS_SOLICITUDES + EXCESO],
  ]);
  const historial = f.sql.transaccion(() => leerHistorialDelMesSqlite(f.sql, enOctubre + DIA));
  assert.deepEqual(historial, [{ en: finDeSeptiembre, accion: 'actualizar-datos', minutos: null }]);
});

test('una reserva a demanda exige su fila con el actor; el actor no sale en estados públicos ni en la consola', async (t) => {
  const f = await fixture(t);
  const consola = ['log', 'info', 'warn', 'error', 'debug'].map((m) => t.mock.method(console, m as 'log'));
  const { revision } = await f.backend.leerTrabajoPrivado();
  const solicitud = {
    solicitudId: PRIMERA,
    accion: 'actualizar-cursos',
    revisionEsperada: revision,
    origen: 'demanda',
  } as const;
  assert.throws(() => f.sql.transaccion(() => reservarTrabajoSqlite(f.sql, solicitud, CONFIANZA, AHORA)));
  assert.deepEqual(f.filas(), []);
  const reserva = f.sql.transaccion(() => {
    const fila = {
      origen: 'demanda',
      accion: 'actualizar-cursos',
      decision: 'admitida',
      solicitudId: PRIMERA,
    } as const;
    anotarSolicitudSqlite(f.sql, { ...fila, runId: '123', actor: ACTOR }, AHORA);
    return reservarTrabajoSqlite(f.sql, solicitud, CONFIANZA, AHORA);
  });
  assert.equal(reserva.estado, 'nueva');
  assert.deepEqual(
    f.filas().map(({ origen, actor_id, actor, run_id }) => [origen, actor_id, actor, run_id]),
    [['demanda', ACTOR.id, ACTOR.nombre, '123']],
  );
  const publicos = [
    reserva.trabajos,
    estadoPublicoTrabajos(await f.backend.leerTrabajoPrivado()),
    await f.backend.leerTrabajoDeSesion(ACCESO),
    await f.backend.leerTrabajoPrivado(),
  ];
  for (const estado of publicos) {
    const texto = JSON.stringify(estado);
    assert.equal(texto.includes(ACTOR.nombre) || texto.includes('actor'), false);
  }
  assert.equal(reserva.trabajos.ultimoTrabajo?.origen, 'demanda');
  assert.equal(
    consola.reduce((suma, espia) => suma + espia.mock.callCount(), 0),
    0,
  );
});
