/** SQL real y binding privado; los ticks sintéticos nunca consultan la red. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import { leerSolicitudTrabajoProgramado } from '../../src/administracion/programacion-trabajos.ts';
import { leerSolicitudTrabajo } from '../../src/administracion/trabajos.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const SEGUNDO = 1000;
const HORA = 60 * 60 * SEGUNDO;
const DIA = 24 * HORA;
const AHORA = Date.parse('2026-10-17T03:00:00Z');
const TICK = { eventoEn: AHORA, cron: '0 3 * * *' };
const ID = '11111111-1111-4111-8111-111111111111';
const TAM_HASH = 64;
const TAM_SHA = 40;
const TAM_PAQUETE = 16;
const VIDA_TOKEN_S = 600;
const VENTANA_HORAS = 6;
const HTTP_INVALIDO = 400;
const TAM_JTI = 22;
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
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
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
function motor(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
    },
    transaccion: (accion) => transaccion(db, accion),
  };
}
async function preparar(backend: AlmacenSesionPanelSqlite | AlmacenPublicoDurable) {
  await backend.prepararPanel(POLITICA);
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
}
async function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  const reloj = { ahora: AHORA };
  new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => reloj.ahora });
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
  t.after(() => db.close());
  await preparar(backend);
  return { db, sql, reloj, backend };
}
const EVIDENCIA_COMPLETADA = {
  estado: 'completed',
  evento: 'workflow_dispatch',
  runId: '123',
  runAttempt: '1',
  repositorioId: CONFIANZA.repositorioId,
  propietarioId: CONFIANZA.propietarioId,
  sha: CONFIANZA.sha,
  workflowPath: '.github/workflows/actualizar.yml',
  conclusion: 'failure',
} as const;
function eventos(db: DatabaseSync) {
  return db.prepare('SELECT * FROM administracion_programacion_eventos ORDER BY evento_en DESC').all();
}
function identidad(ahora = AHORA): IdentidadEjecucionGitHub {
  const { audiencia: _, ...pins } = CONFIANZA;
  return {
    ...pins,
    runId: '123',
    runAttempt: '1',
    jti: 'sintetico',
    emitidoEn: ahora / SEGUNDO,
    caducaEn: ahora / SEGUNDO + VIDA_TOKEN_S,
  };
}
async function candidato(backend: AlmacenSesionPanelSqlite) {
  await abrirSesionDePrueba(backend, ACCESO);
  await backend.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA,
  );
  const referencia = { solicitudId: ID, revisionReserva: 1 };
  await backend.confirmarInicio({ ...referencia, accion: 'actualizar-datos' }, identidad());
  await backend.registrarRecibo(
    {
      ...referencia,
      accion: 'actualizar-datos',
      resultado: 'validado',
      veredicto: 'verde',
      terminadoEn: new Date(AHORA).toISOString().replace('.000Z', 'Z'),
      huellaPaquete: 'c'.repeat(TAM_PAQUETE),
      error: null,
    },
    'd'.repeat(TAM_HASH),
    identidad(),
  );
  return { ...referencia, runId: '123', revisionEsperada: 0 };
}
test('contrato cerrado: cron diario canónico e instante exacto; manual rechaza tercera acción', () => {
  assert.deepEqual(leerSolicitudTrabajoProgramado(TICK), TICK);
  for (const delta of [
    { eventoEn: 0 },
    { eventoEn: NaN },
    { eventoEn: Number.MAX_SAFE_INTEGER + 1 },
    { eventoEn: AHORA + 1 },
    { eventoEn: AHORA + SEGUNDO },
    { eventoEn: AHORA + HORA },
    { cron: '00 3 * * *' },
    { cron: '* 3 * * *' },
    { cron: '0 24 * * *' },
    { accion: 'comprobar-programada' },
  ]) {
    assert.throws(() => leerSolicitudTrabajoProgramado({ ...TICK, ...delta }));
  }
  assert.throws(() => leerSolicitudTrabajo({ solicitudId: ID, accion: 'comprobar-programada', revisionEsperada: 0 }));
  let llamadas = 0;
  assert.throws(() =>
    leerSolicitudTrabajoProgramado(
      Object.defineProperty({ cron: TICK.cron }, 'eventoEn', { enumerable: true, get: () => ++llamadas }),
    ),
  );
  assert.equal(llamadas, 0);
});
test('sin sesión humana: reserva interna lee revisión, fija acción y conserva documentos ajenos', async (t) => {
  const f = await fixture(t);
  const ajenos = () =>
    ['administracion_sesion', 'administracion_controles', 'administracion_activacion'].map((tabla) =>
      f.db.prepare(`SELECT * FROM ${tabla}`).all(),
    );
  const antes = ajenos();
  const reserva = await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA);
  assert.equal(reserva.estado, 'nueva');
  assert.equal(reserva.trabajos.revision, 1);
  assert.equal(reserva.trabajos.ultimoTrabajo?.accion, 'comprobar-programada');
  assert.match(
    reserva.trabajos.ultimoTrabajo?.solicitudId ?? '',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const bytes = f.db.prepare('SELECT documento FROM administracion_trabajo').get();
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'repetida');
  assert.equal(
    (await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: AHORA - DIA }, CONFIANZA)).estado,
    'repetida',
  );
  assert.deepEqual(f.db.prepare('SELECT documento FROM administracion_trabajo').get(), bytes);
  assert.deepEqual(ajenos(), antes);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM administracion_programacion').get()?.n, 1);
});
test('futuro no consume; tardío consume; ocupado consume aunque el trabajo termine después', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: AHORA + DIA }, CONFIANZA));
  assert.equal(f.db.prepare('SELECT evento_en FROM administracion_programacion').get()?.evento_en, 0);
  assert.equal(
    (await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: AHORA - DIA }, CONFIANZA)).estado,
    'omitida-tardia',
  );
  assert.equal(
    (await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: AHORA - DIA }, CONFIANZA)).estado,
    'repetida',
  );
  const nueva = await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA);
  assert.equal(nueva.estado, 'nueva');
  const trabajo = nueva.trabajos.ultimoTrabajo;
  assert.ok(trabajo);
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  await f.backend.confirmarInicio({ ...referencia, accion: 'comprobar-programada' }, identidad());
  f.reloj.ahora += DIA;
  const siguiente = { ...TICK, eventoEn: f.reloj.ahora };
  // Vencida y con ejecución conocida: la autoridad pide consultar a GitHub sin consumir el evento.
  assert.equal((await f.backend.reservarTrabajoProgramado(siguiente, CONFIANZA)).estado, 'pendiente-reconciliacion');
  const tras = { ...siguiente, reconciliada: true } as const;
  assert.equal((await f.backend.reservarTrabajoProgramado(tras, CONFIANZA)).estado, 'omitida-ocupado');
  await f.backend.finalizarEjecucionSinRecibo(referencia, EVIDENCIA_COMPLETADA);
  assert.equal((await f.backend.reservarTrabajoProgramado(siguiente, CONFIANZA)).estado, 'repetida');
  assert.equal((await f.backend.leerTrabajoPrivado()).ultimoTrabajo?.solicitudId, trabajo.solicitudId);
});
test('ventana seis horas inclusiva y reloj durable impide retroceso', async (t) => {
  const f = await fixture(t);
  f.reloj.ahora += VENTANA_HORAS * HORA;
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'nueva');
  f.reloj.ahora--;
  await assert.rejects(f.backend.reservarTrabajoProgramado(TICK, CONFIANZA));
  const g = await fixture(t);
  g.reloj.ahora += VENTANA_HORAS * HORA + 1;
  assert.equal((await g.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'omitida-tardia');
});
test('una instantánea reservada o en curso se protege; rechazo exacto permite nuevo', async (t) => {
  const f = await fixture(t);
  const solicitud = await candidato(f.backend);
  await f.backend.reservarActivacion(solicitud, identidad());
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'omitida-candidato');
  const instantanea = await f.backend.leerActivacionPrivada();
  f.reloj.ahora += DIA;
  assert.equal(
    (await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: f.reloj.ahora }, CONFIANZA)).estado,
    'omitida-candidato',
  );
  assert.deepEqual(await f.backend.leerActivacionPrivada(), instantanea);
  await f.backend.registrarPasoActivacion(
    { ...solicitud, revisionEsperada: 1, paso: { tipo: 'rechazar', error: 'candidato_no_verificable' } },
    identidad(f.reloj.ahora),
  );
  // El tick consumido no se recupera tras resolver el candidato.
  assert.equal(
    (await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: f.reloj.ahora }, CONFIANZA)).estado,
    'repetida',
  );
  f.reloj.ahora += DIA;
  assert.equal(
    (await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: f.reloj.ahora }, CONFIANZA)).estado,
    'nueva',
  );
});
test('confirmación de la instantánea exacta permite una nueva; una instantánea terminal ajena no detiene la comprobación', async (t) => {
  const f = await fixture(t);
  const solicitud = await candidato(f.backend);
  await f.backend.reservarActivacion(solicitud, identidad());
  const evidencia = {
    sha256Indice: 'a'.repeat(TAM_HASH),
    sha256ManifiestoWeb: 'b'.repeat(TAM_HASH),
    generacion: { revisionCodigo: CONFIANZA.sha, sha256Manifiesto: 'c'.repeat(TAM_HASH) },
    artefacto: {
      revisionCodigo: CONFIANZA.sha,
      huellaPaquete: 'c'.repeat(TAM_PAQUETE),
      sha256Artefacto: 'd'.repeat(TAM_HASH),
    },
    anterior: { principal: { versionId: ID, deploymentId: ID }, cursos: { versionId: ID, deploymentId: ID } },
  };
  const pasos = [
    { tipo: 'preparar', evidencia },
    { tipo: 'subiendo-cursos' },
    { tipo: 'cursos-subida', versionIdCursos: ID },
    { tipo: 'promoviendo-cursos' },
    { tipo: 'cursos-confirmado', versionIdCursos: ID, deploymentIdCursos: ID },
    { tipo: 'subiendo' },
    { tipo: 'subida', versionId: ID },
    { tipo: 'promoviendo' },
    { tipo: 'confirmada', versionId: ID, deploymentId: ID, sha256ManifiestoWeb: evidencia.sha256ManifiestoWeb },
  ] as const;
  for (const paso of pasos) {
    const revisionEsperada = (await f.backend.leerActivacionPrivada()).revision;
    assert.equal(
      (await f.backend.registrarPasoActivacion({ ...solicitud, revisionEsperada, paso }, identidad())).estado,
      'aplicado',
    );
  }
  const fila = f.db.prepare('SELECT documento FROM administracion_activacion').get();
  assert.ok(typeof fila?.documento === 'string');
  const documento = JSON.parse(fila.documento);
  documento.ultimaActivacion.trabajo.solicitudId = '22222222-2222-4222-8222-222222222222';
  f.db.prepare('UPDATE administracion_activacion SET documento=?').run(JSON.stringify(documento));
  f.reloj.ahora += DIA;
  assert.equal(
    (await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: f.reloj.ahora }, CONFIANZA)).estado,
    'nueva',
  );
});
test('una activación abandonada está resuelta: la comprobación diaria siguiente se reserva y puede reintentarla', async (t) => {
  const f = await fixture(t);
  const solicitud = await candidato(f.backend);
  await f.backend.reservarActivacion(solicitud, identidad());
  const anterior = { principal: { versionId: ID, deploymentId: ID }, cursos: { versionId: ID, deploymentId: ID } };
  const revisionEsperada = (await f.backend.leerActivacionPrivada()).revision;
  const abandono = { tipo: 'abandonar', motivo: 'rechazo-previo', observado: anterior } as const;
  const cierre = await f.backend.registrarPasoActivacion(
    { ...solicitud, revisionEsperada, paso: abandono },
    identidad(),
  );
  assert.equal(cierre.estado, 'aplicado');
  f.reloj.ahora += DIA;
  const reserva = await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: f.reloj.ahora }, CONFIANZA);
  assert.equal(reserva.estado, 'nueva');
});
test('un candidato validado en plazo conserva su activación; el evento diario lo omite', async (t) => {
  const f = await fixture(t);
  const solicitud = await candidato(f.backend);
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'omitida-candidato');
  assert.deepEqual(
    eventos(f.db).map(({ resultado, motivo }) => [resultado, motivo]),
    [['omitida-candidato', 'candidato-en-plazo']],
  );
  assert.equal((await f.backend.reservarActivacion(solicitud, identidad())).estado, 'aplicado');
});
test('un candidato validado sin activar y fuera de plazo no detiene la comprobación diaria y el nuevo trabajo lo sustituye', async (t) => {
  const f = await fixture(t);
  const solicitud = await candidato(f.backend);
  f.reloj.ahora += DIA;
  const reserva = await f.backend.reservarTrabajoProgramado({ ...TICK, eventoEn: f.reloj.ahora }, CONFIANZA);
  assert.equal(reserva.estado, 'nueva');
  assert.equal(reserva.trabajos.ultimoTrabajo?.accion, 'comprobar-programada');
  assert.notEqual(reserva.trabajos.ultimoTrabajo?.solicitudId, solicitud.solicitudId);
  assert.deepEqual(
    eventos(f.db).map(({ resultado, motivo }) => [resultado, motivo]),
    [['nueva', 'sin-trabajo-pendiente']],
  );
});
test('fallo tras escribir trabajo revierte watermark y reserva juntos; pérdida no se reconstruye', async (t) => {
  const f = await fixture(t);
  const roto = new AlmacenSesionPanelSqlite(
    {
      ...f.sql,
      ejecutar: (sentencia, ...valores) => {
        f.sql.ejecutar(sentencia, ...valores);
        if (sentencia.startsWith('UPDATE administracion_trabajo SET')) {
          throw new Error('fallo sintético');
        }
      },
    },
    { ahora: () => AHORA },
  );
  await assert.rejects(roto.reservarTrabajoProgramado(TICK, CONFIANZA), /fallo sintético/);
  assert.equal((await f.backend.leerTrabajoPrivado()).revision, 0);
  assert.equal(f.db.prepare('SELECT evento_en FROM administracion_programacion').get()?.evento_en, 0);
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'nueva');
  f.db.exec('DROP TABLE administracion_programacion');
  await assert.rejects(f.backend.prepararTrabajos());
  await assert.rejects(f.backend.reservarTrabajoProgramado(TICK, CONFIANZA));
});
test('dos conexiones y reinicio mantienen dedup de ticks ya omitidos sin permiso de despacho', async (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'programacion-node-'));
  const opciones = {
    archivo: join(dir, 'autoridad.sqlite'),
    maxClientes: 2,

    ahora: () => AHORA,
  };
  let a = crearAlmacenPublicoNode(opciones);
  const b = crearAlmacenPublicoNode(opciones);
  t.after(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true });
  });
  await preparar(a.sesion as AlmacenSesionPanelSqlite);
  const reservar = (base: typeof a) =>
    (base.trabajos as AlmacenSesionPanelSqlite).reservarTrabajoProgramado(TICK, CONFIANZA);
  const resultados = await Promise.all([reservar(a), reservar(b)]);
  assert.deepEqual(resultados.map((r) => r.estado).sort(), ['nueva', 'repetida']);
  const antes = await a.trabajos.leerTrabajoPrivado();
  a.close();
  a = crearAlmacenPublicoNode(opciones);
  assert.equal((await reservar(a)).estado, 'repetida');
  assert.deepEqual(await a.trabajos.leerTrabajoPrivado(), antes);
});
function fixtureDurable(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: { exec: (sql, ...valores) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: (accion) => transaccion(db, accion),
    },
  };
  const entorno = {};
  let servidor = new AccesoPublicoDurable(estado, entorno);
  let perder = false;
  const backend = new AlmacenPublicoDurable({
    idFromName: (n) => {
      assert.equal(n, 'registro-publico-v1');
      return n;
    },
    get: () => ({
      fetch: async (p) => {
        const respuesta = await servidor.fetch(p);
        if (perder) {
          perder = false;
          throw new Error('respuesta perdida');
        }
        return respuesta;
      },
    }),
  });
  return {
    backend,
    perder: () => {
      perder = true;
    },
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, entorno);
    },
    fetch: (p: Request) => servidor.fetch(p),
  };
}
test('DO mismo binding consume tick aunque se pierda respuesta; reinicio nunca vuelve a despachar', async (t) => {
  const f = fixtureDurable(t);
  await preparar(f.backend);
  const ahora = new Date();
  ahora.setUTCSeconds(0, 0);
  const tick = { eventoEn: ahora.getTime(), cron: `${ahora.getUTCMinutes()} ${ahora.getUTCHours()} * * *` };
  f.perder();
  await assert.rejects(f.backend.reservarTrabajoProgramado(tick, CONFIANZA));
  const reservado = await f.backend.leerTrabajoPrivado();
  assert.equal(reservado.revision, 1);
  assert.equal(reservado.ultimoTrabajo?.accion, 'comprobar-programada');
  f.reiniciar();
  assert.equal((await f.backend.reservarTrabajoProgramado(tick, CONFIANZA)).estado, 'repetida');
  assert.deepEqual(await f.backend.leerTrabajoPrivado(), reservado);
  const respuesta = await f.fetch(
    new Request('https://registro-socios.invalid/trabajos/reservar', {
      method: 'POST',
      body: JSON.stringify({
        acceso: ACCESO,
        solicitud: { solicitudId: ID, revisionEsperada: 0, accion: 'comprobar-programada' },
        confianza: CONFIANZA,
      }),
    }),
  );
  assert.equal(respuesta.status, HTTP_INVALIDO);
});

test('preparación 88 aditiva desde DB previa preserva sesión, credenciales y cuotas; falta 87 falla sin consumir', async (t) => {
  const f = await fixture(t);
  const publico = new AlmacenPublicoSqlite(f.sql, { maxClientes: 2, ahora: () => AHORA });
  await abrirSesionDePrueba(f.backend, ACCESO);
  await publico.cambiarControles(0, { ...POLITICA, api: 'habilitada' });
  sembrarSocioPersistido(f.db, { id: 'pub-prueba', huellas: ['c'.repeat(TAM_HASH)], consultasPorHora: 1 });
  assert.equal(await publico.consumir([{ clave: 'consultas:global', limite: 1, ventanaMs: HORA }]), true);
  await publico.revocar('a'.repeat(TAM_JTI), AHORA / SEGUNDO + VIDA_TOKEN_S);
  f.db.exec('DROP TABLE administracion_programacion');
  f.db.exec('ALTER TABLE publico_estado DROP COLUMN programacion_panel_version');
  f.db.exec('DROP TABLE administracion_activacion');
  f.db.exec('ALTER TABLE publico_estado DROP COLUMN activacion_panel_version');
  const tablas = [
    'administracion_sesion',
    'administracion_controles',
    'administracion_trabajo',
    'publico_socios',
    'publico_contadores',
    'publico_revocados',
  ];
  const ajenos = () => tablas.map((tabla) => f.db.prepare(`SELECT * FROM ${tabla}`).all());
  const antes = ajenos();
  await f.backend.prepararTrabajos();
  assert.deepEqual(ajenos(), antes);
  await assert.rejects(f.backend.reservarTrabajoProgramado(TICK, CONFIANZA));
  assert.equal(f.db.prepare('SELECT evento_en FROM administracion_programacion').get()?.evento_en, 0);
  assert.deepEqual(ajenos(), antes);
  await f.backend.prepararActivacion();
  assert.equal((await f.backend.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'nueva');
});
