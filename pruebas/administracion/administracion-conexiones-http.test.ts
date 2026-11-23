import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { type AdministracionMontada, montarAdministracion } from '../../src/plataforma/administracion.ts';
import { POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.example';
const LEER = 'ia/conexiones/leer';
const SELECCIONAR = 'ia/conexiones/seleccionar';
function peticion(ruta: string, token = '', cuerpo: object = {}, identidad = 'prueba'): Request {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-faro-panel': '1',
      'x-faro-sesion': token,
      'cf-access-jwt-assertion': identidad,
    },
  });
}
async function abrirSesion(panel: AdministracionMontada): Promise<string> {
  const respuesta = await panel.responder(peticion('sesion/abrir', '', { retomar: true }));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  const cuerpo: unknown = await respuesta.json();
  assert.ok(esObjeto(cuerpo) && typeof cuerpo.token === 'string');
  return cuerpo.token;
}
async function montaje(t: TestContext) {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'conexiones-http-'));
  const almacen = crearAlmacenPublicoNode({
    archivo: join(carpeta, 'estado.sqlite'),
    maxClientes: 2,
  });
  t.after(() => {
    almacen.close();
    rmSync(carpeta, { recursive: true });
  });
  let adopciones = 0;
  let validaciones = 0;
  const opciones = {
    configuracion: { origen: ORIGEN, permitirHttpLocal: false },
    almacen,
    sesion: almacen.sesion,
    inicial: POLITICA_PANEL,

    guardiaAdministrativa: async (req: Request) =>
      req.headers.get('cf-access-jwt-assertion') === 'prueba'
        ? principalDePrueba('https://fixture.cloudflareaccess.com', 'administrador')
        : null,
    conexionesIa: {
      inicial: () => {
        adopciones++;
        assert.fail('No debe invocarse una opción retirada');
      },
      validarSeleccion: () => {
        validaciones++;
        assert.fail('Las rutas retiradas no validan ni seleccionan una conexión');
      },
    },
  };
  const panel = await montarAdministracion(opciones);
  const abrir = () => abrirSesion(panel);
  return { almacen, panel, opciones, abrir, adopciones: () => adopciones, validaciones: () => validaciones };
}

test('las rutas retiradas rechazan cuerpos maliciosos sin adoptar ni cambiar una conexión', async (t) => {
  const m = await montaje(t);
  const token = await m.abrir();
  const controles = await m.almacen.leerControles();
  for (const ruta of [LEER, SELECCIONAR]) {
    for (const cuerpo of [{}, { id: '../no-admitido', clave: 'privado-sintetico', revisionEsperada: 0 }]) {
      const respuesta = await m.panel.responder(peticion(ruta, token, cuerpo));
      assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado, ruta);
      assert.equal(respuesta.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await respuesta.text(), /privado-sintetico|secretRef/);
    }
  }
  assert.equal(m.adopciones(), 0);
  assert.equal(m.validaciones(), 0);
  assert.deepEqual(await m.almacen.leerControles(), controles);
});

test('las rutas vigentes conservan Access, sesión y CSRF sin depender de un proveedor', async (t) => {
  const m = await montaje(t);
  const token = await m.abrir();
  assert.equal((await m.panel.responder(peticion('controles/leer', token, {}, ''))).status, ESTADO_HTTP.prohibido);
  assert.equal((await m.panel.responder(peticion('controles/leer'))).status, ESTADO_HTTP.prohibido);
  assert.equal((await m.panel.responder(peticion('controles/leer', token))).status, ESTADO_HTTP.correcto);
  const cruzada = peticion('controles/leer', token);
  cruzada.headers.set('origin', 'https://otro.example');
  assert.equal((await m.panel.responder(cruzada)).status, ESTADO_HTTP.prohibido);
  const nuevo = await m.abrir();
  assert.equal((await m.panel.responder(peticion('controles/leer', token))).status, ESTADO_HTTP.conflicto);
  assert.equal((await m.panel.responder(peticion('controles/leer', nuevo))).status, ESTADO_HTTP.correcto);
  assert.equal(m.adopciones(), 0);
});
