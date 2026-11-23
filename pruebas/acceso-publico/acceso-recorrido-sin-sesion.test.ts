import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { responderAccesoRecorrido } from '../../src/plataforma/cloudflare/acceso-recorrido.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import type { VarianteRecorrido } from '../../src/plataforma/variantes-recorrido.ts';

/** La primera extensión del registro hace de variante inactiva; sin extensiones no hay otra variante que proteger. */
const [EXTENSION] = EXTENSIONES;
const SIN_EXTENSIONES = EXTENSION === undefined && 'Sin extensiones instaladas no hay otra variante que proteger.';
const VARIANTE: VarianteRecorrido = EXTENSION?.id ?? 'real';
const ENTRADA = `/${EXTENSION?.entrada ?? 'recorrido.html'}`;

// La variante inactiva del recorrido pide su contraseña con un formulario propio, en la misma dirección: sin esquema
// HTTP para ese formulario no cabe un 401 (RFC 9110, 15.5.2). La navegación recibe el formulario; lo demás, un 403.
const ORIGEN = 'https://ejemplo.invalid';
const NAVEGACION = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' };
const OPCIONES = {
  variante: VARIANTE,
  clave: 'clave-sintetica-para-el-recorrido',
  firma: 'firma-sintetica-independiente-de-32-caracteres',
  leerModo: async () => ({ version: 1 as const, revision: 3, modo: 'real' as const }),
  consumirIntento: async () => true,
  delegar: async () => new Response('contenido privado'),
};
function pedir(opciones: RequestInit = {}): Promise<Response> {
  return responderAccesoRecorrido(new Request(`${ORIGEN}${ENTRADA}`, opciones), OPCIONES);
}

test('la navegación sin sesión del recorrido recibe su formulario con 200 y sin guardarse', {
  skip: SIN_EXTENSIONES,
}, async () => {
  const respuesta = await pedir({ headers: NAVEGACION });
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.has('www-authenticate'), false);
  assert.match(await respuesta.text(), /<form id="acceso-recorrido"/);
  const cabeza = await pedir({ method: 'HEAD', headers: NAVEGACION });
  assert.equal(cabeza.status, ESTADO_HTTP.correcto);
  assert.equal(await cabeza.text(), '');
});

test('una petición del recorrido sin sesión que no es navegación recibe un 403 vacío', {
  skip: SIN_EXTENSIONES,
}, async () => {
  const respuesta = await pedir({ headers: { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', accept: '*/*' } });
  assert.equal(respuesta.status, ESTADO_HTTP.prohibido);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  // Es del acceso al recorrido, no del portal: con su marca, la consulta del service worker en cada visita sabe que el
  // recorrido está protegido (src/service-worker/copia.js, siEstaProtegido).
  assert.equal(respuesta.headers.get('x-faro-recorrido'), 'acceso');
  assert.equal(respuesta.headers.has('x-faro-portal'), false);
  assert.equal(await respuesta.text(), '');
});

test('la contraseña incorrecta del recorrido recibe un 403 con el formulario', { skip: SIN_EXTENSIONES }, async () => {
  const respuesta = await pedir({
    method: 'POST',
    headers: { origin: ORIGEN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ clave: 'incorrecta' }),
  });
  assert.equal(respuesta.status, ESTADO_HTTP.prohibido);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.has('www-authenticate'), false);
  assert.match(await respuesta.text(), /<form id="acceso-recorrido"/);
});
