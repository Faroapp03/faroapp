/** Autoridad real SQLite y protocolo del binding, sin red ni despliegue Cloudflare. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type ActivacionPrivada,
  type AlmacenActivacion,
  type AlmacenRecuperacionActivacion,
  type EstadoActivacionPrivado,
  type EvidenciaActivacion,
  type EvidenciaIntentoActivacionCompletado,
  leerEstadoActivacionPrivado,
  leerEvidenciaActivacion,
  leerPasoActivacion,
  leerRegistroPasoActivacion,
  type PasoActivacion,
  type SolicitudActivacion,
} from '../../src/administracion/activacion.ts';
import { activacionObservada } from '../../src/administracion/activacion-observada.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { FASES_ACTIVACION as FASES_PUBLICAS } from '../../src/administracion/estado-activacion.js';
import { FASES_ACTIVACION } from '../../src/administracion/fases-activacion.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import type { AlmacenPreparacionPanel } from '../../src/administracion/sesion.ts';
import type { AlmacenSesionUnica } from '../../src/administracion/sesion-unica.ts';
import type { AlmacenTrabajosActualizacion } from '../../src/administracion/trabajos.ts';
import { MAX_MENSAJE_ACTIVACION_DURABLE } from '../../src/plataforma/acceso-publico/activacion-durable.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const DESPLIEGUE = '44444444-4444-4444-8444-444444444444';
const VERSION_CURSOS = '55555555-5555-4555-8555-555555555555';
const DESPLIEGUE_CURSOS = '66666666-6666-4666-8666-666666666666';
const TAM_SHA = 40;
const TAM_HASH = 64;
const TAM_PAQUETE = 16;
const TAM_JTI = 22;
const SEGUNDO = 1000;
const VALIDEZ_S = 600;
const HTTP_INVALIDO = 400;
const ENTORNO = {};
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
const CONFIANZA = {
  audiencia: 'https://recibos.prueba',
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
const EVIDENCIA: EvidenciaActivacion = {
  sha256Indice: 'a'.repeat(TAM_HASH),
  sha256ManifiestoWeb: 'b'.repeat(TAM_HASH),
  generacion: { revisionCodigo: CONFIANZA.sha, sha256Manifiesto: 'c'.repeat(TAM_HASH) },
  artefacto: {
    revisionCodigo: CONFIANZA.sha,
    huellaPaquete: 'd'.repeat(TAM_PAQUETE),
    sha256Artefacto: 'e'.repeat(TAM_HASH),
  },
  anterior: {
    principal: { versionId: ID, deploymentId: OTRO_ID },
    cursos: { versionId: OTRO_ID, deploymentId: ID },
  },
};
/** La evidencia de una activación de un servicio, que publica solo el principal. */
const EVIDENCIA_UN_SERVICIO: EvidenciaActivacion = { ...EVIDENCIA, anterior: { versionId: ID, deploymentId: OTRO_ID } };
const PASOS_CURSOS: readonly PasoActivacion[] = [
  { tipo: 'subiendo-cursos' },
  { tipo: 'cursos-subida', versionIdCursos: VERSION_CURSOS },
  { tipo: 'promoviendo-cursos' },
  { tipo: 'cursos-confirmado', versionIdCursos: VERSION_CURSOS, deploymentIdCursos: DESPLIEGUE_CURSOS },
];
/** Primer efecto de cada forma y su evidencia: Cursos en la de dos servicios, el principal en la de uno. */
const FORMAS = {
  'dos servicios': {
    evidencia: EVIDENCIA,
    primero: { tipo: 'subiendo-cursos' },
    segundo: { tipo: 'cursos-subida', versionIdCursos: VERSION_CURSOS },
  },
  'un servicio': {
    evidencia: EVIDENCIA_UN_SERVICIO,
    primero: { tipo: 'subiendo' },
    segundo: { tipo: 'subida', versionId: VERSION },
  },
} as const satisfies Record<
  string,
  { evidencia: EvidenciaActivacion; primero: PasoActivacion; segundo: PasoActivacion }
>;
type Forma = keyof typeof FORMAS;
/** Deja la activación reservada con la forma de un servicio, como la guarda un servidor que solo publica el principal. */
function aUnServicio(db: DatabaseSync): void {
  const fila = db.prepare('SELECT documento FROM administracion_activacion WHERE id=1').get();
  assert.ok(typeof fila?.documento === 'string');
  const estado = JSON.parse(fila.documento);
  delete estado.ultimaActivacion.versionIdCursos;
  delete estado.ultimaActivacion.deploymentIdCursos;
  db.prepare('UPDATE administracion_activacion SET documento=? WHERE id=1').run(JSON.stringify(estado));
}
const SOLICITUD: SolicitudActivacion = { solicitudId: ID, revisionReserva: 1, runId: '123', revisionEsperada: 0 };
type Backend = AlmacenActivacion & AlmacenTrabajosActualizacion & AlmacenPreparacionPanel & AlmacenSesionUnica;
function identidad(runId = '123'): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  const ahora = Math.floor(Date.now() / SEGUNDO);
  return { ...pins, runId, runAttempt: '1', jti: 'identidad-sintetica', emitidoEn: ahora, caducaEn: ahora + VALIDEZ_S };
}
function transaccion<T>(db: DatabaseSync, accion: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const valor = accion();
    db.exec('COMMIT');
    return valor;
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
function sqlFixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  const sql = motor(db);
  const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
  const backend = new AlmacenSesionPanelSqlite(sql);
  t.after(() => db.close());
  return { db, sql, publico, backend };
}
async function preparar(backend: Backend) {
  await backend.prepararPanel(POLITICA);
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
  await abrirSesionDePrueba(backend, ACCESO);
}
async function construir(backend: Backend, solicitudId = ID, runId = '123') {
  const revisionEsperada = (await backend.leerTrabajoPrivado()).revision;
  const reserva = await backend.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId, revisionEsperada, accion: 'actualizar-datos' },
    CONFIANZA,
  );
  assert.ok('trabajos' in reserva && reserva.trabajos.ultimoTrabajo);
  assert.equal(reserva.estado, 'nueva');
  const referencia = { solicitudId, revisionReserva: reserva.trabajos.ultimoTrabajo.revisionReserva };
  await backend.confirmarInicio({ ...referencia, accion: 'actualizar-datos' }, identidad(runId));
  await backend.registrarRecibo(
    {
      ...referencia,
      accion: 'actualizar-datos',
      resultado: 'validado',
      veredicto: 'verde',
      terminadoEn: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      huellaPaquete: EVIDENCIA.artefacto.huellaPaquete,
      error: null,
    },
    'f'.repeat(TAM_HASH),
    identidad(runId),
  );
  return { ...referencia, runId, revisionEsperada: (await backend.leerActivacionPrivada()).revision };
}
async function paso(backend: AlmacenActivacion, p: PasoActivacion, solicitud = SOLICITUD) {
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  return backend.registrarPasoActivacion({ ...solicitud, revisionEsperada, paso: p }, identidad(solicitud.runId));
}

