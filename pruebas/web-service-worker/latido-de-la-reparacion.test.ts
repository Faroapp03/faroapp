// «Reparar Faro» mantiene vivo al service worker como la copia del paquete (scripts/paquete-sin-conexion.js,
// seguirAlServiceWorker): desde su primer aviso, la página le repite su petición, con el mismo número, mientras espera,
// y solo deja de esperar tras un plazo sin avisos, no tras un plazo fijo. Con temporizadores falsos y un service worker
// de prueba que vive como en Firefox: se detiene IDLE_MS + EXTENDIDO_MS después de su último evento, pierde el archivo
// que estaba bajando (lo ya guardado en la provisional se queda) y vuelve a ponerse en marcha con un mensaje.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { type TestContext, test } from 'node:test';
import type { ErrorFaro } from '../../web/scripts/recorrido/api/errores.js';

registerHooks({
  resolve(spec, contexto, siguiente) {
    if (contexto.parentURL?.endsWith('/recorrido/reparar.js') && ['./conversacion.js', './pagina.js'].includes(spec)) {
      return { url: new URL('./conversacion-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});
const { ERROR_REPARAR_SIN_COMPLETAR, repararLaCopia } = await import('../../web/scripts/recorrido/reparar.js');

const IDLE_MS = 30_000;
const EXTENDIDO_MS = 30_000;
/** Lo imprescindible por 3G: nueve archivos de 20 s, unos 3 min; más que la vida sin eventos y que el plazo de antes. */
const ARCHIVOS = 9;
const ARCHIVO_MS = 20_000;
/** El latido del service worker mientras recibe datos (service-worker.js, LATIDO_MS). */
const AVISO_DEL_SERVICIO_MS = 5000;
const SEGUNDO = 1000;
const HASTA_MS = 600_000;
const vuelta = () => new Promise((listo) => setImmediate(listo));

/** Cómo está el service worker de prueba: su reloj, su vida, lo guardado en la provisional y las peticiones. */
function estadoInicial() {
  return {
    ahora: 0,
    ultimoEvento: 0,
    enMarcha: false,
    guardados: 0,
    bajado: 0,
    detenciones: 0,
    arranques: 0,
    ids: [] as unknown[],
    averiado: false,
  };
}
type EstadoDelServicio = ReturnType<typeof estadoInicial>;
type Avisar = (data: unknown) => void;

/** Una petición de la página: es un evento, que lo pone en marcha; al empezar, avisa de que sigue (sin cifras). */
function alRecibirUnaPeticion(estado: EstadoDelServicio, avisar: Avisar, { type, id }: { type: string; id: unknown }) {
  assert.equal(type, 'REPARAR_COPIA');
  estado.ids.push(id);
  if (estado.averiado) {
    return;
  }
  estado.ultimoEvento = estado.ahora;
  if (!estado.enMarcha) {
    estado.enMarcha = true;
    estado.arranques += 1;
    avisar({ type: 'PROGRESO_DE_LA_REPARACION', id });
  }
}

/**
 * Un segundo de la reparación en marcha: el navegador la detiene si su último evento queda más lejos que IDLE_MS +
 * EXTENDIDO_MS, y el archivo a medias se pierde; si no, baja, avisa con cada archivo guardado y cada
 * AVISO_DEL_SERVICIO_MS, y responde al terminar.
 */
function seguirReparando(estado: EstadoDelServicio, avisar: Avisar) {
  if (estado.ahora - estado.ultimoEvento > IDLE_MS + EXTENDIDO_MS) {
    estado.enMarcha = false;
    estado.bajado = 0;
    estado.detenciones += 1;
    return;
  }
  estado.bajado += SEGUNDO;
  const id = estado.ids.at(-1);
  if (estado.bajado >= ARCHIVO_MS) {
    estado.bajado = 0;
    estado.guardados += 1;
    avisar({ type: 'PROGRESO_DE_LA_REPARACION', id });
  } else if (estado.bajado % AVISO_DEL_SERVICIO_MS === 0) {
    avisar({ type: 'PROGRESO_DE_LA_REPARACION', id });
  }
  if (estado.guardados === ARCHIVOS) {
    estado.enMarcha = false;
    avisar({ type: 'COPIA_REPARADA', id, ok: true });
  }
}

/** La página de prueba: anota lo que dice Faro y si recarga. */
function pagina(contenedor: unknown) {
  const pasos: string[] = [];
  const entorno = {
    contenedor,
    raiz: { dataset: {} as Record<string, string> },
    recargar: () => pasos.push('recargar'),
    conversacion: {
      reparando: () => pasos.push('reparando'),
      reparado: () => pasos.push('reparado'),
      fallo: (error: ErrorFaro) => pasos.push(`fallo ${(error.explicacion as { clave: string }).clave}`),
    },
  };
  return { pasos, entorno: entorno as unknown as Parameters<typeof repararLaCopia>[0] };
}

/** El service worker de prueba, con la vida que le da Firefox, y la página que le pide la reparación. */
function servicioComoEnFirefox(t: TestContext) {
  const oyentes = new EventTarget();
  const estado = estadoInicial();
  const avisar: Avisar = (data) => oyentes.dispatchEvent(new MessageEvent('message', { data }));
  const contenedor = {
    controller: {
      postMessage: (mensaje: { type: string; id: unknown }) => alRecibirUnaPeticion(estado, avisar, mensaje),
    },
    addEventListener: (tipo: string, oyente: EventListener) => oyentes.addEventListener(tipo, oyente),
    removeEventListener: (tipo: string, oyente: EventListener) => oyentes.removeEventListener(tipo, oyente),
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** Un segundo más de reloj: primero lo que la página tenía programado, después lo que hace el service worker. */
  const pasar = async () => {
    estado.ahora += SEGUNDO;
    t.mock.timers.tick(SEGUNDO);
    if (estado.enMarcha) {
      seguirReparando(estado, avisar);
    }
    await vuelta();
  };
  return { estado, pasar, ...pagina(contenedor) };
}

test('una reparación de 3 min por 3G termina bien: la página mantiene vivo al service worker', async (t) => {
  const sw = servicioComoEnFirefox(t);
  let acabada = false;
  void repararLaCopia(sw.entorno).then(() => {
    acabada = true;
  });
  await vuelta();
  while (!acabada && sw.estado.ahora < HASTA_MS) {
    await sw.pasar();
  }
  assert.deepEqual(sw.pasos, ['reparando', 'reparado', 'recargar'], `a los ${sw.estado.ahora} ms`);
  assert.equal(sw.estado.detenciones, 0, 'el navegador no lo detiene');
  assert.equal(sw.estado.arranques, 1, 'un solo intento');
  assert.equal(new Set(sw.estado.ids).size, 1, 'el latido repite la petición con el mismo número');
  assert.ok(sw.estado.ids.length > 1, 'la página repite la petición mientras espera');
});

test('si el navegador lo detiene a mitad, la siguiente petición lo pone en marcha y sigue donde lo dejó', async (t) => {
  const sw = servicioComoEnFirefox(t);
  let acabada = false;
  void repararLaCopia(sw.entorno).then(() => {
    acabada = true;
  });
  await vuelta();
  const detenidoA = 70_000;
  while (!acabada && sw.estado.ahora < HASTA_MS) {
    await sw.pasar();
    if (sw.estado.ahora === detenidoA) {
      sw.estado.enMarcha = false;
      sw.estado.bajado = 0;
      sw.estado.detenciones += 1;
    }
  }
  assert.deepEqual(sw.pasos, ['reparando', 'reparado', 'recargar']);
  assert.equal(sw.estado.arranques, 2, 'vuelve a ponerse en marcha una vez');
  assert.equal(new Set(sw.estado.ids).size, 1);
});

test('un service worker que deja de avisar: la reparación queda sin completar tras el plazo sin avisos', async (t) => {
  const sw = servicioComoEnFirefox(t);
  let acabada = false;
  void repararLaCopia(sw.entorno).then(() => {
    acabada = true;
  });
  await vuelta();
  // Avisa durante 30 s y después ya no responde a nada.
  while (!acabada && sw.estado.ahora < HASTA_MS) {
    await sw.pasar();
    if (sw.estado.ahora === IDLE_MS) {
      sw.estado.enMarcha = false;
      sw.estado.averiado = true;
    }
  }
  assert.deepEqual(sw.pasos, ['reparando', `fallo ${ERROR_REPARAR_SIN_COMPLETAR}`]);
  assert.ok(sw.estado.ahora < IDLE_MS + 2 * IDLE_MS + 2 * SEGUNDO, `deja de esperar a los ${sw.estado.ahora} ms`);
});
