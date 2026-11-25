/** El reloj diario sale solo de los estados que paran el ciclo y deja constancia de cada evento; sin red real. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { configuracionProgramadaDelEntorno } from '../../src/administracion/configuracion-programada.ts';
import { crearConsultorEjecucionGitHub } from '../../src/administracion/consulta-ejecucion-github.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { crearDespachadorGitHub } from '../../src/administracion/ejecutor-github.ts';
import { PLAZO_PANEL_MS } from '../../src/administracion/http.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import {
  MAX_EVENTOS_PROGRAMADOS,
  MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR,
  PLAZO_RESERVA_PROGRAMADA_MS,
  VENTANA_TRABAJO_PROGRAMADO_MS,
} from '../../src/administracion/programacion-trabajos.ts';
import { crearComprobadorProgramado } from '../../src/administracion/programada.ts';
import {
  crearReconciliadorSinSesion,
  PLAZO_RECONCILIACION_SIN_SESION_MS,
} from '../../src/administracion/reconciliacion.ts';
import { evaluarVigilante } from '../../src/administracion/vigilante.ts';
import { leerVigilantePanel } from '../../src/administracion/vigilante-panel.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { leerProgramacionSqlite } from '../../src/plataforma/acceso-publico/programacion-sqlite.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { montarAdministracion } from '../../src/plataforma/administracion.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';
import { CONFIG_VIGILANTE, CORTE_VIGILANTE, entradasVigilante, PROGRAMADA_VIGILANTE } from '../ayudas/vigilante.ts';

const SEGUNDO = 1000;
const HORA = 60 * 60 * SEGUNDO;
const MINUTOS_RESERVA = 384;
const DIA = 24 * HORA;
const AHORA = Date.parse('2026-10-17T03:00:00Z');
const CRON = '0 3 * * *';
const TAM_HASH = 64;
const TAM_SHA = 40;
const VIDA_TOKEN_S = 600;
const RUN_ID = 123;
const VENTANA_SUPERADA_MS = VENTANA_TRABAJO_PROGRAMADO_MS + HORA;
const RETRASO_EXTRA_MS = 300;
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
const DESTINO = { propietario: 'equipo', repositorio: 'fuente', workflow: 'actualizar.yml', ref: 'refs/heads/main' };
const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
const senal = () => new AbortController().signal;
const tick = (eventoEn: number) => ({ eventoEn, cron: CRON });

async function fixture(t: TestContext) {
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
  const reloj = { ahora: AHORA };
  new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: () => reloj.ahora });
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
  await backend.prepararPanel(POLITICA);
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
  const eventos = () => leerProgramacionSqlite(sql, reloj.ahora).eventos.map((e) => [e.resultado, e.motivo]);
  return { db, sql, reloj, backend, eventos };
}
function identidad(ahora: number): IdentidadEjecucionGitHub {
  const { audiencia: _, ...pins } = CONFIANZA;
  return {
    ...pins,
    runId: String(RUN_ID),
    runAttempt: '1',
    jti: 'sintetico',
    emitidoEn: ahora / SEGUNDO,
    caducaEn: ahora / SEGUNDO + VIDA_TOKEN_S,
  };
}
/** Doble del despacho de GitHub: responde con el estado indicado y cuenta los envíos. */
function despachoGitHub(responder: () => Response) {
  const envios: Request[] = [];
  const despachar = crearDespachadorGitHub({
    destino: DESTINO,
    obtenerToken: async () => 'secreto-sintetico',
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      envios.push(entrada);
      return responder();
    },
  });
  return { despachar, envios };
}
const aceptado = () =>
  Response.json({
    workflow_run_id: RUN_ID,
    run_url: `https://api.github.com/repos/equipo/fuente/actions/runs/${RUN_ID}`,
    html_url: `https://github.com/equipo/fuente/actions/runs/${RUN_ID}`,
  });
