import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
  configuracionProgramadaDelEntorno,
  configuracionProgramadaDiferida,
  leerCronDiario,
} from '../../src/administracion/configuracion-programada.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { SolicitudActualizacion } from '../../src/administracion/ejecutor-github.ts';
import { comprobarEventoProgramado, crearComprobadorProgramado } from '../../src/administracion/programada.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { montarAdministracion, type OpcionesMontajeAdministrativo } from '../../src/plataforma/administracion.ts';

const AHORA = Date.parse('2026-10-17T12:00:00Z');
const TAM_SHA = 40;
const CONFIGURACION_EXCESIVA = 2_000;
const CONFIGURACION = { version: 1, habilitada: true, cron: '0 12 * * *' } as const;
const EVENTO = { eventoEn: AHORA, cron: CONFIGURACION.cron };
const CONFIANZA = {
  audiencia: 'https://panel.example/mantenimiento/resultado',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
const senal = () => new AbortController().signal;
/** Estas pruebas parten de un almacén sin reservas vencidas; la recuperación tiene su propia prueba. */
const SIN_RESERVA_VENCIDA = async () => 'sin-reserva-vencida' as const;
function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      db.prepare(sentencia).run(...valores);
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
  const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: () => AHORA });
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
  const opciones: OpcionesMontajeAdministrativo = {
    configuracion: { origen: 'https://panel.example', permitirHttpLocal: false },
    guardiaAdministrativa: async () => null,
    almacen: publico,
    sesion: almacen,
    trabajos: almacen,
    almacenActivacion: almacen,
    inicial: POLITICA,

    actualizacion: {
      configuracion: () => ({
        confianza: CONFIANZA,
        destino: { propietario: 'equipo', repositorio: 'fuente', workflow: 'actualizar.yml', ref: 'main' },
        obtenerToken: async () => 'token-sintetico',
      }),
    },
    programada: { configuracion: () => CONFIGURACION, almacen },
  };
  return { db, almacen, opciones };
}
async function preparar(almacen: AlmacenSesionPanelSqlite) {
  await almacen.prepararPanel(POLITICA);
  await almacen.prepararTrabajos();
  await almacen.prepararActivacion();
}

test('programación opt-in admite solo JSON cerrado y cron diario UTC canónico, sin normalizar', () => {
  assert.equal(configuracionProgramadaDelEntorno({}), undefined);
  assert.equal(configuracionProgramadaDiferida({}), undefined);
  for (const habilitada of [true, false]) {
    assert.deepEqual(
      configuracionProgramadaDelEntorno({
        FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ ...CONFIGURACION, habilitada }),
      }),
      { ...CONFIGURACION, habilitada },
    );
  }
  for (const cron of ['0 0 * * *', '59 23 * * *', '9 9 * * *']) {
    assert.equal(leerCronDiario(cron), cron);
  }
  for (const cron of [
    '00 0 * * *',
    '0 01 * * *',
    '60 0 * * *',
    '0 24 * * *',
    '* * * * *',
    '0,1 0 * * *',
    '0 0 * * 1',
    '0 0 * * *\n',
  ]) {
    assert.throws(() => leerCronDiario(cron));
  }
  for (const entrada of [
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...CONFIGURACION, habilitada: 'si' }),
    JSON.stringify({ ...CONFIGURACION, extra: true }),
    ' '.repeat(CONFIGURACION_EXCESIVA),
  ]) {
    const variables = { FARO_ACTUALIZACION_PROGRAMADA: entrada };
    const diferida = configuracionProgramadaDiferida(variables);
    assert.ok(diferida);
    assert.throws(diferida, /Configuración de actualización programada no válida/);
  }
});

test('captura de configuración y evento rechaza otro cron, instante desalineado o claves añadidas', () => {
  const variables = { FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify(CONFIGURACION) };
  const capturada = configuracionProgramadaDiferida(variables);
  variables.FARO_ACTUALIZACION_PROGRAMADA = '{';
  assert.deepEqual(capturada?.(), CONFIGURACION);
  assert.deepEqual(comprobarEventoProgramado(EVENTO, CONFIGURACION), EVENTO);
  for (const evento of [
    { ...EVENTO, cron: '1 12 * * *' },
    { ...EVENTO, eventoEn: AHORA + 1 },
    { ...EVENTO, extra: true },
  ]) {
    assert.throws(() => comprobarEventoProgramado(evento, CONFIGURACION));
  }
  assert.throws(() => comprobarEventoProgramado(EVENTO, { ...CONFIGURACION, habilitada: false }));
});