test('preparación es aditiva, explícita y no reconstruye una autoridad perdida', async (t) => {
  const f = sqlFixture(t);
  await assert.rejects(f.backend.prepararActivacion());
  await f.backend.prepararPanel(POLITICA);
  await assert.rejects(f.backend.prepararActivacion());
  await f.backend.prepararTrabajos();
  await f.backend.prepararActivacion();
  assert.deepEqual(await f.backend.leerActivacionPrivada(), { version: 1, revision: 0, ultimaActivacion: null });
  await f.backend.prepararActivacion();
  f.db.exec('DROP TABLE administracion_activacion');
  await assert.rejects(f.backend.prepararActivacion());
  assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='administracion_activacion'").get(), undefined);
});

for (const forma of Object.keys(FORMAS) as Forma[]) {
  test(`${forma}: dos conexiones Node reservan una vez y persisten incertidumbre sin volver a autorizar upload`, async (t) => {
    const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'activacion-node-'));
    const opciones = { archivo: join(temporal, 'autoridad.sqlite'), maxClientes: 2 };
    let a = crearAlmacenPublicoNode(opciones);
    const b = crearAlmacenPublicoNode(opciones);
    t.after(() => {
      a.close();
      b.close();
      rmSync(temporal, { recursive: true });
    });
    const backend = a.sesion as AlmacenSesionPanelSqlite;
    await preparar(backend);
    await construir(backend);
    const reservas = await Promise.all([
      a.activacion.reservarActivacion(SOLICITUD, identidad()),
      b.activacion.reservarActivacion(SOLICITUD, identidad()),
    ]);
    assert.deepEqual(reservas.map((r) => r.estado).sort(), ['aplicado', 'repetido']);
    if (forma === 'un servicio') {
      const db = new DatabaseSync(opciones.archivo);
      aUnServicio(db);
      db.close();
    }
    const { evidencia, primero } = FORMAS[forma];
    assert.equal((await paso(a.activacion, { tipo: 'preparar', evidencia })).estado, 'aplicado');
    const registro = { ...SOLICITUD, revisionEsperada: 2, paso: primero };
    const subidas = await Promise.all([
      a.activacion.registrarPasoActivacion(registro, identidad()),
      b.activacion.registrarPasoActivacion(registro, identidad()),
    ]);
    assert.deepEqual(subidas.map((r) => r.estado).sort(), ['aplicado', 'repetido']);
    const antes = await a.activacion.leerActivacionPrivada();
    a.close();
    a = crearAlmacenPublicoNode(opciones);
    assert.deepEqual(await a.activacion.leerActivacionPrivada(), antes);
    assert.equal((await a.activacion.registrarPasoActivacion(registro, identidad())).estado, 'repetido');
    assert.equal((await paso(a.activacion, { tipo: 'rechazar', error: 'despliegue_no_admitido' })).estado, 'conflicto');
    assert.deepEqual(await a.activacion.leerActivacionPrivada(), antes);
    assert.equal((await a.activacion.leerActivacionPrivada()).ultimaActivacion?.fase, primero.tipo);
  });
}

test('la instantánea permanece aunque se construya después; fases fijan versión y cotejan evidencia servida', async (t) => {
  const { backend, db } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  const instantanea = (await backend.leerActivacionPrivada()).ultimaActivacion?.trabajo;
  const nueva = await construir(backend, OTRO_ID, '124');
  assert.equal((await backend.reservarActivacion(nueva, identidad('124'))).estado, 'ocupado');
  assert.deepEqual((await backend.leerActivacionPrivada()).ultimaActivacion?.trabajo, instantanea);
  const pasos: PasoActivacion[] = [
    { tipo: 'preparar', evidencia: EVIDENCIA },
    ...PASOS_CURSOS,
    { tipo: 'subiendo' },
    { tipo: 'subida', versionId: VERSION },
    { tipo: 'promoviendo' },
  ];
  for (const p of pasos) {
    assert.equal((await paso(backend, p)).estado, 'aplicado');
  }
  const confirmar = {
    tipo: 'confirmada',
    versionId: VERSION,
    deploymentId: DESPLIEGUE,
    sha256ManifiestoWeb: EVIDENCIA.sha256ManifiestoWeb,
  } as const;
  assert.equal((await paso(backend, { ...confirmar, versionId: ID })).estado, 'conflicto');
  assert.equal((await paso(backend, { ...confirmar, sha256ManifiestoWeb: 'c'.repeat(TAM_HASH) })).estado, 'conflicto');
  const resultado = await paso(backend, confirmar);
  assert.equal(resultado.estado, 'aplicado');
  assert.equal(resultado.activacion.ultimaActivacion?.fase, 'confirmada');
  assert.equal(
    db.prepare('SELECT solicitud FROM administracion_candidato_pendiente').get()?.solicitud,
    nueva.solicitudId,
  );
  assert.equal(
    (await backend.reservarActivacion({ ...nueva, revisionEsperada: resultado.activacion.revision }, identidad('124')))
      .estado,
    'aplicado',
  );
});

