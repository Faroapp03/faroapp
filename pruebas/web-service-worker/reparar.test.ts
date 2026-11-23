// «Reparar Faro» en la página (recorrido/reparar.js): Faro dice que se está reparando, pide al service worker que
// rehaga su copia y espera la respuesta a esa petición (la de un intento anterior no cuenta). Con éxito, dice que ya
// está y recarga sin que el navegador vuelva a preguntar (data-actualizando); si falla (la red, o lo que llega no es
// de esta versión, o deja de avisar), lo cuenta con su explicación y ofrece volver a intentarlo, sin recargar.
// La página nunca borra copias ni da de baja el service worker. Sin service worker que la controle, recarga. Y tras el
// fallo de la copia guardada se ofrece reparar; tras el de una primera visita, nada.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { type TestContext, test } from 'node:test';
import {
  ERROR_INSTALACION_QUE_NO_COINCIDE,
  ERROR_MOTOR_QUE_NO_COINCIDE,
  ErrorFaro,
} from '../../web/scripts/recorrido/api/errores.js';
import { traducible } from '../../web/scripts/textos.js';

registerHooks({
  resolve(spec, contexto, siguiente) {
    if (contexto.parentURL?.endsWith('/recorrido/reparar.js') && ['./conversacion.js', './pagina.js'].includes(spec)) {
      return { url: new URL('./conversacion-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});
const { ERROR_REPARAR_NO_COINCIDE, ERROR_REPARAR_SIN_COMPLETAR, repararLaCopia, salidasTrasElFallo } = await import(
  '../../web/scripts/recorrido/reparar.js'
);
const { dicho } = await import('./conversacion-doble.ts');
/** Los pasos del primer intento fallido: decir, pedir y contar el fallo. */
const PASOS_DEL_PRIMER_INTENTO = 3;
/** Cuánto se espera sin ningún aviso del service worker (paquete-sin-conexion.js, PLAZO_SIN_AVANCE_MS). */
const PLAZO_SIN_AVISOS_MS = 30_000;

/** Lo que contesta el service worker de mentira a una petición: su resultado, con el número de la petición. */
type Contestacion = { ok: boolean; motivo?: string };

/**
 * El navegador y la conversación de mentira, que anotan cada paso; `respuestas`, lo que contesta el service worker a
 * cada petición (null: no contesta). Con `tardias`, antes de cada respuesta llega la que el service worker da tarde a
 * la petición anterior.
 */
function navegador(respuestas: (Contestacion | null)[], controlada = true, tardias: Contestacion[] = []) {
  const pasos: string[] = [];
  const oyentes = new EventTarget();
  const reintentos: (() => void)[] = [];
  const pedidas: unknown[] = [];
  const responder = (data: Record<string, unknown>) =>
    queueMicrotask(() => oyentes.dispatchEvent(new MessageEvent('message', { data })));
  const contenedor = {
    controller: controlada
      ? {
          postMessage: (mensaje: { type: string; id: unknown }) => {
            pasos.push(`pedir ${mensaje.type}`);
            const tardia = pedidas.length ? tardias.shift() : undefined;
            if (tardia) {
              responder({ type: 'COPIA_REPARADA', id: pedidas.at(-1), ...tardia });
            }
            pedidas.push(mensaje.id);
            const respuesta = respuestas.shift();
            if (respuesta) {
              responder({ type: 'COPIA_REPARADA', id: mensaje.id, ...respuesta });
            }
          },
        }
      : null,
    addEventListener: (tipo: string, oyente: EventListener) => oyentes.addEventListener(tipo, oyente),
    removeEventListener: (tipo: string, oyente: EventListener) => oyentes.removeEventListener(tipo, oyente),
  };
  const conversacion = {
    reparando: () => pasos.push('reparando'),
    reparado: () => pasos.push('reparado'),
    fallo: (error: ErrorFaro, reintentar: () => void) => {
      pasos.push(`fallo ${(error.explicacion as { clave: string }).clave}`);
      reintentos.push(reintentar);
    },
  };
  const raiz = { dataset: {} as Record<string, string> };
  const recargar = () => pasos.push('actualizando' in raiz.dataset ? 'recargar sin preguntar' : 'recargar');
  const entorno = { contenedor, conversacion, recargar, raiz };
  return { pasos, reintentos, pedidas, entorno: entorno as unknown as Parameters<typeof repararLaCopia>[0] };
}

/** Deja que acaben los mensajes de la prueba. */
const asentar = () => new Promise((listo) => setImmediate(listo));

/** La reparación, con el reloj falso: si el service worker no avisa de nada, pasa el plazo sin avisos. */
async function sinAvisos(t: TestContext, entorno: Parameters<typeof repararLaCopia>[0]) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hecha = repararLaCopia(entorno);
  await asentar();
  t.mock.timers.tick(PLAZO_SIN_AVISOS_MS);
  await hecha;
}

test('con éxito: dice que se repara, pide, dice que ya está y recarga sin que el navegador pregunte', async () => {
  const { pasos, entorno } = navegador([{ ok: true }]);
  await repararLaCopia(entorno);
  assert.deepEqual(pasos, ['reparando', 'pedir REPARAR_COPIA', 'reparado', 'recargar sin preguntar']);
});

test('la respuesta tardía de un intento anterior no cuenta: espera la de su petición', async (t) => {
  const { pasos, reintentos, pedidas, entorno } = navegador([null, { ok: true }], true, [
    { ok: false, motivo: 'sin-completar' },
  ]);
  await sinAvisos(t, entorno);
  assert.deepEqual(pasos, ['reparando', 'pedir REPARAR_COPIA', `fallo ${ERROR_REPARAR_SIN_COMPLETAR}`]);
  reintentos[0]?.();
  await asentar();
  assert.notEqual(pedidas[0], pedidas[1], 'cada petición lleva su número');
  assert.deepEqual(pasos.slice(PASOS_DEL_PRIMER_INTENTO), [
    'reparando',
    'pedir REPARAR_COPIA',
    'reparado',
    'recargar sin preguntar',
  ]);
});

test('si la red se corta, lo dice, no recarga y volver a intentarlo repara', async () => {
  const { pasos, reintentos, entorno } = navegador([{ ok: false, motivo: 'sin-completar' }, { ok: true }]);
  await repararLaCopia(entorno);
  assert.deepEqual(pasos, ['reparando', 'pedir REPARAR_COPIA', `fallo ${ERROR_REPARAR_SIN_COMPLETAR}`]);
  reintentos[0]?.();
  await asentar();
  assert.deepEqual(pasos.slice(PASOS_DEL_PRIMER_INTENTO), [
    'reparando',
    'pedir REPARAR_COPIA',
    'reparado',
    'recargar sin preguntar',
  ]);
});

test('si lo que llega no es de esta versión, lo dice con su explicación y no recarga', async () => {
  const { pasos, entorno } = navegador([{ ok: false, motivo: 'no-coincide' }]);
  await repararLaCopia(entorno);
  assert.deepEqual(pasos, ['reparando', 'pedir REPARAR_COPIA', `fallo ${ERROR_REPARAR_NO_COINCIDE}`]);
});

test('si el service worker no avisa de nada en su plazo, es una reparación sin completar', async (t) => {
  const { pasos, entorno } = navegador([null]);
  await sinAvisos(t, entorno);
  assert.deepEqual(pasos, ['reparando', 'pedir REPARAR_COPIA', `fallo ${ERROR_REPARAR_SIN_COMPLETAR}`]);
});

test('sin service worker que controle la página, solo recarga', async () => {
  const { pasos, entorno } = navegador([], false);
  await repararLaCopia(entorno);
  assert.deepEqual(pasos, ['recargar']);
});

test('tras la copia guardada que no coincide se ofrece reparar; tras la primera visita, nada', () => {
  const otras = [{ texto: traducible('otra'), accion: () => {} }];
  const copia = salidasTrasElFallo(new ErrorFaro(traducible(ERROR_MOTOR_QUE_NO_COINCIDE), 0, {}), otras);
  assert.deepEqual(
    copia.map(({ texto }) => texto),
    [traducible('recorrido.reparar')],
  );
  assert.deepEqual(salidasTrasElFallo(new ErrorFaro(traducible(ERROR_INSTALACION_QUE_NO_COINCIDE), 0, {}), otras), []);
  assert.equal(salidasTrasElFallo(new Error('otro'), otras), otras);
});

test('en la conversación: «reparando» se retira al fallar, se ofrece volver a intentarlo y no se recarga', async () => {
  const { pasos, entorno } = navegador([{ ok: false, motivo: 'sin-completar' }]);
  const { conversacion: _propia, ...sinConversacion } = entorno as Record<string, unknown>;
  dicho.length = 0;
  await repararLaCopia(sinConversacion as Parameters<typeof repararLaCopia>[0]);
  assert.deepEqual(dicho, [
    'espera recorrido.reparando',
    'sin espera',
    `fallo ${ERROR_REPARAR_SIN_COMPLETAR}`,
    'sugerencias recorrido.reintentar',
  ]);
  assert.ok(!pasos.includes('recargar'), 'la conversación sigue: solo vuelve a empezar al completar la reparación');
});

test('en la conversación: al terminar, «reparando» pasa a «reparado» y se recarga (vuelve a empezar)', async () => {
  const { pasos, entorno } = navegador([{ ok: true }]);
  const { conversacion: _propia, ...sinConversacion } = entorno as Record<string, unknown>;
  dicho.length = 0;
  await repararLaCopia(sinConversacion as Parameters<typeof repararLaCopia>[0]);
  assert.deepEqual(dicho, ['espera recorrido.reparando', 'espera recorrido.reparado']);
  assert.equal(pasos.at(-1), 'recargar sin preguntar');
});
