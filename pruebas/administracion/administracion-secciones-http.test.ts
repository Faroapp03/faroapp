import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import type { AlmacenSeccionesPanel } from '../../src/administracion/secciones-almacen.ts';
import { leerDocumentoSecciones, politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { accesoPanel, motorPanel, OPCIONES_PANEL, POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const VERSION_SECCIONES = 3;

const ORIGEN = 'https://panel.example';
function peticion(ruta: string, token = '', cuerpo: unknown = {}) {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'x-faro-panel': '1',
      'content-type': 'application/json',
      'cf-access-jwt-assertion': 'identidad-ficticia',
      'x-faro-sesion': token,
    },
  });
}
async function montaje() {
  const db = new DatabaseSync(':memory:');
  const sql = motorPanel(db);
  new AlmacenPublicoSqlite(sql, OPCIONES_PANEL);
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: OPCIONES_PANEL.ahora });
  await almacen.prepararPanel(POLITICA_PANEL);
  const routerCon = (secciones?: AlmacenSeccionesPanel) =>
    crearRouterAdministrativo({
      origen: ORIGEN,
      almacen,
      guardiaAdministrativa: async (req) =>
        req.headers.get('cf-access-jwt-assertion') === 'identidad-ficticia'
          ? principalDePrueba('https://fixture.cloudflareaccess.com', 'administrador-ficticio')
          : null,
      ...(secciones ? { secciones } : {}),
    });
  const router = routerCon(almacen);
  const abrir = async () => {
    const r = await router(peticion('sesion/abrir', '', { retomar: true }));
    const cuerpo = (await r.json()) as { token: string };
    assert.equal(r.status, ESTADO_HTTP.correcto);
    assert.equal(typeof cuerpo.token, 'string');
    return cuerpo.token;
  };
  return { db, almacen, router, routerCon, abrir };
}
const cambio = (revisionEsperada = 0) => ({
  revisionEsperada,
  secciones: { ...politicaSeccionesInicial(), biblioteca: false },
});

test('secciones por HTTP comparte CAS con conectividad y conserva todos sus campos', async () => {
  const m = await montaje();
  try {
    const token = await m.abrir();
    const inicial = await m.almacen.leerControlesDeSesion(accesoPanel('a'));
    assert.equal(inicial.estado, 'sustituida');
    const lectura = await m.router(peticion('secciones/leer', token));
    assert.equal(lectura.status, ESTADO_HTTP.correcto);
    assert.equal(lectura.headers.get('cache-control'), 'no-store');
    const antes = (await lectura.json()) as { secciones: unknown };
    assert.deepEqual(leerDocumentoSecciones(antes.secciones), {
      version: VERSION_SECCIONES,
      revision: 0,
      secciones: politicaSeccionesInicial(),
    });
    const guardado = await m.router(peticion('secciones/cambiar', token, cambio()));
    assert.equal(guardado.status, ESTADO_HTTP.correcto);
    const despues = (await guardado.json()) as { secciones: unknown };
    assert.equal(leerDocumentoSecciones(despues.secciones).secciones.biblioteca, false);
    const controles = await m.router(peticion('controles/leer', token));
    const estado = (await controles.json()) as { controles: unknown };
    assert.deepEqual(estado.controles, { ...POLITICA_PANEL, revision: 1 });
    const antiguo = await m.router(
      peticion('controles/cambiar', token, { revisionEsperada: 0, politica: POLITICA_PANEL }),
    );
    assert.equal(antiguo.status, ESTADO_HTTP.conflicto);
    const nuevo = await m.router(
      peticion('controles/cambiar', token, { revisionEsperada: 1, politica: { ...POLITICA_PANEL, mcp: true } }),
    );
    assert.equal(nuevo.status, ESTADO_HTTP.correcto);
    assert.deepEqual(await m.almacen.leerSecciones(), {
      version: VERSION_SECCIONES,
      revision: 2,
      secciones: cambio().secciones,
    });
    assert.equal((await m.router(peticion('secciones/cambiar', token, cambio(1)))).status, ESTADO_HTTP.conflicto);
    assert.equal((await m.almacen.leerSecciones())?.revision, 2);
  } finally {
    m.db.close();
  }
});

test('secciones exige Access, origen, sesión y forma cerrada antes de escribir', async () => {
  const m = await montaje();
  try {
    const token = await m.abrir();
    for (const cabecera of ['origin', 'x-faro-panel', 'cf-access-jwt-assertion', 'x-faro-sesion']) {
      const req = peticion('secciones/cambiar', token, cambio());
      req.headers.delete(cabecera);
      const estado = (await m.router(req)).status;
      assert.ok(estado === ESTADO_HTTP.noAutenticado || estado === ESTADO_HTTP.prohibido, cabecera);
    }
    for (const cuerpo of [
      null,
      [],
      { ...cambio(), otro: true },
      { ...cambio(), revisionEsperada: -1 },
      { ...cambio(), revisionEsperada: 1 / 2 },
      { ...cambio(), secciones: { biblioteca: false } },
      { ...cambio(), secciones: { ...cambio().secciones, biblioteca: 0 } },
      { ...cambio(), secciones: { ...cambio().secciones, inicio: false } },
    ]) {
      assert.equal(
        (await m.router(peticion('secciones/cambiar', token, cuerpo))).status,
        ESTADO_HTTP.solicitudIncorrecta,
      );
    }
    assert.equal((await m.router(peticion('secciones/leer', token, cambio()))).status, ESTADO_HTTP.solicitudIncorrecta);
    const metodo = new Request(peticion('secciones/leer', token), { method: 'PUT' });
    assert.equal((await m.router(metodo)).status, ESTADO_HTTP.metodoNoAdmitido);
    assert.equal((await m.almacen.leerSecciones())?.revision, 0);
  } finally {
    m.db.close();
  }
});

test('capacidad ausente no inventa política y una sesión sustituida no puede modificarla', async () => {
  const m = await montaje();
  try {
    const token = await m.abrir();
    assert.equal((await m.routerCon()(peticion('secciones/leer', token))).status, ESTADO_HTTP.noDisponible);
    await m.abrir();
    const r = await m.router(peticion('secciones/cambiar', token, cambio()));
    assert.equal(r.status, ESTADO_HTTP.conflicto);
    assert.deepEqual(await r.json(), { error: 'sesion_sustituida' });
    assert.equal((await m.almacen.leerSecciones())?.revision, 0);
  } finally {
    m.db.close();
  }
});

test('una sustitución posterior al commit no entrega el resultado a la sesión anterior', async () => {
  const m = await montaje();
  try {
    const token = await m.abrir();
    const capacidad: AlmacenSeccionesPanel = {
      leerSecciones: () => m.almacen.leerSecciones(),
      leerSeccionesDeSesion: (acceso) => m.almacen.leerSeccionesDeSesion(acceso),
      cambiarSeccionesDeSesion: async (...args) => {
        const resultado = await m.almacen.cambiarSeccionesDeSesion(...args);
        // La misma persona abre desde otra página y retoma: la sesión del cambio queda sustituida.
        await m.abrir();
        return resultado;
      },
    };
    const r = await m.routerCon(capacidad)(peticion('secciones/cambiar', token, cambio()));
    assert.equal(r.status, ESTADO_HTTP.conflicto);
    assert.deepEqual(await r.json(), { error: 'sesion_sustituida' });
    assert.deepEqual(await m.almacen.leerSecciones(), {
      version: VERSION_SECCIONES,
      revision: 1,
      secciones: cambio().secciones,
    });
  } finally {
    m.db.close();
  }
});