/** Doble del GET de la ejecución en GitHub, con la identidad fijada en la reserva. */
function ejecucionGitHub() {
  const estado: { remoto: Response | (() => Response) } = { remoto: new Response(null, { status: 502 }) };
  const consultas: Request[] = [];
  const run = (status: string, conclusion: string | null, distinto: Record<string, unknown> = {}) =>
    Response.json({
      id: RUN_ID,
      run_attempt: 1,
      event: 'workflow_dispatch',
      head_sha: CONFIANZA.sha,
      path: '.github/workflows/actualizar.yml',
      status,
      conclusion,
      repository: { id: Number(CONFIANZA.repositorioId), owner: { id: Number(CONFIANZA.propietarioId) } },
      ...distinto,
    });
  const consultar = crearConsultorEjecucionGitHub({
    obtenerToken: async () => 'secreto-sintetico',
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      consultas.push(entrada);
      return typeof estado.remoto === 'function' ? estado.remoto() : estado.remoto;
    },
  });
  return { consultar, consultas, estado, run };
}

test('el cron de recuperación sustituye una sola vez un run conocido que GitHub cerró sin permiso de inicio', async (t) => {
  const f = await fixture(t);
  const github = despachoGitHub(aceptado);
  const remoto = ejecucionGitHub();
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: github.despachar,
    reconciliar: crearReconciliadorSinSesion({ almacen: f.backend, consultar: remoto.consultar }),
  });
  const diario = tick(AHORA);
  const recuperacion = { ...diario, recuperacion: true as const };
  assert.equal(await comprobar(diario, senal()), 'nueva');
  const original = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(original);
  f.reloj.ahora += HORA;
  remoto.estado.remoto = () => remoto.run('in_progress', null);
  assert.equal(await comprobar(recuperacion, senal()), 'repetida');
  remoto.estado.remoto = () => remoto.run('completed', 'failure', { head_sha: 'c'.repeat(TAM_SHA) });
  assert.equal(await comprobar(recuperacion, senal()), 'repetida');
  remoto.estado.remoto = () => remoto.run('completed', 'failure');
  assert.equal(await comprobar(diario, senal()), 'repetida');
  assert.equal(await comprobar(recuperacion, senal()), 'nueva');
  const nuevo = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(nuevo);
  assert.notEqual(nuevo.solicitudId, original.solicitudId);
  assert.equal(await comprobar(recuperacion, senal()), 'repetida');
  assert.deepEqual(
    f.sql.filas('SELECT * FROM administracion_recuperaciones_sin_inicio').map((e) => ({ ...e })),
    [
      {
        evento_en: AHORA,
        registrado_en: f.reloj.ahora,
        run_anterior: String(RUN_ID),
        solicitud_anterior: original.solicitudId,
        solicitud_nueva: nuevo.solicitudId,
      },
    ],
  );
  assert.equal(github.envios.length, 2);
});

test('un trabajo que recibió permiso de inicio conserva su reserva aunque GitHub indique que terminó', async (t) => {
  const f = await fixture(t);
  const github = despachoGitHub(aceptado);
  const remoto = ejecucionGitHub();
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: github.despachar,
    reconciliar: crearReconciliadorSinSesion({ almacen: f.backend, consultar: remoto.consultar }),
  });
  await comprobar(tick(AHORA), senal());
  const t0 = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(t0);
  await f.backend.confirmarInicio(
    { solicitudId: t0.solicitudId, revisionReserva: t0.revisionReserva, accion: t0.accion },
    identidad(AHORA),
  );
  f.reloj.ahora += HORA;
  remoto.estado.remoto = () => remoto.run('completed', 'failure');
  assert.equal(await comprobar({ ...tick(AHORA), recuperacion: true }, senal()), 'repetida');
  assert.equal(github.envios.length, 1);
  assert.equal(remoto.consultas.length, 0);
});

test('un despacho incierto sin permiso de inicio se libera en el evento siguiente y deniega un inicio tardío', async (t) => {
  const f = await fixture(t);
  const github = despachoGitHub(() => new Response(null, { status: ESTADO_HTTP.noDisponible }));
  const remoto = ejecucionGitHub();
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: github.despachar,
    reconciliar: crearReconciliadorSinSesion({ almacen: f.backend, consultar: remoto.consultar }),
  });
  assert.equal(await comprobar(tick(AHORA), senal()), 'nueva');
  const incierto = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.equal(incierto?.estado, 'despacho-incierto');
  assert.ok(incierto);
  f.reloj.ahora += DIA;
  assert.equal(await comprobar(tick(f.reloj.ahora), senal()), 'nueva');
  assert.equal(github.envios.length, 2);
  assert.deepEqual(f.eventos(), [
    ['nueva', 'reserva-sin-inicio-liberada'],
    ['nueva', 'sin-trabajo-pendiente'],
  ]);
  const actual = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.notEqual(actual?.solicitudId, incierto.solicitudId);
  const tardio = await f.backend
    .confirmarInicio(
      { solicitudId: incierto.solicitudId, revisionReserva: incierto.revisionReserva, accion: 'comprobar-programada' },
      identidad(f.reloj.ahora),
    )
    .then(
      (r) => r.estado,
      () => 'rechazado',
    );
  assert.notEqual(tardio, 'aplicado');
  assert.equal(remoto.consultas.length, 0);
});