test('solo último validado moderno, misma run y pins frescos pueden reservar o avanzar', async (t) => {
  const { backend, db } = sqlFixture(t);
  await preparar(backend);
  assert.equal((await backend.reservarActivacion(SOLICITUD, identidad())).estado, 'conflicto');
  await construir(backend);
  const ahora = Math.floor(Date.now() / SEGUNDO);
  const identidades = [
    { ...identidad(), runId: '999' },
    { ...identidad(), runAttempt: '2' },
    { ...identidad(), sha: 'c'.repeat(TAM_SHA) },
    { ...identidad(), workflowSha: 'c'.repeat(TAM_SHA) },
    { ...identidad(), caducaEn: ahora - 1 },
    { ...identidad(), emitidoEn: ahora - VALIDEZ_S - 1 },
  ];
  for (const i of identidades) {
    assert.equal((await backend.reservarActivacion(SOLICITUD, i)).estado, 'conflicto');
  }
  await backend.reservarActivacion(SOLICITUD, identidad());
  const antes = await backend.leerActivacionPrivada();
  for (const i of identidades) {
    assert.equal(
      (
        await backend.registrarPasoActivacion(
          { ...SOLICITUD, revisionEsperada: antes.revision, paso: { tipo: 'preparar', evidencia: EVIDENCIA } },
          i,
        )
      ).estado,
      'conflicto',
    );
  }
  assert.deepEqual(await backend.leerActivacionPrivada(), antes);
  assert.equal((await paso(backend, { tipo: 'rechazar', error: 'candidato_no_verificable' })).estado, 'aplicado');
  const nueva = await construir(backend, OTRO_ID, '124');
  assert.equal(
    (await backend.reservarActivacion({ ...SOLICITUD, revisionEsperada: nueva.revisionEsperada }, identidad())).estado,
    'conflicto',
  );
  const fila = db.prepare('SELECT documento FROM administracion_trabajo').get();
  assert.ok(typeof fila?.documento === 'string');
  const legado = JSON.parse(fila.documento);
  legado.version = 1;
  delete legado.ultimoTrabajo.protocoloInicio;
  delete legado.ultimoTrabajo.inicioConfirmado;
  delete legado.ultimoTrabajo.origen;
  db.prepare('UPDATE administracion_trabajo SET documento=?').run(JSON.stringify(legado));
  assert.equal((await backend.reservarActivacion(nueva, identidad('124'))).estado, 'conflicto');
});

test('rechazo demostrable antes de efectos cierra; código/paquete ajenos no se fijan', async (t) => {
  const { backend } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  const evidenciaAjena = {
    ...EVIDENCIA,
    artefacto: { ...EVIDENCIA.artefacto, huellaPaquete: 'a'.repeat(TAM_PAQUETE) },
  };
  assert.equal((await paso(backend, { tipo: 'preparar', evidencia: evidenciaAjena })).estado, 'conflicto');
  assert.equal((await paso(backend, { tipo: 'subiendo' })).estado, 'conflicto');
  assert.equal((await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA })).estado, 'aplicado');
  const rechazo = {
    ...SOLICITUD,
    revisionEsperada: 2,
    paso: { tipo: 'rechazar', error: 'despliegue_no_admitido' },
  } as const;
  assert.equal((await backend.registrarPasoActivacion(rechazo, identidad())).estado, 'aplicado');
  assert.equal((await backend.registrarPasoActivacion(rechazo, identidad())).estado, 'repetido');
  const nueva = await construir(backend, OTRO_ID, '124');
  assert.equal((await backend.reservarActivacion(nueva, identidad('124'))).estado, 'aplicado');
});

test('activación conserva bytes de sesión, controles, cuotas, socios y revocaciones; un fallo SQL revierte CAS', async (t) => {
  const { backend, db, sql, publico } = sqlFixture(t);
  await preparar(backend);
  await publico.cambiarControles(0, { ...POLITICA, api: 'habilitada' });
  sembrarSocioPersistido(db, { id: 'pub-prueba', huellas: ['a'.repeat(TAM_HASH)], consultasPorHora: 1 });
  await publico.consumir([{ clave: 'consultas:global', limite: 1, ventanaMs: 60_000 }]);
  await publico.revocar('a'.repeat(TAM_JTI), Math.floor(Date.now() / SEGUNDO) + VALIDEZ_S);
  await construir(backend);
  const tablas = [
    'administracion_sesion',
    'administracion_controles',
    'publico_socios',
    'publico_contadores',
    'publico_revocados',
  ];
  const ajenos = () => tablas.map((tabla) => db.prepare(`SELECT * FROM ${tabla}`).all());
  const antes = ajenos();
  const roto = new AlmacenSesionPanelSqlite({
    ...sql,
    ejecutar: (sentencia, ...valores) => {
      sql.ejecutar(sentencia, ...valores);
      if (sentencia.startsWith('UPDATE administracion_activacion SET')) {
        throw new Error('fallo sintético después de persistir');
      }
    },
  });
  await assert.rejects(roto.reservarActivacion(SOLICITUD, identidad()), /fallo sintético/);
  assert.equal((await backend.leerActivacionPrivada()).revision, 0);
  await backend.reservarActivacion(SOLICITUD, identidad());
  await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA });
  await paso(backend, { tipo: 'subiendo-cursos' });
  assert.deepEqual(ajenos(), antes);
});

for (const corrupcion of [
  'DELETE FROM administracion_activacion',
  'UPDATE publico_estado SET activacion_panel_version=0',
  'ALTER TABLE publico_estado DROP COLUMN activacion_panel_version',
  'UPDATE administracion_activacion SET reloj=9007199254740991',
  "UPDATE administracion_activacion SET documento='{}'",
]) {
  test(`pérdida/corrupción no regenera activación: ${corrupcion}`, async (t) => {
    const { backend, db } = sqlFixture(t);
    await preparar(backend);
    db.exec(corrupcion);
    const antes = db.prepare('SELECT * FROM administracion_activacion').all();
    await assert.rejects(backend.prepararActivacion());
    await assert.rejects(backend.leerActivacionPrivada());
    await assert.rejects(backend.reservarActivacion(SOLICITUD, identidad()));
    assert.deepEqual(db.prepare('SELECT * FROM administracion_activacion').all(), antes);
  });
}

function durableFixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  let consultas = 0;
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: {
        exec: (sql, ...valores) => ({
          toArray: () => {
            consultas++;
            return db.prepare(sql).all(...valores);
          },
        }),
      },
      transactionSync: (accion) => transaccion(db, accion),
    },
  };
  let servidor = new AccesoPublicoDurable(estado, ENTORNO);
  const espacio = {
    idFromName: (nombre: string) => {
      assert.equal(nombre, 'registro-publico-v1');
      return nombre;
    },
    get: () => ({ fetch: (peticion: Request) => servidor.fetch(peticion) }),
  };
  t.after(() => db.close());
  return {
    db,
    backend: new SesionUnicaDurable(espacio),
    fetch: (p: Request) => servidor.fetch(p),
    consultas: () => consultas,
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, ENTORNO);
    },
  };
}
for (const forma of Object.keys(FORMAS) as Forma[]) {
  test(`${forma}: binding conserva la instantánea y una respuesta perdida de subiendo no recupera el permiso`, async (t) => {
    const f = durableFixture(t);
    await preparar(f.backend);
    await construir(f.backend);
    await f.backend.reservarActivacion(SOLICITUD, identidad());
    if (forma === 'un servicio') {
      aUnServicio(f.db);
    }
    const { evidencia, primero } = FORMAS[forma];
    await paso(f.backend, { tipo: 'preparar', evidencia });
    let perder = true;
    const cliente = new SesionUnicaDurable({
      idFromName: (n) => n,
      get: () => ({
        fetch: async (p) => {
          const respuesta = await f.fetch(p);
          if (perder) {
            perder = false;
            throw new Error('respuesta perdida');
          }
          return respuesta;
        },
      }),
    });
    const registro = { ...SOLICITUD, revisionEsperada: 2, paso: primero };
    await assert.rejects(cliente.registrarPasoActivacion(registro, identidad()), AlmacenPublicoNoDisponible);
    f.reiniciar();
    assert.equal((await cliente.registrarPasoActivacion(registro, identidad())).estado, 'repetido');
    assert.equal((await cliente.leerActivacionPrivada()).ultimaActivacion?.fase, primero.tipo);
  });
}

test('binding rechaza rutas/JSON excesivo y respuestas de otra referencia o fase', async (t) => {
  const f = durableFixture(t);
  await preparar(f.backend);
  await construir(f.backend);
  const resultado = await f.backend.reservarActivacion(SOLICITUD, identidad());
  for (const ruta of ['/activacion/leer#x', '/activacion/leer?x=1', '/activacion/%6ceer', '/activacion/leer/']) {
    const antes = f.consultas();
    const respuesta = await f.fetch(
      new Request(`https://registro-socios.invalid${ruta}`, { method: 'POST', body: '{}' }),
    );
    assert.equal(respuesta.status, HTTP_INVALIDO);
    assert.equal(f.consultas(), antes);
  }
  const antes = f.consultas();
  assert.equal(
    (
      await f.fetch(
        new Request('https://registro-socios.invalid/activacion/leer', {
          method: 'POST',
          body: `${' '.repeat(MAX_MENSAJE_ACTIVACION_DURABLE)}{}`,
        }),
      )
    ).status,
    HTTP_INVALIDO,
  );
  assert.equal(f.consultas(), antes);
  const a = resultado.activacion.ultimaActivacion;
  assert.ok(a);
  const cliente = new SesionUnicaDurable({
    idFromName: (n) => n,
    get: () => ({
      fetch: async () =>
        Response.json({
          ...resultado,
          activacion: { ...resultado.activacion, ultimaActivacion: { ...a, trabajo: { ...a.trabajo, runId: '999' } } },
        }),
    }),
  });
  await assert.rejects(cliente.reservarActivacion(SOLICITUD, identidad()), AlmacenPublicoNoDisponible);
  const clienteFase = new SesionUnicaDurable({
    idFromName: (n) => n,
    get: () => ({ fetch: async () => Response.json(resultado) }),
  });
  await assert.rejects(
    clienteFase.registrarPasoActivacion({ ...SOLICITUD, revisionEsperada: 1, paso: { tipo: 'subiendo' } }, identidad()),
    AlmacenPublicoNoDisponible,
  );
});

test('lectores no invocan accesores y rechazan estados incompletos o campos libres', () => {
  let llamadas = 0;
  const registro = Object.defineProperty({ ...SOLICITUD }, 'paso', { enumerable: true, get: () => ++llamadas });
  assert.throws(() => leerRegistroPasoActivacion(registro));
  assert.equal(llamadas, 0);
  assert.throws(() => leerRegistroPasoActivacion({ ...SOLICITUD, paso: { tipo: 'subiendo', comando: 'libre' } }));
  assert.throws(() => leerEstadoActivacionPrivado({ version: 1, revision: 1, ultimaActivacion: null }));
});

