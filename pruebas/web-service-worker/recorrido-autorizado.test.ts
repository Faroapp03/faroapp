import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { rutaFueraDeLaCopia } from '../../src/plataforma/politica-cache-web.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const ENTRADAS = ['recorrido.html', 'recorrido', 'recorrido.html?idioma=ca', '%72ecorrido.html', 'modo-recorrido.json'];
/** Lo que autoriza una variante: su modo y las entradas de las extensiones, que nunca entran en la copia. */
const AUTORIZACIONES = ['modo-recorrido.json', ...EXTENSIONES.map(({ entrada }) => entrada)];

test('el modo y las variantes de las extensiones nunca se guardan en la copia; el recorrido real sí', () => {
  for (const entrada of AUTORIZACIONES) {
    assert.equal(rutaFueraDeLaCopia(entrada), true, entrada);
  }
  for (const entrada of [
    'recorrido.html',
    'recorrido',
    '%72ecorrido.html',
    'informe-ejemplo.html',
    'recorrido-guia.html',
  ]) {
    assert.equal(rutaFueraDeLaCopia(entrada), false, entrada);
  }
});

for (const base of BASES) {
  test(`el ejemplo de informe conserva el cierre de su sección: ${base}`, async () => {
    const sw = servicio(base, {
      politica: textoPoliticaCache(),
      archivos: ['inicio.html', 'sin-conexion.html', 'informe-ejemplo.html'],
    });
    sw.guardadas.set(
      sw.nombreCopia,
      new Map([
        [sw.urlDe('inicio.html'), new Response('INICIO', { headers: { 'x-faro-portal': 'publico' } })],
        [sw.urlDe('informe-ejemplo.html'), new Response('INFORME ANTERIOR')],
      ]),
    );
    sw.conectar();
    sw.red.respuesta = () =>
      Response.json({
        version: VERSION_SECCIONES_PUBLICAS,
        autoridad: '11111111-1111-4111-8111-111111111111',
        revision: 1,
        secciones: { ...politicaSeccionesInicial(), recorrido: false },
      });
    const respuesta = await pedir(sw, 'informe-ejemplo.html');
    assert.equal(respuesta.estado, ESTADO_HTTP.noEncontrado);
    assert.notEqual(respuesta.cuerpo, 'INFORME ANTERIOR');
  });

  test(`la caché residual no evita la autorización del recorrido: ${base}`, async () => {
    const sw = servicio(base, { politica: textoPoliticaCache() });
    sw.guardadas.set(
      sw.nombreCopia,
      new Map(ENTRADAS.map((entrada) => [sw.urlDe(entrada), new Response('RECORRIDO ANTERIOR')])),
    );
    const resultado = await pedir(sw, 'modo-recorrido.json');
    assert.equal(resultado.interceptada, false, 'modo-recorrido.json');
    assert.equal(sw.copias.aperturas, 0);
    assert.deepEqual(sw.peticiones, []);
  });

  test(`instalar no solicita el modo ni las variantes protegidas aunque aparezcan en el catálogo: ${base}`, async () => {
    const sw = servicio(base, {
      politica: textoPoliticaCache(),
      archivos: ['inicio.html', 'sin-conexion.html', 'recorrido.html', ...AUTORIZACIONES],
    });
    sw.conectar();
    await sw.instalar();
    assert.deepEqual(
      sw.peticiones.sort(),
      [sw.urlDe('inicio.html'), sw.urlDe('sin-conexion.html'), sw.urlDe('recorrido.html')].sort(),
    );
  });
}
