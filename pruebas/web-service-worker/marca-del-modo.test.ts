// La marca del modo (modo.js): solo un rechazo propio de Faro demuestra que la instalación es privada; la marca se lee
// y se escribe en su turno, y cada paso a privada lleva las pestañas al portal una sola vez; si no se puede escribir,
// la navegación sigue con lo observado; la sonda en segundo plano tiene plazo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, type PestanaDePrueba, pedir, pestanaEn, servicio } from './ayudas.ts';

const BASE = BASES[0] ?? '';
const PUBLICO = 'PUBLICO';
const HTML = { 'content-type': 'text/html' };

/** Una instalación pública con su copia, con red. */
function instalacionPublica() {
  const sw = servicio(BASE, { cuerpoDe: (ruta) => (ruta === 'inicio.html' ? PUBLICO : 'SIN CONEXION') });
  sw.guardadas.set(
    sw.nombreCopia,
    new Map([[sw.urlDe('inicio.html'), new Response(PUBLICO, { headers: { ...HTML, 'x-faro-portal': 'publico' } })]]),
  );
  sw.conectar();
  return sw;
}

const marcaDe = async (sw: ReturnType<typeof servicio>) =>
  sw.guardadas.get(`faro-modo:${BASE}`)?.get(sw.urlDe('modo-de-la-instalacion'))?.clone().text();

const PRIVADO = { 'x-faro-portal': 'privado' };
const BASIC = { 'www-authenticate': 'Basic realm="Acceso privado", charset="UTF-8"' };

for (const [caso, estado, cabeceras] of [
  ['un 403 sin la cabecera de Faro (un WAF, un bloqueo geográfico)', ESTADO_HTTP.prohibido, {}],
  ['un 401 sin la cabecera de Faro', ESTADO_HTTP.noAutenticado, {}],
  ['un 401 con el desafío de Basic de otro (un proxy)', ESTADO_HTTP.noAutenticado, BASIC],
] as const) {
  test(`${caso} no demuestra que sea privada: se sirve la copia y no cambia la marca`, async () => {
    const sw = instalacionPublica();
    sw.red.respuesta = () => new Response('BLOQUEO', { status: estado, headers: cabeceras });
    assert.equal((await pedir(sw, 'inicio.html')).cuerpo, PUBLICO);
    assert.notEqual(await marcaDe(sw), 'privada');
  });
}

for (const [caso, estado, cabeceras] of [
  ['un 403 de Faro (x-faro-portal: privado)', ESTADO_HTTP.prohibido, PRIVADO],
  ['un 401 de Faro (x-faro-portal: privado)', ESTADO_HTTP.noAutenticado, PRIVADO],
  ['el 401 de la puerta de Basic de Faro', ESTADO_HTTP.noAutenticado, { ...BASIC, ...PRIVADO }],
] as const) {
  test(`${caso} demuestra que es privada`, async () => {
    const sw = instalacionPublica();
    sw.red.respuesta = () => new Response('ACCESO', { status: estado, headers: cabeceras });
    assert.equal((await pedir(sw, 'inicio.html')).cuerpo, 'ACCESO');
    assert.equal(await marcaDe(sw), 'privada');
  });
}

test('N navegaciones a la vez que ven el paso a privada llevan cada pestaña al portal una sola vez', async () => {
  const sw = instalacionPublica();
  const NAVEGACIONES = 5;
  const pestanas = Array.from({ length: NAVEGACIONES }, (_, i) => pestanaEn(`p${i}`, sw.urlDe('inicio.html')));
  (sw.evaluar('self.clients.pestanas') as PestanaDePrueba[]).push(...pestanas);
  sw.red.respuesta = () => new Response('ACCESO', { status: ESTADO_HTTP.prohibido, headers: PRIVADO });
  const respuestas = await Promise.all(
    pestanas.map((pestana) =>
      pedir(sw, 'inicio.html', undefined, { clientId: pestana.id, resultingClientId: pestana.id }),
    ),
  );
  assert.ok(respuestas.every((respuesta) => respuesta.cuerpo === 'ACCESO'));
  assert.equal(await marcaDe(sw), 'privada');
  for (const pestana of pestanas) {
    assert.ok(pestana.navegaciones.length <= 1, `${pestana.id}: ${pestana.navegaciones.length} recargas`);
  }
});

test('si no se puede escribir la marca, la navegación sigue con lo observado y no recarga las pestañas', async () => {
  const sw = instalacionPublica();
  const otra = pestanaEn('otra', sw.urlDe('inicio.html'));
  (sw.evaluar('self.clients.pestanas') as PestanaDePrueba[]).push(otra);
  sw.copias.antesDeGuardar = async (nombre) => {
    if (nombre.startsWith('faro-modo:')) {
      throw new DOMException('Sin espacio', 'QuotaExceededError');
    }
  };
  sw.red.respuesta = () => new Response('ACCESO', { status: ESTADO_HTTP.prohibido, headers: PRIVADO });
  const respuesta = await pedir(sw, 'inicio.html').catch((error: Error) => ({ cuerpo: `rechazada: ${error.name}` }));
  assert.equal(respuesta.cuerpo, 'ACCESO', 'la evidencia observada lleva esta navegación al portal');
  assert.deepEqual(otra.navegaciones, [], 'sin marca guardada no hay paso a privada que propagar');
  sw.copias.antesDeGuardar = async () => {};
  sw.red.respuesta = () => new Response(PUBLICO, { headers: { ...HTML, 'x-faro-portal': 'publico' } });
  assert.equal((await pedir(sw, 'inicio.html')).cuerpo, PUBLICO);
});

test('la sonda en segundo plano tiene plazo (PLAZO_DE_LA_CONSULTA_MS): una red sin salida no la deja colgada', async () => {
  const sw = instalacionPublica();
  const plazo = Number(sw.evaluar("typeof PLAZO_DE_LA_CONSULTA_MS === 'number' ? PLAZO_DE_LA_CONSULTA_MS : NaN"));
  const plazos: number[] = [];
  const BREVE_MS = 5;
  (
    sw.evaluar(`(registrar) => {
    const real = AbortSignal;
    globalThis.AbortSignal = { timeout: (ms) => (registrar(ms), real.timeout(ms === ${plazo} ? ${BREVE_MS} : ms)) };
  }`) as (registrar: (ms: number) => void) => void
  )((ms) => plazos.push(ms));
  sw.red.respuesta = (_url, opciones) =>
    new Promise((_resolver, rechazar) => {
      opciones?.signal?.addEventListener('abort', () => rechazar(opciones.signal?.reason));
    });
  const PARA_LA_PRUEBA_MS = 3000;
  const acabada = await Promise.race([
    pedir(sw, 'inicio.html').then((respuesta) => respuesta.cuerpo),
    new Promise((resolver) => setTimeout(resolver, PARA_LA_PRUEBA_MS, 'colgada')),
  ]);
  assert.equal(acabada, PUBLICO, 'la navegación y su sonda en segundo plano terminan');
  assert.ok(plazos.includes(plazo));
  assert.ok(plazo > Number(sw.evaluar('PLAZO_DE_LA_SONDA_MS')), 'más largo que lo que espera la navegación');
  assert.equal(await marcaDe(sw), undefined, 'un plazo vencido no cambia la marca');
});
