/** Runtime y binding DO reales con SQLite local; ningún transporte sale a la red. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { PLAZO_PANEL_MS } from '../../src/administracion/http.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import type { VariablesDelEntorno } from '../../src/comun/entorno.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { prepararActivacionSqlite } from '../../src/plataforma/acceso-publico/activacion-sqlite.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { prepararProgramacionSqlite } from '../../src/plataforma/acceso-publico/programacion-sqlite.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { prepararTrabajosSqlite } from '../../src/plataforma/acceso-publico/trabajos-sqlite.ts';
import { prepararVigilanteSqlite } from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import { CONFIG_VIGILANTE, DIA_VIGILANTE } from '../ayudas/vigilante.ts';

const ORIGEN = 'https://panel.example';
const TAM_SHA = 40;
const MINUTO_MS = 60_000;
const DESPACHO_GITHUB = {
  workflow_run_id: 789,
  run_url: 'https://api.github.com/repos/equipo/fuente/actions/runs/789',
  html_url: 'https://github.com/equipo/fuente/actions/runs/789',
};
const CONFIGURACION_ACTUALIZACION = JSON.stringify({
  version: 1,
  confianza: {
    audiencia: `${ORIGEN}/mantenimiento/resultado`,
    repositorioId: '123',
    propietarioId: '456',
    ref: 'refs/heads/main',
    workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
    sha: 'a'.repeat(TAM_SHA),
    workflowSha: 'b'.repeat(TAM_SHA),
  },
  destino: { propietario: 'equipo', repositorio: 'fuente', workflow: 'actualizar.yml', ref: 'main' },
});
function eventoActual(instante = Date.now()) {
  const scheduledTime = Math.floor(instante / MINUTO_MS) * MINUTO_MS;
  const fecha = new Date(scheduledTime);
  return { scheduledTime, cron: `${fecha.getUTCMinutes()} ${fecha.getUTCHours()} * * *` };
}
function solicitud(ruta: string, method = 'GET') {
  return new Request(`${ORIGEN}${ruta}`, { method, headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } });
}
function variablesFixture(cambios: VariablesDelEntorno) {
  return {
    FARO_ADMINISTRACION: 'si',
    FARO_ADMIN_ORIGEN: ORIGEN,
    FARO_ADMIN_ACCESS_EQUIPO: 'equipo-prueba',
    FARO_ADMIN_ACCESS_AUD: 'panel',
    FARO_SECRETO_FIRMA: 'firma-sintetica-privada-de-mas-de-treinta-y-dos-caracteres',
    FARO_ACTUALIZACION_GITHUB: CONFIGURACION_ACTUALIZACION,
    FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico',

    ...cambios,
  };
}
function estadoSqlite(db: DatabaseSync): EstadoAccesoPublicoDurable {
  return {
    storage: {
      sql: {
        exec: (sentencia: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sentencia).all(...valores) }),
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
function fixture(t: TestContext, cambios: VariablesDelEntorno = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const rutas: string[] = [];
  const variables = variablesFixture(cambios);
  const estado = estadoSqlite(db);
  const esperar = { antes: async (_ruta: string) => {} };
  let durable: AccesoPublicoDurable | undefined;
  const espacio = {
    idFromName: (nombre: string) => nombre,
    get: () => ({
      fetch: async (peticion: Request) => {
        const ruta = new URL(peticion.url).pathname;
        rutas.push(ruta);
        await esperar.antes(ruta);
        durable ??= new AccesoPublicoDurable(estado, variables);
        return durable.fetch(peticion);
      },
    }),
  };
  const env = {
    ...variables,
    REGISTRO_SOCIOS: espacio,
    ASSETS: { fetch: async () => new Response('estático', { status: ESTADO_HTTP.noEncontrado }) },
  };
  return { db, rutas, env, esperar };
}

test('scheduled ausente/OFF no prepara autoridad, incluso con administración y ejecutor defectuosos', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No usar red'));
  const evento = eventoActual();
  for (const cambio of [
    {},
    { FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ version: 1, habilitada: false, cron: evento.cron }) },
  ]) {
    const f = fixture(t, { ...cambio, FARO_ADMINISTRACION: 'rota', FARO_ACTUALIZACION_GITHUB: '{' });
    let sinReintentos = 0;
    await worker.scheduled(
      {
        ...evento,
        noRetry: () => {
          sinReintentos++;
        },
      },
      f.env,
    );
    assert.equal(sinReintentos, 1);
    assert.equal(f.rutas.length, 0);
    assert.equal((await worker.fetch(solicitud('/inicio.html'), f.env)).status, ESTADO_HTTP.noEncontrado);
  }
});

/** Las filas del historial de eventos, sin el instante de registro. */
function eventosGuardados(db: DatabaseSync) {
  return db
    .prepare('SELECT evento_en, resultado, motivo, fase, motivo_fallo FROM administracion_programacion_eventos')
    .all()
    .map((fila) => ({ ...fila }));
}

