import assert from 'node:assert/strict';
import { test } from 'node:test';
import es from '../../web/idiomas/es.js';
import { registrarDiccionario } from '../../web/scripts/textos.js';
import { Boton, cargar, evento, Nodo, navegador, pagina } from '../web-controles/ayudas.js';

registrarDiccionario('es', es);

// Cada vuelta vacía promesas/mensajes y después el plazo simulado de consulta entre pestañas.
const VUELTAS_PARA_ASENTAR = 4;

/** La página «Instalar Faro», a la que lleva el enlace del menú. */
const PAGINA_INSTALAR = new URL('../../web/instalar.html', import.meta.url).href;

/** Solo los contratos DOM utilizados por instalación; no simula renderizado. */
class Area extends Nodo {
  value = '';
}
class Registro extends EventTarget {
  waiting = new Trabajador();
  installing = null;
  active = new Trabajador();
}
class Trabajador extends EventTarget {
  state = 'installed';
  /** @type {unknown[]} */
  mensajes = [];
  /** @param {unknown} mensaje */
  postMessage(mensaje) {
    this.mensajes.push(mensaje);
  }
}

/** Deja terminar promesas y mensajes y vence el plazo de consulta entre pestañas. @param {import('node:test').TestContext} contexto */
async function asentar(contexto) {
  for (let vuelta = 0; vuelta < VUELTAS_PARA_ASENTAR; vuelta++) {
    await new Promise((listo) => setImmediate(listo));
    contexto.mock.timers.runAll();
  }
}

/**
 * `sinServiceWorker` quita `navigator.serviceWorker` (Safari sin él); `inseguro` pone `isSecureContext` en false y quita
 * `navigator.storage` (como un contexto no seguro); `comoAplicacion` abre la página en modo standalone (Faro
 * instalado); `enInstalar` es la propia instalar.html (lleva [data-instalar]); `peticionAntes`, una petición del
 * navegador que llega después de cargar el módulo y antes de iniciarInstalacion.
 * `primeraVisita` deja el registro sin versión activa ni en espera y con una instalándose; `constancia` es lo que
 * devuelve la copia de estado del service worker (service-worker.js, «Instalación que no coincide»).
 * @typedef {{ paso?: string, escrito?: string, otra?: boolean, controlada?: boolean, bloqueo?: Error,
 *   sinServiceWorker?: boolean, inseguro?: boolean, comoAplicacion?: boolean, enInstalar?: boolean,
 *   peticionAntes?: Event, primeraVisita?: boolean, constancia?: object }} Opciones
 */

/** @param {string} etiqueta */
function crearElemento(etiqueta) {
  return etiqueta === 'button' ? new Boton() : new Nodo();
}

/** @param {import('node:test').TestContext} contexto @param {Opciones} opciones */
function prepararPagina(contexto, opciones) {
  const p = pagina(contexto);
  Object.assign(p.document, { readyState: 'complete', createElement: crearElemento });
  if (opciones.paso !== undefined) {
    p.document.body.dataset.paso = opciones.paso;
  }
  const campo = new Area();
  campo.value = opciones.escrito ?? '';
  p.ids.set('mensaje', campo);
  const menu = new Nodo();
  p.ids.set('menu', menu);
  if (opciones.enInstalar) {
    p.consultas.set('[data-instalar]', [new Nodo()]);
  }
  return { ...p, menu };
}

/** @param {import('node:test').TestContext} contexto @param {Opciones} opciones */
function servicioDePrueba(contexto, opciones) {
  const registro = new Registro();
  if (opciones.primeraVisita) {
    const instalandose = new Trabajador();
    instalandose.state = 'installing';
    Object.assign(registro, { active: null, waiting: null, installing: instalandose });
  }
  const contenedor = Object.assign(new EventTarget(), {
    controller: opciones.controlada === false ? null : new Trabajador(),
    ready: Promise.resolve(registro),
    startMessages() {},
    register: contexto.mock.fn(async () => {
      if (opciones.bloqueo) {
        throw opciones.bloqueo;
      }
      return registro;
    }),
  });
  return { registro, contenedor };
}

/** Canal de prueba que contesta únicamente si otra pestaña conserva trabajo. @param {boolean} otra */
function claseDelCanal(otra) {
  return class Canal extends EventTarget {
    /** @param {string} mensaje */
    postMessage(mensaje) {
      if (mensaje === 'algo-que-perder?' && otra) {
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: 'algo-que-perder' })));
      }
    }
  };
}

