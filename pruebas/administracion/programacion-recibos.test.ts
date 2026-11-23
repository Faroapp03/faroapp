/** Recibos 1/2 + OIDC sintético contra SQL real; ningún transporte sale del proceso. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type { AccionActualizacion } from '../../src/administracion/ejecutor-github.ts';
import type { AccionManual } from '../../src/administracion/estado-trabajos.js';
import { crearReceptorInicioActualizacion } from '../../src/administracion/inicio-actualizacion.ts';
import {
  crearReceptorResultadoActualizacion,
  leerResultado,
} from '../../src/administracion/resultado-actualizacion.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = Date.parse('2026-10-17T03:00:00Z');
const TAM_HASH = 64;
const TAM_SHA = 40;
const RSA_BITS = 2048;
const SEGUNDO = 1000;
const VIDA_S = 300;
const TAM_PAQUETE = 16;
const VERSION_DESCONOCIDA = 3;
const ORIGEN = 'https://mantenimiento.example';
const URL_RECIBO = `${ORIGEN}/mantenimiento/resultado`;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
const ID = '11111111-1111-4111-8111-111111111111';
const CONFIANZA = {
  audiencia: URL_RECIBO,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/producto/.github/workflows/actualizar.yml@refs/heads/main',
  workflowSha: 'a'.repeat(TAM_SHA),
  sha: 'b'.repeat(TAM_SHA),
};
const HTTP = { ok: 200, invalido: 400, noAutorizado: 401, conflicto: 409 };
const ESTADO = {
  version: 1,
  observadoEn: '2026-10-17T03:00:00Z',
  formacionAbiertaCaduca: null,
  fuentes: [{ id: 'fuente', politica: 'mensual', fecha: '2026-10-17', plazoDias: 30 }],
  modulos: ['fuente', 'paquete'].map((id) => ({
    id,
    ultimoIntento: '2026-10-17T03:00:00Z',
    veredicto: 'verde',
    ultimaVersionBuena: { fecha: '2026-10-17T03:00:00Z', huella: 'c'.repeat(TAM_HASH) },
    fallos: 0,
    proximoReintento: null,
  })),
};
function cuerpo(accion: AccionActualizacion, version: number, solicitudId = ID) {
  return {
    version,
    solicitudId,
    revisionReserva: 1,
    accion,
    resultado: 'sin-pendientes',
    veredicto: null,
    terminadoEn: '2026-10-17T03:00:00Z',
    estado: ESTADO,
    huellaPaquete: null,
    error: null,
  };
}
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
async function fixture(t: TestContext, accion: AccionManual | 'comprobar-programada') {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql: SqlAccesoPublico = {
    filas: (s, ...v) => db.prepare(s).all(...v),
    ejecutar: (s, ...v) => {
      db.prepare(s).run(...v);
    },
    transaccion: (a) => transaccion(db, a),
  };
  new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => AHORA });
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
  await backend.prepararPanel({
    version: 2,
    api: 'deshabilitada',
    mcp: false,
    a2a: false,
  });
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
  await abrirSesionDePrueba(backend, ACCESO);
  if (accion === 'comprobar-programada') {
    await backend.reservarTrabajoProgramado({ eventoEn: AHORA, cron: '0 3 * * *' }, CONFIANZA);
  } else {
    await backend.reservarTrabajoDeSesion(ACCESO, { solicitudId: ID, accion, revisionEsperada: 0 }, CONFIANZA);
  }
  await backend.cerrarSesion(ACCESO);
  const trabajo = (await backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(trabajo);
  return {
    backend,
    referencia: { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva, accion },
  };
}
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
async function cripto() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'sintetica' };
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: CONFIANZA.audiencia,
    repository_id: CONFIANZA.repositorioId,
    repository_owner_id: CONFIANZA.propietarioId,
    ref: CONFIANZA.ref,
    workflow_ref: CONFIANZA.workflowRef,
    workflow_sha: CONFIANZA.workflowSha,
    sha: CONFIANZA.sha,
    run_id: '789',
    run_attempt: '1',
    jti: 'sintetico',
    iat: AHORA / SEGUNDO,
    nbf: AHORA / SEGUNDO,
    exp: AHORA / SEGUNDO + VIDA_S,
  };
  return {
    pedir: async () => Response.json({ keys: [jwk] }),
    firmar: async (delta: Record<string, unknown> = {}) => {
      const texto = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims, ...delta })).toString('base64url')}`;
      const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(texto));
      return `${texto}.${Buffer.from(firma).toString('base64url')}`;
    },
  };
}
const CLAVES = cripto();
function peticion(url: string, token: string, texto: string) {
  return new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: texto,
  });
}
test('lectores de recibos v1/v2 cierran acciones y sin-pendientes sin alterar forma', () => {
  assert.equal(leerResultado(cuerpo('reintentar-pendientes', 1)).recibo.resultado, 'sin-pendientes');
  assert.equal(leerResultado(cuerpo('comprobar-programada', 2)).recibo.resultado, 'sin-pendientes');
  for (const c of [
    cuerpo('comprobar-programada', 1),
    cuerpo('actualizar-datos', 1),
    cuerpo('actualizar-datos', 2),
    cuerpo('comprobar-programada', VERSION_DESCONOCIDA),
  ]) {
    assert.throws(() => leerResultado(c));
  }
  for (const accion of ['actualizar-datos', 'reintentar-pendientes', 'comprobar-programada'] as const) {
    assert.equal(
      leerResultado({
        ...cuerpo(accion, 2),
        resultado: 'validado',
        veredicto: 'verde',
        huellaPaquete: 'd'.repeat(TAM_PAQUETE),
      }).recibo.accion,
      accion,
    );
  }
});
async function iniciar(f: Awaited<ReturnType<typeof fixture>>, token: string) {
  const claves = await CLAVES;
  const receptor = crearReceptorInicioActualizacion({
    origen: ORIGEN,
    almacen: f.backend,
    pedir: claves.pedir,
    ahora: () => AHORA,
  });
  assert.equal(
    (await receptor(peticion(`${ORIGEN}/mantenimiento/inicio`, token, JSON.stringify(f.referencia)))).status,
    HTTP.ok,
  );
}
for (const escenario of [
  { accion: 'comprobar-programada', version: 2 },
  { accion: 'reintentar-pendientes', version: 1 },
] as const) {
  test(`OIDC + SQL ${escenario.accion} recibo${escenario.version}: inicio obligatorio y replay conserva bytes exactos`, async (t) => {
    const f = await fixture(t, escenario.accion);
    const claves = await CLAVES;
    const token = await claves.firmar();
    const receptor = crearReceptorResultadoActualizacion({
      origen: ORIGEN,
      almacen: f.backend,
      pedir: claves.pedir,
      ahora: () => AHORA,
    });
    const texto = `${JSON.stringify(cuerpo(escenario.accion, escenario.version, f.referencia.solicitudId))}\n`;
    assert.equal((await receptor(peticion(URL_RECIBO, token, texto))).status, HTTP.conflicto);
    await iniciar(f, token);
    assert.equal(
      (await receptor(peticion(URL_RECIBO, await claves.firmar({ run_attempt: '2' }), texto))).status,
      HTTP.noAutorizado,
    );
    assert.deepEqual(await (await receptor(peticion(URL_RECIBO, token, texto))).json(), { estado: 'aplicado' });
    const antes = await f.backend.leerTrabajoPrivado();
    assert.equal(antes.ultimoTrabajo?.huellaRecibo, createHash('sha256').update(texto).digest('hex'));
    assert.deepEqual(await (await receptor(peticion(URL_RECIBO, token, texto))).json(), { estado: 'repetido' });
    assert.equal((await receptor(peticion(URL_RECIBO, token, texto.trim()))).status, HTTP.conflicto);
    assert.deepEqual(await f.backend.leerTrabajoPrivado(), antes);
  });
}