test('dentro del plazo una reserva sigue ocupada y no se libera ni se reenvía', async (t) => {
  const f = await fixture(t);
  assert.ok(PLAZO_RESERVA_PROGRAMADA_MS > MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR * 60 * SEGUNDO);
  assert.ok(PLAZO_RESERVA_PROGRAMADA_MS < DIA);
  f.reloj.ahora = AHORA + DIA - HORA;
  await abrirSesionDePrueba(f.backend, ACCESO);
  const manual = await f.backend.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: '11111111-1111-4111-8111-111111111111', accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA,
  );
  assert.equal(manual.estado, 'nueva');
  f.reloj.ahora = AHORA + DIA;
  const github = despachoGitHub(aceptado);
  const remoto = ejecucionGitHub();
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: github.despachar,
    reconciliar: crearReconciliadorSinSesion({ almacen: f.backend, consultar: remoto.consultar }),
  });
  assert.equal(await comprobar(tick(f.reloj.ahora), senal()), 'omitida-ocupado');
  assert.equal(github.envios.length, 0);
  assert.deepEqual(f.eventos(), [['omitida-ocupado', 'trabajo-en-plazo']]);
  assert.equal(remoto.consultas.length, 0);
});

/** Un ciclo del panel despachado a GitHub y sin recibo, una hora antes del evento diario: sigue dentro de su plazo. */
async function cicloDelPanelSinRecibo(f: Awaited<ReturnType<typeof fixture>>) {
  f.reloj.ahora = AHORA + DIA - HORA;
  await abrirSesionDePrueba(f.backend, ACCESO);
  const manual = await f.backend.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: '22222222-2222-4222-8222-222222222222', accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA,
  );
  assert.ok('trabajos' in manual && manual.estado === 'nueva');
  const trabajo = manual.trabajos.ultimoTrabajo;
  assert.ok(trabajo);
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  assert.equal(
    (await f.backend.anotarDespacho(referencia, { estado: 'despachada', runId: String(RUN_ID) })).estado,
    'aplicado',
  );
  f.reloj.ahora = AHORA + DIA;
}
test('un ciclo en plazo que GitHub ya cerró sin recibo se cierra solo y el evento diario reserva el suyo', async (t) => {
  const f = await fixture(t);
  await cicloDelPanelSinRecibo(f);
  const github = despachoGitHub(aceptado);
  const remoto = ejecucionGitHub();
  remoto.estado.remoto = () => remoto.run('completed', 'failure');
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: github.despachar,
    reconciliar: crearReconciliadorSinSesion({ almacen: f.backend, consultar: remoto.consultar }),
  });
  assert.equal(await comprobar(tick(f.reloj.ahora), senal()), 'nueva');
  assert.equal(remoto.consultas.length, 1);
  assert.equal(github.envios.length, 1);
  assert.deepEqual(f.eventos(), [['nueva', 'ejecucion-cerrada-sin-recibo']]);
  assert.equal((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.accion, 'comprobar-programada');
});
test('un ciclo en plazo que GitHub da por en curso se omite tras una sola consulta', async (t) => {
  const f = await fixture(t);
  await cicloDelPanelSinRecibo(f);
  const github = despachoGitHub(aceptado);
  const remoto = ejecucionGitHub();
  remoto.estado.remoto = () => remoto.run('in_progress', null);
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: github.despachar,
    reconciliar: crearReconciliadorSinSesion({ almacen: f.backend, consultar: remoto.consultar }),
  });
  assert.equal(await comprobar(tick(f.reloj.ahora), senal()), 'omitida-ocupado');
  assert.equal(remoto.consultas.length, 1);
  assert.equal(github.envios.length, 0);
  assert.deepEqual(f.eventos(), [['omitida-ocupado', 'trabajo-en-plazo']]);
  assert.equal((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.runId, String(RUN_ID));
});