test('configuración programada inválida falla con error neutral, guarda su fase y no reserva ni despacha', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No usar red'));
  const registro = t.mock.method(console, 'error', () => {});
  const f = fixture(t, { FARO_ACTUALIZACION_PROGRAMADA: '{SECRETO-NO-IMPRIMIR' });
  const evento = eventoActual();
  await assert.rejects(worker.scheduled(evento, f.env), {
    message: 'La actualización programada no está disponible',
    cause: { fase: 'configuracion', registrado: true },
  });
  assert.deepEqual(
    registro.mock.calls.map((c) => c.arguments),
    [['Faro: la actualización programada ha fallado.', { fase: 'configuracion', registrado: true }]],
  );
  assert.deepEqual(eventosGuardados(f.db), [
    {
      evento_en: evento.scheduledTime,
      resultado: 'fallida',
      motivo: 'evento-sin-consumir',
      fase: 'configuracion',
      motivo_fallo: 'error',
    },
  ]);
  assert.equal(f.db.prepare('SELECT evento_en FROM administracion_programacion').get()?.evento_en, 0);
  assert.ok(!JSON.stringify(registro.mock.calls).includes('SECRETO'));
  assert.equal((await worker.fetch(solicitud('/inicio.html'), f.env)).status, ESTADO_HTTP.noEncontrado);
  assert.equal((await worker.fetch(solicitud('/api/salud'), f.env)).status, ESTADO_HTTP.correcto);
  assert.ok(f.rutas.every((ruta) => ruta !== '/trabajos/programada'));
});

test('si la autoridad no puede guardar el fallo, queda el aviso en el registro de Cloudflare con su fase', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No usar red'));
  const registro = t.mock.method(console, 'error', () => {});
  const f = fixture(t, { FARO_ACTUALIZACION_PROGRAMADA: '{SECRETO-NO-IMPRIMIR' });
  f.esperar.antes = async (ruta) => {
    if (ruta === '/trabajos/programada/fallo') {
      throw new Error('autoridad sin respuesta');
    }
  };
  await assert.rejects(worker.scheduled(eventoActual(), f.env), {
    message: 'La actualización programada no está disponible',
    cause: { fase: 'configuracion', registrado: false },
  });
  assert.deepEqual(
    registro.mock.calls.map((c) => c.arguments),
    [['Faro: la actualización programada ha fallado.', { fase: 'configuracion', registrado: false }]],
  );
});

test('scheduled prepara la autoridad y despacha una sola vez aunque el runtime entregue distintos instantes del minuto', async (t) => {
  const evento = eventoActual(Date.now() - MINUTO_MS);
  const f = fixture(t, {
    FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ version: 1, habilitada: true, cron: evento.cron }),
  });
  const despachos: unknown[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (entrada: Parameters<typeof fetch>[0], opciones?: Parameters<typeof fetch>[1]) => {
      const peticion = new Request(entrada, opciones);
      assert.equal(
        peticion.url,
        'https://api.github.com/repos/equipo/fuente/actions/workflows/actualizar.yml/dispatches',
      );
      assert.equal(peticion.headers.get('user-agent'), IDENTIDAD_WEB['User-Agent']);
      despachos.push(await peticion.json());
      return Response.json({
        workflow_run_id: 789,
        run_url: 'https://api.github.com/repos/equipo/fuente/actions/runs/789',
        html_url: 'https://github.com/equipo/fuente/actions/runs/789',
      });
    },
  );
  const desplazado = { ...evento, scheduledTime: evento.scheduledTime + MINUTO_MS - 1 };
  await Promise.all([worker.scheduled(desplazado, f.env), worker.scheduled(evento, f.env)]);
  assert.equal(despachos.length, 1);
  assert.deepEqual(
    eventosGuardados(f.db).map((fila) => fila.evento_en),
    [evento.scheduledTime],
  );
  const despacho = despachos[0] as { inputs: { accion: string } };
  assert.equal(despacho.inputs.accion, 'comprobar-programada');
  assert.equal(f.db.prepare('SELECT huella_sesion FROM administracion_sesion').get()?.huella_sesion, null);
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE name='administracion_activacion'").get());
  assert.equal((await worker.fetch(solicitud('/api/salud'), f.env)).status, ESTADO_HTTP.correcto);
  for (const ruta of ['/mantenimiento/programada', '/mantenimiento/scheduled', '/mantenimiento/programada/']) {
    assert.equal((await worker.fetch(solicitud(ruta, 'POST'), f.env)).status, ESTADO_HTTP.noEncontrado);
  }
  assert.equal(despachos.length, 1);
});

