// Los 503 de la plataforma cuando falla la autoridad de la administración: la disponibilidad de las secciones de la
// web, los archivos del panel y el panel de Node (sus peticiones y su catálogo). La respuesta sigue siendo el 503 sin
// detalle, y el motivo queda en el registro; una retirada de la persona no es un fallo y no se registra.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepararSociosNode } from '../../src/plataforma/acceso-publico/composicion-node.ts';
import { crearServidorWebAdministrativo } from '../../src/plataforma/administracion-web.ts';
import { comprobarSeccionWeb, respuestaDeSecciones } from '../../src/plataforma/secciones-web.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.example';
const NO_DISPONIBLE = 503;
const PERSONA = principalDePrueba('https://equipo.example', 'persona');
const autoridadCaida = async (): Promise<never> => {
  throw new Error('autoridad sintética caída');
};
const MOTIVO = 'Error: autoridad sintética caída';

/** Los mensajes de console.error de la prueba. */
function registro(t: test.TestContext) {
  const error = t.mock.method(console, 'error', () => {});
  return () => error.mock.calls.map((llamada) => llamada.arguments);
}

test('secciones: si la disponibilidad no se puede leer, 503 y el motivo en el registro', async (t) => {
  const mensajes = registro(t);
  const senal = new AbortController().signal;
  assert.equal((await respuestaDeSecciones({ method: 'GET', signal: senal }, autoridadCaida)).status, NO_DISPONIBLE);
  assert.equal((await comprobarSeccionWeb('/recorrido.html', senal, autoridadCaida))?.status, NO_DISPONIBLE);
  const esperado = [`La disponibilidad de las secciones de la web no se ha podido leer: ${MOTIVO}`];
  assert.deepEqual(mensajes(), [esperado, esperado]);
});

test('secciones: si la persona se ha retirado, 503 sin registrar nada', async (t) => {
  const mensajes = registro(t);
  const retirada = new AbortController();
  retirada.abort();
  assert.equal((await comprobarSeccionWeb('/recorrido.html', retirada.signal, autoridadCaida))?.status, NO_DISPONIBLE);
  assert.deepEqual(mensajes(), []);
});

test('archivos del panel: si no se pueden leer, 503 sin detalle y el motivo en el registro', async (t) => {
  const mensajes = registro(t);
  const responder = crearServidorWebAdministrativo({
    configuracion: { origen: ORIGEN, permitirHttpLocal: false },
    guardiaAdministrativa: async () => PERSONA,
  });
  const respuesta = await responder(new Request(`${ORIGEN}/administracion`), autoridadCaida);
  assert.equal(respuesta.status, NO_DISPONIBLE);
  assert.equal(respuesta.body, null);
  assert.deepEqual(mensajes(), [[`Un archivo del panel no se ha podido servir: ${MOTIVO}`]]);
});

test('panel de Node: con su almacén cerrado, sus peticiones y su catálogo dan 503 y el motivo en el registro', async (t) => {
  const mensajes = registro(t);
  const preparados = await prepararSociosNode({
    archivo: join(process.env.TMPDIR ?? '.', 'faro-panel-no-disponible.sqlite'),
    administracion: {
      configuracion: { origen: ORIGEN, permitirHttpLocal: false },
      guardiaAdministrativa: async () => PERSONA,
      inicial: { version: 2, api: 'deshabilitada', mcp: false, a2a: false },
    },
  });
  preparados.cerrar();
  const { administracion } = preparados;
  assert.ok(administracion);
  const peticion = () => new Request(`${ORIGEN}/administracion/api/controles/leer`, { method: 'POST', body: '{}' });
  assert.equal((await administracion.responder(peticion())).status, NO_DISPONIBLE);
  assert.equal((await administracion.catalogo(new Request(`${ORIGEN}/.well-known/api-catalog`))).status, NO_DISPONIBLE);
  const registros = mensajes().map(([linea]) => JSON.parse(String(linea)) as Record<string, unknown>);
  assert.equal(registros.length, 2);
  assert(
    registros.every((r) => r.operacion === 'montaje-conectividad' && r.tipo === 'Error' && r.estado === NO_DISPONIBLE),
  );
  assert.doesNotMatch(JSON.stringify(registros), /cerrado|message|stack/);
});