test('recuperación autoriza solo el día completo, cron exacto y ventana, conservando la clave diaria', () => {
  const configuracion = { version: 1 as const, habilitada: true, cron: '15 4 * * *', recuperarEl: '2026-11-19' };
  const leer = (recuperarEl: string, habilitada = true) =>
    configuracionProgramadaDelEntorno({
      FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ ...configuracion, habilitada, recuperarEl }),
    });
  assert.deepEqual(leer('2026-11-19'), configuracion);
  for (const dia of ['2026-02-30', '2026-11-19x', '26-11-19']) {
    assert.throws(() => leer(dia));
  }
  assert.throws(() => leer('2026-11-19', false));
  const entrada = { eventoEn: Date.parse('2026-11-19T05:10:00Z'), cron: '10 5 19 11 *' };
  const diario = { eventoEn: Date.parse('2026-11-19T04:15:00Z'), cron: configuracion.cron };
  const recuperacion = { ...diario, recuperacion: true as const };
  assert.deepEqual(comprobarEventoProgramado(entrada, configuracion), recuperacion);
  assert.deepEqual(comprobarEventoProgramado(recuperacion, configuracion), recuperacion);
  assert.deepEqual(comprobarEventoProgramado(diario, configuracion), diario);
  assert.throws(() => comprobarEventoProgramado(recuperacion, { ...configuracion, recuperarEl: '2026-11-18' }));
  for (const invalido of [
    { ...entrada, eventoEn: Date.parse('2027-11-19T05:10:00Z') },
    { ...entrada, cron: '10 5 19 10 *' },
    { ...entrada, eventoEn: Date.parse('2026-11-19T10:16:00Z'), cron: '16 10 19 11 *' },
    { ...entrada, eventoEn: Date.parse('2026-11-19T04:14:00Z'), cron: '14 4 19 11 *' },
    { ...entrada, extra: true },
  ]) {
    assert.throws(() => comprobarEventoProgramado(invalido, configuracion));
  }
});

test('repetir recuperación o recibir el diario solo permite un despacho', async (t) => {
  const f = fixture(t);
  await preparar(f.almacen);
  let despachos = 0;
  const comprobar = crearComprobadorProgramado({
    almacen: f.almacen,
    confianza: CONFIANZA,
    reconciliar: SIN_RESERVA_VENCIDA,
    despachar: async () => {
      despachos++;
      return { estado: 'despachada', runId: '789' };
    },
  });
  const config = { version: 1 as const, habilitada: true, cron: '15 11 * * *', recuperarEl: '2026-10-17' };
  const recuperacion = comprobarEventoProgramado({ eventoEn: AHORA, cron: '0 12 17 10 *' }, config);
  const diario = comprobarEventoProgramado({ eventoEn: Date.parse('2026-10-17T11:15:00Z'), cron: config.cron }, config);
  assert.equal(await comprobar(recuperacion, senal()), 'nueva');
  assert.equal(await comprobar(recuperacion, senal()), 'repetida');
  assert.equal(await comprobar(diario, senal()), 'repetida');
  assert.equal(despachos, 1);
});

test('reserva nueva despacha una sola vez y fija acción/referencia de autoridad sin crear sesión humana', async (t) => {
  const f = fixture(t);
  await preparar(f.almacen);
  const enviadas: SolicitudActualizacion[] = [];
  const comprobar = crearComprobadorProgramado({
    almacen: f.almacen,
    confianza: CONFIANZA,
    reconciliar: SIN_RESERVA_VENCIDA,
    despachar: async (solicitud) => {
      enviadas.push(solicitud);
      assert.equal((await f.almacen.leerTrabajoPrivado()).ultimoTrabajo?.estado, 'despacho-incierto');
      return { estado: 'despachada', runId: '789' };
    },
  });
  assert.deepEqual((await Promise.all([comprobar(EVENTO, senal()), comprobar(EVENTO, senal())])).sort(), [
    'nueva',
    'repetida',
  ]);
  const estado = await f.almacen.leerTrabajoPrivado();
  assert.deepEqual(enviadas, [
    { solicitudId: estado.ultimoTrabajo?.solicitudId, accion: 'comprobar-programada', revisionReserva: 1 },
  ]);
  assert.equal(estado.ultimoTrabajo?.runId, '789');
  assert.equal(f.db.prepare('SELECT huella_sesion FROM administracion_sesion').get()?.huella_sesion, null);
});

