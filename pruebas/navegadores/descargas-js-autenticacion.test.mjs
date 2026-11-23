/**
 * Las repeticiones de autenticación de descargas-js.mjs: el servidor de pruebas (fixture.ts) anota el estado de cada
 * respuesta y el JavaScript del servidor se cuenta con la regla del presupuesto (presupuesto-cifras.mjs), sobre HTTP
 * real con un Worker sintético que pide la credencial Basic como el privado.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { crearFixture } from './fixture.ts';
import { repeticionesDeAutenticacion } from './presupuesto-cifras.mjs';
import { esJavaScriptDelServidor } from './presupuesto-criterios.mjs';

const { correcto: CORRECTO, noAutenticado: DESAFIO } = ESTADO_HTTP;
/** Los GET de guiones del registro: dos del que se repite y uno del que no. */
const GUIONES = 3;
const CREDENCIAL = `Basic ${Buffer.from('persona:clave').toString('base64')}`;

/** Un Worker que responde 401 sin la credencial y el archivo con ella, como el desafío del Worker privado. */
const artefacto = {
  worker: {
    AccesoPublicoDurable: class {
      fetch() {
        return Promise.resolve(new Response(null, { status: ESTADO_HTTP.noEncontrado }));
      }
    },
    default: {
      fetch: (peticion) =>
        Promise.resolve(
          peticion.headers.get('authorization') === CREDENCIAL
            ? new Response('//', { headers: { 'content-type': 'text/javascript' } })
            : new Response(null, { status: ESTADO_HTTP.noAutenticado }),
        ),
    },
  },
};

test('el JavaScript que se vuelve a pedir tras el desafío Basic cuenta como repetición de autenticación', async () => {
  const fixture = await crearFixture(artefacto);
  try {
    const pedir = async (ruta, destino, credencial = false) => {
      const respuesta = await fetch(`${fixture.origen}${ruta}`, {
        headers: { ...IDENTIDAD_WEB, 'sec-fetch-dest': destino, ...(credencial ? { authorization: CREDENCIAL } : {}) },
      });
      await respuesta.arrayBuffer();
      return respuesta.status;
    };
    assert.equal(await pedir('/js/pagina-inicio.js', 'script'), ESTADO_HTTP.noAutenticado);
    assert.equal(await pedir('/js/pagina-inicio.js', 'script', true), ESTADO_HTTP.correcto);
    assert.equal(await pedir('/estilos/base.css', 'style'), ESTADO_HTTP.noAutenticado);
    assert.equal(await pedir('/estilos/base.css', 'style', true), ESTADO_HTTP.correcto);
    assert.equal(await pedir('/scripts/sin-repetir.js', 'script'), ESTADO_HTTP.noAutenticado);
    assert.deepEqual(
      fixture.peticiones.map((p) => p.estado),
      [DESAFIO, CORRECTO, DESAFIO, CORRECTO, DESAFIO],
      'cada petición con el estado de su respuesta',
    );
    const deJavaScript = fixture.peticiones.filter((p) => p.metodo === 'GET' && esJavaScriptDelServidor(p));
    assert.equal(deJavaScript.length, GUIONES);
    assert.equal(repeticionesDeAutenticacion(deJavaScript), 1, 'solo el 401 del guion que se vuelve a pedir');
    assert.deepEqual(fixture.errores, []);
  } finally {
    await fixture.cerrar();
  }
});