test('cron o instante discordante se guarda como fallo de validación, sin reserva ni despacho', async (t) => {
  const evento = eventoActual();
  const f = fixture(t, {
    FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ version: 1, habilitada: true, cron: evento.cron }),
  });
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No despachar'));
  t.mock.method(console, 'error', () => {});
  for (const entrada of [
    { ...evento, cron: '00 0 * * *' },
    { ...evento, scheduledTime: evento.scheduledTime - MINUTO_MS + 1 },
  ]) {
    await assert.rejects(worker.scheduled(entrada, f.env), {
      message: 'La actualización programada no está disponible',
      cause: { fase: 'validacion', registrado: true },
    });
  }
  assert.deepEqual(
    eventosGuardados(f.db).map((e) => [e.evento_en, e.resultado, e.fase]),
    [
      [evento.scheduledTime, 'fallida', 'validacion'],
      [evento.scheduledTime - MINUTO_MS + 1, 'fallida', 'validacion'],
    ].sort((a, b) => Number(a[0]) - Number(b[0])),
  );
  assert.ok(f.rutas.every((ruta) => ruta !== '/trabajos/programada'));
});

/**
 * Un instante posterior al reloj de la autoridad no se guarda: sería una fila por delante de toda evaluación, que el
 * panel no podría mostrar. Queda solo el aviso en el registro de Cloudflare, con `registrado: false`.
 */
test('un instante posterior al reloj falla en la validación y solo queda en el registro de Cloudflare', async (t) => {
  const evento = eventoActual();
  const f = fixture(t, {
    FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ version: 1, habilitada: true, cron: evento.cron }),
  });
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No despachar'));
  const registro = t.mock.method(console, 'error', () => {});
  const futuro = { ...evento, scheduledTime: evento.scheduledTime + 2 * MINUTO_MS + 1 };
  await assert.rejects(worker.scheduled(futuro, f.env), {
    message: 'La actualización programada no está disponible',
    cause: { fase: 'validacion', registrado: false },
  });
  assert.deepEqual(eventosGuardados(f.db), []);
  assert.deepEqual(
    registro.mock.calls.map((c) => c.arguments),
    [['Faro: la actualización programada ha fallado.', { fase: 'validacion', registrado: false }]],
  );
  assert.ok(f.rutas.every((ruta) => ruta !== '/trabajos/programada'));
});

test('el montaje del panel tiene plazo y un montaje tardío no reserva ni despacha', async (t) => {
  const evento = eventoActual();
  const f = fixture(t, {
    FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ version: 1, habilitada: true, cron: evento.cron }),
  });
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No despachar'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const continuar = Promise.withResolvers<void>();
  const iniciado = Promise.withResolvers<void>();
  f.esperar.antes = async (ruta) => {
    if (ruta === '/panel/preparar') {
      iniciado.resolve();
      await continuar.promise;
    }
  };
  t.mock.method(console, 'error', () => {});
  const pendiente = worker.scheduled(evento, f.env);
  const rechazo = assert.rejects(pendiente, { cause: { fase: 'preparacion', registrado: false } });
  await iniciado.promise;
  t.mock.timers.tick(PLAZO_PANEL_MS + 1);
  await rechazo;
  continuar.resolve();
  await new Promise<void>((resolver) => setImmediate(resolver));
  assert.ok(f.rutas.every((ruta) => !ruta.startsWith('/trabajos/') && !ruta.startsWith('/activacion/')));
});

