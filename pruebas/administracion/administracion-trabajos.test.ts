import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import {
  type ConfianzaOidcGitHub,
  type IdentidadEjecucionGitHub,
  leerConfianzaOidcGitHub,
} from '../../src/administracion/oidc-github.ts';
import { INACTIVIDAD_SESION_PANEL_MS } from '../../src/administracion/sesion.ts';
import {
  leerEstadoTrabajosPrivado,
  leerReciboTrabajo,
  leerSolicitudTrabajo,
  type ReciboTrabajo,
  type ResultadoReservaTrabajo,
} from '../../src/administracion/trabajos.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import type { SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido } from '../ayudas/registro-persistido-anterior.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const TAM_SHA = 40;
const TAM_VERSION = 16;
const VALIDEZ_IDENTIDAD_S = 60;
const TAM_JTI_API = 22;
const IAT_FUTURO_RECHAZADO_S = 31;
const IAT_VIEJO_RECHAZADO_S = 601;
const MINUTO_MS = 60_000;
const AHORA = Date.parse('2026-10-16T12:00:00Z');
const SEGUNDO = 1000;
const HUELLA = 'f'.repeat(TAM_HUELLA);
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
/** La misma persona en otro dispositivo: con la sesión única es la única que puede sustituir una sesión viva. */
const OTRO_ACCESO = { huellaSesion: 'c'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 } as const;
const CONFIANZA: ConfianzaOidcGitHub = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
};
const RECIBO: ReciboTrabajo = {
  solicitudId: ID,
  revisionReserva: 1,
  accion: 'actualizar-datos',
  resultado: 'validado',
  veredicto: 'verde',
  terminadoEn: '2026-10-16T12:00:00Z',
  huellaPaquete: 'a'.repeat(TAM_VERSION),
  error: null,
};
function identidad(ahora = AHORA): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  return {
    ...pins,
    runId: '789',
    runAttempt: '1',
    jti: 'jti-sintetico',
    emitidoEn: ahora / SEGUNDO,
    caducaEn: ahora / SEGUNDO + VALIDEZ_IDENTIDAD_S,
  };
}
function referencia(trabajo: { solicitudId: string; revisionReserva: number }) {
  return { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
}
function nueva(resultado: ResultadoReservaTrabajo) {
  assert.equal(resultado.estado, 'nueva');
  assert.ok('trabajos' in resultado && resultado.trabajos.ultimoTrabajo);
  return resultado.trabajos.ultimoTrabajo;
}
async function fixture(t: test.TestContext, preparado = true) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-trabajos-'));
  const archivo = join(dir, 'panel.sqlite');
  const reloj = { ahora: AHORA };
  const almacen = crearAlmacenPublicoNode({ archivo, maxClientes: 2, ahora: () => reloj.ahora });
  const db = new DatabaseSync(archivo);
  t.after(() => {
    db.close();
    almacen.close();
    rmSync(dir, { recursive: true });
  });
  await almacen.sesion.prepararPanel(POLITICA);
  await abrirSesionDePrueba(almacen.sesion, ACCESO);
  if (preparado) {
    await almacen.trabajos.prepararTrabajos();
  }
  return { almacen, db, archivo, reloj };
}
function instantanea(db: DatabaseSync) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((f) => ({
      nombre: f.name,
      filas: db.prepare(`SELECT * FROM ${f.name} ORDER BY 1`).all(),
    }));
}
function datosAjenos(db: DatabaseSync) {
  return ['publico_socios', 'publico_contadores', 'publico_revocados', 'administracion_controles'].map((tabla) =>
    db.prepare(`SELECT * FROM ${tabla} ORDER BY 1`).all(),
  );
}

test('capacidad separada y preparación idempotente conservan autoridad activa y no preparan por import/construcción', async (t) => {
  const { almacen, db } = await fixture(t, false);
  assert.equal(almacen.trabajos, almacen.sesion);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='administracion_trabajo'").get(), undefined);
  await assert.rejects(almacen.trabajos.leerTrabajoPrivado());
  await almacen.trabajos.prepararTrabajos();
  const antes = instantanea(db);
  await almacen.trabajos.prepararTrabajos();
  assert.deepEqual(instantanea(db), antes);
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), { version: 2, revision: 0, ultimoTrabajo: null });
});

