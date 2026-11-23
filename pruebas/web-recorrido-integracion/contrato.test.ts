// Contrato HTTP real entre el motor y los lectores del recorrido, con datos publicados y sin red ni proveedor.
import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi, type ResponderApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { apuntarTraducciones, datoEn, olvidarTraducciones } from '../../web/scripts/recorrido/datos-traducidos.js';
import { leerFichaDeGrupo, rutaEnIdioma, traduccionesDeFicha } from '../../web/scripts/recorrido/traduccion-api.js';

const ORIGEN = 'https://recorrido.test';
const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const IDIOMAS = ['es', 'ca'] as const;
let api: ResponderApi;

before(async () => {
  mock.method(globalThis, 'fetch', () => assert.fail('Este contrato no permite llamadas de red'));
  api = await crearApi({
    datos: DATOS,

    origenesPermitidos: [],
    seguridad: { secretoFirma: 'secreto-sintetico-local-para-contrato-del-recorrido' },
  });
});
afterEach(() => olvidarTraducciones());
after(() => mock.restoreAll());

/** Una respuesta del servidor pasa por HTTP y JSON antes de llegar a los lectores de la web. */
async function consultar(ruta: string): Promise<Record<string, unknown>> {
  const respuesta = await api(
    new Request(`${ORIGEN}/api${ruta}`, {
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
    }),
  );
  assert.equal(respuesta.status, ESTADO_HTTP.correcto, await respuesta.clone().text());
  assert.equal(respuesta.headers.get(CABECERA_CONTRATO), String(CONTRATO_API));
  const datos: unknown = await respuesta.json();
  assert.ok(esObjeto(datos));
  return datos;
}

test('las fichas HTTP conservan tareas, notas y traducciones al incorporarse al recorrido ES/CA', async () => {
  // Recepción, panadería y un grupo sin tareas OIT: las tres formas llegan al mismo lector.
  for (const codigo of ['4226', '7512', '0110']) {
    for (const idioma of IDIOMAS) {
      const datos = await consultar(rutaEnIdioma(`/grupos/${codigo}`, idioma));
      const original = structuredClone(datos);
      const ficha = leerFichaDeGrupo(datos);
      assert.equal(ficha.isco08, codigo);
      assert.equal(ficha.titulo, datos.titulo);
      assert.ok(Array.isArray(datos.tareas));
      const tareas = datos.tareas.filter(esObjeto).filter((tarea) => Number.isFinite(tarea.nota));
      assert.deepEqual(
        ficha.tareas.map(({ id, nota, texto_es, texto_en }) => ({ id, nota, texto_es, texto_en })),
        tareas.map(({ id, nota, texto_es, texto_en }) => ({ id, nota, texto_es, texto_en })),
      );
      apuntarTraducciones(traduccionesDeFicha(datos, idioma), idioma);
      assert.equal(datoEn(ficha.titulo, 'es'), ficha.titulo);
      if (idioma === 'ca') {
        assert.equal(datoEn(ficha.titulo, idioma), datos.titulo_ca ?? ficha.titulo);
      }
      assert.deepEqual(datos, original, 'el lector no cambia la respuesta del motor');
      olvidarTraducciones();
    }
  }
});
