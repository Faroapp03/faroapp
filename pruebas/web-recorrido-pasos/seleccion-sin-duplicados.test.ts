import './aislar.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { ficha } from '../web-recorrido-modelo/datos.ts';
import { type Nodo, prepararDom } from './dom.ts';

await cargarDiccionario('es');
const modelo = await import('../../web/scripts/recorrido/estado.js');
const fila = await import('../../web/scripts/recorrido/fila-tarea.js');

test('real: selección oficial impide duplicados y conserva texto', () => {
  prepararDom();
  modelo.reiniciarEstado();
  fijarIdioma('es');
  const ocupada = modelo.nuevaTarea('Conducir', '8331-1');
  const propia = modelo.nuevaTarea('Atender viajeros');
  modelo.estado.tareas.push(ocupada, propia);
  const fichaConDos = ficha();
  const tareaBase = fichaConDos.tareas[0];
  assert.ok(tareaBase);
  fichaConDos.tareas.push({ ...tareaBase, id: '8331-2' });
  const oficiales = modelo.oficialesDe(fichaConDos);
  let cambios = 0;
  const nodo = fila.crearFilaDeTarea(propia, 1, {
    oficiales,
    alQuitar: () => {},
    alElegirOficial: () => {
      cambios += 1;
    },
  }) as unknown as Nodo;
  const usada = nodo.querySelector('option[value="8331-1"]') as Nodo;
  assert.equal(usada.disabled, true);
  const libre = oficiales.find((oficial) => oficial.id !== '8331-1');
  assert.ok(libre);
  const selector = nodo.querySelector('select') as Nodo;
  selector.value = libre.id;
  selector.dispatchEvent(new Event('change'));
  assert.equal(propia.oficial, libre.id);
  assert.equal(propia.emparejadaPara, 'Atender viajeros');
  assert.equal(cambios, 1);
  assert.equal(modelo.quienCuenta('8331-1', propia), ocupada);
});
