// Si el trabajo que cuenta el pensamiento falla cuando el pensamiento ya ha empezado (dentro de su espera), el
// pensamiento sale con la espera, nadie lo termina (así no hay medida faro:pagina:pensamiento, que solo registra
// crearPensamientoEnCurso al recogerlo, comprobado en pruebas/web-recorrido-interfaz/pensamiento.test.ts) y la barra
// de escritura queda libre: ni petición en curso ni formulario ocupado. Un caso por camino: el motor de ocupación y la
// carga de los grupos de las tareas.
import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma, resolver, traducible } from '../../web/scripts/textos.js';
import { ficha } from '../web-recorrido-modelo/datos.ts';
import { configurarApi } from './api-doble.ts';
import { prepararDom } from './dom.ts';
import { enviar, observadas, reiniciarInterfaz } from './interfaz-doble.ts';
import { prepararPasos } from './motor-local-doble.ts';

const { hayPeticionEnCurso, soltarEspera } = await import('../../web/scripts/recorrido/pagina.js');
const { empezarConversacion } = await import('../../web/scripts/recorrido/paso-ocupacion.js');
await cargarDiccionario('es');

const VUELTAS = 20;
const ANALIZAR = resolver(traducible('recorrido.pensamiento.paso.analizar'));
const BUSCAR_LAS_TAREAS = resolver(traducible('recorrido.pensamiento.paso.tareas-buscar'));
const DECIDIDA = {
  lectura: { sinComprension: false },
  paso: { tipo: 'decidida', grupo: '5131', esco: '5131.1', soloGrupo: false },
};

async function soltarPromesas() {
  for (let i = 0; i < VUELTAS; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Lo que queda tras el fallo: el pensamiento empezado con `primerPaso` salió con su espera y nadie lo termina. */
function comprobarQueSeRetira(primerPaso: string) {
  const indices = observadas.pensamientosEmpezados.flatMap((paso, i) => (resolver(paso) === primerPaso ? [i] : []));
  assert.equal(indices.length, 1, 'el pensamiento ha empezado una vez');
  const empezado = observadas.nodosEmpezados[indices[0] ?? -1];
  assert.equal(empezado?.parentElement?.dataset.tipo, 'espera', 'empezó dentro de la espera');
  assert.equal(observadas.espera, null, 'la espera, y con ella el pensamiento, ya no está');
  assert.ok(empezado && !observadas.nodos.includes(empezado), 'Faro no dice el pensamiento empezado');
  assert.equal(empezado?.dataset.estado, 'pensando', 'nadie lo termina');
  assert.deepEqual(observadas.pensamientosSeguidos, [], 'no se recoge ningún pensamiento: no hay medida');
  assert.equal(hayPeticionEnCurso(), false, 'la barra queda libre');
  assert.equal(document.querySelector('form[aria-busy="true"]'), null, 'ningún formulario queda ocupado');
}

beforeEach(() => {
  prepararDom();
  soltarEspera();
  reiniciarEstado();
  reiniciarInterfaz();
  fijarIdioma('es');
});

test('si falla el motor de ocupación con el pensamiento empezado, se retira y la barra queda libre', async () => {
  prepararPasos(new Error('el motor ha fallado'));
  empezarConversacion();
  void enviar('camarero');
  await soltarPromesas();
  comprobarQueSeRetira(ANALIZAR);
});

test('si falla la carga de los grupos de las tareas con el pensamiento empezado, se retira y la barra queda libre', async () => {
  let pedidas = 0;
  configurarApi({
    // La primera ficha es la de la ocupación elegida; las siguientes, la carga de los grupos, fallan.
    fichaDeGrupo: (isco08) => {
      pedidas += 1;
      return pedidas === 1 ? Promise.resolve(ficha(isco08)) : Promise.reject(new Error('la ficha no llega'));
    },
  });
  prepararPasos(DECIDIDA);
  empezarConversacion();
  void enviar('camarero');
  await soltarPromesas();
  assert.ok(pedidas > 1, 'se han pedido los grupos, después de la ficha de la ocupación');
  comprobarQueSeRetira(BUSCAR_LAS_TAREAS);
});