/** @param {import('node:test').TestContext} contexto @param {Opciones} [opciones] */
async function arrancar(contexto, opciones = {}) {
  contexto.mock.timers.enable({ apis: ['setTimeout'] });
  const p = prepararPagina(contexto, opciones);
  const servicio = servicioDePrueba(contexto, opciones);
  const persistir = contexto.mock.fn(async () => true);
  const almacenamiento = { persisted: async () => false, persist: persistir };
  const Canal = claseDelCanal(opciones.otra ?? false);
  const ventana = Object.assign(new EventTarget(), { isSecureContext: !opciones.inseguro, BroadcastChannel: Canal });
  const modo = Object.assign(new EventTarget(), { matches: opciones.comoAplicacion ?? false });
  const recargar = contexto.mock.fn();
  const confirmar = contexto.mock.fn(() => true);
  navegador(contexto, {
    window: ventana,
    navigator: {
      ...(opciones.sinServiceWorker ? {} : { serviceWorker: servicio.contenedor }),
      ...(opciones.inseguro ? {} : { storage: almacenamiento }),
    },
    matchMedia: () => modo,
    location: { reload: recargar },
    confirm: confirmar,
    BroadcastChannel: Canal,
    HTMLTextAreaElement: Area,
    ServiceWorkerRegistration: Registro,
    caches: {
      match: async () => (opciones.constancia ? Response.json(opciones.constancia) : undefined),
    },
  });
  /** @type {typeof import('../../web/scripts/instalacion.js')} */
  const modulo = await cargar('instalacion.js');
  if (opciones.peticionAntes) {
    ventana.dispatchEvent(opciones.peticionAntes);
  }
  modulo.iniciarInstalacion();
  await asentar(contexto);
  return { ...p, ...servicio, recargar, confirmar, ventana, persistir, modo, modulo };
}

/** El escenario con vigilancia de versiones: el aviso es lo último que añade a la página. @param {import('node:test').TestContext} contexto @param {Opciones} [opciones] */
async function escenario(contexto, opciones = {}) {
  const p = await arrancar(contexto, opciones);
  const aviso = p.document.body.children.at(-1);
  assert.ok(aviso);
  return { ...p, aviso };
}

test('sin trabajo pendiente activa la versión y recarga; el primer control no recarga', async (contexto) => {
  const p = await escenario(contexto);
  assert.deepEqual(p.registro.waiting.mensajes, [{ type: 'ACTIVATE_UPDATE' }]);
  p.contenedor.dispatchEvent(new Event('controllerchange'));
  assert.equal(p.recargar.mock.callCount(), 1);
  assert.equal(p.document.documentElement.dataset.actualizando, '');
});

test('primera instalación prepara datos sin activar ni recargar una versión anterior', async (contexto) => {
  const p = await escenario(contexto, { controlada: false });
  assert.deepEqual(p.registro.waiting.mensajes, []);
  assert.deepEqual(p.registro.active.mensajes, [{ type: 'PREPARAR_PAQUETE' }]);
  p.contenedor.dispatchEvent(new Event('controllerchange'));
  assert.equal(p.recargar.mock.callCount(), 0);
});

for (const opciones of [{ paso: '2' }, { paso: '1', escrito: 'Trabajo sin enviar' }]) {
  test(`con trabajo pendiente (${JSON.stringify(opciones)}) avisa y pide confirmación`, async (contexto) => {
    const p = await escenario(contexto, opciones);
    assert.deepEqual(p.registro.waiting.mensajes, []);
    assert.equal(p.aviso.hidden, false);
    p.contenedor.dispatchEvent(new Event('controllerchange'));
    assert.equal(p.recargar.mock.callCount(), 0);
    const actualizar = p.aviso.children.at(1);
    assert.ok(actualizar);
    actualizar.dispatchEvent(evento('click'));
    await asentar(contexto);
    assert.equal(p.confirmar.mock.callCount(), 1);
    assert.deepEqual(p.registro.waiting.mensajes, [{ type: 'ACTIVATE_UPDATE' }]);
    p.contenedor.dispatchEvent(new Event('controllerchange'));
    assert.equal(p.recargar.mock.callCount(), 1);
  });
}

