import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, type PestanaDePrueba, pedir, pestanaEn, servicio } from './ayudas.ts';

const BASE = BASES[0] ?? '';
const PUBLICO = 'PUBLICO';
const SIN_CONEXION = 'SIN CONEXION';
/** Más que el plazo de la sonda (PLAZO_DE_LA_SONDA_MS, modo.js). */
const DESPUES_DEL_PLAZO_MS = 1300;
/** La espera máxima de la pestaña que navega (1 s, ESPERAS_DE_LA_PESTANA en modo.js) y un margen. */
const MARGEN_MS = 1500;

const cuerpoDe = (ruta: string) => (ruta === 'inicio.html' ? PUBLICO : SIN_CONEXION);
const inicioPublico = () =>
  new Response(PUBLICO, { headers: { 'content-type': 'text/html', 'x-faro-portal': 'publico' } });

/** Una instalación pública con su copia, con red; `copias` compartidas simulan el reinicio del service worker. */
function instalacionPublica(sw = servicio(BASE, { cuerpoDe })) {
  if (!sw.guardadas.has(sw.nombreCopia)) {
    sw.guardadas.set(
      sw.nombreCopia,
      new Map([
        [sw.urlDe('inicio.html'), inicioPublico()],
        [sw.urlDe('sin-conexion.html'), new Response(SIN_CONEXION, { headers: { 'content-type': 'text/html' } })],
      ]),
    );
  }
  sw.conectar();
  return sw;
}

const marcaDe = async (sw: ReturnType<typeof servicio>) =>
  sw.guardadas.get(`faro-modo:${BASE}`)?.get(sw.urlDe('modo-de-la-instalacion'))?.clone().text();

/** El 401 del portal de Faro, con su cabecera (solo un rechazo de Faro demuestra que es privada: evidenciaDe). */
const rechazoDelPortal = () =>
  new Response('ACCESO', { status: ESTADO_HTTP.noAutenticado, headers: { 'x-faro-portal': 'privado' } });

const tarde = (respuesta: () => Response) =>
  new Promise<Response>((resolver) => setTimeout(() => resolver(respuesta()), DESPUES_DEL_PLAZO_MS));

test('la primera navegación con red tras pasar a privada no sirve la copia pública: va al portal', async () => {
  const sw = instalacionPublica();
  sw.red.respuesta = () => rechazoDelPortal();
  const respuesta = await pedir(sw, 'inicio.html');
  assert.equal(respuesta.cuerpo, 'ACCESO');
  assert.equal(respuesta.estado, ESTADO_HTTP.noAutenticado);
  assert.equal(await marcaDe(sw), 'privada');
});

test('un 2xx con x-faro-portal: privado también es evidencia de privada', async () => {
  const sw = instalacionPublica();
  sw.red.respuesta = () => new Response('PORTAL', { headers: { 'x-faro-portal': 'privado' } });
  assert.equal((await pedir(sw, 'inicio.html')).cuerpo, 'PORTAL');
  assert.equal(await marcaDe(sw), 'privada');
});

for (const [caso, respuesta] of [
  ['5xx', () => new Response('CAIDO', { status: ESTADO_HTTP.noDisponible })],
  ['404', () => new Response('NO', { status: 404 })],
  ['redirección de un alias en una navegación', () => new Response(null, { status: 302, headers: { location: '/' } })],
] as const) {
  test(`un ${caso} no demuestra que sea privada: se sirve la copia y no cambia la marca`, async () => {
    const sw = instalacionPublica();
    sw.red.respuesta = respuesta;
    assert.equal((await pedir(sw, 'inicio.html')).cuerpo, PUBLICO);
    assert.notEqual(await marcaDe(sw), 'privada');
  });
}

test('con la red caída se sirve la copia pública y no se marca privada', async () => {
  const sw = instalacionPublica();
  sw.red.offline = true;
  assert.equal((await pedir(sw, 'inicio.html')).cuerpo, PUBLICO);
  assert.equal(await marcaDe(sw), undefined);
});

test('con el plazo vencido y sin evidencia, se sirve la copia y no se marca privada', async () => {
  const sw = instalacionPublica();
  sw.red.respuesta = () => tarde(() => new Response('CAIDO', { status: ESTADO_HTTP.noDisponible }));
  assert.equal((await pedir(sw, 'inicio.html')).cuerpo, PUBLICO);
  assert.notEqual(await marcaDe(sw), 'privada');
});

test('una sonda tardía marca privada y lleva al portal a las pestañas abiertas', async () => {
  const sw = instalacionPublica();
  const otra = pestanaEn('B', sw.urlDe('biblioteca.html'));
  (sw.evaluar('self.clients.pestanas') as PestanaDePrueba[]).push(otra);
  sw.red.respuesta = () => tarde(() => rechazoDelPortal());
  assert.equal((await pedir(sw, 'inicio.html')).cuerpo, PUBLICO);
  assert.equal(await marcaDe(sw), 'privada');
  assert.deepEqual(otra.navegaciones, [sw.urlDe('biblioteca.html')]);
  sw.red.respuesta = () => rechazoDelPortal();
  assert.equal((await pedir(sw, 'inicio.html')).cuerpo, 'ACCESO');
});

