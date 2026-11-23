import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import { INACTIVIDAD_SESION_PANEL_MS } from '../../src/administracion/sesion.ts';
import {
  type EvidenciaEjecucionCompletada,
  leerEstadoTrabajosPrivado,
  leerEvidenciaEjecucionCompletada,
  leerInicioTrabajo,
  leerResultadoRetiradaTrabajo,
  leerRetiradaTrabajo,
  type ReciboTrabajo,
} from '../../src/administracion/trabajos.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = Date.parse('2026-10-16T12:00:00Z');
const TAM_HUELLA = 64;
const TAM_SHA = 40;
const TAM_VERSION = 16;
const SEGUNDO = 1000;
const VALIDEZ_S = 60;
const IAT_ANTERIOR_S = 31;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
/** La misma persona en otro dispositivo: con la sesión única es la única que puede sustituir una sesión viva. */
const OTRO_ACCESO = { huellaSesion: 'c'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const CONFIANZA = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const SOLICITUD = { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 } as const;
const INICIO = { solicitudId: ID, accion: 'actualizar-datos', revisionReserva: 1 } as const;
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
const RECIBO: ReciboTrabajo = {
  ...INICIO,
  resultado: 'validado',
  veredicto: 'verde',
  terminadoEn: '2026-10-16T12:00:00Z',
  huellaPaquete: 'a'.repeat(TAM_VERSION),
  error: null,
};
function identidad(): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  return {
    ...pins,
    runId: '789',
    runAttempt: '1',
    jti: 'jti-sintetico',
    emitidoEn: AHORA / SEGUNDO,
    caducaEn: AHORA / SEGUNDO + VALIDEZ_S,
  };
}
const EVIDENCIA: EvidenciaEjecucionCompletada = {
  estado: 'completed',
  evento: 'workflow_dispatch',
  runId: '789',
  runAttempt: '1',
  repositorioId: '123',
  propietarioId: '456',
  sha: CONFIANZA.sha,
  workflowPath: '.github/workflows/actualizar.yml',
  conclusion: 'success',
};
async function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-ciclo-'));
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
  await almacen.trabajos.prepararTrabajos();
  await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, SOLICITUD, CONFIANZA);
  return { almacen, db, archivo, reloj };
}
test('protocolo obligatorio rechaza candidato válido sin inicio autorizado aunque OIDC sea correcto', async (t) => {
  const { almacen } = await fixture(t);
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, 'e'.repeat(TAM_HUELLA), identidad())).estado,
    'conflicto',
  );
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});

test('inicio vincula run y pins una sola vez; no necesita sesión humana activa ni entrega campos privados', async (t) => {
  const { almacen, reloj } = await fixture(t);
  reloj.ahora += INACTIVIDAD_SESION_PANEL_MS;
  const i = { ...identidad(), emitidoEn: reloj.ahora / SEGUNDO, caducaEn: reloj.ahora / SEGUNDO + VALIDEZ_S };
  const inicio = await almacen.trabajos.confirmarInicio(INICIO, i);
  assert.equal(inicio.estado, 'aplicado');
  assert.equal(inicio.trabajos.ultimoTrabajo?.runId, i.runId);
  assert.ok(!/confianza|inicioConfirmado|protocoloInicio/.test(JSON.stringify(inicio)));
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal(antes.ultimoTrabajo?.inicioConfirmado, true);
  assert.equal((await almacen.trabajos.confirmarInicio(INICIO, { ...i, jti: 'otro-token' })).estado, 'repetido');
  assert.equal((await almacen.trabajos.confirmarInicio(INICIO, { ...i, runId: '790' })).estado, 'conflicto');
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});

test('inicio revalida tupla, acción, pins, intento, vigencia y emisión posterior a reserva con margen', async (t) => {
  const { almacen } = await fixture(t);
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  for (const cambio of [
    { repositorioId: '124' },
    { propietarioId: '457' },
    { sha: 'c'.repeat(TAM_SHA) },
    { workflowSha: 'c'.repeat(TAM_SHA) },
    { ref: 'refs/heads/otra' },
    { workflowRef: CONFIANZA.workflowRef.replace('main', 'otra') },
    { runAttempt: '2' },
    { emitidoEn: AHORA / SEGUNDO - IAT_ANTERIOR_S },
    { emitidoEn: AHORA / SEGUNDO + IAT_ANTERIOR_S },
    { caducaEn: AHORA / SEGUNDO },
  ]) {
    assert.equal((await almacen.trabajos.confirmarInicio(INICIO, { ...identidad(), ...cambio })).estado, 'conflicto');
  }
  for (const cambio of [
    { solicitudId: OTRO_ID },
    { revisionReserva: 2 },
    { accion: 'reintentar-pendientes' as const },
  ]) {
    assert.equal((await almacen.trabajos.confirmarInicio({ ...INICIO, ...cambio }, identidad())).estado, 'conflicto');
  }
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
  assert.equal(
    (
      await almacen.trabajos.confirmarInicio(INICIO, {
        ...identidad(),
        emitidoEn: AHORA / SEGUNDO - IAT_ANTERIOR_S + 1,
      })
    ).estado,
    'aplicado',
  );
});

