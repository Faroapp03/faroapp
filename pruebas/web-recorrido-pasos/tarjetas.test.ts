import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { MAX_TAREA } from '../../src/comun/protocolo-web.ts';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { apuntarTraducciones, olvidarTraducciones } from '../../web/scripts/recorrido/datos-traducidos.js';
import { estado, nuevaTarea, oficialesDe, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { ficha } from '../web-recorrido-modelo/datos.ts';
import { html, Nodo, prepararDom } from './dom.ts';

const { crearFilaDeTarea, MAX_LETRAS_TAREA } = await import('../../web/scripts/recorrido/fila-tarea.js');
const { crearListaOficial } = await import('../../web/scripts/recorrido/lista-oficial.js');
const { crearConfirmacion, ocupacionMarcada } = await import('../../web/scripts/recorrido/tarjeta-confirmar.js');
const { crearExploracion } = await import('../../web/scripts/recorrido/tarjeta-explorar.js');
await cargarDiccionario('es');
await cargarDiccionario('ca');

const comoNodo = (nodo: HTMLElement) => nodo as unknown as Nodo;
const contenedor = (nodos: HTMLElement[]) => {
  const raiz = new Nodo('div');
  raiz.append(...nodos.map(comoNodo));
  return raiz;
};
beforeEach(() => {
  prepararDom();
  reiniciarEstado();
  olvidarTraducciones();
  fijarIdioma('es');
});

test('fila: límite del contrato, nombres actualizados al editar y oficial ya contada deshabilitada', () => {
  assert.equal(MAX_LETRAS_TAREA, MAX_TAREA);
  const oficial = oficialesDe(ficha());
  const marcada = nuevaTarea('Conducir', '8331-1');
  marcada.marcada = true;
  const propia = nuevaTarea('Atender viajeros');
  estado.tareas.push(marcada, propia);
  const fila = comoNodo(crearFilaDeTarea(propia, 1, { oficiales: oficial, alQuitar: () => {} }));
  const input = fila.querySelector('input[type="text"]') as Nodo;
  const usada = fila.querySelector('option[value="8331-1"]') as Nodo;
  assert.ok(input && usada);
  assert.equal(usada.disabled, true);
  input.value = 'Atender consultas';
  input.dispatchEvent(new Event('input'));
  assert.equal(propia.texto, 'Atender consultas');
  assert.ok(fila.querySelector('legend')?.textContent.endsWith(' Atender consultas'));
  assert.ok(fila.querySelector('label[for="oficial-2"]')?.textContent.endsWith(' Atender consultas'));
});

test('casillas: las oficiales usadas no se duplican y una marcada siempre se puede desmarcar', () => {
  const oficial = oficialesDe(ficha());
  const tarea = nuevaTarea('Conducir', '8331-1');
  const opciones = {
    titulo: 'Tareas',
    explicacion: '',
    tareas: oficial,
    usadas: new Map([['8331-1', 'Conducir']]),
    conGrupo: false,
    alMarcar: () => {},
  };
  const usada = comoNodo(crearListaOficial({ ...opciones, marcadas: new Map() })).querySelector('input') as Nodo;
  const marcada = comoNodo(crearListaOficial({ ...opciones, marcadas: new Map([['8331-1', tarea]]) })).querySelector(
    'input',
  ) as Nodo;
  assert.equal(usada.disabled, true);
  assert.equal(marcada.disabled, false);
  assert.equal(marcada.checked, true);
});

test('confirmación ordena títulos en el idioma visible, no elige por defecto y conserva elección al volver', () => {
  const grupo = {
    ...ficha(),
    cita: '',
    ocupaciones: [
      { esco: 'b', titulo: 'Abedul' },
      { esco: 'a', titulo: 'Roble' },
    ],
  };
  apuntarTraducciones(
    [
      { castellano: 'Abedul', traduccion: 'Bedoll', origen: null },
      { castellano: 'Roble', traduccion: 'Alzina', origen: null },
    ],
    'ca',
  );
  fijarIdioma('ca');
  const opciones = {
    grupo,
    secundario: null,
    alSoloGrupo: () => {},
    alOtraCosa: () => {},
  };
  const sinElegir = contenedor(crearConfirmacion(opciones).nodos);
  assert.deepEqual(
    sinElegir.querySelectorAll('input').map((nodo) => (nodo as Nodo).value),
    ['a', 'b'],
  );
  assert.equal(ocupacionMarcada(html(sinElegir)), null);
  const vuelta = contenedor(crearConfirmacion({ ...opciones, elegida: 'b' }).nodos);
  assert.equal(ocupacionMarcada(html(vuelta)), 'b');
});

test('exploración ordena jerarquía y entrega el grupo original', () => {
  const hijos = [
    { codigo: '8', titulo: 'Zeta', ocupaciones: 1 },
    { codigo: '7', titulo: 'Alfa', ocupaciones: 2 },
  ];
  const elegidas: unknown[] = [];
  const tarjeta = crearExploracion({
    padre: '',
    tituloPadre: '',
    hijos,
    alAbrir: (hijo) => {
      elegidas.push(hijo);
    },
    alContar: () => {},
  });
  const botones = contenedor(tarjeta.nodos).querySelectorAll('button');
  assert.deepEqual(
    botones.slice(0, -1).map((boton) => boton.querySelector('strong')?.textContent),
    ['Alfa', 'Zeta'],
  );
  botones[0]?.dispatchEvent(new Event('click'));
  assert.equal(elegidas[0], hijos[1]);
});