function sqlDe(db: DatabaseSync) {
  return {
    filas: (sentencia: string, ...valores: ValorSql[]) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia: string, ...valores: ValorSql[]) => {
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
}

test('el evento programado evalúa el vigilante y envía su aviso; un envío fallido no tumba el evento', async (t) => {
  const evento = eventoActual();
  const vigilante = { ...CONFIG_VIGILANTE, activadoEn: evento.scheduledTime - MINUTO_MS };
  const f = fixture(t, {
    FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ version: 1, habilitada: true, cron: evento.cron }),
    FARO_VIGILANTE: JSON.stringify(vigilante),
    FARO_AVISO_URL: 'https://avisos.example/faro',
  });
  const registro = t.mock.method(console, 'error', () => {});
  const avisos: Request[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (entrada: Parameters<typeof fetch>[0], opciones?: Parameters<typeof fetch>[1]) => {
      const peticion = new Request(entrada, opciones);
      if (peticion.url === 'https://avisos.example/faro') {
        avisos.push(peticion);
        return new Response(null, { status: 503 });
      }
      return Response.json({
        workflow_run_id: 789,
        run_url: 'https://api.github.com/repos/equipo/fuente/actions/runs/789',
        html_url: 'https://github.com/equipo/fuente/actions/runs/789',
      });
    },
  );
  // Sin preparar, el vigilante no se puede evaluar: el evento se atiende igual y el fallo queda en el registro.
  await worker.scheduled(evento, f.env);
  assert.deepEqual(
    registro.mock.calls.map((c) => c.arguments),
    [['Faro: el aviso del vigilante no se ha podido preparar.', { fase: 'aviso' }]],
  );
  prepararVigilanteSqlite(sqlDe(f.db), vigilante, Date.now());
  await worker.scheduled(evento, f.env);
  assert.equal(avisos.length, 1);
  const cuerpo = (await avisos[0]?.json()) as { tipo: string; panel: string };
  assert.equal(cuerpo.tipo, 'nuevo');
  assert.equal(cuerpo.panel, `${ORIGEN}/administracion/`);
  assert.ok(Number(f.db.prepare('SELECT count(*) AS n FROM administracion_vigilante_decisiones').get()?.n) > 0);
  const intento = f.db
    .prepare('SELECT intento_resultado, intento_motivo, avisado FROM administracion_vigilante_aviso')
    .get();
  assert.deepEqual(
    { ...intento },
    { intento_resultado: 'fallido', intento_motivo: 'respuesta-no-admitida', avisado: null },
  );
  assert.equal(registro.mock.calls.length, 1);
});

/**
 * Vigilante con un evento ya exigible y la dirección de avisos configurada. Se prepara en cuanto la autoridad tiene
 * sus tablas (al llegar a `ruta`), igual que lo haría el panel; `lanzar` hace fallar esa ruta.
 */
function fixtureConVigilante(
  t: TestContext,
  evento: ReturnType<typeof eventoActual>,
  falla: { ruta: string; lanzar: boolean; cambios?: VariablesDelEntorno },
) {
  const vigilante = { ...CONFIG_VIGILANTE, activadoEn: evento.scheduledTime - 2 * DIA_VIGILANTE };
  const f = fixture(t, {
    FARO_ACTUALIZACION_PROGRAMADA: JSON.stringify({ version: 1, habilitada: true, cron: evento.cron }),
    FARO_VIGILANTE: JSON.stringify(vigilante),
    FARO_AVISO_URL: 'https://avisos.example/faro',
    ...falla.cambios,
  });
  f.esperar.antes = async (ruta) => {
    if (ruta === falla.ruta) {
      // Un vigilante preparado presupone la autoridad completa: trabajos, programación y activación.
      prepararTrabajosSqlite(sqlDe(f.db), Date.now());
      prepararProgramacionSqlite(sqlDe(f.db), Date.now());
      prepararActivacionSqlite(sqlDe(f.db), Date.now());
      prepararVigilanteSqlite(sqlDe(f.db), vigilante, Date.now());
      if (falla.lanzar) {
        throw new Error('autoridad sin respuesta');
      }
    }
  };
  return f;
}
type AvisoRecibido = { tipo: string; decisiones: { clave: string; motivo: string }[] };
function capturarAvisos(t: TestContext) {
  const avisos: AvisoRecibido[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (entrada: Parameters<typeof fetch>[0], opciones?: Parameters<typeof fetch>[1]) => {
      const peticion = new Request(entrada, opciones);
      assert.equal(peticion.url, 'https://avisos.example/faro', 'solo sale el aviso');
      avisos.push((await peticion.json()) as AvisoRecibido);
      return new Response(null, { status: 204 });
    },
  );
  return avisos;
}

