// El contrato factual de /api/clasificar en el motor del dispositivo: búsqueda por palabras con su aviso, selección
// desactivada y versión del contrato.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../src/api/problemas.ts';
import { clasificar } from '../../src/api/rutas/clasificar.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { contextoDelDispositivo } from '../ayudas/contexto-del-dispositivo.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const CORRECTO = 200;
const INCOMPATIBLE = 409;
const NO_DISPONIBLE = 503;
const CONTRATO_ANTERIOR = 6;
const TEXTO = 'recepcionista';
const AVISO = {
  es: 'Faro busca por palabras las ocupaciones que encajan con lo que cuentas, y tú eliges la tuya.',
  ca: 'Faro cerca per paraules les ocupacions que encaixen amb el que expliques, i tu tries la teva.',
};
function peticion(idioma: 'es' | 'ca', contrato: number | null = CONTRATO_API) {
  return new Request('https://factual.example/api/clasificar', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(contrato === null ? {} : { [CABECERA_CONTRATO]: String(contrato) }),
    },
    body: JSON.stringify({ texto: TEXTO, idioma }),
  });
}

for (const idioma of ['es', 'ca'] as const) {
  test(`la búsqueda factual ${idioma} devuelve candidatas con su aviso`, async (t) => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('La prueba no admite red'));
    const api = await crearApiLocal({ datos: DATOS, motorDeCursos });
    const respuesta = await api(peticion(idioma));
    assert.equal(respuesta.status, CORRECTO);
    assert.equal(respuesta.headers.get(CABECERA_CONTRATO), String(CONTRATO_API));
    const cuerpo: unknown = await respuesta.json();
    assert.ok(esObjeto(cuerpo));
    assert.deepEqual(cuerpo.avisos, [{ tipo: 'busqueda-por-palabras', texto: AVISO[idioma] }]);
    assert.equal(cuerpo.decision, 'explorar');
    assert.ok(Array.isArray(cuerpo.candidatas) && cuerpo.candidatas.length > 0);
  });
  test(`la selección desactivada ${idioma} mantiene el 503 sin afirmar que falta la IA local`, async () => {
    const contexto = await contextoDelDispositivo(DATOS, { caminoAMano: false });
    const solicitud = peticion(idioma);
    const respuesta = await clasificar(contexto, solicitud);
    assert.equal(respuesta.status, NO_DISPONIBLE);
    assert.equal(respuesta.headers.get('retry-after'), '3600');
    const cuerpo: unknown = await respuesta.json();
    assert.ok(esObjeto(cuerpo));
    assert.equal(cuerpo.type, `${RAIZ_DE_LOS_PROBLEMAS}seleccion_no_disponible`);
    assert.equal(Object.hasOwn(cuerpo, 'soloEnLinea'), false);
    assert.doesNotMatch(String(cuerpo.detail), /inteligencia artificial|intel·ligència artificial/i);
  });
}

test('el contrato factual rechaza la versión anterior y la ausencia', async () => {
  const api = await crearApiLocal({ datos: DATOS, motorDeCursos });
  for (const version of [CONTRATO_ANTERIOR, null]) {
    const respuesta = await api(peticion('es', version));
    assert.equal(respuesta.status, INCOMPATIBLE);
    assert.equal(respuesta.headers.get(CABECERA_CONTRATO), String(CONTRATO_API));
  }
});