const REFERENCIA = { solicitudId: ID, revisionReserva: 1 };
const RETIRADA = { ...REFERENCIA, revisionEsperada: 1 };
test('retirada CAS antes de inicio es idempotente y bloquea inicio, despacho y recibo tardíos', async (t) => {
  const { almacen } = await fixture(t);
  assert.equal(
    (await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, { ...RETIRADA, revisionEsperada: 0 })).estado,
    'conflicto',
  );
  const retiro = await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, RETIRADA);
  assert.equal(retiro.estado, 'retirado');
  assert.ok('trabajos' in retiro);
  assert.equal(retiro.trabajos.ultimoTrabajo?.resultado?.resultado, 'retirado');
  assert.equal(retiro.trabajos.ultimoTrabajo?.runId, null);
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal((await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, RETIRADA)).estado, 'retirado');
  assert.equal((await almacen.trabajos.confirmarInicio(INICIO, identidad())).estado, 'conflicto');
  assert.equal(
    (await almacen.trabajos.anotarDespacho(REFERENCIA, { estado: 'despachada', runId: '789' })).estado,
    'conflicto',
  );
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, 'e'.repeat(TAM_HUELLA), identidad())).estado,
    'conflicto',
  );
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});

test('run conocido sin inicio puede retirarse, pero inicio confirmado gana a retirada en otra conexión', async (t) => {
  const { almacen, archivo } = await fixture(t);
  const otro = crearAlmacenPublicoNode({ archivo, maxClientes: 2, ahora: () => AHORA });
  t.after(() => otro.close());
  await almacen.trabajos.anotarDespacho(REFERENCIA, { estado: 'despachada', runId: '789' });
  const revision = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  assert.equal((await otro.trabajos.confirmarInicio(INICIO, identidad())).estado, 'aplicado');
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal(
    (await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, { ...RETIRADA, revisionEsperada: revision })).estado,
    'conflicto',
  );
  assert.deepEqual(await otro.trabajos.leerTrabajoPrivado(), antes);
});

test('retirada con run conocido gana antes de inicio en otra conexión; no cancela ni concede ejecución', async (t) => {
  const { almacen, archivo } = await fixture(t);
  const otro = crearAlmacenPublicoNode({ archivo, maxClientes: 2, ahora: () => AHORA });
  t.after(() => otro.close());
  await almacen.trabajos.anotarDespacho(REFERENCIA, { estado: 'despachada', runId: '789' });
  const revisionEsperada = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  assert.equal(
    (await otro.trabajos.retirarTrabajoDeSesion(ACCESO, { ...RETIRADA, revisionEsperada })).estado,
    'retirado',
  );
  assert.equal((await almacen.trabajos.confirmarInicio(INICIO, identidad())).estado, 'conflicto');
  assert.equal((await almacen.trabajos.leerTrabajoPrivado()).ultimoTrabajo?.inicioConfirmado, false);
});

test('retirada exige sesión vigente y no renueva actividad; sustitución no borra trabajo', async (t) => {
  const { almacen, reloj } = await fixture(t);
  reloj.ahora += SEGUNDO;
  await abrirSesionDePrueba(almacen.sesion, OTRO_ACCESO);
  assert.deepEqual(await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, RETIRADA), { estado: 'sustituida' });
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  const sesion = await almacen.sesion.comprobarSesion(OTRO_ACCESO);
  reloj.ahora += INACTIVIDAD_SESION_PANEL_MS;
  assert.deepEqual(await almacen.trabajos.retirarTrabajoDeSesion(OTRO_ACCESO, RETIRADA), { estado: 'caducada' });
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
  assert.equal(sesion.estado, 'activa');
});

