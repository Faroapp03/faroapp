import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarAutoridadReal, comprobarEntradaSinRed } from './remoto-unificado.mjs';

const REVISION = 4;
const origen = new URL('https://ejemplo.invalid/');
const respuesta = (status, cuerpo, headers = {}) => ({
  status: () => status,
  headers: () => headers,
  json: async () => cuerpo,
  text: async () => cuerpo,
});
function fixture({
  modo = 'real',
  estadoModo = 200,
  panel = 404,
  real = 200,
  cuerpoReal = '<input id="mensaje">',
  marca,
  demo = 404,
} = {}) {
  const llamadas = [];
  return {
    llamadas,
    contexto: {
      request: {
        async get(url, opciones) {
          const ruta = new URL(url).pathname;
          llamadas.push([ruta, opciones]);
          if (ruta === '/modo-recorrido.json') {
            return respuesta(estadoModo, { version: 1, revision: REVISION, modo }, { 'cache-control': 'no-store' });
          }
          if (ruta.startsWith('/administracion')) {
            return respuesta(panel, '');
          }
          if (ruta === '/recorrido.html') {
            return respuesta(real, cuerpoReal, marca ? { 'x-faro-recorrido': marca } : {});
          }
          if (ruta.startsWith('/demo/')) {
            return respuesta(demo, '');
          }
          throw new Error(`Ruta inesperada: ${ruta}`);
        },
      },
    },
  };
}

test('comprueba modo real, protección del panel, página real y ausencia de ambas rutas retiradas', async () => {
  const { contexto, llamadas } = fixture();
  assert.deepEqual(await comprobarAutoridadReal(contexto, origen), { revision: REVISION });
  assert.deepEqual(
    llamadas.map(([ruta]) => ruta),
    [
      '/modo-recorrido.json',
      '/administracion',
      '/administracion/panel.js',
      '/administracion/api/controles/leer',
      '/recorrido.html',
      '/demo/recorrido.html',
      '/demo/panel/index.html',
    ],
  );
});

test('rechaza modo heredado o indisponible, panel abierto, página equivocada y rutas retiradas disponibles', async () => {
  for (const opciones of [
    { modo: 'demo' },
    { estadoModo: 503 },
    { panel: 200 },
    { real: 503 },
    { cuerpoReal: '<form id="acceso-recorrido">' },
    { marca: 'temporal' },
    { demo: 200 },
  ]) {
    await assert.rejects(comprobarAutoridadReal(fixture(opciones).contexto, origen));
  }
});

/** Simula el contrato del menú: solo aparece el enlace activo si recuperó destino y permiso. */
function paginaDelMenu({ recupera }) {
  let offline = false;
  const pasos = [];
  const contexto = {
    setOffline: async (valor) => {
      offline = valor;
      pasos.push(valor);
    },
  };
  const pagina = {
    evaluate: async () => {},
    locator(selector) {
      return {
        first() {
          return this;
        },
        async waitFor() {
          if (selector.includes(':not([aria-disabled])')) {
            assert.equal(selector, '#menu a[href$="/recorrido.html"]:not([aria-disabled])');
            if (offline || (pasos.length && !recupera)) {
              throw new Error('Enlace real deshabilitado');
            }
          } else {
            assert.ok(offline && selector.includes('aria-disabled="true"'));
          }
        },
      };
    },
  };
  return { contexto, pagina, pasos };
}

test('al recuperar la red vuelve el enlace real habilitado y con destino', async () => {
  const { contexto, pagina, pasos } = paginaDelMenu({ recupera: true });
  await comprobarEntradaSinRed(contexto, pagina);
  assert.deepEqual(pasos, [true, false]);
});

test('si el enlace sigue deshabilitado al recuperar la red el ensayo falla', async () => {
  const { contexto, pagina } = paginaDelMenu({ recupera: false });
  await assert.rejects(comprobarEntradaSinRed(contexto, pagina), /deshabilitado/u);
});
