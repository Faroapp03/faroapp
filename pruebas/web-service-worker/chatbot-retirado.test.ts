/** Una versión nueva elimina la copia anterior sin volver a servir su página retirada. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASES, pedir, servicio } from './ayudas.ts';

for (const base of BASES) {
  test(`la PWA descarta la copia anterior del chatbot: ${base}`, async () => {
    // La página de sin conexión guardada es la de esta versión: se comprueba con su huella al servirla.
    const sw = servicio(base, {
      version: '0000000000000000',
      archivos: ['sin-conexion.html', 'recorrido.html'],
      cuerpoDe: (ruta) => (ruta === 'sin-conexion.html' ? 'SIN CONEXIÓN' : ruta),
    });
    const antigua = `faro:${base}:version-retirada`;
    sw.guardadas.set(antigua, new Map([[sw.urlDe('chatbot.html'), new Response('CHATBOT ANTERIOR')]]));
    sw.guardadas.set(
      sw.nombreCopia,
      new Map([
        [sw.urlDe('inicio.html'), new Response('INICIO', { headers: { 'x-faro-portal': 'publico' } })],
        [sw.urlDe('sin-conexion.html'), new Response('SIN CONEXIÓN')],
      ]),
    );
    await sw.activar();
    assert.equal(sw.guardadas.has(antigua), false);
    const respuesta = await pedir(sw, 'chatbot.html');
    assert.equal(respuesta.cuerpo, 'SIN CONEXIÓN');
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('chatbot.html')), false);
  });
}