/** Montaje administrativo real con un único transporte a GitHub: despacho por POST y consulta por GET. */
async function montajeConGitHub(f: Awaited<ReturnType<typeof fixture>>) {
  const { run } = ejecucionGitHub();
  const github = {
    envios: [] as Request[],
    consultas: [] as Request[],
    remoto: (): Response | Promise<Response> => run('in_progress', null),
    run,
  };
  const pedir: typeof fetch = async (entrada) => {
    assert.ok(entrada instanceof Request);
    if (entrada.method === 'POST') {
      github.envios.push(entrada);
      return aceptado();
    }
    assert.equal(entrada.url, `https://api.github.com/repos/equipo/fuente/actions/runs/${RUN_ID}/attempts/1`);
    github.consultas.push(entrada);
    return github.remoto();
  };
  const administracion = await montarAdministracion({
    configuracion: { origen: 'https://panel.example', permitirHttpLocal: false },
    guardiaAdministrativa: async () => null,
    almacen: new AlmacenPublicoSqlite(f.sql, { maxClientes: 1, ahora: () => f.reloj.ahora }),
    sesion: f.backend,
    trabajos: f.backend,
    almacenActivacion: f.backend,
    inicial: POLITICA,
    actualizacion: {
      configuracion: () => ({ confianza: CONFIANZA, destino: DESTINO, obtenerToken: async () => 'secreto-sintetico' }),
      pedir,
    },
    programada: { configuracion: () => ({ version: 1, habilitada: true, cron: CRON }), almacen: f.backend },
  });
  const ejecutar = administracion.ejecutarProgramada;
  assert.ok(ejecutar);
  return { ejecutar, github };
}

