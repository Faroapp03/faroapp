import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const ENTRADAS = ['recorrido.html', 'recorrido', '%72ecorrido.html'];

for (const base of BASES) {
  test(`la entrada del recorrido pedida sin navegar no la atiende el service worker: ${base}`, async () => {
    const sw = servicio(base, { politica: textoPoliticaCache() });
    sw.guardadas.set(sw.nombreCopia, new Map(ENTRADAS.map((ruta) => [sw.urlDe(ruta), new Response('ANTIGUO')])));
    sw.conectar();
    sw.red.respuesta = () => new Response('pregunta', { status: 401 });
    for (const ruta of ENTRADAS) {
      for (const mode of ['cors', 'same-origin', 'no-cors']) {
        const respuesta = await pedir(sw, ruta, { method: 'GET', mode });
        assert.equal(respuesta.interceptada, false, `${ruta} (${mode})`);
        assert.equal(respuesta.aperturas, 0, `${ruta} (${mode})`);
      }
    }
    const informe = await pedir(sw, 'informe-ejemplo.html', { method: 'GET', mode: 'cors' });
    assert.equal(informe.interceptada, true, 'informe-ejemplo.html');
  });
}
