import './ayudas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMPO_FIRMAS_NO_VALIDAS } from '../../web/scripts/protocolo-web.js';
import { estado, nuevaTarea, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { pagina } from '../web-controles/ayudas.js';
import { estimacion } from '../web-recorrido-modelo/datos.ts';
import { fijarMotor } from './motor-local-doble.ts';

test('el informe conserva tareas sin nota y no pide inferencia ni ofrece reestimación', async (t) => {
  pagina(t);
  reiniciarEstado();
  t.after(reiniciarEstado);
  estado.ocupacion = {
    isco08: '7512',
    esco: null,
    isco08Secundario: null,
    palabra: 'Panadera',
    titulo: 'Panaderos',
    origen: 'jerarquia',
  };
  estado.tareas = [{ ...nuevaTarea('Preparo pedidos especiales'), tiempo: 'algo' }];
  const rutas: string[] = [];
  fijarMotor(async (ruta, opciones) => {
    rutas.push(ruta);
    assert.equal(ruta, '/api/informe?formato=breve&reloj=dispositivo');
    const tareas: unknown = JSON.parse(String(opciones.body)).tareas;
    assert.ok(Array.isArray(tareas));
    assert.equal(tareas[0].texto, 'Preparo pedidos especiales');
    assert.equal('estimacion' in tareas[0], false);
    return Response.json({ html: '<p>Informe sin nota inventada</p>', avisos: [] });
  });
  const informe = await import('../../web/scripts/recorrido/paso-informe.js');
  const resultado = await informe.htmlDelInforme('es', informe.pendientesDeEstimar);
  assert.equal(resultado.html, '<p>Informe sin nota inventada</p>');
  assert.deepEqual(rutas, ['/api/informe?formato=breve&reloj=dispositivo']);
  assert.equal(estado.tareas[0]?.estimacion, null);
  assert.equal(estado.tareas[0]?.sinEstimacion?.motivo, 'sinEstimacionAcreditada');
});

test('una firma rechazada se retira sin renovar una estimación ni tocar otra firma', async (t) => {
  pagina(t);
  reiniciarEstado();
  t.after(reiniciarEstado);
  estado.ocupacion = {
    isco08: '7512',
    esco: null,
    isco08Secundario: null,
    palabra: 'Panadera',
    titulo: 'Panaderos',
    origen: 'jerarquia',
  };
  estado.tareas = ['Preparo', 'Ordeno'].map((texto) => ({
    ...nuevaTarea(texto),
    tiempo: 'algo',
    estimadaPara: texto,
    estimacion: estimacion(),
  }));
  const segunda = structuredClone(estado.tareas[1]);
  let intentos = 0;
  fijarMotor(async (ruta) => {
    assert.equal(ruta, '/api/informe?formato=breve&reloj=dispositivo');
    return ++intentos === 1
      ? Response.json(
          { error: 'Firma no válida', [CAMPO_FIRMAS_NO_VALIDAS]: [`t${estado.tareas[0]?.id}`] },
          { status: 400 },
        )
      : Response.json({ html: '<p>Informe conservado</p>' });
  });
  const informe = await import('../../web/scripts/recorrido/paso-informe.js');
  assert.equal((await informe.htmlDelInforme('es', informe.pendientesDeEstimar)).html, '<p>Informe conservado</p>');
  assert.equal(intentos, 2);
  assert.equal(estado.tareas[0]?.estimacion, null);
  assert.deepEqual(estado.tareas[1], segunda);
});