test('montaje real: el evento diario cierra con GitHub una ejecución vencida y completada, y no la cierra si sigue o no responde', async (t) => {
  const f = await fixture(t);
  const { ejecutar, github } = await montajeConGitHub(f);
  await ejecutar(tick(AHORA), senal());
  const trabajo = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(trabajo);
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  await f.backend.confirmarInicio({ ...referencia, accion: 'comprobar-programada' }, identidad(f.reloj.ahora));
  for (const siguiente of [
    () => github.run('in_progress', null),
    () => new Response(null, { status: ESTADO_HTTP.noDisponible }),
  ]) {
    github.remoto = siguiente;
    f.reloj.ahora += DIA;
    await ejecutar(tick(f.reloj.ahora), senal());
    assert.equal((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.estado, 'despachado');
  }
  github.remoto = () => github.run('completed', 'success');
  f.reloj.ahora += DIA;
  await ejecutar(tick(f.reloj.ahora), senal());
  assert.equal(github.consultas.length, ['en curso', 'sin respuesta', 'completada'].length);
  assert.equal(github.envios.length, 2);
  assert.deepEqual(f.eventos(), [
    ['nueva', 'ejecucion-cerrada-sin-recibo'],
    ['omitida-ocupado', 'requiere-atencion'],
    ['omitida-ocupado', 'requiere-atencion'],
    ['nueva', 'sin-trabajo-pendiente'],
  ]);
  assert.notEqual((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.solicitudId, referencia.solicitudId);
});

test('una ejecución iniciada y sin cierre solo se cierra cuando GitHub la da por completada; lo demás pide atención', async (t) => {
  const f = await fixture(t);
  const despacho = despachoGitHub(aceptado);
  const remoto = ejecucionGitHub();
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: despacho.despachar,
    reconciliar: crearReconciliadorSinSesion({ almacen: f.backend, consultar: remoto.consultar }),
  });
  assert.equal(await comprobar(tick(AHORA), senal()), 'nueva');
  assert.equal(remoto.consultas.length, 0);
  const trabajo = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(trabajo);
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  await f.backend.confirmarInicio({ ...referencia, accion: 'comprobar-programada' }, identidad(f.reloj.ahora));

  remoto.estado.remoto = () => remoto.run('in_progress', null);
  f.reloj.ahora += DIA;
  assert.equal(await comprobar(tick(f.reloj.ahora), senal()), 'omitida-ocupado');
  remoto.estado.remoto = () => new Response(null, { status: ESTADO_HTTP.noDisponible });
  f.reloj.ahora += DIA;
  assert.equal(await comprobar(tick(f.reloj.ahora), senal()), 'omitida-ocupado');
  assert.equal((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.estado, 'despachado');

  remoto.estado.remoto = () => remoto.run('completed', 'failure');
  f.reloj.ahora += DIA;
  assert.equal(await comprobar(tick(f.reloj.ahora), senal()), 'nueva');
  const diasVencidos = ['en curso', 'sin respuesta', 'completada'];
  assert.equal(remoto.consultas.length, diasVencidos.length);
  assert.equal(despacho.envios.length, 2);
  assert.deepEqual(f.eventos(), [
    ['nueva', 'ejecucion-cerrada-sin-recibo'],
    ['omitida-ocupado', 'requiere-atencion'],
    ['omitida-ocupado', 'requiere-atencion'],
    ['nueva', 'sin-trabajo-pendiente'],
  ]);
  const historial = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.notEqual(historial?.solicitudId, referencia.solicitudId);
});

test('el historial conserva como máximo sesenta eventos, del más reciente al más antiguo, sin datos personales', async (t) => {
  const f = await fixture(t);
  const total = MAX_EVENTOS_PROGRAMADOS + 2;
  for (let dia = 0; dia < total; dia++) {
    const eventoEn = AHORA + dia * DIA;
    f.reloj.ahora = eventoEn + VENTANA_SUPERADA_MS;
    assert.equal((await f.backend.reservarTrabajoProgramado(tick(eventoEn), CONFIANZA)).estado, 'omitida-tardia');
  }
  const programacion = leerProgramacionSqlite(f.sql, f.reloj.ahora);
  assert.equal(programacion.eventos.length, MAX_EVENTOS_PROGRAMADOS);
  assert.equal(programacion.eventos[0]?.eventoEn, AHORA + (total - 1) * DIA);
  assert.equal(programacion.eventos.at(-1)?.eventoEn, AHORA + 2 * DIA);
  assert.ok(
    programacion.eventos.every((e) => e.resultado === 'omitida-tardia' && e.motivo === 'evento-fuera-de-ventana'),
  );
  const columnas = f.db
    .prepare('SELECT name FROM pragma_table_info(?) ORDER BY name')
    .all('administracion_programacion_eventos')
    .map((c) => c.name);
  assert.deepEqual(columnas, ['evento_en', 'fase', 'motivo', 'motivo_fallo', 'registrado_en', 'resultado']);
});

test('el panel del vigilante entrega el historial de la programación y rechaza motivos desconocidos', () => {
  const entradas = entradasVigilante();
  const eventoEn = entradas.programacion.ultimoEventoEn ?? 0;
  entradas.programacion = {
    ...entradas.programacion,
    eventos: [
      {
        eventoEn,
        registradoEn: eventoEn,
        resultado: 'omitida-ocupado',
        motivo: 'requiere-atencion',
        fase: null,
        motivoFallo: null,
      },
    ],
  };
  const evaluacion = evaluarVigilante(CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, entradas, CORTE_VIGILANTE);
  assert.deepEqual(evaluacion.eventosProgramados, entradas.programacion.eventos);
  const dto = {
    version: 1,
    origenDatos: 'recibo',
    evaluadoEn: CORTE_VIGILANTE,
    pulsoContinuo: 'no-instrumentado',
    entregaActiva: 'sin-observacion-actual',
    revision: 0,
    incidencias: [],
    areas: [],
    fechaDatos: [],
    ultimoTrabajo: null,
    eventosProgramados: [{ eventoEn, resultado: 'omitida-ocupado', motivo: 'requiere-atencion' }],
  };
  // Sin fallos ni canal de avisos, la respuesta tiene la forma que ya leía un panel anterior.
  assert.deepEqual(leerVigilantePanel(dto).eventosProgramados, dto.eventosProgramados);
  assert.ok(!('avisos' in leerVigilantePanel(dto)));
  for (const evento of [
    { resultado: 'nueva', motivo: 'ejecucion-cerrada-sin-recibo' },
    { resultado: 'omitida-candidato', motivo: 'candidato-en-plazo' },
    { resultado: 'nueva', motivo: 'sin-trabajo-pendiente', fase: 'despacho', motivoFallo: 'error' },
    { resultado: 'fallida', motivo: 'evento-sin-consumir', fase: 'reserva', motivoFallo: 'plazo-agotado' },
  ]) {
    const eventosProgramados = [{ eventoEn, ...evento }];
    assert.deepEqual(leerVigilantePanel({ ...dto, eventosProgramados }).eventosProgramados, eventosProgramados);
  }
  for (const incorrecto of [
    { resultado: 'nueva', motivo: 'requiere-atencion' },
    { resultado: 'fallida', motivo: 'evento-sin-consumir' },
    { resultado: 'nueva', motivo: 'sin-trabajo-pendiente', fase: null, motivoFallo: null },
    { resultado: 'fallida', motivo: 'evento-sin-consumir', fase: 'reserva' },
    { resultado: 'fallida', motivo: 'evento-sin-consumir', fase: 'despacho', motivoFallo: 'error' },
    { resultado: 'omitida-ocupado', motivo: 'requiere-atencion', fase: 'reserva', motivoFallo: 'error' },
    { resultado: 'fallida', motivo: 'evento-sin-consumir', fase: 'reserva', motivoFallo: 'texto del error' },
  ]) {
    assert.throws(() => leerVigilantePanel({ ...dto, eventosProgramados: [{ eventoEn, ...incorrecto }] }));
  }
  // `avisos` solo viaja cuando dice algo más que «no configurados». La forma anterior, sin canales, se lee como el
  // canal de la dirección web.
  const enviado = {
    estado: 'configurados',
    ultimoIntento: { en: CORTE_VIGILANTE, resultado: 'enviado', motivo: null },
  };
  assert.deepEqual(leerVigilantePanel({ ...dto, avisos: enviado }).avisos, { canales: [{ canal: 'url', ...enviado }] });
  assert.throws(() => leerVigilantePanel({ ...dto, avisos: { estado: 'no-configurados', ultimoIntento: null } }));
});

// La igualdad entre este límite y los topes de actualizar.yml la comprueba pruebas/herramientas/workflow-presupuesto.test.ts.
// El horario solo admite un cron diario: una reserva que no vence antes del evento siguiente lo dejaría omitido como
// trabajo en plazo, en vez de reconciliar la reserva que se quedó sin cerrar. La ventana de los eventos no la limita:
// mide lo que tarda en llegar un evento, no lo que dura el trabajo anterior.
test('la reserva dura 384 minutos, más que el límite del workflow y menos que un día, y la plantilla del horario coincide con su variable', () => {
  assert.ok(PLAZO_RESERVA_PROGRAMADA_MS > MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR * 60 * SEGUNDO);
  assert.ok(PLAZO_RESERVA_PROGRAMADA_MS < DIA);
  assert.equal(PLAZO_RESERVA_PROGRAMADA_MS, MINUTOS_RESERVA * 60 * SEGUNDO);
  const fragmento = JSON.parse(
    readFileSync(new URL('../../config/cloudflare/programacion.example.jsonc', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(fragmento).sort(), ['triggers', 'vars']);
  const configuracion = configuracionProgramadaDelEntorno(fragmento.vars);
  assert.equal(configuracion?.habilitada, true);
  assert.deepEqual(fragmento.triggers, { crons: [configuracion?.cron] });
});

/** Deja una ejecución programada despachada, con inicio confirmado y ya vencida en el reloj de la autoridad. */
async function ejecucionVencida(f: Awaited<ReturnType<typeof fixture>>) {
  const despacho = despachoGitHub(aceptado);
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: despacho.despachar,
    reconciliar: async () => 'sin-ejecucion-abierta',
  });
  assert.equal(await comprobar(tick(AHORA), senal()), 'nueva');
  const trabajo = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(trabajo);
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  await f.backend.confirmarInicio({ ...referencia, accion: 'comprobar-programada' }, identidad(f.reloj.ahora));
  f.reloj.ahora += DIA;
  return referencia;
}

test('la consulta a GitHub sigue el reloj de la autoridad y no se pide para un evento repetido o tardío', async (t) => {
  const f = await fixture(t);
  // Ejecución manual con inicio confirmado, creada 6 h antes del evento: vence solo si el evento llega tarde.
  f.reloj.ahora = AHORA + DIA - VENTANA_TRABAJO_PROGRAMADO_MS;
  await abrirSesionDePrueba(f.backend, ACCESO);
  const solicitudId = '11111111-1111-4111-8111-111111111111';
  await f.backend.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId, accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA,
  );
  const referencia = { solicitudId, revisionReserva: 1 };
  await f.backend.anotarDespacho(referencia, { estado: 'despachada', runId: String(RUN_ID) });
  await f.backend.confirmarInicio({ ...referencia, accion: 'actualizar-datos' }, identidad(f.reloj.ahora));
  let consultas = 0;
  const comprobar = crearComprobadorProgramado({
    almacen: f.backend,
    confianza: CONFIANZA,
    despachar: despachoGitHub(aceptado).despachar,
    reconciliar: async () => {
      consultas++;
      return 'en-curso';
    },
  });
  // El evento del día llega con 2 h de retraso: con su propia hora la ejecución aún estaría en plazo.
  f.reloj.ahora = AHORA + DIA + 2 * HORA;
  assert.equal(await comprobar(tick(AHORA), senal()), 'omitida-tardia');
  assert.equal(consultas, 0);
  assert.equal(await comprobar(tick(AHORA + DIA), senal()), 'omitida-ocupado');
  assert.equal(consultas, 1);
  assert.equal(await comprobar(tick(AHORA + DIA), senal()), 'repetida');
  assert.equal(consultas, 1);
  assert.deepEqual(f.eventos(), [
    ['omitida-ocupado', 'requiere-atencion'],
    ['omitida-tardia', 'evento-fuera-de-ventana'],
  ]);
});

