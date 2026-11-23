import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const REDIRECCION = 302;

for (const base of BASES) {
  test(`portal privado no abre páginas cacheadas tras cierre o sin red: ${base}`, async () => {
    const sw = servicio(base);
    const copia = new Map([
      [sw.urlDe('inicio.html'), new Response('PRIVADO', { headers: { 'x-faro-portal': 'privado' } })],
      [sw.urlDe('sin-conexion.html'), new Response('COPIA')],
    ]);
    sw.guardadas.set(sw.nombreCopia, copia);
    sw.conectar();
    sw.red.respuesta = () => new Response('ACCESO', { status: ESTADO_HTTP.noAutenticado });
    assert.equal((await pedir(sw, 'inicio.html')).estado, ESTADO_HTTP.noAutenticado);
    assert.equal((await pedir(sw, 'inicio.html')).cuerpo, 'ACCESO');
    sw.red.respuesta = () => new Response('PROHIBIDO', { status: ESTADO_HTTP.prohibido });
    assert.equal((await pedir(sw, 'inicio.html')).estado, ESTADO_HTTP.prohibido);
    sw.red.respuesta = () => new Response(null, { status: REDIRECCION, headers: { location: '/acceso-web' } });
    assert.equal((await pedir(sw, 'inicio.html')).estado, REDIRECCION);
    sw.red.respuesta = () => new Response('NO DISPONIBLE', { status: ESTADO_HTTP.noDisponible });
    assert.equal((await pedir(sw, 'inicio.html')).estado, ESTADO_HTTP.noDisponible);
    sw.red.offline = true;
    const offline = await pedir(sw, 'inicio.html');
    assert.equal(offline.estado, ESTADO_HTTP.noDisponible);
    assert.notEqual(offline.cuerpo, 'PRIVADO');
    assert.equal(copia.has(sw.urlDe('inicio.html')), true);
  });
}

test('la instalación pública conserva navegación sin conexión', async () => {
  const sw = servicio(BASES[0] ?? '', { cuerpoDe: (ruta) => (ruta === 'inicio.html' ? 'PUBLICO' : ruta) });
  sw.guardadas.set(
    sw.nombreCopia,
    new Map([[sw.urlDe('inicio.html'), new Response('PUBLICO', { headers: { 'x-faro-portal': 'publico' } })]]),
  );
  const respuesta = await pedir(sw, 'inicio.html');
  assert.equal(respuesta.cuerpo, 'PUBLICO');
});

test('si falta el marcador no sirve otra página privada residual', async () => {
  const sw = servicio(BASES[0] ?? '');
  sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe('biblioteca.html'), new Response('PRIVADO')]]));
  const respuesta = await pedir(sw, 'biblioteca.html');
  assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible);
  assert.notEqual(respuesta.cuerpo, 'PRIVADO');
});

test('una copia anterior sin marcador no autoriza navegación privada offline', async () => {
  const sw = servicio(BASES[0] ?? '');
  sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe('inicio.html'), new Response('RESIDUAL')]]));
  const respuesta = await pedir(sw, 'inicio.html');
  assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible);
  assert.notEqual(respuesta.cuerpo, 'RESIDUAL');
});

test('una marca de portal desconocida no permite la copia sin red', async () => {
  const sw = servicio(BASES[0] ?? '');
  sw.guardadas.set(
    sw.nombreCopia,
    new Map([
      [
        sw.urlDe('inicio.html'),
        new Response('RESIDUAL', {
          headers: { 'x-faro-portal': 'desconocido' },
        }),
      ],
    ]),
  );
  assert.equal((await pedir(sw, 'inicio.html')).estado, ESTADO_HTTP.noDisponible);
});
