/** Cliente del grupo de Cloudflare Access con un `fetch` falso: forma de las llamadas, plazo y fallos sin reintentos. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { crearGrupoAccess, PLAZO_LLAMADA_ACCESS_MS } from '../../src/administracion/grupo-access.ts';
import { PLAZO_PANEL_MS } from '../../src/administracion/http.ts';

const DESTINO = {
  cuenta: '0123456789abcdef0123456789abcdef',
  grupo: '01234567-89ab-cdef-0123-456789abcdef',
  token: 'token-sintetico-de-prueba-con-longitud-sobrada',
};
const GRUPO = {
  id: DESTINO.grupo,
  name: 'Faro · Administradores',
  include: [{ email: { email: 'vieja@faro.invalid' } }],
};

test('las llamadas llevan el token en Authorization, plazo propio y nunca siguen redirecciones', async () => {
  const vistas: RequestInit[] = [];
  const pedir: typeof fetch = async (_url, opciones) => {
    vistas.push(opciones ?? {});
    return Response.json({ success: true, result: GRUPO });
  };
  const grupo = crearGrupoAccess(DESTINO, pedir);
  assert.equal(await grupo.sincronizar(['ana@faro.invalid'], new AbortController().signal), 'correcta');
  assert.equal(vistas.length, 2);
  for (const opciones of vistas) {
    assert.equal(new Headers(opciones.headers).get('authorization'), `Bearer ${DESTINO.token}`);
    // workerd rechaza el modo «error» al crear la petición: se pide en «manual» y la redirección se rechaza aquí.
    assert.equal(opciones.redirect, 'manual');
    assert.ok(opciones.signal instanceof AbortSignal);
  }
  const escrito = JSON.parse(String(vistas[1]?.body));
  assert.deepEqual(escrito.include, [{ email: { email: 'ana@faro.invalid' } }]);
  assert.equal(escrito.name, GRUPO.name);
  // Tres llamadas seguidas tienen que caber en el plazo de cinco segundos de una petición del panel.
  assert.equal(PLAZO_LLAMADA_ACCESS_MS * vistas.length + PLAZO_LLAMADA_ACCESS_MS <= PLAZO_PANEL_MS, true);
});

test('red caída, redirección, respuesta sin éxito, grupo ilegible o JSON roto: «fallida», con una sola llamada cada vez', async () => {
  // Un grupo ilegible solo invalida la sincronización: la revocación no lee el grupo y su `success: true` vale.
  const casos: [() => Promise<Response>, 'correcta' | 'fallida'][] = [
    [
      async () => {
        throw new TypeError('fetch failed');
      },
      'fallida',
    ],
    [async () => new Response(null, { status: 302, headers: { location: 'https://ejemplo.invalid/' } }), 'fallida'],
    [async () => Response.json({ success: false }), 'fallida'],
    [async () => Response.json({ success: true, result: { name: '', include: [] } }), 'correcta'],
    [async () => Response.json({ success: true, result: { name: 'x', include: 'no-es-lista' } }), 'correcta'],
    [async () => new Response('{roto'), 'fallida'],
    [async () => Response.json({ success: true }, { status: 500 }), 'fallida'],
    [
      async () => {
        throw new DOMException('Plazo agotado', 'TimeoutError');
      },
      'fallida',
    ],
  ];
  for (const [responder, revocacion] of casos) {
    let llamadas = 0;
    const grupo = crearGrupoAccess(DESTINO, async () => {
      llamadas += 1;
      return responder();
    });
    assert.equal(await grupo.sincronizar([], new AbortController().signal), 'fallida');
    assert.equal(await grupo.revocar('ana@faro.invalid', new AbortController().signal), revocacion);
    assert.equal(llamadas, 2);
  }
});

test('si la petición del panel se cancela, la cancelación sigue su curso y no se confunde con un fallo', async () => {
  const control = new AbortController();
  const grupo = crearGrupoAccess(DESTINO, async () => {
    control.abort(new Error('retirada'));
    throw new DOMException('Cancelada', 'AbortError');
  });
  await assert.rejects(grupo.revocar('ana@faro.invalid', control.signal), /retirada/);
});