test('reserva CAS devuelve nueva solo una vez; replays exactos no renuevan actividad ni cambian revisión', async (t) => {
  const { almacen, db } = await fixture(t);
  const trabajo = nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  assert.equal(trabajo.estado, 'despacho-incierto');
  assert.equal(trabajo.revisionReserva, 1);
  assert.ok(!JSON.stringify(trabajo).includes('confianza'));
  const antes = instantanea(db);
  const repetida = await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, {
    ...CONFIANZA,
    audiencia: 'otro-destino',
  });
  assert.equal(repetida.estado, 'repetida');
  assert.deepEqual(instantanea(db), antes);
  assert.equal(
    (await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, { ...SOLICITUD, revisionEsperada: 1 }, CONFIANZA)).estado,
    'conflicto',
  );
  assert.equal(
    (
      await almacen.trabajos.reservarTrabajoDeSesion(
        ACCESO,
        { ...SOLICITUD, accion: 'reintentar-pendientes' },
        CONFIANZA,
      )
    ).estado,
    'conflicto',
  );
  assert.equal(
    (await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, { ...SOLICITUD, solicitudId: OTRO_ID }, CONFIANZA)).estado,
    'conflicto',
  );
  assert.equal(
    (
      await almacen.trabajos.reservarTrabajoDeSesion(
        ACCESO,
        { ...SOLICITUD, solicitudId: OTRO_ID, revisionEsperada: 1 },
        CONFIANZA,
      )
    ).estado,
    'ocupado',
  );
});

test('otra sesión sustituye control humano pero no trabajo; lectura no extiende inactividad', async (t) => {
  const { almacen, reloj } = await fixture(t);
  nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  reloj.ahora += SEGUNDO;
  await abrirSesionDePrueba(almacen.sesion, OTRO_ACCESO);
  assert.deepEqual(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA), {
    estado: 'sustituida',
  });
  const lectura = await almacen.trabajos.leerTrabajoDeSesion(OTRO_ACCESO);
  assert.equal(lectura.estado, 'activa');
  assert.ok('sesion' in lectura);
  assert.equal(lectura.sesion.ultimaActividadEn, reloj.ahora);
  reloj.ahora += INACTIVIDAD_SESION_PANEL_MS;
  assert.deepEqual(await almacen.trabajos.leerTrabajoDeSesion(OTRO_ACCESO), { estado: 'caducada' });
  assert.equal((await almacen.trabajos.leerTrabajoPrivado()).ultimoTrabajo?.estado, 'despacho-incierto');
  const recibo = { ...RECIBO, terminadoEn: new Date(reloj.ahora).toISOString().replace('.000Z', 'Z') };
  await almacen.trabajos.confirmarInicio({ ...referencia(recibo), accion: recibo.accion }, identidad(reloj.ahora));
  assert.equal((await almacen.trabajos.registrarRecibo(recibo, HUELLA, identidad(reloj.ahora))).estado, 'aplicado');
});

test('incertidumbre persiste tras reinicio y tiempo; nada recupera permiso de envío', async (t) => {
  const { almacen, archivo, reloj } = await fixture(t);
  const trabajo = nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal((await almacen.trabajos.anotarDespacho(referencia(trabajo), { estado: 'incierta' })).estado, 'repetido');
  reloj.ahora += INACTIVIDAD_SESION_PANEL_MS;
  const otro = crearAlmacenPublicoNode({ archivo, maxClientes: 2, ahora: () => reloj.ahora });
  try {
    await otro.trabajos.prepararTrabajos();
    assert.deepEqual(await otro.trabajos.leerTrabajoPrivado(), antes);
    await abrirSesionDePrueba(otro.sesion, OTRO_ACCESO);
    assert.equal((await otro.trabajos.reservarTrabajoDeSesion(OTRO_ACCESO, SOLICITUD, CONFIANZA)).estado, 'repetida');
  } finally {
    otro.close();
  }
});

test('run confirmado es fijo, rechazos tardíos no lo borran y recibo contrario no libera', async (t) => {
  const { almacen } = await fixture(t);
  const trabajo = nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  assert.equal(
    (await almacen.trabajos.anotarDespacho(referencia(trabajo), { estado: 'despachada', runId: '789' })).estado,
    'aplicado',
  );
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal(
    (await almacen.trabajos.anotarDespacho(referencia(trabajo), { estado: 'rechazada' })).estado,
    'conflicto',
  );
  assert.equal(
    (await almacen.trabajos.anotarDespacho(referencia(trabajo), { estado: 'despachada', runId: '790' })).estado,
    'conflicto',
  );
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, { ...identidad(), runId: '790' })).estado,
    'conflicto',
  );
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
  await almacen.trabajos.confirmarInicio({ ...referencia(RECIBO), accion: RECIBO.accion }, identidad());
  assert.equal((await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad())).estado, 'aplicado');
  assert.equal(
    (await almacen.trabajos.anotarDespacho(referencia(trabajo), { estado: 'despachada', runId: '789' })).estado,
    'repetido',
  );
  assert.equal(
    (await almacen.trabajos.anotarDespacho(referencia(trabajo), { estado: 'rechazada' })).estado,
    'conflicto',
  );
});

