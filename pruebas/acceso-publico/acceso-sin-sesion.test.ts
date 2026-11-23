import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import type { IdentificadoresLimite } from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import { responderAccesoPortal } from '../../src/plataforma/cloudflare/acceso-portal.ts';
import { paginaAcceso } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { retornoValido } from '../../src/plataforma/cloudflare/sin-sesion.ts';

// Sin sesión no hay esquema HTTP con que pedir la identificación de un formulario: un 401 sin desafío incumple
// RFC 9110 (15.5.2). Una navegación se lleva a la pantalla de acceso; lo demás recibe un 403 vacío.
const ORIGEN = 'https://ejemplo.invalid';
const VER_OTRA = 303;
const MAX_RETORNO = 512;
const NAVEGACION = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' };
const MODULO = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'script', accept: '*/*' };
const OPCIONES = {
  clave: 'clave-sintetica-de-acceso',
  firma: 'firma-sintetica-independiente-de-32-caracteres',
  claveLimite: 'limite-sintetico-independiente-de-32-caracteres',
  registrarSesion: async () => {},
  sesionActiva: async () => false,
  revocarSesion: async () => {},
  sesionesDisponibles: async () => true,
  consumirIntento: async (_huella: IdentificadoresLimite) => true,
  paginaAcceso,
  delegar: async (_p: Request) => new Response('Privado'),
};

function pedir(ruta: string, opciones: RequestInit = {}): Promise<Response> {
  return responderAccesoPortal(new Request(`${ORIGEN}${ruta}`, opciones), OPCIONES);
}
function retornoDe(respuesta: Response): string | null {
  return new URL(respuesta.headers.get('location') ?? '', ORIGEN).searchParams.get('volver');
}
async function volverDeLaPantalla(retorno: string): Promise<string | undefined> {
  const pantalla = await pedir(`/acceso-web?volver=${encodeURIComponent(retorno)}`, { headers: NAVEGACION });
  return /<form id="formulario-acceso"[^>]* data-volver="([^"]*)"/.exec(await pantalla.text())?.[1];
}

test('una navegación GET sin sesión se lleva a la pantalla de acceso con la página pedida', async () => {
  const respuesta = await pedir('/recursos/catalogo.html?seccion=cursos', { headers: NAVEGACION });
  assert.equal(respuesta.status, VER_OTRA);
  assert.equal(new URL(respuesta.headers.get('location') ?? '', ORIGEN).pathname, '/acceso-web');
  assert.equal(retornoDe(respuesta), '/recursos/catalogo.html?seccion=cursos');
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.has('www-authenticate'), false);
  assert.equal(await respuesta.text(), '');
});

test('sin metadatos de Fetch, la aceptación de HTML basta para tratarla como navegación', async () => {
  const respuesta = await pedir('/inicio.html', { headers: { accept: 'text/html,application/xhtml+xml' } });
  assert.equal(respuesta.status, VER_OTRA);
  assert.equal(retornoDe(respuesta), '/inicio.html');
});

test('HEAD de navegación sin sesión también se lleva a la pantalla de acceso', async () => {
  const respuesta = await pedir('/inicio.html', { method: 'HEAD', headers: NAVEGACION });
  assert.equal(respuesta.status, VER_OTRA);
  assert.equal(retornoDe(respuesta), '/inicio.html');
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
});

test('un módulo o un dato pedido sin sesión recibe un 403 vacío que no se guarda', async () => {
  for (const ruta of ['/scripts/inicio.js', '/api/salud', '/acceso-web/estado', '/acceso-web']) {
    const respuesta = await pedir(ruta, { headers: MODULO });
    assert.equal(respuesta.status, ESTADO_HTTP.prohibido, ruta);
    assert.equal(await respuesta.text(), '', ruta);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store', ruta);
    assert.equal(respuesta.headers.has('content-type'), false, ruta);
  }
});

test('una petición que no es GET ni HEAD sin sesión recibe un 403', async () => {
  for (const metodo of ['POST', 'PUT', 'DELETE']) {
    const respuesta = await pedir('/inicio.html', { method: metodo, headers: NAVEGACION });
    assert.equal(respuesta.status, ESTADO_HTTP.prohibido, metodo);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store', metodo);
    assert.equal(await respuesta.text(), '', metodo);
  }
});