test('otra pestaña con trabajo impide la activación automática', async (contexto) => {
  const p = await escenario(contexto, { otra: true });
  assert.deepEqual(p.registro.waiting.mensajes, []);
  assert.equal(p.recargar.mock.callCount(), 0);
});

test('otra pestaña también impide activar después de confirmar aquí', async (contexto) => {
  const p = await escenario(contexto, { paso: '2', otra: true });
  p.aviso.children.at(1)?.dispatchEvent(evento('click'));
  await asentar(contexto);
  assert.equal(p.confirmar.mock.callCount(), 1);
  assert.deepEqual(p.registro.waiting.mensajes, []);
  assert.equal(p.aviso.children[0]?.textContent, es['instalacion.otra-pestana']);
});

/** Una petición del navegador (beforeinstallprompt) con su ventana simulada. @param {import('node:test').TestContext} contexto @param {string} [respuesta] */
function peticionDelNavegador(contexto, respuesta = 'accepted') {
  const prompt = contexto.mock.fn(async () => {});
  const peticion = evento('beforeinstallprompt', { prompt, userChoice: Promise.resolve({ outcome: respuesta }) });
  return { prompt, peticion };
}

// No hay diálogo genérico de ayuda: la ventana del navegador se abre con instalar(), desde el botón de instalar.html
// (pruebas/web-informacion/instalar.test.ts). La petición exige el gesto, persiste y es de un solo uso; cuando el
// navegador no puede abrir la ventana, el resultado es «no-disponible» y la página lo explica.
test('instalar(): persistencia solo con el gesto y ventana del navegador de un solo uso', async (contexto) => {
  const p = await escenario(contexto);
  const enlace = p.menu.children[0];
  assert.ok(enlace);
  assert.equal(p.persistir.mock.callCount(), 0);
  assert.equal(p.modulo.estadoDeLaInstalacion(), 'no-disponible');
  const { prompt, peticion } = peticionDelNavegador(contexto);
  p.ventana.dispatchEvent(peticion);
  assert.equal(peticion.defaultPrevented, true);
  assert.equal(p.modulo.estadoDeLaInstalacion(), 'disponible');
  assert.equal(p.persistir.mock.callCount(), 0);
  assert.equal(await p.modulo.instalar(), 'aceptada');
  await asentar(contexto);
  assert.equal(prompt.mock.callCount(), 1);
  assert.equal(p.persistir.mock.callCount(), 1);
  assert.equal(p.modulo.estadoDeLaInstalacion(), 'instalada');
  assert.equal(enlace.hidden, true);
  assert.equal(await p.modulo.instalar(), 'no-disponible');
  assert.equal(prompt.mock.callCount(), 1);
});

test('instalar(): si la persona no acepta, la petición se gasta y el enlace sigue', async (contexto) => {
  const p = await escenario(contexto);
  const { prompt, peticion } = peticionDelNavegador(contexto, 'dismissed');
  p.ventana.dispatchEvent(peticion);
  /** @type {string[]} */
  const avisos = [];
  p.modulo.alCambiarLaInstalacion((/** @type {string} */ estado) => avisos.push(estado));
  assert.equal(await p.modulo.instalar(), 'rechazada');
  assert.equal(prompt.mock.callCount(), 1);
  assert.deepEqual(avisos, ['no-disponible']);
  assert.equal(p.menu.children[0]?.hidden, false);
});

test('instalar(): una ventana que el navegador no abre es «no-disponible»; otro fallo no se oculta', async (contexto) => {
  const p = await escenario(contexto);
  const caducada = evento('beforeinstallprompt', {
    prompt: async () => {
      throw new DOMException('Ya usada', 'InvalidStateError');
    },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  });
  p.ventana.dispatchEvent(caducada);
  assert.equal(await p.modulo.instalar(), 'no-disponible');
  const rota = evento('beforeinstallprompt', {
    prompt: async () => {
      throw new TypeError('Fallo del programa');
    },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  });
  p.ventana.dispatchEvent(rota);
  await assert.rejects(p.modulo.instalar(), TypeError);
  assert.equal(p.modulo.estadoDeLaInstalacion(), 'no-disponible');
});