test('inicio reconcilia despacho incierto; recibo duplicado conserva revisión y cambios de cuerpo se rechazan', async (t) => {
  const { almacen } = await fixture(t);
  nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  await almacen.trabajos.confirmarInicio({ ...referencia(RECIBO), accion: RECIBO.accion }, identidad());
  assert.equal((await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad())).estado, 'aplicado');
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, { ...identidad(), jti: 'token-nuevo' })).estado,
    'repetido',
  );
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, 'e'.repeat(TAM_HUELLA), identidad())).estado,
    'conflicto',
  );
  assert.equal(
    (await almacen.trabajos.registrarRecibo({ ...RECIBO, huellaPaquete: 'b'.repeat(TAM_VERSION) }, HUELLA, identidad()))
      .estado,
    'conflicto',
  );
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});

test('pins exactos, intento 1 y vigencia se comprueban de nuevo dentro de transacción', async (t) => {
  const { almacen } = await fixture(t);
  nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  const malos = [
    { repositorioId: '124' },
    { propietarioId: '457' },
    { ref: 'refs/heads/otra' },
    { workflowRef: CONFIANZA.workflowRef.replace('main', 'otra') },
    { workflowSha: 'c'.repeat(TAM_SHA) },
    { sha: 'c'.repeat(TAM_SHA) },
    { runAttempt: '2' },
    { caducaEn: AHORA / SEGUNDO },
    { emitidoEn: AHORA / SEGUNDO + IAT_FUTURO_RECHAZADO_S },
    { emitidoEn: AHORA / SEGUNDO - IAT_VIEJO_RECHAZADO_S },
  ];
  for (const cambio of malos) {
    assert.equal(
      (await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, { ...identidad(), ...cambio })).estado,
      'conflicto',
    );
  }
  for (const terminadoEn of ['2026-10-16T11:59:29Z', '2026-10-16T12:00:31Z']) {
    assert.equal(
      (await almacen.trabajos.registrarRecibo({ ...RECIBO, terminadoEn }, HUELLA, identidad())).estado,
      'conflicto',
    );
  }
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});

test('rechazo definitivo libera; nueva intención CAS no recibe eventos del trabajo anterior', async (t) => {
  const { almacen } = await fixture(t);
  const viejo = nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  assert.equal((await almacen.trabajos.anotarDespacho(referencia(viejo), { estado: 'rechazada' })).estado, 'aplicado');
  assert.equal((await almacen.trabajos.anotarDespacho(referencia(viejo), { estado: 'rechazada' })).estado, 'repetido');
  const estado = await almacen.trabajos.leerTrabajoPrivado();
  nueva(
    await almacen.trabajos.reservarTrabajoDeSesion(
      ACCESO,
      { ...SOLICITUD, solicitudId: OTRO_ID, revisionEsperada: estado.revision },
      CONFIANZA,
    ),
  );
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal((await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA)).estado, 'conflicto');
  assert.equal(
    (await almacen.trabajos.anotarDespacho(referencia(viejo), { estado: 'despachada', runId: '789' })).estado,
    'conflicto',
  );
  assert.equal((await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad())).estado, 'conflicto');
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});