test('la pantalla de acceso se sirve con 200, sin guardarse y con HEAD sin cuerpo', async () => {
  const respuesta = await pedir('/acceso-web', { headers: NAVEGACION });
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await respuesta.text(), /id="formulario-acceso"/);
  const cabeza = await pedir('/acceso-web', { method: 'HEAD', headers: NAVEGACION });
  assert.equal(cabeza.status, ESTADO_HTTP.correcto);
  assert.equal(await cabeza.text(), '');
});

test('la pantalla devuelve a la página pedida solo si es una ruta interna', async () => {
  assert.equal(
    await volverDeLaPantalla('/recursos/catalogo.html?seccion=cursos'),
    '/recursos/catalogo.html?seccion=cursos',
  );
  for (const ajeno of [
    '//evil.invalid/',
    'https://evil.invalid/',
    'javascript:alert(1)',
    '/\\evil.invalid',
    '\\\\evil.invalid',
    '/\t/evil.invalid',
    'inicio.html',
    '/acceso-web',
    '/acceso-web/estado',
    `/${'a'.repeat(MAX_RETORNO)}`,
  ]) {
    assert.equal(await volverDeLaPantalla(ajeno), '/inicio.html', ajeno);
  }
});

// Rutas que pasan una comprobación sobre el texto, pero que al analizarse o descodificarse empiezan por dos barras o
// llevan una barra invertida o un carácter de control.
for (const ajeno of [
  '/.//evil.example',
  '/%2e//evil.example',
  '/a/..//evil.example',
  '/%2F%2Fevil.example',
  '/\\evil.example',
  '/a%0d%0a',
]) {
  test(`el retorno ${JSON.stringify(ajeno)} se descarta: ya analizado, saldría del sitio`, async () => {
    assert.equal(retornoValido(ajeno), '/inicio.html');
    assert.equal(await volverDeLaPantalla(ajeno), '/inicio.html');
  });
}

for (const ajeno of ['/%61cceso-web', '/%61cceso-web/estado', '/x/%2e%2e%2facceso-web', '/%5C%5Cx', '///x', '/%']) {
  test(`el retorno ${JSON.stringify(ajeno)} se descarta: descodificado, lleva a la pantalla o fuera del sitio`, async () => {
    assert.equal(retornoValido(ajeno), '/inicio.html');
    assert.equal(await volverDeLaPantalla(ajeno), '/inicio.html');
  });
}

test('el retorno conserva la consulta y nunca el fragmento', async () => {
  assert.equal(retornoValido('/recursos/catalogo.html?consulta=1'), '/recursos/catalogo.html?consulta=1');
  assert.equal(await volverDeLaPantalla('/recursos/catalogo.html?consulta=1'), '/recursos/catalogo.html?consulta=1');
  assert.equal(retornoValido('/recursos/catalogo.html?consulta=1#pasar=x'), '/recursos/catalogo.html?consulta=1');
});

test('la pantalla escapa el retorno: ninguna entidad puede convertirlo en otro origen', async () => {
  assert.equal(await volverDeLaPantalla('/x?a=1&b=2'), '/x?a=1&amp;b=2');
  // &sol; es la barra: sin escapar, el atributo leído sería //evil.invalid.
  assert.equal(await volverDeLaPantalla('/&sol;evil.invalid'), '/&amp;sol;evil.invalid');
});

test('una navegación sin sesión hacia la propia pantalla no se convierte en redirección', async () => {
  const respuesta = await pedir('/acceso-web?volver=%2Finicio.html', { headers: NAVEGACION });
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
});

test('las credenciales incorrectas reciben un 403 que el guion de la pantalla trata como error', async () => {
  const respuesta = await pedir('/acceso-web/entrar', {
    method: 'POST',
    headers: {
      origin: ORIGEN,
      'cf-connecting-ip': '192.0.2.1',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ usuario: 'Faro', clave: 'incorrecta' }),
  });
  assert.equal(respuesta.status, ESTADO_HTTP.prohibido);
  assert.equal(respuesta.ok, false);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.has('www-authenticate'), false);
});

test('tras entrar, el guion vuelve a la página indicada por el servidor con el fragmento que trajo la redirección', async () => {
  const html = await (await pedir('/acceso-web', { headers: NAVEGACION })).text();
  const guion = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  assert.match(guion, /location\.assign\(formulario\.dataset\.volver\+location\.hash\)/);
  assert.doesNotMatch(guion, /location\.reload\(\)/);
});
