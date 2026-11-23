// Comprueba la autoridad del recorrido real y las rutas administrativas sin abrirlas.
import assert from 'node:assert/strict';

const HTTP_OK = 200;
const HTTP_NO_ENCONTRADO = 404;

export async function comprobarAutoridadReal(
  contexto,
  origen,
  estadosPanel = [HTTP_NO_ENCONTRADO, HTTP_NO_ENCONTRADO, HTTP_NO_ENCONTRADO],
) {
  const api = contexto.request;
  const modoRespuesta = await api.get(new URL('/modo-recorrido.json', origen).href);
  assert.equal(modoRespuesta.status(), HTTP_OK, 'La autoridad de modo debe responder');
  assert.match(modoRespuesta.headers()['cache-control'] ?? '', /no-store/i);
  const modo = await modoRespuesta.json();
  assert.equal(modo.version, 1);
  assert.equal(modo.modo, 'real', 'El recorrido real debe estar activo');
  assert.ok(Number.isSafeInteger(modo.revision) && modo.revision >= 0);
  for (const [indice, ruta] of [
    '/administracion',
    '/administracion/panel.js',
    '/administracion/api/controles/leer',
  ].entries()) {
    const panel = await api.get(new URL(ruta, origen).href, { maxRedirects: 0 });
    assert.equal(panel.status(), estadosPanel[indice], `La protección del panel no coincide: ${ruta}`);
  }
  const abierta = await api.get(new URL('/recorrido.html', origen).href, { maxRedirects: 0 });
  assert.equal(abierta.status(), HTTP_OK, 'El recorrido real activo debe estar disponible');
  assert.match(await abierta.text(), /id="mensaje"/u, 'Debe servirse la página real');
  assert.equal(abierta.headers()['x-faro-recorrido'], undefined, 'La página activa no es un acceso temporal');
  for (const ruta of ['/demo/recorrido.html', '/demo/panel/index.html']) {
    const retirada = await api.get(new URL(ruta, origen).href, { maxRedirects: 0 });
    assert.equal(retirada.status(), HTTP_NO_ENCONTRADO, `La ruta retirada no debe servirse: ${ruta}`);
  }
  return { revision: modo.revision };
}

export async function comprobarEntradaSinRed(contexto, pagina) {
  const entrada = pagina.locator('#menu a[href$="/recorrido.html"]:not([aria-disabled])').first();
  await entrada.waitFor({ state: 'attached' });
  await contexto.setOffline(true);
  await pagina.evaluate(() => window.dispatchEvent(new Event('online')));
  await pagina
    .locator('#menu a[aria-disabled="true"] [data-texto="comun.seccion.empezar"]')
    .waitFor({ state: 'attached' });
  await contexto.setOffline(false);
  await pagina.evaluate(() => window.dispatchEvent(new Event('online')));
  await entrada.waitFor({ state: 'attached' });
}

export async function comprobarSitioUnificado(contexto, origen) {
  const pagina = await contexto.newPage();
  const externas = [];
  pagina.on('request', (peticion) => {
    const url = new URL(peticion.url());
    if (url.origin !== origen.origin) {
      externas.push(url.origin);
    }
  });
  try {
    assert.equal((await pagina.goto(new URL('/inicio.html', origen).href))?.status(), HTTP_OK);
    await comprobarEntradaSinRed(contexto, pagina);
    await pagina.setViewportSize({ width: 320, height: 800 });
    assert.equal((await pagina.goto(new URL('/recorrido.html', origen).href))?.status(), HTTP_OK);
    await pagina.locator('#mensaje').waitFor({ state: 'attached' });
    const reflujo = await pagina.evaluate(() => ({
      ancho: document.documentElement.clientWidth,
      contenido: document.documentElement.scrollWidth,
    }));
    assert.ok(reflujo.contenido <= reflujo.ancho + 1, 'El recorrido debe adaptarse a 320 píxeles');
    assert.deepEqual(externas, [], 'La visita no pide recursos de terceros');
    return { modo: 'real', entradaActiva: true, entradaSinRedDeshabilitada: true, reflujo, terceros: 0 };
  } finally {
    await contexto.setOffline(false);
    await pagina.close();
  }
}
