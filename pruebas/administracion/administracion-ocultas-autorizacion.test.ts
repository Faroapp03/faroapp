/** La lectura privada nunca cruza una sustitución de sesión ni precede a la frontera de autorización. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.example';
function peticion(ruta: string, token = '', cuerpo: unknown = {}, identidad = true) {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-faro-panel': '1',
      ...(identidad ? { 'x-identidad-prueba': 'si' } : {}),
      ...(token ? { 'x-faro-sesion': token } : {}),
    },
    body: JSON.stringify(cuerpo),
  });
}
async function preparar(t: test.TestContext, leer: () => Promise<null>) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql: SqlAccesoPublico = {
    filas: (s, ...v) => db.prepare(s).all(...v),
    ejecutar: (s, ...v) => {
      db.prepare(s).run(...v);
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = accion();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
  const almacen = new AlmacenSesionPanelSqlite(sql);
  await almacen.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen,
    leerCatalogoPrivado: leer,
    guardiaAdministrativa: async (p) =>
      p.headers.get('x-identidad-prueba') === 'si' ? principalDePrueba(ORIGEN, 'principal-sintetico') : null,
  });
  const abrir = async () => {
    const r = await router(peticion('sesion/abrir', '', { retomar: true }));
    assert.equal(r.status, ESTADO_HTTP.correcto);
    return ((await r.json()) as { token: string }).token;
  };
  return { router, abrir };
}
test('Access, token, sesión y petición cerrada se comprueban antes de leer el catálogo', async (t) => {
  let lecturas = 0;
  const f = await preparar(t, async () => {
    lecturas++;
    return null;
  });
  const cuerpo = { tipo: 'todos', pagina: 0, revision: null };
  assert.equal((await f.router(peticion('datos/ofertas-ocultas', '', cuerpo, false))).status, ESTADO_HTTP.prohibido);
  assert.equal((await f.router(peticion('datos/ofertas-ocultas', '', cuerpo))).status, ESTADO_HTTP.prohibido);
  const token = await f.abrir();
  for (const mal of [
    { ...cuerpo, extra: true },
    { ...cuerpo, pagina: -1 },
    { ...cuerpo, tipo: 'cualquier-cosa' },
  ]) {
    assert.equal(
      (await f.router(peticion('datos/ofertas-ocultas', token, mal))).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
  }
  await f.abrir();
  assert.equal((await f.router(peticion('datos/ofertas-ocultas', token, cuerpo))).status, ESTADO_HTTP.conflicto);
  assert.equal(lecturas, 0);
});
test('sustitución durante la lectura descarta la página; error ilegible no se refleja ni se convierte en cero', async (t) => {
  let liberar: () => void = () => {};
  let entrar: () => void = () => {};
  const dentro = new Promise<void>((r) => {
    entrar = r;
  });
  const espera = new Promise<void>((r) => {
    liberar = r;
  });
  const f = await preparar(t, async () => {
    entrar();
    await espera;
    return null;
  });
  const token = await f.abrir();
  const leyendo = f.router(peticion('datos/ofertas-ocultas', token, { tipo: 'todos', pagina: 0, revision: null }));
  await dentro;
  await f.abrir();
  liberar();
  const r = await leyendo;
  assert.equal(r.status, ESTADO_HTTP.conflicto);
  const texto = await r.text();
  assert.ok(!texto.includes('ofertasOcultas') && !texto.includes('total'));
  const g = await preparar(t, async () => {
    throw new Error('/equipo/privado/token=secreto');
  });
  const t2 = await g.abrir();
  const error = await g.router(peticion('datos/ofertas-ocultas', t2, { tipo: 'todos', pagina: 0, revision: null }));
  assert.equal(error.status, ESTADO_HTTP.noDisponible);
  assert.deepEqual(await error.json(), { error: 'no_disponible' });
});