test('appinstalled: el estado pasa a «instalada», avisa y oculta el enlace del menú', async (contexto) => {
  const p = await escenario(contexto);
  p.ventana.dispatchEvent(peticionDelNavegador(contexto).peticion);
  /** @type {string[]} */
  const avisos = [];
  p.modulo.alCambiarLaInstalacion((/** @type {string} */ estado) => avisos.push(estado));
  p.ventana.dispatchEvent(new Event('appinstalled'));
  assert.deepEqual(avisos, ['instalada']);
  assert.equal(p.modulo.estadoDeLaInstalacion(), 'instalada');
  assert.equal(p.menu.children[0]?.hidden, true);
  assert.equal(await p.modulo.instalar(), 'no-disponible');
});

test('abierto como aplicación: «abierta», sin enlace visible; al salir del modo vuelve', async (contexto) => {
  const p = await escenario(contexto, { comoAplicacion: true });
  const enlace = p.menu.children[0];
  assert.ok(enlace);
  assert.equal(p.modulo.estadoDeLaInstalacion(), 'abierta');
  assert.equal(enlace.hidden, true);
  p.modo.matches = false;
  p.modo.dispatchEvent(new Event('change'));
  assert.equal(p.modulo.estadoDeLaInstalacion(), 'no-disponible');
  assert.equal(enlace.hidden, false);
});

test('la petición del navegador se guarda desde que se carga el módulo, antes de iniciar la página', async (contexto) => {
  const { prompt, peticion } = peticionDelNavegador(contexto);
  const p = await escenario(contexto, { peticionAntes: peticion });
  assert.equal(peticion.defaultPrevented, true);
  assert.equal(p.modulo.estadoDeLaInstalacion(), 'disponible');
  assert.equal(await p.modulo.instalar(), 'aceptada');
  assert.equal(prompt.mock.callCount(), 1);
});

test('el menú de las demás páginas enlaza a instalar.html, como un enlace corriente', async (contexto) => {
  const p = await escenario(contexto);
  assert.equal(p.menu.children.length, 1);
  const enlace = p.menu.children[0];
  assert.ok(enlace);
  assert.equal(Reflect.get(enlace, 'href'), PAGINA_INSTALAR);
  assert.equal(Reflect.get(enlace, 'className'), 'instalacion-enlace');
  assert.equal(enlace.textContent, es['instalacion.titulo']);
  assert.equal(enlace.dataset.texto, 'instalacion.titulo');
  assert.equal(enlace.hidden, false);
});

test('en la propia instalar.html el menú no lleva el enlace', async (contexto) => {
  const p = await escenario(contexto, { enInstalar: true });
  assert.equal(p.menu.children.length, 0);
});

test('registro bloqueado conserva la página y diferencia restricción de fallo técnico', async (contexto) => {
  const avisos = contexto.mock.method(console, 'warn', () => {});
  const notas = contexto.mock.method(console, 'info', () => {});
  const p = await escenario(contexto, { bloqueo: new DOMException('Restringido', 'SecurityError') });
  assert.equal(notas.mock.callCount(), 1);
  assert.equal(avisos.mock.callCount(), 0);
  assert.equal(p.recargar.mock.callCount(), 0);
});

test('un error técnico al registrar queda visible en consola y no recarga', async (contexto) => {
  const avisos = contexto.mock.method(console, 'warn', () => {});
  const p = await escenario(contexto, { bloqueo: new TypeError('Guion inaccesible') });
  assert.equal(avisos.mock.callCount(), 1);
  assert.equal(p.recargar.mock.callCount(), 0);
});

/** @type {{ descripcion: string, condiciones: Opciones }[]} */
const SIN_INSTALACION_AUTOMATICA = [
  {
    descripcion: 'sin serviceWorker en navigator, con contexto seguro (Safari)',
    condiciones: { sinServiceWorker: true },
  },
  { descripcion: 'con isSecureContext false', condiciones: { inseguro: true } },
];

// Sin service worker (Safari) o sin contexto seguro, la página ofrece igualmente «Instalar Faro» como enlace del
// menú a instalar.html, y no recibe ni diálogo ni aviso.
for (const { descripcion, condiciones } of SIN_INSTALACION_AUTOMATICA) {
  test(`${descripcion}: el enlace a instalar.html sigue en el menú, sin registro ni aviso`, async (contexto) => {
    const p = await arrancar(contexto, condiciones);
    const enlace = p.menu.children[0];
    assert.ok(enlace);
    assert.equal(enlace.hidden, false);
    assert.equal(Reflect.get(enlace, 'href'), PAGINA_INSTALAR);
    assert.equal(enlace.textContent, es['instalacion.titulo']);
    assert.equal(p.contenedor.register.mock.callCount(), 0);
    assert.deepEqual(p.registro.active.mensajes, []);
    assert.equal(p.document.body.children.length, 0);
  });
}