test('la marca privada sobrevive al reinicio del service worker: sin red, acceso-sin-conexion', async () => {
  const primero = instalacionPublica();
  primero.red.respuesta = () => rechazoDelPortal();
  await pedir(primero, 'inicio.html');
  const reiniciado = servicio(BASE, { cuerpoDe }, primero.copias);
  const sinRed = await pedir(reiniciado, 'inicio.html');
  assert.equal(sinRed.estado, ESTADO_HTTP.noDisponible);
  assert.notEqual(sinRed.cuerpo, PUBLICO);
  assert.match(String(sinRed.cuerpo), /Para comprobar tu acceso hace falta conexión/);
});

test('vuelve a pública solo con la evidencia de pública', async () => {
  const sw = instalacionPublica();
  sw.red.respuesta = () => rechazoDelPortal();
  await pedir(sw, 'inicio.html');
  sw.red.respuesta = () => new Response('CAIDO', { status: ESTADO_HTTP.noDisponible });
  await pedir(sw, 'inicio.html');
  assert.equal(await marcaDe(sw), 'privada');
  sw.red.respuesta = inicioPublico;
  await pedir(sw, 'inicio.html');
  assert.equal(await marcaDe(sw), 'publica');
  assert.equal((await pedir(sw, 'inicio.html')).cuerpo, PUBLICO);
});

test('M-2: sin inicio.html en la copia, el modo sale de la marca e inicio.html vuelve con su huella', async () => {
  const sw = instalacionPublica();
  sw.red.respuesta = inicioPublico;
  await pedir(sw, 'sin-conexion.html');
  assert.equal(await marcaDe(sw), 'publica');
  const copia = sw.guardadas.get(sw.nombreCopia);
  copia?.delete(sw.urlDe('inicio.html'));
  await pedir(sw, 'sin-conexion.html');
  assert.equal(await copia?.get(sw.urlDe('inicio.html'))?.clone().text(), PUBLICO);
  copia?.delete(sw.urlDe('inicio.html'));
  sw.red.offline = true;
  const sinRed = await pedir(sw, 'inicio.html');
  assert.equal(sinRed.cuerpo, SIN_CONEXION);
});

/** Dos pestañas: A, la que navega a inicio.html (su resultingClientId), y B, otra ya abierta. */
function conDosPestanas(sw: ReturnType<typeof servicio>) {
  const a = pestanaEn('A', sw.urlDe('inicio.html'));
  const b = pestanaEn('B', sw.urlDe('biblioteca.html'));
  (sw.evaluar('self.clients.pestanas') as PestanaDePrueba[]).push(a, b);
  return { a, b };
}

test('con la evidencia tardía, también la pestaña que navegó deja la copia pública y va al portal', async () => {
  const sw = instalacionPublica();
  const { a, b } = conDosPestanas(sw);
  sw.red.respuesta = () => tarde(() => rechazoDelPortal());
  const navegacion = { method: 'GET', mode: 'navigate' };
  assert.equal((await pedir(sw, 'inicio.html', navegacion, { resultingClientId: 'A' })).cuerpo, PUBLICO);
  assert.deepEqual(a.navegaciones, [sw.urlDe('inicio.html')]);
  assert.deepEqual(b.navegaciones, [sw.urlDe('biblioteca.html')]);
});

test('con la evidencia en plazo, la pestaña que navega no se interrumpe y las demás van al portal', async () => {
  const sw = instalacionPublica();
  const { a, b } = conDosPestanas(sw);
  sw.red.respuesta = () => rechazoDelPortal();
  const navegacion = { method: 'GET', mode: 'navigate' };
  assert.equal((await pedir(sw, 'inicio.html', navegacion, { resultingClientId: 'A' })).cuerpo, 'ACCESO');
  assert.deepEqual(a.navegaciones, []);
  assert.deepEqual(b.navegaciones, [sw.urlDe('biblioteca.html')]);
});

test('al instalar, inicio.html con x-faro-portal: publico deja la marca pública antes de navegar (M-2)', async () => {
  const sw = servicio(BASE, { cuerpoDe });
  sw.conectar();
  sw.red.respuesta = (url) =>
    url.endsWith('inicio.html')
      ? inicioPublico()
      : new Response(SIN_CONEXION, { headers: { 'content-type': 'text/html' } });
  await sw.instalar();
  assert.equal(await marcaDe(sw), 'publica');
  sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe('inicio.html'));
  sw.red.offline = true;
  assert.equal((await pedir(sw, 'inicio.html')).cuerpo, SIN_CONEXION);
});

test('con la evidencia tardía, la pestaña que navegó vuelve a pedir su página aunque no aparezca su id', async () => {
  const sw = instalacionPublica();
  const { a } = conDosPestanas(sw);
  sw.red.respuesta = () => tarde(() => rechazoDelPortal());
  const navegacion = { method: 'GET', mode: 'navigate' };
  const inicio = performance.now();
  await pedir(sw, 'inicio.html', navegacion, { resultingClientId: 'otro-id' });
  assert.deepEqual(a.navegaciones, [sw.urlDe('inicio.html')]);
  assert.ok(performance.now() - inicio < DESPUES_DEL_PLAZO_MS + MARGEN_MS, 'sin agotar la espera de la pestaña');
});