test('terminales no activan generación ni alteran claves, cuotas, revocaciones o controles', async (t) => {
  const { almacen, db } = await fixture(t);
  sembrarSocioPersistido(db, { id: 'pub-uno', huellas: [HUELLA], consultasPorHora: 2 });
  await almacen.consumir([{ clave: 'consultas:global', limite: 2, ventanaMs: MINUTO_MS }]);
  await almacen.revocar('a'.repeat(TAM_JTI_API), AHORA / SEGUNDO + VALIDEZ_IDENTIDAD_S);
  const antes = datosAjenos(db);
  nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  await almacen.trabajos.confirmarInicio({ ...referencia(RECIBO), accion: RECIBO.accion }, identidad());
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad());
  const revision = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  nueva(
    await almacen.trabajos.reservarTrabajoDeSesion(
      ACCESO,
      { ...SOLICITUD, solicitudId: OTRO_ID, accion: 'reintentar-pendientes', revisionEsperada: revision },
      CONFIANZA,
    ),
  );
  const recibo: ReciboTrabajo = {
    ...RECIBO,
    solicitudId: OTRO_ID,
    revisionReserva: revision + 1,
    accion: 'reintentar-pendientes',
    resultado: 'sin-pendientes',
    veredicto: null,
    huellaPaquete: null,
  };
  await almacen.trabajos.confirmarInicio(
    { ...referencia(recibo), accion: recibo.accion },
    { ...identidad(), runId: '790' },
  );
  await almacen.trabajos.registrarRecibo(recibo, HUELLA, { ...identidad(), runId: '790' });
  assert.deepEqual(datosAjenos(db), antes);
  assert.equal((await almacen.leerControles())?.revision, 0);
  assert.ok(!JSON.stringify(await almacen.trabajos.leerTrabajoDeSesion(ACCESO)).includes('audiencia'));
});

test('retirada y completed sin recibo conservan claves, cuotas, revocaciones y controles existentes', async (t) => {
  const { almacen, db } = await fixture(t);
  sembrarSocioPersistido(db, { id: 'pub-uno', huellas: [HUELLA], consultasPorHora: 2 });
  await almacen.consumir([{ clave: 'consultas:global', limite: 2, ventanaMs: MINUTO_MS }]);
  await almacen.revocar('a'.repeat(TAM_JTI_API), AHORA / SEGUNDO + VALIDEZ_IDENTIDAD_S);
  const antes = datosAjenos(db);
  const a = nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, { ...referencia(a), revisionEsperada: a.revisionReserva });
  const revisionEsperada = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  const b = nueva(
    await almacen.trabajos.reservarTrabajoDeSesion(
      ACCESO,
      { ...SOLICITUD, solicitudId: OTRO_ID, revisionEsperada },
      CONFIANZA,
    ),
  );
  await almacen.trabajos.confirmarInicio({ ...referencia(b), accion: b.accion }, identidad());
  const cierre = await almacen.trabajos.finalizarEjecucionSinRecibo(referencia(b), {
    estado: 'completed',
    evento: 'workflow_dispatch',
    runId: '789',
    runAttempt: '1',
    repositorioId: CONFIANZA.repositorioId,
    propietarioId: CONFIANZA.propietarioId,
    sha: CONFIANZA.sha,
    workflowPath: '.github/workflows/actualizar.yml',
    conclusion: 'failure',
  });
  assert.equal(cierre.estado, 'aplicado');
  assert.equal(cierre.trabajos.ultimoTrabajo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.deepEqual(datosAjenos(db), antes);
});

test('contratos cerrados copian sin accesores, rechazan entradas y coherencia defectuosa sin secretos', () => {
  for (const entrada of [null, undefined, 1, [], 'secreto', {}]) {
    assert.throws(() => leerConfianzaOidcGitHub(entrada), /Confianza OIDC de GitHub no válida/);
  }
  let leido = false;
  const accessor = {
    ...SOLICITUD,
    get accion() {
      leido = true;
      return 'actualizar-datos';
    },
  };
  assert.throws(() => leerSolicitudTrabajo(accessor));
  assert.equal(leido, false);
  for (const cambio of [{ extra: 'no-reflejar' }, { solicitudId: 'token' }, { revisionEsperada: -1 }]) {
    assert.throws(
      () => leerSolicitudTrabajo({ ...SOLICITUD, ...cambio }),
      (e: unknown) => e instanceof Error && !e.message.includes('no-reflejar'),
    );
  }
  for (const cambio of [
    { terminadoEn: '2026-02-30T12:00:00Z' },
    { resultado: 'sin-pendientes' },
    { resultado: 'rechazado' },
    { huellaPaquete: null },
    { error: 'inventado' },
  ]) {
    assert.throws(() => leerReciboTrabajo({ ...RECIBO, ...cambio }));
  }
  assert.ok(Object.isFrozen(leerReciboTrabajo(RECIBO)));
});

