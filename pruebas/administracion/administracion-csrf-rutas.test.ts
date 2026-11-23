import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AlmacenAdministradores } from '../../src/administracion/administradores.ts';
import { crearRouterAdministrativo, RUTAS as RUTAS_ENRUTADOR } from '../../src/administracion/http.ts';
import type { AlmacenSesionPanel } from '../../src/administracion/sesion.ts';
import type { AlmacenSesionUnica } from '../../src/administracion/sesion-unica.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';

const ORIGEN = 'https://ejemplo.invalid';
/** Sale de la tabla del enrutador: una ruta nueva entra en esta prueba sin tener que acordarse de añadirla. */
const RUTAS = [...RUTAS_ENRUTADOR.keys()];
const CABECERAS = {
  origin: ORIGEN,
  'sec-fetch-site': 'same-origin',
  'x-faro-panel': '1',
  'content-type': 'application/json',
};

async function rechazosDeOrigen(router: ReturnType<typeof crearRouterAdministrativo>, url: string, ruta: string) {
  for (const [cabecera, valor] of [
    ['origin', ''],
    ['origin', 'https://ajeno.invalid'],
    ['sec-fetch-site', ''],
    ['sec-fetch-site', 'cross-site'],
    ['sec-fetch-site', 'same-site'],
    ['sec-fetch-site', 'none'],
  ] as const) {
    const headers = new Headers(CABECERAS);
    if (valor) {
      headers.set(cabecera, valor);
    } else {
      headers.delete(cabecera);
    }
    assert.equal(
      (await router(new Request(url, { method: 'POST', headers, body: '{}' }))).status,
      ESTADO_HTTP.prohibido,
      `${ruta}: ${cabecera} ${valor || 'ausente'}`,
    );
  }
}

test('cada ruta exige POST, Origin exacto y Sec-Fetch-Site same-origin antes de autenticar', async () => {
  let autenticaciones = 0;
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen: {} as AlmacenSesionPanel & AlmacenSesionUnica & AlmacenAdministradores,
    guardiaAdministrativa: async () => {
      autenticaciones++;
      return null;
    },
  });
  for (const nueva of ['/administracion/api/sesion/bienvenida', '/administracion/api/sesion/registro']) {
    assert.ok(RUTAS.includes(nueva), nueva);
  }
  for (const ruta of RUTAS) {
    const url = `${ORIGEN}${ruta}`;
    for (const metodo of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.equal(
        (await router(new Request(url, { method: metodo, headers: CABECERAS }))).status,
        ESTADO_HTTP.metodoNoAdmitido,
        `${metodo} ${ruta}`,
      );
    }
    await rechazosDeOrigen(router, url, ruta);
    for (const tipo of ['', 'text/plain', 'application/x-www-form-urlencoded']) {
      const headers = new Headers(CABECERAS);
      if (tipo) {
        headers.set('content-type', tipo);
      } else {
        headers.delete('content-type');
      }
      const cuerpo = new TextEncoder().encode('{}');
      assert.equal(
        (await router(new Request(url, { method: 'POST', headers, body: cuerpo }))).status,
        ESTADO_HTTP.tipoNoAdmitido,
        `${ruta}: content-type ${tipo || 'ausente'}`,
      );
    }
  }
  assert.equal(autenticaciones, 0);
});
