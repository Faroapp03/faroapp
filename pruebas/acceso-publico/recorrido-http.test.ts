import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AlmacenSesionRecorridoSqlite } from '../../src/plataforma/acceso-publico/sesion-recorrido-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { responderModoRecorrido } from '../../src/plataforma/cloudflare/modo-publico.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { escribirSinAlarma } from '../ayudas/alarma-durable.ts';
import { motorPanel, OPCIONES_PANEL, POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

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
test('panel exige sesión y permite lectura, CAS y conflicto de selector', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = motorPanel(db);
    new AlmacenPublicoSqlite(sql, OPCIONES_PANEL);
    const almacen = new AlmacenSesionRecorridoSqlite(sql, { ahora: OPCIONES_PANEL.ahora, cubrir: escribirSinAlarma });
    await almacen.prepararPanel(POLITICA_PANEL);
    const router = crearRouterAdministrativo({
      origen: ORIGEN,
      almacen,
      recorrido: almacen,
      guardiaAdministrativa: async (r) =>
        r.headers.get('cf-access-jwt-assertion') === 'identidad-ficticia'
          ? principalDePrueba('https://fixture.cloudflareaccess.com', 'administrador-ficticio')
          : null,
    });
    assert.equal((await router(peticion('recorrido/leer'))).status, ESTADO_HTTP.prohibido);
    const abierta = await router(peticion('sesion/abrir'));
    const { token } = (await abierta.json()) as { token: string };
    assert.equal((await router(peticion('recorrido/leer', token))).status, ESTADO_HTTP.correcto);
    assert.equal(
      (await router(peticion('recorrido/cambiar', token, { revisionEsperada: 0, modo: 'real' }))).status,
      ESTADO_HTTP.correcto,
    );
    // Con la revisión ya superada, cualquier modo instalado choca: la primera extensión o, sin ellas, el real.
    const otro = EXTENSIONES[0]?.id ?? 'real';
    assert.equal(
      (await router(peticion('recorrido/cambiar', token, { revisionEsperada: 0, modo: otro }))).status,
      ESTADO_HTTP.conflicto,
    );
    assert.equal(
      (await router(peticion('recorrido/cambiar', token, { revisionEsperada: 1, modo: 'otro' }))).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
    assert.equal((await almacen.leerRecorrido()).modo, 'real');
  } finally {
    db.close();
  }
});
test('lectura pública falla cerrada sin autoridad y no permite métodos de escritura', async () => {
  assert.equal(
    (await responderModoRecorrido(new Request('https://ejemplo.invalid/modo-recorrido.json'), undefined)).status,
    ESTADO_HTTP.noDisponible,
  );
  assert.equal(
    (
      await responderModoRecorrido(
        new Request('https://ejemplo.invalid/modo-recorrido.json', { method: 'POST' }),
        undefined,
      )
    ).status,
    ESTADO_HTTP.metodoNoAdmitido,
  );
});