const CORRUPCIONES = [
  'DROP TABLE administracion_trabajo',
  'DELETE FROM administracion_trabajo',
  'UPDATE publico_estado SET trabajo_panel_version=0',
  'ALTER TABLE publico_estado DROP COLUMN trabajo_panel_version',
  "UPDATE administracion_trabajo SET documento='{}'",
  'UPDATE administracion_trabajo SET reloj=reloj+1',
  'DELETE FROM administracion_sesion',
  'DELETE FROM administracion_controles',
];
for (const corrupcion of CORRUPCIONES) {
  test(`corrupción no se repara ni borra reserva: ${corrupcion}`, async (t) => {
    const { almacen, db } = await fixture(t);
    nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
    db.exec(corrupcion);
    const antes = instantanea(db);
    await assert.rejects(almacen.trabajos.prepararTrabajos());
    await assert.rejects(almacen.trabajos.leerTrabajoPrivado());
    assert.deepEqual(instantanea(db), antes);
  });
}

test('reloj retrocedido y revisión agotada fallan cerrado, sin borrar estado ni aumentar por replay', async (t) => {
  const { almacen, db, reloj } = await fixture(t);
  const trabajo = nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  reloj.ahora -= SEGUNDO;
  await assert.rejects(almacen.trabajos.anotarDespacho(referencia(trabajo), { estado: 'rechazada' }));
  reloj.ahora = AHORA;
  const estado = await almacen.trabajos.leerTrabajoPrivado();
  const maximo = { ...estado, revision: Number.MAX_SAFE_INTEGER };
  leerEstadoTrabajosPrivado(maximo);
  db.prepare('UPDATE administracion_trabajo SET documento=?').run(JSON.stringify(maximo));
  const antes = instantanea(db);
  await assert.rejects(almacen.trabajos.anotarDespacho(referencia(trabajo), { estado: 'rechazada' }));
  assert.deepEqual(instantanea(db), antes);
  assert.equal((await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA)).estado, 'repetida');
});

test('UUID A reutilizado tras B no acepta recibo tardío de la primera reserva A, aun con JWT fresco', async (t) => {
  const { almacen } = await fixture(t);
  nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  await almacen.trabajos.confirmarInicio({ ...referencia(RECIBO), accion: RECIBO.accion }, identidad());
  await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, identidad());
  const revisionA = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  const b = nueva(
    await almacen.trabajos.reservarTrabajoDeSesion(
      ACCESO,
      { ...SOLICITUD, solicitudId: OTRO_ID, revisionEsperada: revisionA },
      CONFIANZA,
    ),
  );
  await almacen.trabajos.anotarDespacho(referencia(b), { estado: 'rechazada' });
  const revisionB = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  nueva(
    await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, { ...SOLICITUD, revisionEsperada: revisionB }, CONFIANZA),
  );
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, HUELLA, { ...identidad(), jti: 'jwt-fresco' })).estado,
    'conflicto',
  );
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});

test('margen remoto admite dos segundos y no adelanta reloj SQL; treinta y un segundos se rechazan', async (t) => {
  const { almacen, reloj } = await fixture(t);
  nueva(await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  await almacen.trabajos.confirmarInicio({ ...referencia(RECIBO), accion: RECIBO.accion }, identidad());
  const recibo = { ...RECIBO, terminadoEn: '2026-10-16T12:00:02Z' };
  assert.equal((await almacen.trabajos.registrarRecibo(recibo, HUELLA, identidad())).estado, 'aplicado');
  const estado = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal(estado.ultimoTrabajo?.actualizadoEn, reloj.ahora);
  assert.equal(estado.ultimoTrabajo?.resultado?.terminadoEn, recibo.terminadoEn);
});

function motorConFallo(db: DatabaseSync, falla: (sentencia: string) => boolean): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
      if (falla(sql)) {
        throw new Error('Fallo sintético');
      }
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const salida = accion();
        db.exec('COMMIT');
        return salida;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
test('fallo SQL revierte adopción completa o reserva junto al reloj de sesión; reintento limpio es único', async (t) => {
  const { almacen, db, reloj } = await fixture(t, false);
  let sentenciaFallida = 'UPDATE publico_estado SET trabajo_panel_version';
  const sql = motorConFallo(db, (sentencia) => sentencia.startsWith(sentenciaFallida));
  const panel = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
  const original = instantanea(db);
  await assert.rejects(panel.prepararTrabajos());
  assert.deepEqual(instantanea(db), original);
  await almacen.trabajos.prepararTrabajos();
  const antes = instantanea(db);
  reloj.ahora += SEGUNDO;
  sentenciaFallida = 'UPDATE administracion_trabajo SET documento';
  await assert.rejects(panel.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
  assert.deepEqual(instantanea(db), antes);
  sentenciaFallida = 'NO COINCIDE';
  nueva(await panel.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA));
});
