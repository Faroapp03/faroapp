import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMPO_FIRMAS_NO_VALIDAS } from '../../web/scripts/protocolo-web.js';
import { esCancelacion } from '../../web/scripts/recorrido/api/errores.js';

const { cancelarPeticiones } = await import('../../web/scripts/recorrido/api/transporte.js');

import { estado, nuevaTarea, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { pagina } from '../web-controles/ayudas.js';
import { cuerpo, prepararApi, respuesta } from '../web-recorrido-api/ayudas.ts';
import { estimacion } from '../web-recorrido-modelo/datos.ts';

const HTML = '<p>Informe de ensayo</p>';
async function preparar(t: Parameters<typeof pagina>[0], tareas = ['Preparar', 'Ordenar']) {
  pagina(t);
  reiniciarEstado();
  estado.ocupacion = {
    isco08: '7512',
    esco: null,
    isco08Secundario: null,
    palabra: 'Panadera',
    titulo: 'Panaderos',
    origen: 'jerarquia',
  };
  estado.tareas = tareas.map((texto) => ({ ...nuevaTarea(texto), tiempo: 'algo' }));
  t.after(reiniciarEstado);
  return import('../../web/scripts/recorrido/paso-informe.js');
}

test('tareas literales quedan sin nota y el informe conserva el cuerpo sin solicitar inferencia', async (t) => {
  const informe = await preparar(t);
  const tareaAnterior = estado.tareas[0];
  assert.ok(tareaAnterior);
  Object.assign(tareaAnterior, { yaContada: '8331-1' });
  const peticiones = await prepararApi(t, () => respuesta({ html: HTML, avisos: [] }));
  assert.deepEqual(await informe.htmlDelInforme('es', informe.pendientesDeEstimar), { html: HTML, avisos: [] });
  assert.equal(peticiones.filter((p) => p.ruta === '/api/estimar').length, 0);
  assert.equal(informe.tareasSinEstimacion().length, estado.tareas.length);
  const enviada = peticiones.find((p) => p.ruta.startsWith('/api/informe'));
  assert.ok(enviada);
  const tareas = cuerpo(enviada.opciones).tareas;
  assert.ok(Array.isArray(tareas));
  assert.ok(tareas.every((tarea) => !('yaContada' in tarea)));
  assert.deepEqual(
    tareas.map((x) => [x.texto, 'estimacion' in x]),
    [
      ['Preparar', false],
      ['Ordenar', false],
    ],
  );
});

test('firma rechazada se retira solo de la tarea indicada sin pedir su renovación', async (t) => {
  const informe = await preparar(t);
  const primera = estado.tareas[0];
  assert.ok(primera);
  primera.estimacion = estimacion();
  primera.estimadaPara = primera.texto;
  let pedidos = 0;
  const peticiones = await prepararApi(t, () => {
    pedidos += 1;
    return pedidos === 1
      ? respuesta({ error: 'Firma caducada', [CAMPO_FIRMAS_NO_VALIDAS]: [`t${primera.id}`] }, { status: 400 })
      : respuesta({ html: HTML, avisos: [] });
  });
  assert.deepEqual(await informe.htmlDelInforme('es', informe.pendientesDeEstimar), { html: HTML, avisos: [] });
  assert.equal(pedidos, 2);
  assert.deepEqual(
    peticiones.filter((p) => p.ruta === '/api/estimar').map((p) => cuerpo(p.opciones).tarea),
    [],
  );
});

test('cancelar el informe no entrega resultado ni añade una estimación a las tareas', async (t) => {
  const informe = await preparar(t);
  const peticiones = await prepararApi(t, () => {
    cancelarPeticiones();
    throw new DOMException('Retirada', 'AbortError');
  });
  await assert.rejects(informe.htmlDelInforme('es', informe.pendientesDeEstimar), esCancelacion);
  assert.equal(peticiones.length, 1);
  assert.ok(
    estado.tareas.every(
      (tarea) => tarea.estimacion === null && tarea.sinEstimacion?.motivo === 'sinEstimacionAcreditada',
    ),
  );
});