function escribirLegado(db: DatabaseSync) {
  const fila = db.prepare('SELECT documento FROM administracion_trabajo').get();
  assert.equal(typeof fila?.documento, 'string');
  const privado = leerEstadoTrabajosPrivado(JSON.parse(String(fila?.documento)));
  assert.ok(privado.ultimoTrabajo);
  // El documento v1 nunca llevó los campos de la v2 ni el origen de la solicitud.
  const {
    inicioConfirmado: _inicio,
    protocoloInicio: _protocolo,
    origen: _origen,
    ...ultimoTrabajo
  } = privado.ultimoTrabajo;
  const anterior = { version: 1, revision: privado.revision, ultimoTrabajo };
  db.prepare('UPDATE administracion_trabajo SET documento=?').run(JSON.stringify(anterior));
  return anterior;
}
test('v1 se lee como legado y migra explícitamente a v2 sin reiniciar trabajo, revisión, reloj ni sesión', async (t) => {
  const { almacen, db } = await fixture(t);
  const anterior = escribirLegado(db);
  const filaAntes = db.prepare('SELECT reloj FROM administracion_trabajo').get();
  const sesionAntes = db.prepare('SELECT * FROM administracion_sesion').get();
  const lectura = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal(lectura.version, 2);
  assert.equal(lectura.ultimoTrabajo?.protocoloInicio, 'legado');
  assert.equal(
    JSON.parse(String(db.prepare('SELECT documento FROM administracion_trabajo').get()?.documento)).version,
    1,
  );
  await almacen.trabajos.prepararTrabajos();
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), lectura);
  assert.deepEqual(db.prepare('SELECT reloj FROM administracion_trabajo').get(), filaAntes);
  assert.deepEqual(db.prepare('SELECT * FROM administracion_sesion').get(), sesionAntes);
  assert.equal(lectura.revision, anterior.revision);
  assert.equal(
    JSON.parse(String(db.prepare('SELECT documento FROM administracion_trabajo').get()?.documento)).version,
    2,
  );
  assert.equal((await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, RETIRADA)).estado, 'conflicto');
  assert.equal((await almacen.trabajos.confirmarInicio(INICIO, identidad())).estado, 'conflicto');
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, 'e'.repeat(TAM_HUELLA), identidad())).estado,
    'aplicado',
  );
});