// ---------- Instalación que no coincide ----------

/** La base de la web, la del service worker y la que lleva su aviso. */
const BASE_DE_LA_WEB = new URL('../../web/', import.meta.url).href;
const MARCA = 'instalacionNoCoincide';
const EVENTO = 'faro-instalacion-no-coincide';
/** Una constancia escrita después de empezar a seguir la instalación: la del intento que se descarta. */
const MAS_TARDE_MS = 60_000;

/** Cuántas veces se ha contado al recorrido que la instalación no coincide. @param {EventTarget} ventana */
function contarAvisos(ventana) {
  const contados = { veces: 0 };
  ventana.addEventListener(EVENTO, () => {
    contados.veces += 1;
  });
  return contados;
}

/** La versión que se instalaba se descarta. @param {Registro} registro */
function descartar(registro) {
  const trabajador = /** @type {Trabajador} */ (/** @type {unknown} */ (registro.installing));
  trabajador.state = 'redundant';
  trabajador.dispatchEvent(new Event('statechange'));
}

test('primera visita: el aviso del service worker de esta web pone la marca y lanza el evento una vez', async (c) => {
  const p = await arrancar(c, { primeraVisita: true });
  const avisos = contarAvisos(p.ventana);
  const aviso = { type: 'INSTALACION_QUE_NO_COINCIDE', archivo: 'motor/x.js', base: BASE_DE_LA_WEB };
  p.contenedor.dispatchEvent(new MessageEvent('message', { data: aviso }));
  p.contenedor.dispatchEvent(new MessageEvent('message', { data: aviso }));
  await asentar(c);
  assert.equal(p.document.documentElement.dataset[MARCA], '');
  assert.equal(avisos.veces, 1);
});

test('el aviso de otra web de Faro del mismo origen no marca esta', async (c) => {
  const p = await arrancar(c, { primeraVisita: true });
  const avisos = contarAvisos(p.ventana);
  const aviso = { type: 'INSTALACION_QUE_NO_COINCIDE', archivo: 'motor/x.js', base: 'https://faro.example/otra/' };
  p.contenedor.dispatchEvent(new MessageEvent('message', { data: aviso }));
  await asentar(c);
  assert.equal(p.document.documentElement.dataset[MARCA], undefined);
  assert.equal(avisos.veces, 0);
});

test('primera visita: una versión descartada con constancia de este intento pone la marca', async (c) => {
  const constancia = { motivo: 'no-coincide', archivo: 'motor/x.js', version: 'v', cuando: Date.now() + MAS_TARDE_MS };
  const p = await arrancar(c, { primeraVisita: true, constancia });
  const avisos = contarAvisos(p.ventana);
  descartar(p.registro);
  await asentar(c);
  assert.equal(p.document.documentElement.dataset[MARCA], '');
  assert.equal(avisos.veces, 1);
});

test('una constancia de un intento anterior no vale: la versión descartada no marca nada', async (c) => {
  const p = await arrancar(c, { primeraVisita: true, constancia: { motivo: 'no-coincide', archivo: 'x', cuando: 0 } });
  const avisos = contarAvisos(p.ventana);
  descartar(p.registro);
  await asentar(c);
  assert.equal(p.document.documentElement.dataset[MARCA], undefined);
  assert.equal(avisos.veces, 0);
});

test('con una versión activa, ni el aviso ni la constancia marcan nada: la anterior sigue sirviendo', async (c) => {
  const constancia = { motivo: 'no-coincide', archivo: 'motor/x.js', version: 'v', cuando: Date.now() + MAS_TARDE_MS };
  const p = await arrancar(c, { constancia });
  const avisos = contarAvisos(p.ventana);
  const aviso = { type: 'INSTALACION_QUE_NO_COINCIDE', archivo: 'motor/x.js', base: BASE_DE_LA_WEB };
  p.contenedor.dispatchEvent(new MessageEvent('message', { data: aviso }));
  await asentar(c);
  assert.equal(p.document.documentElement.dataset[MARCA], undefined);
  assert.equal(avisos.veces, 0);
});