function evidenciaIntento(runAttempt = '1'): EvidenciaIntentoActivacionCompletado {
  return {
    estado: 'completed',
    evento: 'workflow_dispatch',
    runId: '123',
    runAttempt,
    repositorioId: CONFIANZA.repositorioId,
    propietarioId: CONFIANZA.propietarioId,
    sha: CONFIANZA.sha,
    workflowPath: '.github/workflows/actualizar.yml',
    conclusion: 'failure',
  };
}
async function comprobarCercadoRecuperacion(
  backend: AlmacenRecuperacionActivacion,
  concedida: EstadoActivacionPrivado,
  forma: Forma,
) {
  const i2 = { ...identidad(), runAttempt: '2' };
  const { primero, segundo } = FORMAS[forma];
  assert.equal((await backend.reservarActivacion(SOLICITUD, identidad())).estado, 'conflicto');
  const registro = { ...SOLICITUD, revisionEsperada: concedida.revision, paso: primero };
  assert.equal((await backend.registrarPasoActivacion(registro, identidad())).estado, 'conflicto');
  assert.equal((await backend.registrarPasoRecuperacionActivacion(registro, identidad())).estado, 'conflicto');
  assert.equal((await backend.registrarPasoRecuperacionActivacion(registro, i2)).estado, 'aplicado');
  assert.equal((await backend.registrarPasoRecuperacionActivacion(registro, i2)).estado, 'repetido');
  const incierta = await backend.leerActivacionPrivada();
  const i3 = { ...i2, runAttempt: '3' };
  const relevo3 = await backend.recuperarActivacion(
    { ...SOLICITUD, revisionEsperada: incierta.revision },
    i3,
    evidenciaIntento('2'),
  );
  assert.equal(relevo3.estado, 'aplicado');
  assert.equal(relevo3.activacion.ultimaActivacion?.fase, primero.tipo);
  assert.deepEqual(relevo3.activacion.ultimaActivacion?.trabajo, concedida.ultimaActivacion?.trabajo);
  assert.equal((await backend.registrarPasoRecuperacionActivacion(registro, i2)).estado, 'conflicto');
  const siguiente = {
    ...SOLICITUD,
    revisionEsperada: relevo3.activacion.revision,
    paso: segundo,
  };
  assert.equal((await backend.registrarPasoRecuperacionActivacion(siguiente, i2)).estado, 'conflicto');
  assert.equal((await backend.registrarPasoRecuperacionActivacion(siguiente, i3)).estado, 'aplicado');
}
/** Reserva y prepara con la forma indicada; la de un servicio se deja como la guarda un servidor que publica solo el principal. */
async function reservarYPreparar(f: { db: DatabaseSync; backend: Backend }, forma: Forma) {
  await f.backend.reservarActivacion(SOLICITUD, identidad());
  if (forma === 'un servicio') {
    aUnServicio(f.db);
  }
  await paso(f.backend, { tipo: 'preparar', evidencia: FORMAS[forma].evidencia });
}
async function comprobarNegativosRecuperacion(backend: AlmacenRecuperacionActivacion, antes: EstadoActivacionPrivado) {
  const i2 = { ...identidad(), runAttempt: '2' };
  const solicitud = { ...SOLICITUD, revisionEsperada: antes.revision };
  for (const [i, e] of [
    [{ ...i2, runId: '999' }, evidenciaIntento()],
    [{ ...i2, sha: 'f'.repeat(TAM_SHA) }, evidenciaIntento()],
    [i2, { ...evidenciaIntento(), runAttempt: '2' }],
    [i2, { ...evidenciaIntento(), runId: '999' }],
    [i2, { ...evidenciaIntento(), sha: 'f'.repeat(TAM_SHA) }],
  ] as const) {
    assert.equal((await backend.recuperarActivacion(solicitud, i, e)).estado, 'conflicto');
    assert.deepEqual(await backend.leerActivacionPrivada(), antes);
  }
}
for (const [adaptador, forma] of [
  ['sqlite', 'dos servicios'],
  ['durable', 'dos servicios'],
  ['sqlite', 'un servicio'],
  ['durable', 'un servicio'],
] as const) {
  test(`recuperación ${adaptador}, ${forma}: CAS del intento exacto conserva la instantánea y cerca originales y supervisores antiguos`, async (t) => {
    const f = adaptador === 'sqlite' ? sqlFixture(t) : durableFixture(t);
    const backend: AlmacenRecuperacionActivacion & Backend = f.backend;
    await preparar(backend);
    await construir(backend);
    const i2 = { ...identidad(), runAttempt: '2' };
    assert.equal((await backend.recuperarActivacion(SOLICITUD, i2, evidenciaIntento())).estado, 'conflicto');
    await reservarYPreparar(f, forma);
    const antes = await backend.leerActivacionPrivada();
    assert.ok(!Object.hasOwn(antes.ultimaActivacion as object, 'recuperacion'));
    const solicitud = { ...SOLICITUD, revisionEsperada: antes.revision };
    await comprobarNegativosRecuperacion(backend, antes);
    const [a, b] = await Promise.all([
      backend.recuperarActivacion(solicitud, i2, evidenciaIntento()),
      backend.recuperarActivacion(solicitud, i2, evidenciaIntento()),
    ]);
    assert.deepEqual([a.estado, b.estado].sort(), ['aplicado', 'repetido']);
    const concedida = a.activacion;
    assert.equal(concedida.revision, antes.revision + 1);
    const { recuperacion, ...instantanea } = concedida.ultimaActivacion as NonNullable<
      typeof concedida.ultimaActivacion
    >;
    assert.deepEqual(instantanea, { ...antes.ultimaActivacion, actualizadoEn: instantanea.actualizadoEn });
    assert.ok(instantanea.actualizadoEn >= (antes.ultimaActivacion?.actualizadoEn ?? 0));
    assert.deepEqual(recuperacion, {
      version: 1,
      intento: '2',
      revisionBase: antes.revision,
      anterior: evidenciaIntento(),
    });
    assert.equal(
      (
        await backend.recuperarActivacion(
          { ...solicitud, revisionEsperada: concedida.revision },
          i2,
          evidenciaIntento(),
        )
      ).estado,
      'conflicto',
    );
    await comprobarCercadoRecuperacion(backend, concedida, forma);
  });
}

test('metadata de recuperación versionada rechaza corrupción sin migrar documentos anteriores', async (t) => {
  const { backend } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  const legado = await backend.leerActivacionPrivada();
  assert.deepEqual(leerEstadoActivacionPrivado(legado), legado);
  assert.ok(!Object.hasOwn(legado.ultimaActivacion as object, 'recuperacion'));
  const actual = await backend.recuperarActivacion(
    { ...SOLICITUD, revisionEsperada: 1 },
    { ...identidad(), runAttempt: '2' },
    evidenciaIntento(),
  );
  const a = actual.activacion.ultimaActivacion;
  assert.ok(a?.recuperacion);
  for (const recuperacion of [
    { ...a.recuperacion, version: 2 },
    { ...a.recuperacion, intento: '1' },
    { ...a.recuperacion, intento: '02' },
    { ...a.recuperacion, revisionBase: 0 },
    { ...a.recuperacion, revisionBase: 2 },
    { ...a.recuperacion, libre: true },
    { ...a.recuperacion, anterior: { ...a.recuperacion.anterior, runAttempt: '2' } },
    { ...a.recuperacion, anterior: { ...a.recuperacion.anterior, workflowPath: '.github/workflows/otro.yml' } },
  ]) {
    assert.throws(() =>
      leerEstadoActivacionPrivado({ ...actual.activacion, ultimaActivacion: { ...a, recuperacion } }),
    );
  }
});

