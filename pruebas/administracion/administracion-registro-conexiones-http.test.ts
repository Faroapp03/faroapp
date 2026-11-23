/** Router administrativo sobre SQLite real; las capacidades retiradas solo se inyectan para comprobar su rechazo. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { crearRouterAdministrativo, MAX_CUERPO_PANEL_BYTES, PLAZO_PANEL_MS } from '../../src/administracion/http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { motorPanel, OPCIONES_PANEL, POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.example';
const FICTICIA = 'credencial-sintetica-no-real-106';
const PRINCIPAL = principalDePrueba('https://fixture.cloudflareaccess.com', 'administrador');
function alta(revisionEsperada = 0, id = 'nuevo') {
  return {
    operacionId: crypto.randomUUID(),
    revisionEsperada,
    id,
    clave: FICTICIA,
    perfil: { version: 1, proveedor: { secretRef: null, privacidad: 'personas-reales' } },
  };
}
function peticion(ruta: string, token = '', cuerpo: unknown = {}) {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'x-faro-panel': '1',
      'content-type': 'application/json',
      'cf-access-jwt-assertion': 'valida',
      'x-faro-sesion': token,
    },
  });
}
function solicitud(ruta: string, token: string, cuerpo: unknown = {}) {
  return peticion(`ia/conexiones/${ruta}`, token, cuerpo);
}
async function montaje() {
  const db = new DatabaseSync(':memory:');
  const sql = motorPanel(db);
  new AlmacenPublicoSqlite(sql, OPCIONES_PANEL);
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: OPCIONES_PANEL.ahora });
  await almacen.prepararPanel(POLITICA_PANEL);
  const llamadas = { registrar: 0, rotar: 0, recibo: 0 };
  const capacidad = {
    registrar: async () => {
      llamadas.registrar++;
      assert.fail('Una capacidad retirada no puede registrar conexiones');
    },
    rotar: async () => {
      llamadas.rotar++;
      assert.fail('Una capacidad retirada no puede rotar conexiones');
    },
    consultarRecibo: async () => {
      llamadas.recibo++;
      assert.fail('Una capacidad retirada no puede consultar recibos');
    },
  };
  const routerCon = (gestionConexionesIa?: typeof capacidad) =>
    crearRouterAdministrativo({
      almacen,
      origen: ORIGEN,
      guardiaAdministrativa: async (req) =>
        req.headers.get('cf-access-jwt-assertion') === 'valida' ? PRINCIPAL : null,
      ...(gestionConexionesIa ? { gestionConexionesIa } : {}),
    });
  const router = routerCon(capacidad);
  const abrir = async () => {
    const respuesta = await router(peticion('sesion/abrir'));
    const cuerpo: unknown = await respuesta.json();
    assert.ok(esObjeto(cuerpo) && typeof cuerpo.token === 'string');
    return cuerpo.token;
  };
  return { db, almacen, capacidad, llamadas, routerCon, router, abrir };
}
function sinFiltracion(texto: string) {
  assert.doesNotMatch(
    texto,
    /credencial-sintetica|secretRef|referencia|sobre|cifrado|nonce|maestra|hostsPermitidos|https:/u,
  );
}

test('una capacidad inyectada no restaura gestión ni admite secretos o recibos por HTTP', async () => {
  const m = await montaje();
  try {
    const token = await m.abrir();
    for (const ruta of ['gestion', 'registrar', 'rotar', 'recibo']) {
      const respuesta = await m.router(solicitud(ruta, token, alta()));
      assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado, ruta);
      sinFiltracion(await respuesta.text());
    }
    assert.deepEqual(m.llamadas, { registrar: 0, rotar: 0, recibo: 0 });
  } finally {
    m.db.close();
  }
});

test('el cuerpo de una ruta vigente conserva 4 KiB sin la ampliación de registro retirada', async () => {
  const m = await montaje();
  try {
    const base = peticion('sesion/abrir');
    assert.equal(
      (await m.router(new Request(base, { body: `{}${' '.repeat(MAX_CUERPO_PANEL_BYTES - 2)}` }))).status,
      ESTADO_HTTP.correcto,
    );
    assert.equal(
      (await m.router(new Request(base, { body: `{}${' '.repeat(MAX_CUERPO_PANEL_BYTES)}` }))).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
    const declarada = peticion('sesion/abrir');
    declarada.headers.set('content-length', String(MAX_CUERPO_PANEL_BYTES + 1));
    assert.equal((await m.router(declarada)).status, ESTADO_HTTP.solicitudIncorrecta);
    assert.deepEqual(m.llamadas, { registrar: 0, rotar: 0, recibo: 0 });
  } finally {
    m.db.close();
  }
});

test('cuerpo bloqueado en ruta vigente vence y se cancela sin tocar el gestor retirado', async (t) => {
  const m = await montaje();
  try {
    const token = await m.abrir();
    let cancelado = false;
    const cuerpo = new ReadableStream<Uint8Array>({
      cancel() {
        cancelado = true;
      },
    });
    const inicio: RequestInit & { duplex: 'half' } = { body: cuerpo, duplex: 'half' };
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pendiente = m.router(new Request(peticion('controles/leer', token), inicio));
    await turno();
    t.mock.timers.tick(PLAZO_PANEL_MS);
    assert.equal((await pendiente).status, ESTADO_HTTP.tiempoAgotado);
    await turno();
    assert.equal(cancelado, true);
    assert.deepEqual(m.llamadas, { registrar: 0, rotar: 0, recibo: 0 });
  } finally {
    m.db.close();
  }
});