test('una reserva fallida queda guardada sin mover la marca y el vigilante avisa de que falta el evento', async (t) => {
  const evento = eventoActual();
  const f = fixtureConVigilante(t, evento, { ruta: '/trabajos/programada', lanzar: true });
  const avisos = capturarAvisos(t);
  const registro = t.mock.method(console, 'error', () => {});
  await assert.rejects(worker.scheduled(evento, f.env), {
    message: 'La actualización programada no está disponible',
    cause: { fase: 'reserva', registrado: true },
  });
  assert.deepEqual(eventosGuardados(f.db), [
    {
      evento_en: evento.scheduledTime,
      resultado: 'fallida',
      motivo: 'evento-sin-consumir',
      fase: 'reserva',
      motivo_fallo: 'error',
    },
  ]);
  // La marca sigue sin evento consumido (0 es «sin evento»).
  assert.equal(f.db.prepare('SELECT evento_en FROM administracion_programacion').get()?.evento_en, 0);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0]?.tipo, 'nuevo');
  assert.ok(
    avisos[0]?.decisiones.some((d) => d.clave === 'programador' && d.motivo === 'evento_esperado_sin_registro'),
  );
  assert.deepEqual(
    registro.mock.calls.map((c) => c.arguments),
    [['Faro: la actualización programada ha fallado.', { fase: 'reserva', registrado: true }]],
  );
});

test('tras una programación fallida en la validación, el vigilante se evalúa y avisa', async (t) => {
  const evento = eventoActual();
  const f = fixtureConVigilante(t, evento, { ruta: '/vigilante/aviso/preparar', lanzar: false });
  const avisos = capturarAvisos(t);
  t.mock.method(console, 'error', () => {});
  await assert.rejects(worker.scheduled({ ...evento, cron: '00 0 * * *' }, f.env), {
    cause: { fase: 'validacion', registrado: true },
  });
  assert.deepEqual(
    eventosGuardados(f.db).map((e) => [e.resultado, e.fase]),
    [['fallida', 'validacion']],
  );
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0]?.tipo, 'nuevo');
  assert.ok(
    avisos[0]?.decisiones.some((d) => d.clave === 'programador' && d.motivo === 'evento_esperado_sin_registro'),
  );
  assert.ok(Number(f.db.prepare('SELECT count(*) AS n FROM administracion_vigilante_decisiones').get()?.n) > 0);
});

test('con la programación apagada, el vigilante habilitado se evalúa igual y avisa', async (t) => {
  const evento = eventoActual();
  const apagada = JSON.stringify({ version: 1, habilitada: false, cron: evento.cron });
  const f = fixtureConVigilante(t, evento, {
    ruta: '/vigilante/aviso/preparar',
    lanzar: false,
    cambios: { FARO_ACTUALIZACION_PROGRAMADA: apagada },
  });
  const avisos = capturarAvisos(t);
  const registro = t.mock.method(console, 'error', () => {});
  await worker.scheduled(evento, f.env);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0]?.tipo, 'nuevo');
  // Apagada sin pausa declarada, con el evento diario llegando: incidencia propia del programador.
  assert.ok(avisos[0]?.decisiones.some((d) => d.clave === 'programador' && d.motivo === 'programacion_apagada'));
  assert.ok(Number(f.db.prepare('SELECT count(*) AS n FROM administracion_vigilante_decisiones').get()?.n) > 0);
  assert.deepEqual(registro.mock.calls, []);
  assert.ok(
    f.rutas.every((ruta) => !ruta.startsWith('/trabajos/')),
    'sin programación no se reserva nada',
  );
});

test('con FARO_VIGILANTE no válida, el evento deja una línea en el registro de Cloudflare y avisa de ello', async (t) => {
  const evento = eventoActual();
  const f = fixtureConVigilante(t, evento, {
    ruta: '/vigilante/aviso/preparar',
    lanzar: false,
    cambios: { FARO_VIGILANTE: '{SECRETO-NO-IMPRIMIR' },
  });
  // Sin vigilante válido el evento llega a despachar: se responde a GitHub y se recogen los avisos.
  const avisos: AvisoRecibido[] = [];
  const registro = t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (entrada: Parameters<typeof fetch>[0], opciones?: RequestInit) => {
    const peticion = new Request(entrada, opciones);
    if (peticion.url !== 'https://avisos.example/faro') {
      return Response.json(DESPACHO_GITHUB);
    }
    avisos.push((await peticion.json()) as AvisoRecibido);
    return new Response(null, { status: 204 });
  });
  await worker.scheduled(evento, f.env);
  assert.deepEqual(
    avisos.map((a) => [a.tipo, a.decisiones.map((d) => `${d.clave} · ${d.motivo}`)]),
    [['nuevo', ['vigilante · configuracion_no_valida']]],
  );
  assert.deepEqual(
    registro.mock.calls.map((c) => c.arguments),
    [['Faro: la configuración del vigilante no es válida.', { fase: 'aviso', motivo: 'configuracion-vigilante' }]],
  );
  assert.ok(!JSON.stringify(registro.mock.calls).includes('SECRETO'));
  // El mismo día no se repite.
  await worker.scheduled(evento, f.env);
  assert.equal(avisos.length, 1);
});