test('binding de recuperación rechaza prueba libre, supervisor ajeno y respuestas falsas sin tocar SQL', async (t) => {
  const f = durableFixture(t);
  await preparar(f.backend);
  await construir(f.backend);
  await f.backend.reservarActivacion(SOLICITUD, identidad());
  const solicitud = { ...SOLICITUD, revisionEsperada: 1 };
  const i2 = { ...identidad(), runAttempt: '2' };
  const prueba = evidenciaIntento();
  for (const cuerpo of [
    { solicitud, identidad: i2, anterior: { ...prueba, comando: 'libre' } },
    { solicitud, identidad: i2, anterior: { ...prueba, runAttempt: '02' } },
    { solicitud, identidad: i2, anterior: prueba, extra: true },
  ]) {
    const antes = f.consultas();
    const respuesta = await f.fetch(
      new Request('https://registro-socios.invalid/activacion/recuperar', {
        method: 'POST',
        body: JSON.stringify(cuerpo),
      }),
    );
    assert.equal(respuesta.status, HTTP_INVALIDO);
    assert.equal(f.consultas(), antes);
  }
  const concedida = await f.backend.recuperarActivacion(solicitud, i2, prueba);
  const a = concedida.activacion.ultimaActivacion;
  assert.ok(a?.recuperacion);
  for (const cambio of [
    { recuperacion: { ...a.recuperacion, intento: '3', anterior: { ...prueba, runAttempt: '2' } } },
    {
      trabajo: { ...a.trabajo, runId: '999' },
      recuperacion: { ...a.recuperacion, anterior: { ...prueba, runId: '999' } },
    },
  ]) {
    const cliente = new SesionUnicaDurable({
      idFromName: (n) => n,
      get: () => ({
        fetch: async () =>
          Response.json({
            ...concedida,
            activacion: { ...concedida.activacion, ultimaActivacion: { ...a, ...cambio } },
          }),
      }),
    });
    await assert.rejects(cliente.recuperarActivacion(solicitud, i2, prueba), AlmacenPublicoNoDisponible);
  }
});

test('dos servicios: Cursos se publica y se confirma antes del principal, sin saltos ni identificadores ajenos', async (t) => {
  const { backend } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  const reservada = (await backend.leerActivacionPrivada()).ultimaActivacion;
  assert.equal(reservada?.versionIdCursos, null);
  assert.equal(reservada?.deploymentIdCursos, null);
  // Una reserva de dos servicios no admite la evidencia de un solo servicio.
  assert.equal((await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA_UN_SERVICIO })).estado, 'conflicto');
  assert.equal((await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA })).estado, 'aplicado');
  // El principal no empieza hasta que Cursos está confirmado.
  assert.equal((await paso(backend, { tipo: 'subiendo' })).estado, 'conflicto');
  const [subiendo, subida, promoviendo, confirmado] = PASOS_CURSOS as [
    PasoActivacion,
    PasoActivacion,
    PasoActivacion,
    PasoActivacion,
  ];
  for (const p of [subiendo, subida, promoviendo]) {
    assert.equal((await paso(backend, p)).estado, 'aplicado');
  }
  const ajeno = { tipo: 'cursos-confirmado', versionIdCursos: VERSION, deploymentIdCursos: DESPLIEGUE_CURSOS } as const;
  assert.equal((await paso(backend, ajeno)).estado, 'conflicto');
  const resultado = await paso(backend, confirmado);
  assert.equal(resultado.estado, 'aplicado');
  const actual = resultado.activacion.ultimaActivacion;
  assert.equal(actual?.fase, 'cursos-confirmado');
  assert.deepEqual([actual?.versionIdCursos, actual?.deploymentIdCursos], [VERSION_CURSOS, DESPLIEGUE_CURSOS]);
  assert.deepEqual([actual?.versionId, actual?.deploymentId], [null, null]);
  const repetido = await backend.registrarPasoActivacion(
    { ...SOLICITUD, revisionEsperada: resultado.activacion.revision - 1, paso: confirmado },
    identidad(),
  );
  assert.equal(repetido.estado, 'repetido');
  assert.equal((await paso(backend, { tipo: 'rechazar', error: 'candidato_no_verificable' })).estado, 'conflicto');
  assert.equal((await paso(backend, { tipo: 'subiendo' })).estado, 'aplicado');
});

test('una activación guardada con la forma de un servicio se sigue leyendo y se termina sin pasar por Cursos', async (t) => {
  const f = sqlFixture(t);
  await preparar(f.backend);
  await construir(f.backend);
  await f.backend.reservarActivacion(SOLICITUD, identidad());
  const estado = await f.backend.leerActivacionPrivada();
  const { versionIdCursos, deploymentIdCursos, ...unServicio } = estado.ultimaActivacion as ActivacionPrivada;
  assert.deepEqual([versionIdCursos, deploymentIdCursos], [null, null]);
  f.db
    .prepare('UPDATE administracion_activacion SET documento=? WHERE id=1')
    .run(JSON.stringify({ ...estado, ultimaActivacion: unServicio }));
  assert.equal(
    Object.hasOwn((await f.backend.leerActivacionPrivada()).ultimaActivacion as object, 'versionIdCursos'),
    false,
  );
  assert.equal((await paso(f.backend, { tipo: 'preparar', evidencia: EVIDENCIA })).estado, 'conflicto');
  assert.equal((await paso(f.backend, { tipo: 'preparar', evidencia: EVIDENCIA_UN_SERVICIO })).estado, 'aplicado');
  assert.equal((await paso(f.backend, { tipo: 'subiendo-cursos' })).estado, 'conflicto');
  for (const p of [
    { tipo: 'subiendo' },
    { tipo: 'subida', versionId: VERSION },
    { tipo: 'promoviendo' },
    {
      tipo: 'confirmada',
      versionId: VERSION,
      deploymentId: DESPLIEGUE,
      sha256ManifiestoWeb: EVIDENCIA.sha256ManifiestoWeb,
    },
  ] as const) {
    assert.equal((await paso(f.backend, p)).estado, 'aplicado');
  }
  const final = (await f.backend.leerActivacionPrivada()).ultimaActivacion;
  assert.equal(final?.fase, 'confirmada');
  assert.equal(f.db.prepare('SELECT id FROM administracion_candidato_pendiente').get(), undefined);
  assert.equal(Object.hasOwn(final as object, 'versionIdCursos'), false);
});

