import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { cargar, navegador, pagina } from '../web-controles/ayudas.js';

// El arranque común tiene su propia prueba. Aquí se ejercitan el borrado real y sus dependencias,
// con almacenes de memoria: nunca se abre ni borra una base o caché del equipo.
const hooks = registerHooks({
  load(url, contexto, siguiente) {
    if (url === new URL('../../web/scripts/sitio.js', import.meta.url).href) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return siguiente(url, contexto);
  },
});
after(() => hooks.deregister());

/** @param {Record<string, string>} claves */
function almacenamiento(claves) {
  const almacen = { ...claves };
  Object.defineProperty(almacen, 'removeItem', {
    value: (/** @type {string} */ clave) => {
      delete almacen[clave];
    },
  });
  return almacen;
}

/** @typedef {{ confirmar?: boolean, fallaCache?: boolean, fallaBase?: boolean, otroAlcance?: boolean, borrar?: (nombre: string) => Promise<void> }} Opciones */
/** Las copias de esta web que se borran a la vez: la de la web, la del paquete y la de estado. */
const BORRADOS_PARA_PROBAR_ESPERA = 3;
const CLAVES_MODOS_ANTIGUOS = ['faro-modos', 'faro-modo-inicial'];

function almacenesDePrueba() {
  const claves = {
    'otra-app': 'conservar',
    'faro-tema': 'oscuro',
    'faro-modo-elegido': 'ia-off',
    ...Object.fromEntries(CLAVES_MODOS_ANTIGUOS.map((clave) => [clave, 'ia-on'])),
  };
  return { local: almacenamiento(claves), sesion: almacenamiento(claves) };
}

/** @param {string[]} borradas @param {boolean | undefined} fallaBase */
function basesDePrueba(borradas, fallaBase) {
  return {
    deleteDatabase: (/** @type {string} */ nombre) => {
      borradas.push(nombre);
      const peticion = Object.assign(new EventTarget(), { onsuccess: () => {}, onerror: () => {} });
      queueMicrotask(() => {
        if (fallaBase) {
          peticion.onerror();
        } else {
          peticion.onsuccess();
          peticion.dispatchEvent(new Event('success'));
        }
      });
      return peticion;
    },
  };
}

/** @param {string[]} mensajes */
function canalDePrueba(mensajes) {
  return class Canal extends EventTarget {
    /** @param {string} mensaje */
    postMessage(mensaje) {
      mensajes.push(mensaje);
    }
    close() {}
  };
}

/** @param {import('node:test').TestContext} contexto @param {Opciones} opciones */
function prepararEntorno(contexto, opciones) {
  const almacenes = almacenesDePrueba();
  const base = new URL('../../web/', import.meta.url).href;
  const borrarCache = contexto.mock.fn(async (/** @type {string} */ nombre) => {
    await opciones.borrar?.(nombre);
    return true;
  });
  const retirar = contexto.mock.fn(async () => true);
  /** @type {string[]} */
  const borradas = [];
  const abrirCarpeta = contexto.mock.fn(() => {
    throw new Error('No se usa OPFS para estos datos');
  });
  /** @type {string[]} */
  const mensajes = [];
  /** @type {string[]} */
  const alertas = [];
  const ubicacion = { href: 'informacion-y-creditos.html' };
  navegador(contexto, {
    window: { caches: {} },
    localStorage: almacenes.local,
    sessionStorage: almacenes.sesion,
    confirm: () => opciones.confirmar !== false,
    alert: (/** @type {string} */ mensaje) => alertas.push(mensaje),
    location: ubicacion,
    BroadcastChannel: canalDePrueba(mensajes),
    caches: {
      keys: async () => {
        if (opciones.fallaCache) {
          throw new Error('Caché bloqueada');
        }
        return [
          `faro:${base}:v1`,
          'faro:https://otra.example/:v1',
          'faro-paquete-actual',
          `faro-estado:${base}`,
          'faro-estado:https://otra.example/',
          'otra-app',
        ];
      },
      delete: borrarCache,
    },
    navigator: {
      serviceWorker: {
        getRegistration: async () => ({ scope: opciones.otroAlcance ? `${base}otra/` : base, unregister: retirar }),
      },
      storage: { getDirectory: abrirCarpeta },
    },
    indexedDB: basesDePrueba(borradas, opciones.fallaBase),
  });
  return { ...almacenes, base, borrarCache, retirar, borradas, abrirCarpeta, mensajes, ubicacion, alertas };
}

