// El informe de un resultado recibido de otro dispositivo (paso-informe.js, abrirResultadoRecibido) con la copia del
// motor que no es la de esta versión: el receptor (otro-dispositivo/recibir.js) falla con MotorQueNoCoincide y Faro lo
// cuenta como en los demás pasos, con la explicación de la copia guardada y «Reparar Faro», no con el fallo general de
// la transferencia; al repararla, la página se vuelve a abrir con el mismo resultado. Con la instalación que no
// coincide (primera visita), su explicación y nada que ofrecer. La conversación es la real; solo el borde Worker del
// receptor es un doble (carga-recibido.ts).
import '../web-recorrido-integral/carga-recibido.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MotorQueNoCoincide } from '../../web/scripts/motor-local/cliente.js';
import { codificar, enlaceConCodigo } from '../../web/scripts/otro-dispositivo/formato.js';
import {
  ERROR_INSTALACION_QUE_NO_COINCIDE,
  ERROR_MOTOR_QUE_NO_COINCIDE,
  ErrorFaro,
} from '../../web/scripts/recorrido/api/errores.js';
import { traducible } from '../../web/scripts/textos.js';
import { Nodo, navegador, pagina } from '../web-controles/ayudas.js';
import { fijarMotor } from '../web-recorrido-integral/motor-doble.ts';

/** La página del recorrido en la que se abre el resultado. */
const PAGINA = 'https://faro.example/recorrido.html';
const RESULTADO = {
  idioma: 'es' as const,
  isco08: '7512',
  fecha: new Date().toISOString().slice(0, 10),
  tareas: [{ tareaOit: '7512-1', tiempo: 'algo' as const }],
  sinViajar: 0,
};

class Mensaje extends Nodo {
  prepend(...hijos: (Nodo | string)[]): void {
    this.append(...hijos);
  }
  scrollIntoView(): void {}
}
class Fila extends Nodo {
  replaceChildren(...hijos: Nodo[]): void {
    this.children = [];
    this.append(...hijos);
  }
}

/** Las claves de lo que se ha escrito en `nodo` y dentro de él, en orden. */
function claves(nodo: Nodo): string[] {
  return [...(nodo.dataset.texto ? [nodo.dataset.texto] : []), ...nodo.children.flatMap(claves)];
}

/** Abre el resultado recibido con el motor del dispositivo que falla con `fallo`; devuelve lo dicho y lo ofrecido. */
async function abrirConElMotorQueFalla(t: Parameters<typeof pagina>[0], fallo: Error) {
  const dom = pagina(t);
  const conversacion = new Nodo();
  const sugerencias = new Fila();
  for (const [id, nodo] of [
    ['informe', new Nodo()],
    ['nota-idioma-informe', new Nodo()],
    ['conversacion', conversacion],
    ['sugerencias', sugerencias],
  ] as const) {
    dom.ids.set(id, nodo);
  }
  dom.document.createElement = () => new Mensaje();
  // Lo que hace la página al volver a abrirse: la dirección que deja en la barra y cada recarga.
  const salida = { direcciones: [] as string[], recargas: 0 };
  navegador(t, {
    navigator: {},
    SVGElement: Nodo,
    HTMLDialogElement: Nodo,
    HTMLLinkElement: Nodo,
    location: {
      href: PAGINA,
      hash: '',
      reload: () => {
        salida.recargas += 1;
      },
    },
    history: {
      state: null,
      replaceState: (_estado: unknown, _titulo: string, url: string) => salida.direcciones.push(url),
    },
  });
  fijarMotor(async () => {
    throw fallo;
  });
  const { abrirResultadoRecibido } = await import('../../web/scripts/recorrido/paso-informe.js');
  await abrirResultadoRecibido(codificar(RESULTADO), { alBorrar: () => {} });
  return { dicho: claves(conversacion), ofrecido: claves(sugerencias), sugerencias, salida };
}

test('con la copia del motor que no es de esta versión, el informe recibido ofrece «Reparar Faro»', async (t) => {
  const { dicho, ofrecido } = await abrirConElMotorQueFalla(
    t,
    new MotorQueNoCoincide('El archivo del motor del dispositivo no es el de esta versión.'),
  );
  assert.ok(dicho.includes(ERROR_MOTOR_QUE_NO_COINCIDE), `Faro lo explica: ${dicho}`);
  assert.ok(!dicho.includes('recorrido.pasar.fallo'), 'no con el fallo general de la transferencia');
  assert.deepEqual(ofrecido, ['recorrido.reparar']);
});

test('con la instalación que no coincide, su explicación y nada que ofrecer', async (t) => {
  const { dicho, ofrecido } = await abrirConElMotorQueFalla(
    t,
    new ErrorFaro(traducible(ERROR_INSTALACION_QUE_NO_COINCIDE), 0, {}),
  );
  assert.ok(dicho.includes(ERROR_INSTALACION_QUE_NO_COINCIDE), `Faro lo explica: ${dicho}`);
  assert.deepEqual(ofrecido, []);
});

test('al reparar desde el informe recibido, la página se vuelve a abrir con el mismo resultado', async (t) => {
  const { sugerencias, salida } = await abrirConElMotorQueFalla(
    t,
    new MotorQueNoCoincide('El archivo del motor del dispositivo no es el de esta versión.'),
  );
  // Sin service worker que la controle, la reparación solo recarga (recorrido/reparar.js): basta para ver cómo.
  sugerencias.children[0]?.dispatchEvent(new Event('click'));
  assert.deepEqual(
    salida.direcciones,
    [enlaceConCodigo(PAGINA, codificar(RESULTADO))],
    'con el resultado en su enlace',
  );
  assert.equal(salida.recargas, 1);
});