test('lectores: los campos y fases de Cursos solo valen en la forma de dos servicios', () => {
  const base = leerPasoActivacion({ tipo: 'cursos-subida', versionIdCursos: VERSION_CURSOS });
  assert.deepEqual(base, { tipo: 'cursos-subida', versionIdCursos: VERSION_CURSOS });
  assert.throws(() => leerPasoActivacion({ tipo: 'cursos-subida', versionId: VERSION_CURSOS }));
  assert.throws(() => leerPasoActivacion({ tipo: 'cursos-confirmado', versionIdCursos: VERSION_CURSOS }));
  assert.throws(() => leerPasoActivacion({ tipo: 'subiendo-cursos', versionIdCursos: VERSION_CURSOS }));
  assert.throws(() =>
    leerEvidenciaActivacion({ ...EVIDENCIA, anterior: { principal: EVIDENCIA_UN_SERVICIO.anterior } }),
  );
});

test('las tres listas de fases coinciden: servidor, estado del panel y orquestador', () => {
  const python = spawnSync(
    fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)),
    ['-c', 'import json\nfrom plataforma_datos.orquestacion.lectura_activacion import FASES\nprint(json.dumps(FASES))'],
    { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(python.status, 0, python.stderr);
  assert.deepEqual([...FASES_PUBLICAS], [...FASES_ACTIVACION]);
  assert.deepEqual(JSON.parse(python.stdout), [...FASES_ACTIVACION]);
});

const HASTA_CURSOS_SUBIDA = 3;
/** Pasos hasta cada fase no terminal de una forma, en orden. */
const PASOS_DE_LA_FORMA: Record<Forma, readonly PasoActivacion[]> = {
  'dos servicios': [
    { tipo: 'preparar', evidencia: EVIDENCIA },
    ...PASOS_CURSOS,
    { tipo: 'subiendo' },
    { tipo: 'subida', versionId: VERSION },
    { tipo: 'promoviendo' },
  ],
  'un servicio': [
    { tipo: 'preparar', evidencia: EVIDENCIA_UN_SERVICIO },
    { tipo: 'subiendo' },
    { tipo: 'subida', versionId: VERSION },
    { tipo: 'promoviendo' },
  ],
};
function abandono(forma: Forma, observado = FORMAS[forma].evidencia.anterior) {
  return { tipo: 'abandonar', motivo: 'a-mano', observado } as const;
}
for (const adaptador of ['sqlite', 'durable'] as const) {
  for (const forma of Object.keys(FORMAS) as Forma[]) {
    test(`abandonar ${adaptador}, ${forma}: cierra desde cada fase no terminal con lo anterior servido y libera la reserva`, async (t) => {
      const pasos = PASOS_DE_LA_FORMA[forma];
      for (let hasta = 0; hasta <= pasos.length; hasta++) {
        const f = adaptador === 'sqlite' ? sqlFixture(t) : durableFixture(t);
        await preparar(f.backend);
        await construir(f.backend);
        await f.backend.reservarActivacion(SOLICITUD, identidad());
        if (forma === 'un servicio') {
          aUnServicio(f.db);
        }
        for (const p of pasos.slice(0, hasta)) {
          assert.equal((await paso(f.backend, p)).estado, 'aplicado');
        }
        const fase = (await f.backend.leerActivacionPrivada()).ultimaActivacion?.fase;
        const resultado = await paso(f.backend, abandono(forma));
        assert.equal(resultado.estado, 'aplicado', `${fase}`);
        const actual = resultado.activacion.ultimaActivacion;
        assert.equal(actual?.fase, 'abandonada');
        assert.deepEqual(actual?.abandono, {
          motivo: 'a-mano',
          observado: FORMAS[forma].evidencia.anterior,
        });
        // Acuse perdido: el mismo paso con la revisión anterior es una repetición, no otro cambio.
        const repetido = await f.backend.registrarPasoActivacion(
          { ...SOLICITUD, revisionEsperada: resultado.activacion.revision - 1, paso: abandono(forma) },
          identidad(),
        );
        assert.equal(repetido.estado, 'repetido');
        // Desde una fase terminal no se abandona, y la reserva queda libre para el trabajo siguiente.
        assert.equal((await paso(f.backend, abandono(forma))).estado, 'conflicto');
        const siguiente = await construir(f.backend, OTRO_ID, '124');
        assert.equal((await f.backend.reservarActivacion(siguiente, identidad('124'))).estado, 'aplicado', `${fase}`);
      }
    });
  }
}
test('abandonar se rechaza sin cambios si algún Worker sirve otra cosa, con otra forma o desde confirmada o rechazada', async (t) => {
  const { backend } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  // Hasta `cursos-subida`: una versión de Cursos subida y sin desplegar.
  for (const p of PASOS_DE_LA_FORMA['dos servicios'].slice(0, HASTA_CURSOS_SUBIDA)) {
    await paso(backend, p);
  }
  const antes = await backend.leerActivacionPrivada();
  const { principal, cursos } = EVIDENCIA.anterior as {
    principal: { versionId: string; deploymentId: string };
    cursos: { versionId: string; deploymentId: string };
  };
  for (const observado of [
    { principal, cursos: { ...cursos, versionId: VERSION_CURSOS } },
    { principal: { ...principal, versionId: VERSION }, cursos },
    principal,
  ]) {
    assert.equal((await paso(backend, abandono('dos servicios', observado))).estado, 'conflicto');
    assert.deepEqual(await backend.leerActivacionPrivada(), antes);
  }
  // Otro despliegue de la misma versión anterior sí vale: es lo que deja una vuelta atrás a mano.
  const vueltaAtras = { principal, cursos: { ...cursos, deploymentId: VERSION } };
  assert.equal((await paso(backend, abandono('dos servicios', vueltaAtras))).estado, 'aplicado');
  const terminal = sqlFixture(t);
  await preparar(terminal.backend);
  await construir(terminal.backend);
  await terminal.backend.reservarActivacion(SOLICITUD, identidad());
  await paso(terminal.backend, { tipo: 'rechazar', error: 'candidato_no_verificable' });
  assert.equal((await paso(terminal.backend, abandono('dos servicios'))).estado, 'conflicto');
  assert.throws(() => leerPasoActivacion({ ...abandono('dos servicios'), motivo: 'libre' }));
});

