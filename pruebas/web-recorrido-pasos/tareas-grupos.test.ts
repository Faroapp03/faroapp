import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { errorDeCancelacion, esCancelacion } from '../../web/scripts/recorrido/api/errores.js';
import { estado, nuevaTarea, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { estimacion, ficha, ocupacion } from '../web-recorrido-modelo/datos.ts';
import { configurarApi } from './api-doble.ts';
import { prepararDom } from './dom.ts';
import { reiniciarInterfaz } from './interfaz-doble.ts';

const { cargarGruposElegidos } = await import('../../web/scripts/recorrido/grupos-elegidos.js');
await cargarDiccionario('es');
await cargarDiccionario('ca');

beforeEach(() => {
  prepararDom();
  reiniciarInterfaz();
  reiniciarEstado();
  estado.ocupacion = ocupacion();
  estado.grupos.principal = ficha();
  estado.grupos.principal.tareas.push({
    id: '8331-2',
    corto: 'Cobrar',
    texto_es: 'Cobrar billetes',
    texto_en: 'Collect fares',
    nota: 0.5,
  });
  fijarIdioma('es');
});

test('cambiar de grupo retira marcadas ajenas, conserva texto/tiempo propios e invalida firma y referencia', async () => {
  const marcada = nuevaTarea('Conducir', '8331-1');
  marcada.marcada = true;
  const propia = nuevaTarea('Atender personas', '8331-1');
  propia.tiempo = 'mucho';
  propia.estimacion = estimacion();
  propia.estimadaPara = propia.texto;
  estado.tareas.push(marcada, propia);
  configurarApi({ fichaDeGrupo: async (codigo) => ficha(codigo) });
  const resultado = await cargarGruposElegidos(
    { isco08: '7512', esco: null, isco08Secundario: null, origen: 'jerarquia' },
    'panadera',
  );
  assert.deepEqual(resultado, { retiradas: { cuantas: 1, de: 'Grupo' } });
  assert.deepEqual(estado.tareas, [propia]);
  assert.equal(propia.texto, 'Atender personas');
  assert.equal(propia.tiempo, 'mucho');
  assert.equal(propia.oficial, null);
  assert.equal(propia.estimacion, null);
  assert.equal(propia.estimadaPara, null);
});

test('misma elección conserva firma y tareas; cambiar solo ESCO invalida firma sin reemparejar', async () => {
  const propia = nuevaTarea('Conducir');
  propia.estimacion = estimacion();
  propia.estimadaPara = propia.texto;
  estado.tareas.push(propia);
  const firmada = propia.estimacion;
  configurarApi({
    fichaDeGrupo: async () => ficha(),
  });
  await cargarGruposElegidos(ocupacion(), 'chofer');
  assert.equal(propia.estimacion, firmada);
  await cargarGruposElegidos({ ...ocupacion(), esco: '8331.1' }, 'chofer');
  assert.equal(propia.estimacion, null);
  assert.equal(propia.estimadaPara, null);
});

test('cancelar ficha antes de completar ambas no escribe ocupación, grupos ni tareas', async () => {
  const antes = structuredClone(estado);
  configurarApi({
    fichaDeGrupo: async () => {
      throw errorDeCancelacion();
    },
  });
  await assert.rejects(cargarGruposElegidos({ ...ocupacion(), isco08: '7512' }, 'Otra'), esCancelacion);
  assert.deepEqual(estado, antes);
});
