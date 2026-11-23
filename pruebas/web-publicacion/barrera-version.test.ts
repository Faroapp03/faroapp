import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';

const fuente = readFileSync(new URL('../../web/scripts/barrera-version.js', import.meta.url), 'utf8');
const marca = '1234567890abcdef';
const PLAZO_HOJA = 5000;

type Opciones = {
  controlador: boolean;
  version?: string;
  canal?: 'ocupado' | 'libre';
  hash?: string;
  red?: string;
  consumirAlPrimero?: () => void;
  dosGuiones?: boolean;
  preload?: boolean;
  almacenamientoBloqueado?: boolean;
  /** El sessionStorage de la pestaña: compartirlo entre dos ensayos es recargar la misma pestaña. */
  sesion?: Map<string, string>;
  instalacionRetrasada?: boolean;
  instalacionFallida?: boolean;
  consultasDeEspera?: number;
  idioma?: 'es' | 'ca';
  idiomaElegido?: 'es' | 'ca';
  fallarGuion?: number;
  hoja?: boolean;
  fallarHojaUnaVez?: boolean;
  agotarHoja?: boolean;
  ultimoEnlace?: Enlace;
  sinAviso?: boolean;
};
class Guion {
  src = 'https://ejemplo.invalid/scripts/barrera-version.js';
  async = true;
  oyentes = new Map<string, () => void>();
  cloneNode() {
    return new Guion();
  }
  addEventListener(tipo: string, fn: () => void) {
    this.oyentes.set(tipo, fn);
  }
}
class Enlace {
  rel: string;
  oyentes = new Map<string, () => void>();
  constructor(rel = 'modulepreload') {
    this.rel = rel;
  }
  cloneNode() {
    return new Enlace(this.rel);
  }
  addEventListener(tipo: string, fn: () => void) {
    this.oyentes.set(tipo, fn);
  }
  removeEventListener(tipo: string) {
    this.oyentes.delete(tipo);
  }
  remove() {}
}
function canalPara(opciones: Opciones) {
  class Canal {
    listener?: (mensaje: { data: string }) => void;
    addEventListener(_tipo: string, fn: (mensaje: { data: string }) => void) {
      this.listener = fn;
    }
    postMessage() {
      if (opciones.canal === 'ocupado') {
        this.listener?.({ data: 'algo-que-perder' });
      }
    }
    close() {}
  }
  return Canal;
}
function crearServiceWorker(opciones: Opciones, acciones: string[]) {
  let lecturas = 0;
  const trabajador = {
    postMessage() {
      acciones.push('activar');
    },
  };
  const registro = {
    async update() {
      acciones.push('update');
    },
    get waiting() {
      opciones.consultasDeEspera = (opciones.consultasDeEspera ?? 0) + 1;
      if (opciones.instalacionFallida || (opciones.instalacionRetrasada && lecturas++ < 2)) {
        return null;
      }
      return trabajador;
    },
    get installing() {
      return opciones.instalacionFallida ? null : {};
    },
  };
  const oyentes = new Map<string, () => void>();
  return {
    controller: opciones.controlador ? {} : null,
    addEventListener(tipo: string, fn: () => void) {
      oyentes.set(tipo, fn);
    },
    async getRegistration() {
      return registro;
    },
    cambiarControlador: () => oyentes.get('controllerchange')?.(),
  };
}
class Elemento {
  hidden = true;
  inert = false;
  textContent = '';
  id = '';
  atributos = new Map<string, string>();
  append() {}
  setAttribute(nombre: string, valor: string) {
    this.atributos.set(nombre, valor);
  }
}
function listaPlantillas() {
  return [] as {
    content: { firstElementChild: Guion | Enlace };
    hasAttribute: () => boolean;
    replaceWith: (nodo: Guion) => void;
    parentNode?: { insertBefore: (nodo: Enlace) => void };
    remove?: () => void;
  }[];
}
function crearHoja(opciones: Opciones, acciones: string[], pendientes: ReturnType<typeof listaPlantillas>) {
  const hoja = {
    content: { firstElementChild: new Enlace('stylesheet') },
    hasAttribute: () => true,
    replaceWith() {
      acciones.push('hoja-sin-esperar');
    },
    parentNode: {
      insertBefore(nodo: Enlace) {
        acciones.push('hoja');
        opciones.ultimoEnlace = nodo;
        if (opciones.agotarHoja) {
          return;
        }
        const evento = opciones.fallarHojaUnaVez ? 'error' : 'load';
        opciones.fallarHojaUnaVez = false;
        nodo.oyentes.get(evento)?.();
      },
    },
    remove() {
      pendientes.splice(pendientes.indexOf(hoja), 1);
    },
  };
  return hoja;
}
function crearPlantillas(opciones: Opciones, acciones: string[]) {
  let numero = 0;
  const pendientes = listaPlantillas();
  const crearGuion = () => {
    const plantilla = {
      content: { firstElementChild: new Guion() },
      hasAttribute: () => true,
      replaceWith(nodo: Guion) {
        pendientes.splice(pendientes.indexOf(plantilla), 1);
        acciones.push('guion');
        opciones.consumirAlPrimero?.();
        delete opciones.consumirAlPrimero;
        numero++;
        nodo.oyentes.get(numero === opciones.fallarGuion ? 'error' : 'load')?.();
      },
    };
    return plantilla;
  };
  const enlace = {
    content: { firstElementChild: new Enlace() },
    hasAttribute: () => true,
    replaceWith() {
      pendientes.splice(pendientes.indexOf(enlace), 1);
      acciones.push('preload');
    },
  };
  if (opciones.hoja) {
    pendientes.push(crearHoja(opciones, acciones, pendientes));
  }
  pendientes.push(crearGuion());
  if (opciones.preload) {
    pendientes.push(enlace);
  }
  if (opciones.dosGuiones) {
    pendientes.push(crearGuion());
  }
  return () => pendientes;
}
/** El mapa de módulos de la página: anota cuándo la barrera lo aparta y cuándo lo repone. */
function crearMapa() {
  const mapa: string[] = [];
  const elementoMapa = {
    nextSibling: null,
    parentNode: {
      insertBefore() {
        mapa.push('reponer');
      },
    },
    remove() {
      mapa.push('apartar');
    },
  };
  return { mapa, elementoMapa };
}
function crearContenidos(): [Elemento, Elemento] {
  const contenido = new Elemento();
  contenido.hidden = false;
  return [contenido, new Elemento()];
}
/** El cuerpo de la página: con su aviso o, con `sinAviso`, sin él hasta que la barrera cree uno. */
function crearCuerpo(opciones: Opciones) {
  const aviso = new Elemento();
  const [contenido, contenidoOculto] = crearContenidos();
  const creados: Elemento[] = [];
  const cuerpo: Elemento[] = opciones.sinAviso ? [contenido, contenidoOculto] : [aviso, contenido, contenidoOculto];
  const body = { inert: true, children: cuerpo, prepend: (nodo: Elemento) => cuerpo.unshift(nodo) };
  const getElementById = (id: string) =>
    opciones.sinAviso ? (cuerpo.find((elemento) => elemento.id === id) ?? null) : aviso;
  const crear = (etiqueta: string) => {
    const elemento = Object.assign(new Elemento(), { etiqueta, hidden: false });
    creados.push(elemento);
    return elemento;
  };
  return { aviso, contenido, contenidoOculto, creados, cuerpo, body, getElementById, crear };
}
/** Un botón del aviso: su rótulo y lo que hace al pulsarlo, que se guarda con `alEscuchar`. */
type BotonDoble = { type: string; textContent: string; addEventListener(tipo: string, fn: () => void): void };
function botonDoble(alEscuchar: (fn: () => void) => void): BotonDoble {
  return {
    type: '',
    textContent: '',
    addEventListener(_tipo: string, fn: () => void) {
      alEscuchar(fn);
    },
  };
}
function entorno(opciones: Opciones, acciones: string[]) {
  const { mapa, elementoMapa } = crearMapa();
  let iniciar: (() => void) | undefined;
  let pulsar: (() => void) | undefined;
  let botones = 0;
  let ultimoBoton: BotonDoble | undefined;
  const pagina = crearCuerpo(opciones);
  const consultarPlantillas = crearPlantillas(opciones, acciones);
  const sw = crearServiceWorker(opciones, acciones);
  const Canal = canalPara(opciones);
  const document = {
    currentScript: new Guion(),
    documentElement: {
      hidden: false,
      lang: opciones.idioma ?? 'es',
      dataset: opciones.idiomaElegido ? { idioma: opciones.idiomaElegido } : {},
    },
    body: pagina.body,
    querySelector: (selector: string) =>
      selector.includes('importmap') ? elementoMapa : { getAttribute: () => marca },
    querySelectorAll: consultarPlantillas,
    getElementById: pagina.getElementById,
    createElement: (etiqueta: string) => {
      if (etiqueta !== 'button') {
        return pagina.crear(etiqueta);
      }
      botones++;
      ultimoBoton = botonDoble((fn) => {
        pulsar = fn;
      });
      return ultimoBoton;
    },
    addEventListener(_nombre: string, fn: () => void) {
      iniciar = fn;
    },
  };
  return {
    mapa,
    pagina,
    sw,
    Canal,
    document,
    iniciar: () => iniciar?.(),
    pulsar: () => pulsar?.(),
    contarBotones: () => botones,
    rotulo: () => ultimoBoton?.textContent,
  };
}
function almacenamiento(opciones: Opciones) {
  const sesion = opciones.sesion ?? new Map<string, string>();
  const comprobar = () => {
    if (opciones.almacenamientoBloqueado) {
      throw new Error('sin almacenamiento');
    }
  };
  return {
    getItem(clave: string) {
      comprobar();
      return sesion.get(clave) ?? null;
    },
    setItem(clave: string, valor: string) {
      comprobar();
      sesion.set(clave, valor);
    },
    removeItem(clave: string) {
      comprobar();
      sesion.delete(clave);
    },
  };
}
function ubicacion(opciones: Opciones, acciones: string[]) {
  const location = {
    hash: opciones.hash ?? '',
    pathname: '/recorrido.html',
    search: '',
    reload() {
      acciones.push('reload');
    },
  };
  return {
    history: {
      state: null,
      replaceState() {
        acciones.push('limpiar-fragmento');
        location.hash = '';
      },
    },
    location,
  };
}
function crearVentana(
  opciones: Opciones,
  canal: ReturnType<typeof canalPara>,
  location: ReturnType<typeof ubicacion>['location'],
) {
  const oyentesVentana = new Map<string, () => void>();
  const ventana = {
    ...(opciones.canal ? { BroadcastChannel: canal } : {}),
    addEventListener(tipo: string, fn: () => void) {
      oyentesVentana.set(tipo, fn);
    },
  };
  return {
    ventana,
    cambiarFragmento: (hash: string) => {
      location.hash = hash;
      oyentesVentana.get('hashchange')?.();
    },
  };
}
function prepararCambioTrasPrimerGuion(opciones: Opciones, ventana: object) {
  if (opciones.dosGuiones && opciones.hash) {
    opciones.consumirAlPrimero = () => {
      const tomar = Reflect.get(ventana, Symbol.for('faro.fragmento.transitorio'));
      tomar();
      opciones.version = 'aaaaaaaaaaaaaaaa';
    };
  }
}
function reloj() {
  let pendiente: (() => void) | undefined;
  return {
    set(fn: () => void, ms: number) {
      if (ms === PLAZO_HOJA) {
        pendiente = fn;
        return 1;
      }
      fn();
      return 0;
    },
    limpiar() {
      pendiente = undefined;
    },
    vencer() {
      const fn = pendiente;
      pendiente = undefined;
      fn?.();
    },
  };
}
async function ensayar(opciones: Opciones) {
  const acciones: string[] = [];
  const e = entorno(opciones, acciones);
  const tiempo = reloj();
  const ubicacionSimulada = ubicacion(opciones, acciones);
  const { ventana, cambiarFragmento } = crearVentana(opciones, e.Canal, ubicacionSimulada.location);
  prepararCambioTrasPrimerGuion(opciones, ventana);
  runInNewContext(fuente, {
    document: e.document,
    navigator: { serviceWorker: e.sw },
    window: ventana,
    BroadcastChannel: e.Canal,
    HTMLScriptElement: Guion,
    HTMLElement: Elemento,
    HTMLLinkElement: Enlace,
    URL,
    AbortSignal,
    fetch: async (url: URL) => ({
      ok: true,
      json: async () => ({ version: opciones.version }),
      text: async () =>
        url.pathname.endsWith('service-worker.js') ? `const VERSION = '${opciones.red ?? marca}';` : '',
    }),
    sessionStorage: almacenamiento(opciones),
    setTimeout: tiempo.set,
    clearTimeout: tiempo.limpiar,
    ...ubicacionSimulada,
    console,
  });
  e.iniciar();
  await dejarTerminar();
  return {
    acciones,
    ...e.pagina,
    ventana,
    pulsar: e.pulsar,
    contarBotones: e.contarBotones,
    rotulo: e.rotulo,
    cambiarControlador: e.sw.cambiarControlador,
    mapa: e.mapa,
    cambiarFragmento,
    vencerPlazo: tiempo.vencer,
    raiz: e.document.documentElement,
  };
}
async function dejarTerminar() {
  for (let n = 0; n < 10; n++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('primera visita habilita los guiones sin forzar actualización', async () => {
  const r = await ensayar({ controlador: false });
  assert.deepEqual(r.acciones, ['guion']);
});
test('copia distinta no activa si falta canal', async () => {
  const r = await ensayar({ controlador: true, version: 'aaaaaaaaaaaaaaaa' });
  assert.deepEqual(r.acciones, ['update']);
  assert.equal(r.aviso.hidden, false);
});
test('copia distinta no activa con otra pestaña ocupada', async () => {
  const r = await ensayar({ controlador: true, version: 'aaaaaaaaaaaaaaaa', canal: 'ocupado' });
  assert.deepEqual(r.acciones, ['update']);
  assert.equal(r.aviso.hidden, false);
});

test('el fragmento se retira de la URL y solo se entrega una vez en memoria', async () => {
  const r = await ensayar({ controlador: false, hash: '#pasar=valor-sintetico' });
  assert.deepEqual(r.acciones, ['limpiar-fragmento', 'guion']);
  const clave = Symbol.for('faro.fragmento.transitorio');
  const tomar = Reflect.get(r.ventana, clave);
  assert.equal(typeof tomar, 'function');
  assert.equal(tomar(), '#pasar=valor-sintetico');
  assert.equal(Reflect.get(r.ventana, clave), undefined);
});

test('tras consumir QR un cambio de versión no recarga ni muestra el código', async () => {
  const opciones: Opciones = {
    controlador: true,
    version: marca,
    hash: '#pasar=valor-sintetico',
    dosGuiones: true,
    red: 'aaaaaaaaaaaaaaaa',
  };
  const r = await ensayar(opciones);
  assert.equal(r.aviso.hidden, false);
  const antes = r.contarBotones();
  r.pulsar();
  for (let n = 0; n < 10; n++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(r.acciones.includes('reload'), false);
  assert.equal(r.contarBotones(), antes);
  assert.match(r.aviso.textContent, /dispositivo de origen/);
  assert.doesNotMatch(r.aviso.textContent, /valor-sintetico/);
});

test('activa preloads antes de guiones aunque aparezcan después en HTML', async () => {
  const r = await ensayar({ controlador: false, preload: true });
  assert.deepEqual(r.acciones, ['preload', 'guion']);
});
test('un fallo al cargar un guion exige recargar, sin repetir guiones ya ejecutados', async () => {
  const r = await ensayar({ controlador: false, dosGuiones: true, fallarGuion: 2 });
  assert.deepEqual(r.acciones, ['guion', 'guion']);
  assert.equal(r.aviso.hidden, false);
  assert.equal(r.contenido.inert, true);
  r.pulsar();
  await dejarTerminar();
  assert.deepEqual(r.acciones, ['guion', 'guion', 'reload']);
  assert.equal(r.aviso.hidden, false);
});
test('un fallo al cargar un guion con QR pide reenviarlo sin recargar', async () => {
  const r = await ensayar({ controlador: false, hash: '#pasar=valor-sintetico', fallarGuion: 1 });
  assert.deepEqual(r.acciones, ['limpiar-fragmento', 'guion']);
  assert.equal(r.aviso.hidden, false);
  assert.match(r.aviso.textContent, /dispositivo de origen/);
  assert.equal(r.contarBotones(), 0);
  assert.equal(Reflect.get(r.ventana, Symbol.for('faro.fragmento.transitorio'))(), '#pasar=valor-sintetico');
});
test('tras un fallo de activación, un nuevo QR en la misma pestaña recarga una sola vez', async () => {
  const r = await ensayar({ controlador: false, hash: '#pasar=primero', fallarGuion: 1 });
  r.cambiarFragmento('#otro');
  assert.deepEqual(r.acciones, ['limpiar-fragmento', 'guion']);
  r.cambiarFragmento('#pasar=segundo');
  r.cambiarFragmento('#pasar=segundo');
  assert.deepEqual(r.acciones, ['limpiar-fragmento', 'guion', 'reload']);
  const nuevaPagina = await ensayar({ controlador: false, hash: '#pasar=segundo' });
  const tomar = Reflect.get(nuevaPagina.ventana, Symbol.for('faro.fragmento.transitorio'));
  assert.equal(tomar(), '#pasar=segundo');
  assert.equal(Reflect.get(nuevaPagina.ventana, Symbol.for('faro.fragmento.transitorio')), undefined);
});
test('un cambio de fragmento sin fallo de activación no fuerza recarga', async () => {
  const r = await ensayar({ controlador: false });
  r.cambiarFragmento('#pasar=nuevo');
  assert.deepEqual(r.acciones, ['guion']);
});
test('espera instalación tardía antes de solicitar activación', async () => {
  const r = await ensayar({
    controlador: true,
    version: 'aaaaaaaaaaaaaaaa',
    canal: 'libre',
    instalacionRetrasada: true,
  });
  assert.deepEqual(r.acciones, ['update', 'activar']);
});
test('sin almacenamiento la primera visita y versión compatible pueden cargar', async () => {
  const primera = await ensayar({ controlador: false, almacenamientoBloqueado: true });
  const compatible = await ensayar({ controlador: true, version: marca, almacenamientoBloqueado: true });
  assert.deepEqual(primera.acciones, ['guion']);
  assert.deepEqual(compatible.acciones, ['guion']);
});

test('si no puede guardar la guarda de recarga, no recarga en bucle', async () => {
  const r = await ensayar({
    controlador: true,
    version: 'aaaaaaaaaaaaaaaa',
    red: 'aaaaaaaaaaaaaaaa',
    almacenamientoBloqueado: true,
  });
  assert.equal(r.acciones.includes('reload'), false);
  assert.equal(r.aviso.hidden, false);
});
test('sin almacenamiento para la guarda, el aviso no culpa a la conexión y su botón vuelve a cargar la página', async () => {
  for (const [idioma, anterior, conexion] of [
    ['es', /no coincide con la versión instalada de Faro/, /conexión/],
    ['ca', /no coincideix amb la versió instal·lada de Faro/, /connexió/],
  ] as const) {
    const r = await ensayar({
      controlador: true,
      version: 'aaaaaaaaaaaaaaaa',
      red: 'aaaaaaaaaaaaaaaa',
      almacenamientoBloqueado: true,
      idioma,
    });
    assert.match(r.aviso.textContent, anterior);
    assert.doesNotMatch(r.aviso.textContent, conexion);
    r.pulsar();
    await dejarTerminar();
    assert.deepEqual(r.acciones, ['reload']);
  }
});
test('con la página antigua recarga sola una vez y anota la guarda en la sesión', async () => {
  const sesion = new Map<string, string>();
  const r = await ensayar({ controlador: true, version: 'aaaaaaaaaaaaaaaa', red: 'aaaaaaaaaaaaaaaa', sesion });
  assert.deepEqual(r.acciones, ['reload']);
  assert.deepEqual([...sesion.values()], [marca]);
});
test('si tras recargar la página sigue antigua, no recarga sola: pide volver a cargarla y su botón lo hace', async () => {
  for (const [idioma, texto, rotulo] of [
    ['es', /no coincide con la versión instalada de Faro/, 'Volver a cargar'],
    ['ca', /no coincideix amb la versió instal·lada de Faro/, 'Torna a carregar'],
  ] as const) {
    const sesion = new Map<string, string>();
    const opciones: Opciones = {
      controlador: true,
      version: 'aaaaaaaaaaaaaaaa',
      red: 'aaaaaaaaaaaaaaaa',
      sesion,
      idioma,
    };
    const primera = await ensayar(opciones);
    assert.deepEqual(primera.acciones, ['reload']);
    const segunda = await ensayar(opciones);
    assert.deepEqual(segunda.acciones, []);
    assert.equal(segunda.aviso.hidden, false);
    assert.match(segunda.aviso.textContent, texto);
    assert.equal(segunda.rotulo(), rotulo);
    segunda.pulsar();
    await dejarTerminar();
    assert.deepEqual(segunda.acciones, ['reload']);
  }
});
test('el aviso de un guion que no ha terminado de cargar ofrece volver a cargar la página', async () => {
  const r = await ensayar({ controlador: false, dosGuiones: true, fallarGuion: 2, idioma: 'ca' });
  assert.equal(r.rotulo(), 'Torna a carregar');
});
test('el fallo al cargar un guion ya empezado tiene su propio texto, distinto del fallo de la comprobación', async () => {
  const r = await ensayar({ controlador: false, dosGuiones: true, fallarGuion: 2 });
  assert.match(r.aviso.textContent, /terminar de cargar esta página/);
  assert.doesNotMatch(r.aviso.textContent, /conexión/);
});
test('avisa de pestaña ocupada y canal ausente en castellano y catalán', async () => {
  const ocupada = await ensayar({ controlador: true, version: 'aaaaaaaaaaaaaaaa', canal: 'ocupado', idioma: 'es' });
  const sinCanal = await ensayar({ controlador: true, version: 'aaaaaaaaaaaaaaaa', idioma: 'ca' });
  assert.match(ocupada.aviso.textContent, /pestaña con trabajo abierto/);
  assert.match(sinCanal.aviso.textContent, /altres pestanyes/);
});

test('tras activar la versión nueva recarga una vez para estrenar también los estilos', async () => {
  const opciones: Opciones = { controlador: true, version: 'aaaaaaaaaaaaaaaa', canal: 'libre' };
  const r = await ensayar(opciones);
  assert.deepEqual(r.acciones, ['update', 'activar']);
  opciones.version = marca;
  r.cambiarControlador();
  await dejarTerminar();
  assert.deepEqual(r.acciones, ['update', 'activar', 'reload']);
});
test('con el código de otro dispositivo en memoria activa en la misma página sin recargar', async () => {
  const opciones: Opciones = {
    controlador: true,
    version: 'aaaaaaaaaaaaaaaa',
    canal: 'libre',
    hash: '#pasar=valor-sintetico',
  };
  const r = await ensayar(opciones);
  opciones.version = marca;
  r.cambiarControlador();
  await dejarTerminar();
  assert.deepEqual(r.acciones, ['limpiar-fragmento', 'update', 'activar', 'guion']);
});
test('tras activar, sin almacenamiento para la guarda, activa en la misma página sin recargar en bucle', async () => {
  const opciones: Opciones = {
    controlador: true,
    version: 'aaaaaaaaaaaaaaaa',
    canal: 'libre',
    almacenamientoBloqueado: true,
  };
  const r = await ensayar(opciones);
  opciones.version = marca;
  r.cambiarControlador();
  await dejarTerminar();
  assert.deepEqual(r.acciones, ['update', 'activar', 'guion']);
});

test('bajo un service worker aparta el mapa de módulos hasta comprobar la copia y lo repone al activar', async () => {
  const coherente = await ensayar({ controlador: true, version: marca });
  assert.deepEqual(coherente.mapa, ['apartar', 'reponer']);
  assert.deepEqual(coherente.acciones, ['guion']);
  const distinta = await ensayar({ controlador: true, version: 'aaaaaaaaaaaaaaaa', canal: 'libre' });
  assert.deepEqual(distinta.mapa, ['apartar']);
  const primera = await ensayar({ controlador: false });
  assert.deepEqual(primera.mapa, []);
});

test('el aviso usa el idioma elegido aunque la página aún no esté traducida', async () => {
  const r = await ensayar({
    controlador: true,
    version: 'aaaaaaaaaaaaaaaa',
    canal: 'ocupado',
    idioma: 'es',
    idiomaElegido: 'ca',
  });
  assert.match(r.aviso.textContent, /Hi ha una altra pestanya/);
});

test('si la instalación falla, avisa enseguida en lugar de agotar el plazo de espera', async () => {
  const opciones: Opciones = {
    controlador: true,
    version: 'aaaaaaaaaaaaaaaa',
    canal: 'libre',
    instalacionFallida: true,
  };
  const r = await ensayar(opciones);
  assert.deepEqual(r.acciones, ['update']);
  assert.equal(r.aviso.hidden, false);
  assert.match(r.aviso.textContent, /No se ha podido preparar esta página/);
  assert.equal(opciones.consultasDeEspera, 1);
});

test('una hoja fallida mantiene el QR y se reintenta antes de ejecutar guiones', async () => {
  const r = await ensayar({ controlador: false, hoja: true, fallarHojaUnaVez: true, hash: '#pasar=valor-sintetico' });
  assert.deepEqual(r.acciones, ['limpiar-fragmento', 'hoja']);
  assert.equal(r.aviso.hidden, false);
  assert.equal(r.raiz.hidden, false);
  assert.equal(r.contenido.hidden, true);
  assert.equal(r.contenidoOculto.hidden, true);
  assert.equal(typeof Reflect.get(r.ventana, Symbol.for('faro.fragmento.transitorio')), 'function');
  r.pulsar();
  await dejarTerminar();
  assert.deepEqual(r.acciones, ['limpiar-fragmento', 'hoja', 'hoja', 'guion']);
  assert.equal(r.aviso.hidden, true);
  assert.equal(r.contenido.hidden, false);
  assert.equal(r.contenidoOculto.hidden, true);
  assert.equal(Reflect.get(r.ventana, Symbol.for('faro.fragmento.transitorio'))(), '#pasar=valor-sintetico');
});

const CASOS_SIN_AVISO = [
  [
    { controlador: true, version: 'aaaaaaaaaaaaaaaa', sinAviso: true },
    ['update'],
    'No se puede comprobar si otras pestañas tienen trabajo abierto. Ciérralas y vuelve a intentarlo.',
  ],
  [
    { controlador: false, hoja: true, fallarHojaUnaVez: true, sinAviso: true },
    ['hoja'],
    'No se ha podido preparar esta página. Comprueba la conexión y vuelve a intentarlo.',
  ],
  [
    { controlador: false, hoja: true, fallarHojaUnaVez: true, sinAviso: true, idioma: 'ca' },
    ['hoja'],
    'No s’ha pogut preparar aquesta pàgina. Comprova la connexió i torna-ho a provar.',
  ],
  [
    { controlador: false, dosGuiones: true, fallarGuion: 2, sinAviso: true },
    ['guion', 'guion'],
    'No se ha podido terminar de cargar esta página. Vuelve a cargarla para seguir.',
  ],
] as const satisfies readonly (readonly [Opciones, readonly string[], string])[];

/** El aviso creado por la barrera: un párrafo `role="alert"` al principio del cuerpo, visible y con su texto. */
function comprobarAvisoCreado(r: Awaited<ReturnType<typeof ensayar>>, texto: string, caso: string) {
  const [creado] = r.creados;
  assert.ok(creado && r.creados.length === 1, caso);
  assert.deepEqual(
    [Reflect.get(creado, 'etiqueta'), creado.id, creado.atributos.get('role')],
    ['p', 'faro-version-aviso', 'alert'],
    caso,
  );
  assert.equal(r.cuerpo[0], creado, caso);
  assert.equal(creado.hidden, false, caso);
  assert.equal(creado.textContent, texto, caso);
  assert.equal(r.raiz.hidden, false, caso);
  assert.deepEqual([r.contenido.hidden, r.contenido.inert, r.contenidoOculto.hidden], [true, true, true], caso);
}

test('sin el aviso de versión la barrera crea uno al principio del cuerpo, lo muestra y no activa los módulos', async () => {
  const rechazos: unknown[] = [];
  const anotar = (motivo: unknown) => rechazos.push(motivo);
  process.on('unhandledRejection', anotar);
  try {
    for (const [opciones, acciones, texto] of CASOS_SIN_AVISO) {
      const caso = JSON.stringify(opciones);
      const r = await ensayar({ ...opciones });
      await dejarTerminar();
      assert.deepEqual(r.acciones, acciones, caso);
      comprobarAvisoCreado(r, texto, caso);
      r.pulsar();
      await dejarTerminar();
      assert.equal(r.creados.length, 1, `${caso}: el reintento reutiliza el aviso creado`);
    }
  } finally {
    process.off('unhandledRejection', anotar);
  }
  assert.deepEqual(rechazos, []);
});

test('sin el guion de la barrera la página sigue visible y el mapa de módulos en su sitio', () => {
  const { mapa, elementoMapa } = crearMapa();
  const raiz = { hidden: false };
  const contexto = {
    document: {
      currentScript: null,
      documentElement: raiz,
      querySelector: (selector: string) =>
        selector.includes('importmap') ? elementoMapa : { getAttribute: () => marca },
    },
    navigator: { serviceWorker: { controller: {}, addEventListener() {} } },
    window: { addEventListener() {} },
    location: { hash: '', pathname: '/recorrido.html', search: '' },
    history: { state: null, replaceState() {} },
    HTMLScriptElement: Guion,
  };
  assert.throws(() => runInNewContext(fuente, contexto), /Falta la barrera de versión/);
  assert.equal(raiz.hidden, false);
  assert.deepEqual(mapa, []);
});

test('el recorrido real y el de cada extensión retrasan todas las hojas hasta la barrera', () => {
  for (const ruta of ['../../web/recorrido.html', ...EXTENSIONES.map(({ entrada }) => `../../web/${entrada}`)]) {
    const html = readFileSync(new URL(ruta, import.meta.url), 'utf8');
    const hojas = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*\/>/gu)];
    assert.ok(hojas.length > 10);
    for (const hoja of hojas) {
      const antes = html.slice(0, hoja.index);
      assert.match(antes, /<template\s+data-faro-carga\s*>\s*$/u, hoja[0]);
      assert.match(html.slice(hoja.index + hoja[0].length), /^\s*<\/template\s*>/u, hoja[0]);
    }
    // El cuerpo no es inerte: lo son sus partes, salvo el aviso de descarga (se lee si la barrera no se ejecuta) y el
    // de versión, que la barrera escribe.
    assert.match(html, /<body class="rc-cuerpo"/u);
    const cuerpo = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
    const partes = [...cuerpo.matchAll(/^ {4}<[a-z]+\b[^>]*>/gmu)].map(([apertura]) => apertura);
    assert.ok(partes.length > 10);
    for (const apertura of partes) {
      const libre = /id="faro-(?:aviso-descarga|version-aviso)"/u.test(apertura);
      assert.equal(/\sinert[\s>]/u.test(apertura), !libre, apertura);
    }
    assert.match(html, /<noscript\b/u);
  }
});

test('una hoja que no responde agota su plazo y puede reintentarse', async () => {
  const opciones: Opciones = { controlador: false, hoja: true, agotarHoja: true };
  const r = await ensayar(opciones);
  r.vencerPlazo();
  await dejarTerminar();
  assert.deepEqual(r.acciones, ['hoja']);
  assert.equal(r.aviso.hidden, false);
  opciones.ultimoEnlace?.oyentes.get('load')?.();
  await dejarTerminar();
  assert.deepEqual(r.acciones, ['hoja']);
  opciones.agotarHoja = false;
  r.pulsar();
  await dejarTerminar();
  assert.deepEqual(r.acciones, ['hoja', 'hoja', 'guion']);
});