/** @param {import('node:test').TestContext} contexto @param {Opciones} [opciones] */
async function escenario(contexto, opciones = {}) {
  const p = pagina(contexto);
  /** @type {() => Promise<void>} */
  let pulsar = async () => {
    throw new Error('No se conectó el botón');
  };
  // Esperar al manejador comprueba la finalización, no solo el lanzamiento de las operaciones.
  p.ids.set('borrar-todo', {
    addEventListener: (/** @type {string} */ nombre, /** @type {() => Promise<void>} */ funcion) => {
      assert.equal(nombre, 'click');
      pulsar = funcion;
    },
  });
  const entorno = prepararEntorno(contexto, opciones);
  await cargar('borrar-datos.js');
  return { pulsar, ...entorno };
}

test('cancelar no borra ni notifica ni navega', async (contexto) => {
  const p = await escenario(contexto, { confirmar: false });
  const antes = { ...p.local };
  await p.pulsar();
  assert.deepEqual(p.local, antes);
  assert.deepEqual(p.borradas, []);
  assert.equal(p.borrarCache.mock.callCount(), 0);
  assert.equal(p.retirar.mock.callCount(), 0);
  assert.deepEqual(p.mensajes, []);
  assert.equal(p.ubicacion.href, 'informacion-y-creditos.html');
});

test('borra solo recursos de Faro, incluidas preferencias antiguas, y espera antes de volver', async (contexto) => {
  const p = await escenario(contexto);
  await p.pulsar();
  for (const almacen of [p.local, p.sesion]) {
    assert.equal(almacen['faro-tema'], undefined);
    assert.equal(almacen['faro-modo-elegido'], undefined);
    assert.equal(almacen['otra-app'], 'conservar');
    for (const clave of CLAVES_MODOS_ANTIGUOS) {
      assert.equal(almacen[clave], undefined);
    }
  }
  assert.deepEqual(
    p.borrarCache.mock.calls.map((llamada) => llamada.arguments),
    [[`faro:${p.base}:v1`], ['faro-paquete-actual'], [`faro-estado:${p.base}`]],
  );
  assert.equal(p.retirar.mock.callCount(), 1);
  assert.deepEqual(p.borradas, ['faro-motor-local']);
  assert.equal(p.abrirCarpeta.mock.callCount(), 0);
  assert.deepEqual(p.mensajes, ['borrar-todo']);
  assert.equal(p.ubicacion.href, 'inicio.html');
});

test('un registro con otro alcance no se retira', async (contexto) => {
  const p = await escenario(contexto, { otroAlcance: true });
  await p.pulsar();
  assert.equal(p.retirar.mock.callCount(), 0);
});

test('el fallo de una caché queda indicado y no impide otros intentos', async (contexto) => {
  const avisos = contexto.mock.method(console, 'warn', () => {});
  const p = await escenario(contexto, { fallaCache: true });
  await p.pulsar();
  assert.equal(avisos.mock.callCount(), 1);
  assert.deepEqual(p.borradas, ['faro-motor-local']);
  assert.deepEqual(p.mensajes, ['borrar-todo']);
  assert.equal(p.ubicacion.href, 'inicio.html');
});

test('un rechazo no permite navegar mientras otro borrado de caché sigue pendiente', async (contexto) => {
  const avisos = contexto.mock.method(console, 'warn', () => {});
  const pendiente = Promise.withResolvers();
  const iniciados = [];
  const p = await escenario(contexto, {
    borrar: async (nombre) => {
      iniciados.push(nombre);
      if (iniciados.length === 1) {
        throw new Error('Primer borrado bloqueado');
      }
      await pendiente.promise;
    },
  });
  let terminada = false;
  const tarea = p.pulsar().then(() => {
    terminada = true;
  });
  try {
    await new Promise((listo) => setImmediate(listo));
    assert.equal(iniciados.length, BORRADOS_PARA_PROBAR_ESPERA);
    assert.equal(terminada, false);
    assert.equal(p.ubicacion.href, 'informacion-y-creditos.html');
    assert.deepEqual(p.mensajes, []);
  } finally {
    pendiente.resolve(undefined);
    await tarea;
  }
  assert.equal(avisos.mock.callCount(), 1);
  assert.equal(p.ubicacion.href, 'inicio.html');
  assert.deepEqual(p.mensajes, ['borrar-todo']);
});

test('error al borrar la clave informa y mantiene la página para reintentar', async (contexto) => {
  contexto.mock.method(console, 'warn', () => {});
  const p = await escenario(contexto, { fallaBase: true });
  await p.pulsar();
  assert.equal(p.alertas.length, 1);
  assert.equal(p.ubicacion.href, 'informacion-y-creditos.html');
  assert.deepEqual(p.mensajes, ['borrar-todo']);
});