test('ejecución completed con run conocido cierra sin candidato y libera nueva intención, incluso legado', async (t) => {
  const { almacen, db } = await fixture(t);
  escribirLegado(db);
  await almacen.trabajos.prepararTrabajos();
  await almacen.trabajos.anotarDespacho(REFERENCIA, { estado: 'despachada', runId: '789' });
  const fin = await almacen.trabajos.finalizarEjecucionSinRecibo(REFERENCIA, EVIDENCIA);
  assert.equal(fin.estado, 'aplicado');
  assert.equal(fin.trabajos.ultimoTrabajo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.equal(fin.trabajos.ultimoTrabajo?.resultado?.huellaPaquete, null);
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal((await almacen.trabajos.finalizarEjecucionSinRecibo(REFERENCIA, EVIDENCIA)).estado, 'repetido');
  assert.equal(
    (await almacen.trabajos.registrarRecibo(RECIBO, 'e'.repeat(TAM_HUELLA), identidad())).estado,
    'conflicto',
  );
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
  assert.equal(
    (
      await almacen.trabajos.reservarTrabajoDeSesion(
        ACCESO,
        { ...SOLICITUD, solicitudId: OTRO_ID, revisionEsperada: antes.revision },
        CONFIANZA,
      )
    ).estado,
    'nueva',
  );
});

test('completed no cierra run desconocido, identidad REST distinta ni estados incompletos', async (t) => {
  const { almacen } = await fixture(t);
  assert.equal((await almacen.trabajos.finalizarEjecucionSinRecibo(REFERENCIA, EVIDENCIA)).estado, 'conflicto');
  await almacen.trabajos.confirmarInicio(INICIO, identidad());
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  for (const cambio of [
    { runId: '790' },
    { repositorioId: '124' },
    { propietarioId: '457' },
    { sha: 'c'.repeat(TAM_SHA) },
    { workflowPath: '.github/workflows/otro.yml' },
  ]) {
    assert.equal(
      (await almacen.trabajos.finalizarEjecucionSinRecibo(REFERENCIA, { ...EVIDENCIA, ...cambio })).estado,
      'conflicto',
    );
  }
  for (const cambio of [{ estado: 'in_progress' }, { evento: 'push' }, { runAttempt: '2' }, { conclusion: null }]) {
    await assert.rejects(
      almacen.trabajos.finalizarEjecucionSinRecibo(REFERENCIA, {
        ...EVIDENCIA,
        ...cambio,
      } as EvidenciaEjecucionCompletada),
    );
  }
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
  assert.equal((await almacen.trabajos.finalizarEjecucionSinRecibo(REFERENCIA, EVIDENCIA)).estado, 'aplicado');
  assert.equal((await almacen.trabajos.confirmarInicio(INICIO, identidad())).estado, 'conflicto');
});

test('rechazo neutro puede cerrar sin inicio, pero sin-pendientes requiere inicio autorizado', async (t) => {
  const { almacen } = await fixture(t);
  const sinPendientes: ReciboTrabajo = { ...RECIBO, resultado: 'sin-pendientes', veredicto: null, huellaPaquete: null };
  assert.equal(
    (await almacen.trabajos.registrarRecibo(sinPendientes, 'e'.repeat(TAM_HUELLA), identidad())).estado,
    'conflicto',
  );
  const rechazado: ReciboTrabajo = {
    ...RECIBO,
    resultado: 'rechazado',
    veredicto: 'rojo',
    huellaPaquete: null,
    error: 'actualizacion_no_completada',
  };
  assert.equal(
    (await almacen.trabajos.registrarRecibo(rechazado, 'e'.repeat(TAM_HUELLA), identidad())).estado,
    'aplicado',
  );
  assert.equal((await almacen.trabajos.confirmarInicio(INICIO, identidad())).estado, 'conflicto');
});

test('contratos nuevos rechazan accesores, campos libres e incoherencia privada sin ejecutar getters', async (t) => {
  let leido = false;
  for (const [leer, entrada] of [
    [leerInicioTrabajo, INICIO],
    [leerRetiradaTrabajo, RETIRADA],
    [leerEvidenciaEjecucionCompletada, EVIDENCIA],
  ] as const) {
    assert.ok(Object.isFrozen(leer(entrada)));
    assert.throws(() => leer({ ...entrada, extra: 'no-reflejar' }));
    assert.throws(() => leer(Object.create(entrada)));
    const campo = Object.keys(entrada)[0];
    assert.ok(campo);
    const accessor = { ...entrada };
    Object.defineProperty(accessor, campo, {
      get() {
        leido = true;
        return 'no-reflejar';
      },
      enumerable: true,
    });
    assert.throws(() => leer(accessor));
  }
  assert.equal(leido, false);
  const { almacen } = await fixture(t);
  const estado = await almacen.trabajos.leerTrabajoPrivado();
  assert.ok(estado.ultimoTrabajo);
  for (const cambio of [{ inicioConfirmado: true }, { protocoloInicio: 'inventado' }, { inicioConfirmado: 'si' }]) {
    assert.throws(() =>
      leerEstadoTrabajosPrivado({ ...estado, ultimoTrabajo: { ...estado.ultimoTrabajo, ...cambio } }),
    );
  }
  const retirada = await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, RETIRADA);
  assert.deepEqual(leerResultadoRetiradaTrabajo(retirada), retirada);
});

test('UUID A→B→A no admite inicio, retirada ni completed tardíos de la primera reserva A', async (t) => {
  const { almacen } = await fixture(t);
  await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, RETIRADA);
  const revisionA = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  const b = await almacen.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { ...SOLICITUD, solicitudId: OTRO_ID, revisionEsperada: revisionA },
    CONFIANZA,
  );
  assert.ok('trabajos' in b && b.trabajos.ultimoTrabajo);
  await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, {
    solicitudId: OTRO_ID,
    revisionReserva: b.trabajos.ultimoTrabajo.revisionReserva,
    revisionEsperada: b.trabajos.revision,
  });
  const revisionB = (await almacen.trabajos.leerTrabajoPrivado()).revision;
  await almacen.trabajos.reservarTrabajoDeSesion(ACCESO, { ...SOLICITUD, revisionEsperada: revisionB }, CONFIANZA);
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  assert.equal((await almacen.trabajos.confirmarInicio(INICIO, identidad())).estado, 'conflicto');
  assert.equal(
    (await almacen.trabajos.retirarTrabajoDeSesion(ACCESO, { ...RETIRADA, revisionEsperada: antes.revision })).estado,
    'conflicto',
  );
  assert.equal((await almacen.trabajos.finalizarEjecucionSinRecibo(REFERENCIA, EVIDENCIA)).estado, 'conflicto');
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});
