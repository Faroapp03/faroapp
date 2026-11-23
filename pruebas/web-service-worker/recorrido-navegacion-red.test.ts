import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { paginasDelServicio } from '../../herramientas/web/servicio/politica-del-servicio.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const ENTRADAS = ['recorrido.html', 'recorrido', '%72ecorrido.html'];
/** El aviso aprobado de la página detrás del portal cuando hace falta conexión para comprobar el acceso. */
const AVISOS_DE_ACCESO = [
  ['es', 'Para comprobar tu acceso hace falta conexión. Vuelve a intentarlo cuando tengas conexión.'],
  ['ca', 'Per comprovar el teu accés cal connexió. Torna-ho a provar quan tinguis connexió.'],
] as const;
const ESTADOS = [
  ESTADO_HTTP.correcto,
  ESTADO_HTTP.encontradoEnOtraDireccion,
  ESTADO_HTTP.noAutenticado,
  ESTADO_HTTP.prohibido,
  ESTADO_HTTP.noDisponible,
];

for (const base of BASES) {
  test(`navegaciones del recorrido pasan por red sin consultar copia: ${base}`, async () => {
    const sw = servicio(base, { politica: textoPoliticaCache() });
    sw.guardadas.set(sw.nombreCopia, new Map(ENTRADAS.map((ruta) => [sw.urlDe(ruta), new Response('ANTIGUO')])));
    sw.conectar();
    for (const estado of ESTADOS) {
      sw.red.respuesta = () => new Response(`RED ${estado}`, { status: estado });
      for (const ruta of ENTRADAS) {
        const respuesta = await pedir(sw, ruta);
        assert.equal(respuesta.interceptada, true, ruta);
        assert.equal(respuesta.estado, estado, ruta);
        assert.equal(respuesta.cuerpo, `RED ${estado}`, ruta);
        assert.equal(respuesta.aperturas, 0, ruta);
      }
    }
  });
  for (const portal of ['privado', null]) {
    test(`sin red, detrás de un portal, la entrada da el 503 del acceso y nunca la copia (${portal}): ${base}`, async () => {
      const sw = servicio(base, { politica: textoPoliticaCache() });
      const inicio = new Response('INICIO', portal ? { headers: { 'x-faro-portal': portal } } : undefined);
      sw.guardadas.set(
        sw.nombreCopia,
        new Map([
          [sw.urlDe('inicio.html'), inicio],
          ...ENTRADAS.map((ruta) => [sw.urlDe(ruta), new Response('ANTIGUO')] as const),
        ]),
      );
      const esperada = paginasDelServicio()['acceso-sin-conexion']?.replaceAll('{{inicio}}', sw.urlDe('inicio.html'));
      for (const [idioma, aviso] of AVISOS_DE_ACCESO) {
        assert.ok(esperada?.includes(`<section lang="${idioma}">`), `la página lleva su parte en ${idioma}`);
        assert.ok(esperada?.includes(`<p>${aviso}</p>`), `detrás del portal, el aviso de acceso en ${idioma}`);
      }
      for (const ruta of ENTRADAS) {
        const respuesta = await pedir(sw, ruta);
        assert.equal(respuesta.interceptada, true, ruta);
        assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible, ruta);
        assert.equal(respuesta.cuerpo, esperada, ruta);
      }
    });
  }
  test(`un fallo que no es de la red no se hace pasar por falta de conexión: ${base}`, async () => {
    const sw = servicio(base, { politica: textoPoliticaCache() });
    sw.conectar();
    sw.red.respuesta = () => {
      throw new RangeError('fallo del programa');
    };
    await assert.rejects(pedir(sw, 'recorrido.html'), RangeError);
  });
  test(`otros métodos y recursos permanecen fuera de este tratamiento: ${base}`, async () => {
    const sw = servicio(base, { politica: textoPoliticaCache() });
    for (const [ruta, opciones] of [
      ['recorrido.html', { method: 'POST', mode: 'navigate' }],
      ['modo-recorrido.json', { method: 'GET', mode: 'cors' }],
    ] as const) {
      assert.equal((await pedir(sw, ruta, opciones)).interceptada, false, ruta);
    }
  });
}

test('se conserva la respuesta original, incluida la cabecera de redirección', async () => {
  const sw = servicio(BASES[0] ?? 'https://ejemplo.invalid/', { politica: textoPoliticaCache() });
  sw.conectar();
  const original = new Response(null, {
    status: ESTADO_HTTP.encontradoEnOtraDireccion,
    headers: { location: '/acceso-web' },
  });
  sw.red.respuesta = () => original;
  let respuesta: Promise<Response> | undefined;
  sw.oyentes.get('fetch')?.({
    request: { url: sw.urlDe('recorrido.html'), method: 'GET', mode: 'navigate' },
    respondWith: (valor: Promise<Response>) => {
      respuesta = valor;
    },
    waitUntil: () => {},
  });
  assert.ok(respuesta);
  assert.equal(await respuesta, original);
  assert.equal((await respuesta).headers.get('location'), '/acceso-web');
});

test('una navegación de otro origen no entra en la guardia', () => {
  const sw = servicio(BASES[0] ?? 'https://ejemplo.invalid/', { politica: textoPoliticaCache() });
  let interceptada = false;
  sw.oyentes.get('fetch')?.({
    request: { url: 'https://ajeno.invalid/recorrido.html', method: 'GET', mode: 'navigate' },
    respondWith: () => {
      interceptada = true;
    },
  });
  assert.equal(interceptada, false);
});