test('el panel ve la abandonada con su motivo y sin la versión subida que nunca se sirvió', async (t) => {
  const { backend } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  for (const p of PASOS_DE_LA_FORMA['dos servicios'].slice(0, 2)) {
    await paso(backend, p);
  }
  await paso(backend, { ...abandono('dos servicios'), motivo: 'rechazo-previo' });
  const privado = await backend.leerActivacionPrivada();
  assert.equal(privado.ultimaActivacion?.versionIdCursos, null);
  const visto = activacionObservada(privado).ultimaActivacion;
  assert.equal(visto?.fase, 'abandonada');
  assert.equal(visto?.motivoAbandono, 'rechazo-previo');
  assert.deepEqual([visto?.versionId, visto?.deploymentId], [null, null]);
});
test('anotar un rechazo detiene sin cambiar de fase, solo con un efecto en curso, y se borra al avanzar', async (t) => {
  const { backend } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  const anotar = { tipo: 'anotar-rechazo', motivo: 'rechazo-proveedor', observado: EVIDENCIA.anterior } as const;
  // En `preparada` no hay efecto en curso: no se admite.
  await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA });
  assert.equal((await paso(backend, anotar)).estado, 'conflicto');
  await paso(backend, { tipo: 'subiendo-cursos' });
  // Lo observado tiene la forma de la activación.
  assert.equal((await paso(backend, { ...anotar, observado: EVIDENCIA_UN_SERVICIO.anterior })).estado, 'conflicto');
  const anotada = await paso(backend, anotar);
  assert.equal(anotada.estado, 'aplicado');
  assert.equal(anotada.activacion.ultimaActivacion?.fase, 'subiendo-cursos');
  assert.deepEqual(anotada.activacion.ultimaActivacion?.detenida, {
    motivo: 'rechazo-proveedor',
    observado: EVIDENCIA.anterior,
  });
  const repetida = await backend.registrarPasoActivacion(
    { ...SOLICITUD, revisionEsperada: anotada.activacion.revision - 1, paso: anotar },
    identidad(),
  );
  assert.equal(repetida.estado, 'repetido');
  const visto = activacionObservada(await backend.leerActivacionPrivada()).ultimaActivacion;
  assert.equal(visto?.motivoDetenida, 'rechazo-proveedor');
  // Sin la versión de Cursos de la intención en servicio, lo servido ha cambiado fuera de esta publicación.
  assert.equal(visto?.servidoDetenida, 'cambiado');
  const avanza = await paso(backend, { tipo: 'cursos-subida', versionIdCursos: VERSION_CURSOS });
  assert.equal(avanza.estado, 'aplicado');
  assert.equal(Object.hasOwn(avanza.activacion.ultimaActivacion as object, 'detenida'), false);
  assert.equal(activacionObservada(avanza.activacion).ultimaActivacion?.motivoDetenida, null);
  assert.throws(() => leerPasoActivacion({ ...anotar, motivo: 'a-mano' }));
  // Una detenida en una fase sin efecto en curso no se lee.
  const estado = await backend.leerActivacionPrivada();
  assert.throws(() =>
    leerEstadoActivacionPrivado({
      ...estado,
      ultimaActivacion: {
        ...estado.ultimaActivacion,
        detenida: { motivo: 'rechazo-previo', observado: EVIDENCIA.anterior },
      },
    }),
  );
});

test('detenida sin observación: si no se pudo comprobar qué se sirve, el panel lo ve como desconocido', async (t) => {
  const { backend } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA });
  await paso(backend, { tipo: 'subiendo-cursos' });
  const anotada = await paso(backend, { tipo: 'anotar-rechazo', motivo: 'rechazo-previo', observado: null });
  assert.equal(anotada.estado, 'aplicado');
  assert.deepEqual(anotada.activacion.ultimaActivacion?.detenida, { motivo: 'rechazo-previo', observado: null });
  const visto = activacionObservada(await backend.leerActivacionPrivada()).ultimaActivacion;
  assert.deepEqual([visto?.motivoDetenida, visto?.servidoDetenida], ['rechazo-previo', 'desconocido']);
});
test('detenida tras cursos-confirmado: Cursos nuevo y el principal anterior se ven como formación no disponible', async (t) => {
  const { backend } = sqlFixture(t);
  await preparar(backend);
  await construir(backend);
  await backend.reservarActivacion(SOLICITUD, identidad());
  for (const p of [
    { tipo: 'preparar', evidencia: EVIDENCIA } as const,
    ...PASOS_CURSOS,
    { tipo: 'subiendo' } as const,
  ]) {
    await paso(backend, p);
  }
  const { principal } = EVIDENCIA.anterior as { principal: { versionId: string; deploymentId: string } };
  const observado = { principal, cursos: { versionId: VERSION_CURSOS, deploymentId: DESPLIEGUE_CURSOS } };
  await paso(backend, { tipo: 'anotar-rechazo', motivo: 'rechazo-proveedor', observado });
  const visto = activacionObservada(await backend.leerActivacionPrivada()).ultimaActivacion;
  assert.deepEqual([visto?.motivoDetenida, visto?.servidoDetenida], ['rechazo-proveedor', 'cursos-nuevo']);
});
