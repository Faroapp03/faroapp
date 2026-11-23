import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { panelInstitucional } from '../ayudas/conectividad.ts';

// La sesión del panel viaja en una cabecera propia, sin esquema HTTP registrado: sin ella no cabe un 401, que exige
// un desafío (RFC 9110, 15.5.2). La sesión inactiva es un 403 con el mismo cuerpo, y por ese cuerpo decide el panel.
type Panel = Awaited<ReturnType<typeof panelInstitucional>>;

async function abrirYCerrar(p: Panel): Promise<string> {
  const abierta: unknown = await (await p.panel.responder(p.peticion('sesion/abrir'))).json();
  assert(esObjeto(abierta) && typeof abierta.token === 'string');
  const cerrada = await p.panel.responder(p.peticion('sesion/cerrar', {}, abierta.token));
  assert.equal(cerrada.status, ESTADO_HTTP.correcto);
  return abierta.token;
}
async function esSesionInactiva(respuesta: Response, ruta: string): Promise<void> {
  assert.equal(respuesta.status, ESTADO_HTTP.prohibido, ruta);
  assert.equal(respuesta.headers.has('www-authenticate'), false, ruta);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store', ruta);
  assert.deepEqual(await respuesta.json(), { error: 'sesion_inactiva' }, ruta);
}

for (const modo of ['Node', 'binding'] as const) {
  test(`${modo}: sin sesión o con la sesión cerrada, el panel responde 403 sesion_inactiva`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const token = await abrirYCerrar(p);
      for (const ruta of ['controles/leer', 'accesos/leer', 'instituciones/leer']) {
        const cuerpo = ruta === 'accesos/leer' ? { pagina: 1 } : {};
        await esSesionInactiva(await p.panel.responder(p.peticion(ruta, cuerpo)), `${ruta} sin token`);
        await esSesionInactiva(await p.panel.responder(p.peticion(ruta, cuerpo, token)), `${ruta} cerrada`);
      }
    } finally {
      p.cerrar();
    }
  });
}