test('una consulta lenta que acaba en completada se trata como indeterminada y deja el plazo al despacho', async (t) => {
  const f = await fixture(t);
  const { ejecutar, github } = await montajeConGitHub(f);
  await ejecutar(tick(AHORA), senal());
  const trabajo = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(trabajo);
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  await f.backend.confirmarInicio({ ...referencia, accion: 'comprobar-programada' }, identidad(f.reloj.ahora));
  github.remoto = async () => {
    await new Promise((resolver) => setTimeout(resolver, PLAZO_RECONCILIACION_SIN_SESION_MS + RETRASO_EXTRA_MS));
    return github.run('completed', 'success');
  };
  f.reloj.ahora += DIA;
  const inicio = performance.now();
  await ejecutar(tick(f.reloj.ahora), senal());
  assert.ok(performance.now() - inicio < PLAZO_PANEL_MS);
  assert.equal((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.estado, 'despachado');
  assert.deepEqual(f.eventos()[0], ['omitida-ocupado', 'requiere-atencion']);
  github.remoto = () => github.run('completed', 'success');
  f.reloj.ahora += DIA;
  await ejecutar(tick(f.reloj.ahora), senal());
  assert.deepEqual(f.eventos()[0], ['nueva', 'ejecucion-cerrada-sin-recibo']);
  assert.equal(github.envios.length, 2);
});

test('el reconciliador programado no cierra una ejecución completada con otra identidad ni con un segundo intento', async (t) => {
  for (const distinto of [
    { repository: { id: Number(CONFIANZA.repositorioId) + 1, owner: { id: Number(CONFIANZA.propietarioId) } } },
    { head_sha: 'c'.repeat(TAM_SHA) },
    { id: RUN_ID + 1 },
    { run_attempt: 2 },
  ]) {
    const f = await fixture(t);
    const referencia = await ejecucionVencida(f);
    const remoto = ejecucionGitHub();
    remoto.estado.remoto = () => remoto.run('completed', 'success', distinto);
    const reconciliar = crearReconciliadorSinSesion({ almacen: f.backend, consultar: remoto.consultar });
    assert.equal(await reconciliar(senal()), 'indeterminada');
    const actual = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
    assert.equal(actual?.solicitudId, referencia.solicitudId);
    assert.equal(actual?.estado, 'despachado');
  }
});
