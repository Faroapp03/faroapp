// En el paso de tareas se elige: con tareas oficiales que marcar, la barra de escribir se esconde y la tarjeta ocupa su
// sitio; «Añadir otra tarea» la vuelve a abrir. Sin tareas oficiales, lo principal es escribir y la barra se queda.
import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { estado, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { ficha, ocupacion } from '../web-recorrido-modelo/datos.ts';
import { buscar, prepararDom } from './dom.ts';
import { observadas, reiniciarInterfaz } from './interfaz-doble.ts';

const { iniciarPasoTareas, mostrarPasoTareas } = await import('../../web/scripts/recorrido/paso-tareas.js');
await cargarDiccionario('es');

const SIN_RETIRADAS = { retiradas: { cuantas: 0, de: '' } };

beforeEach(() => {
  prepararDom();
  reiniciarInterfaz();
  reiniciarEstado();
  estado.ocupacion = ocupacion();
  estado.grupos.principal = ficha();
  fijarIdioma('es');
});

test('con tareas oficiales que marcar, la barra de escribir se esconde y «Añadir otra tarea» la vuelve a abrir', () => {
  mostrarPasoTareas(SIN_RETIRADAS);
  assert.equal(observadas.compositorVisible, false);
  iniciarPasoTareas();
  buscar('boton-anadir').dispatchEvent(new Event('click'));
  assert.equal(observadas.compositorVisible, true);
});

test('sin tareas oficiales, lo principal es escribir: la barra se queda', () => {
  const sinOficiales = ficha();
  sinOficiales.tareas.length = 0;
  estado.grupos.principal = sinOficiales;
  mostrarPasoTareas(SIN_RETIRADAS);
  assert.equal(observadas.compositorVisible, true);
});