test('error de despacho y cancelación durante reserva nunca recuperan permiso para reenviar', async (t) => {
  const f = fixture(t);
  await preparar(f.almacen);
  let llamadas = 0;
  const comprobar = crearComprobadorProgramado({
    almacen: f.almacen,
    confianza: CONFIANZA,
    reconciliar: SIN_RESERVA_VENCIDA,
    despachar: async () => {
      llamadas++;
      throw new Error('transporte interrumpido');
    },
  });
  await assert.rejects(comprobar(EVENTO, senal()), /transporte interrumpido/);
  assert.equal(await comprobar(EVENTO, senal()), 'repetida');
  assert.equal(llamadas, 1);
  const control = new AbortController();
  const reserva = Promise.withResolvers<Awaited<ReturnType<typeof f.almacen.reservarTrabajoProgramado>>>();
  const inicio = Promise.withResolvers<void>();
  const cancelable = crearComprobadorProgramado({
    almacen: {
      reservarTrabajoProgramado: async () => {
        inicio.resolve();
        return reserva.promise;
      },
      anotarDespacho: async () => assert.fail('No anotar'),
    },
    confianza: CONFIANZA,
    reconciliar: SIN_RESERVA_VENCIDA,
    despachar: async () => assert.fail('No despachar tras cancelar'),
  });
  const pendiente = cancelable(EVENTO, control.signal);
  await inicio.promise;
  control.abort();
  reserva.resolve({ estado: 'repetida', trabajos: { version: 1, revision: 0, ultimoTrabajo: null } });
  await assert.rejects(pendiente);
});

test('montaje prepara activación incluso sin habilitarla y mantiene programación fuera del router humano', async (t) => {
  const f = fixture(t);
  let llamadas = 0;
  assert.ok(f.opciones.actualizacion);
  const panel = await montarAdministracion({
    ...f.opciones,
    actualizacion: {
      configuracion: f.opciones.actualizacion.configuracion,
      pedir: async () => {
        llamadas++;
        assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE name='administracion_activacion'").get());
        return Response.json({
          workflow_run_id: 789,
          run_url: 'https://api.github.com/repos/equipo/fuente/actions/runs/789',
          html_url: 'https://github.com/equipo/fuente/actions/runs/789',
        });
      },
    },
  });
  assert.equal(panel.recibirActivacion, undefined);
  assert.ok(panel.ejecutarProgramada);
  await panel.ejecutarProgramada(EVENTO, senal());
  await panel.ejecutarProgramada(EVENTO, senal());
  assert.equal(llamadas, 1);
  const respuesta = await panel.responder(
    new Request('https://panel.example/administracion/api/datos/programada', { method: 'POST' }),
  );
  assert.ok(!respuesta.ok);
  assert.equal(llamadas, 1);
});

test('programación OFF o defectuosa no se valida al montar ni afecta a controles y catálogo', async (t) => {
  const f = fixture(t);
  for (const texto of [JSON.stringify({ ...CONFIGURACION, habilitada: false }), '{']) {
    const obtener = configuracionProgramadaDiferida({ FARO_ACTUALIZACION_PROGRAMADA: texto });
    assert.ok(obtener);
    const panel = await montarAdministracion({
      ...f.opciones,
      programada: { configuracion: obtener, almacen: f.almacen },
      actualizacion: { configuracion: () => assert.fail('No validar ejecutor') },
    });
    assert.deepEqual(await panel.leerControles(senal()), { ...POLITICA, revision: 0 });
    assert.equal(
      (await panel.catalogo(new Request('https://panel.example/.well-known/api-catalog'))).status,
      ESTADO_HTTP.correcto,
    );
    if (texto === '{') {
      // La configuración defectuosa queda como fallo de su fase, sin reservar ni despachar.
      await assert.rejects(panel.ejecutarProgramada?.(EVENTO, senal()) ?? Promise.resolve(), {
        fase: 'configuracion',
        registrado: true,
      });
      assert.deepEqual(
        f.db
          .prepare('SELECT resultado, fase FROM administracion_programacion_eventos')
          .all()
          .map((e) => ({ ...e })),
        [{ resultado: 'fallida', fase: 'configuracion' }],
      );
    } else {
      await panel.ejecutarProgramada?.(EVENTO, senal());
      assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='administracion_trabajo'").get(), undefined);
    }
  }
});

test('cancelación durante preparar trabajos impide preparación/reserva/despacho posteriores', async (t) => {
  const f = fixture(t);
  const continuar = Promise.withResolvers<void>();
  const iniciado = Promise.withResolvers<void>();
  const original = f.almacen.prepararTrabajos.bind(f.almacen);
  t.mock.method(f.almacen, 'prepararTrabajos', async () => {
    iniciado.resolve();
    await continuar.promise;
    await original();
  });
  const prepararActivacion = t.mock.method(f.almacen, 'prepararActivacion');
  const reservar = t.mock.method(f.almacen, 'reservarTrabajoProgramado');
  const panel = await montarAdministracion(f.opciones);
  const control = new AbortController();
  const pendiente = panel.ejecutarProgramada?.(EVENTO, control.signal);
  await iniciado.promise;
  control.abort();
  await assert.rejects(pendiente ?? Promise.resolve());
  continuar.resolve();
  await new Promise<void>((resolver) => setImmediate(resolver));
  assert.equal(prepararActivacion.mock.callCount(), 0);
  assert.equal(reservar.mock.callCount(), 0);
});
