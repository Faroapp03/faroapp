import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  politicaSeccionesInicial,
  SECCIONES_WEB,
  VERSION_SECCIONES_PUBLICAS,
} from '../../src/administracion/secciones-web.js';
import CA from '../../web/idiomas/ca.js';
import ES from '../../web/idiomas/es.js';
import { fijarIdioma, registrarDiccionario } from '../../web/scripts/textos.js';
import { Boton, cargar, Nodo, navegador, pagina } from './ayudas.js';

/** @import { TestContext } from 'node:test' */
/** @typedef {typeof import('../../web/scripts/secciones.js')} Modulo */
const REVISION_RETIRADA = 3;
const REVISION_MAYOR = 5;
/** Las tarjetas de inicio, con sus destinos de web/inicio.html. */
const TARJETAS_INICIO = ['entender-ia.html', 'que-es-faro.html', 'que-es-faro.html#como-funciona'];
const PLAZO_SECCIONES = 3000;
const BASE = new URL('../../web/', import.meta.url);
const POLITICA = new URL('secciones-v3.json', BASE).href;
const UNIDADES = '.menu-lista > li, .buscador-resultados > li, .historia, .apertura-acciones, .rc-entrega-encuesta';
const documento = (revision = 0, biblioteca = true) => ({
  version: VERSION_SECCIONES_PUBLICAS,
  autoridad: '11111111-1111-4111-8111-111111111111',
  revision,
  secciones: { ...politicaSeccionesInicial(), cursos: true, biblioteca },
});

class Enlace extends Nodo {
  href = '';
}

test('una copia legada de otra instalación no bloquea la revisión inicial v3', async (t) => {
  const entorno = await preparar(t);
  const { autoridad: _autoridad, ...resto } = documento(1, false);
  const vieja = { ...resto, version: 2 };
  const bits = SECCIONES_WEB.map(({ id }) => Number(vieja.secciones[id])).join('');
  const clave = `${new URL('secciones.json', BASE).href}?revision=1&estado=${bits}`;
  const legado = new Map([[clave, Response.json(vieja)]]);
  entorno.caches.mapas.set(`faro-secciones:${BASE.href}`, legado);
  await entorno.modulo.iniciarSecciones();
  assert.equal(entorno.modulo.seccionDisponible('biblioteca'), true);
  assert.equal(legado.size, 1);
});
/** @param {string} ruta Relativa a la web, con su fragmento si lo lleva. */
function enlaceA(ruta) {
  const enlace = new Enlace();
  enlace.href = new URL(ruta, BASE).href;
  enlace.hidden = false;
  return enlace;
}
function copias() {
  /** @type {Map<string, Map<string, Response>>} */
  const mapas = new Map();
  return {
    mapas,
    open: async (/** @type {string} */ nombre) => {
      const mapa = mapas.get(nombre) ?? new Map();
      mapas.set(nombre, mapa);
      return {
        keys: async () => [...mapa.keys()].map((url) => new Request(url)),
        match: async (/** @type {string|Request} */ clave) =>
          mapa.get(typeof clave === 'string' ? clave : clave.url)?.clone(),
        put: async (/** @type {string} */ clave, /** @type {Response} */ respuesta) => {
          mapa.set(clave, respuesta.clone());
        },
        delete: async (/** @type {Request} */ clave) => mapa.delete(clave.url),
      };
    },
  };
}

/** @param {TestContext} t */
async function preparar(t) {
  const dom = pagina(t);
  const caches = copias();
  /** @type {RequestInit[]} */
  const pedidos = [];
  /** @type {() => Promise<Response>} */
  let respuesta = async () => Response.json(documento());
  // Un enlace por sección con páginas; «Cómo funciona», dentro de Faro, y «Guías», dentro de la Biblioteca, no tienen
  // páginas propias.
  const conPaginas = SECCIONES_WEB.filter(({ rutas }) => rutas.length > 0);
  const enlaces = conPaginas.map(({ rutas }) => enlaceA(rutas[0]?.slice(1) ?? ''));
  const biblioteca = enlaces[conPaginas.findIndex(({ id }) => id === 'biblioteca')];
  assert.ok(biblioteca);
  const unidad = new Nodo();
  unidad.hidden = false;
  unidad.consultas.set(UNIDADES, []);
  unidad.consultas.set('a[href]', [biblioteca]);
  unidad.append(biblioteca);
  dom.consultas.set('a[href]', enlaces);
  navegador(t, {
    HTMLAnchorElement: Enlace,
    navigator: {
      locks: {
        request: async (/** @type {string} */ _nombre, /** @type {() => Promise<unknown>} */ accion) => accion(),
      },
    },
    window: new EventTarget(),
    location: { href: new URL('inicio.html', BASE).href },
    caches,
    fetch: async (/** @type {string} */ url, /** @type {RequestInit} */ opciones) => {
      assert.equal(url, POLITICA);
      pedidos.push(opciones);
      return respuesta();
    },
  });
  const modulo = /** @type {Modulo} */ (await cargar('secciones.js'));
  return {
    ...dom,
    modulo,
    caches,
    pedidos,
    enlaces,
    biblioteca,
    unidad,
    respuesta: (/** @type {() => Promise<Response>} */ valor) => {
      respuesta = valor;
    },
  };
}

test('secciones: política inicial explícita conserva todos los accesos y retirar/reactivar afecta a unidades completas', async (t) => {
  const { modulo, enlaces, unidad, biblioteca, respuesta, pedidos } = await preparar(t);
  const inicio = modulo.iniciarSecciones();
  assert.equal(inicio, modulo.iniciarSecciones());
  await inicio;
  assert.ok(enlaces.every((enlace) => !enlace.hidden));
  assert.equal(unidad.hidden, false);
  assert.equal(pedidos[0]?.cache, 'no-store');
  assert.equal(pedidos[0]?.redirect, 'manual');
  assert.ok(pedidos[0]?.signal instanceof AbortSignal);
  respuesta(async () => Response.json(documento(1, false)));
  await modulo.actualizarSecciones();
  assert.equal(unidad.hidden, true);
  assert.equal(biblioteca.hidden, false, 'se oculta la unidad completa, no queda li vacío');
  assert.equal(modulo.accesoASeccionDisponible(/** @type {HTMLElement} */ (/** @type {unknown} */ (unidad))), false);
  respuesta(async () => Response.json(documento(2, true)));
  await modulo.actualizarSecciones();
  assert.equal(unidad.hidden, false);
  assert.ok(enlaces.every((enlace) => !enlace.hidden));
});

test('el permiso de recorrido gobierna el enlace al recorrido también tras cambiar su destino', async (t) => {
  const { modulo, enlaces, respuesta } = await preparar(t);
  const real = enlaces.find((enlace) => enlace.href.endsWith('/recorrido.html'));
  assert.ok(real);
  await modulo.iniciarSecciones();
  assert.equal(real.hidden, false);
  respuesta(async () =>
    Response.json({ ...documento(1), secciones: { ...politicaSeccionesInicial(), recorrido: false } }),
  );
  await modulo.actualizarSecciones();
  assert.equal(real.hidden, true);
  assert.equal(modulo.accesoASeccionDisponible(/** @type {HTMLElement} */ (/** @type {unknown} */ (real))), false);
  respuesta(async () => Response.json(documento(2)));
  await modulo.actualizarSecciones();
  assert.equal(real.hidden, false);
});

test('cerrar el recorrido oculta entero el grupo de acciones de la apertura, sin dejar un hueco', async (t) => {
  const entorno = await preparar(t);
  const grupo = Object.assign(new Nodo(), { hidden: false });
  grupo.consultas.set(UNIDADES, []);
  const empezar = enlaceA('recorrido.html');
  const ejemplo = enlaceA('informe-ejemplo.html');
  grupo.append(empezar, ejemplo);
  // Los enlaces de la página: los de cada sección, con «Empezar» dentro del grupo en lugar del suelto, y el ejemplo.
  const sueltos = entorno.enlaces.filter((enlace) => !enlace.href.endsWith('/recorrido.html'));
  entorno.consultas.set('a[href]', [...sueltos, empezar, ejemplo]);
  await entorno.modulo.iniciarSecciones();
  assert.equal(grupo.hidden, false);
  entorno.respuesta(async () =>
    Response.json({ ...documento(1), secciones: { ...politicaSeccionesInicial(), recorrido: false } }),
  );
  await entorno.modulo.actualizarSecciones();
  assert.equal(grupo.hidden, true);
  assert.equal(empezar.hidden, false, 'se oculta el grupo, no cada enlace por separado');
  assert.equal(ejemplo.hidden, false);
  entorno.respuesta(async () => Response.json(documento(2)));
  await entorno.modulo.actualizarSecciones();
  assert.equal(grupo.hidden, false);
});

test('secciones: fallo de red sin política cierra y una retirada aprendida persiste entre páginas', async (t) => {
  const entorno = await preparar(t);
  entorno.respuesta(async () => {
    throw new TypeError('sin red');
  });
  await entorno.modulo.iniciarSecciones();
  assert.equal(entorno.modulo.seccionDisponible('biblioteca'), false);
  entorno.respuesta(async () => Response.json(documento(REVISION_RETIRADA, false)));
  await entorno.modulo.actualizarSecciones();
  const otra = /** @type {Modulo} */ (await cargar('secciones.js'));
  entorno.respuesta(async () => {
    throw new TypeError('sin red');
  });
  await otra.iniciarSecciones();
  assert.equal(otra.seccionDisponible('biblioteca'), false);
  assert.equal(otra.seccionDisponible('doctor'), true);
  assert.equal(entorno.caches.mapas.get(otra.COPIA_SECCIONES)?.size, 2);
});

test('secciones: HTTP/JSON defectuoso bloquea sin olvidar lo recibido; revisión antigua no reabre', async (t) => {
  const { modulo, respuesta } = await preparar(t);
  await modulo.iniciarSecciones();
  for (const recibida of [
    new Response('', { status: 503 }),
    new Response('', { status: 401 }),
    Response.json({ version: 1 }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
  ]) {
    respuesta(async () => recibida.clone());
    await modulo.actualizarSecciones();
    assert.equal(modulo.seccionDisponible('biblioteca'), false);
  }
  respuesta(async () => {
    throw new TypeError('sin red');
  });
  await modulo.actualizarSecciones();
  assert.equal(modulo.seccionDisponible('biblioteca'), true);
  respuesta(async () => Response.json(documento(2, false)));
  await modulo.actualizarSecciones();
  respuesta(async () => Response.json(documento(1, true)));
  await modulo.actualizarSecciones();
  assert.equal(modulo.seccionDisponible('biblioteca'), false);
  respuesta(async () => {
    throw new TypeError('sin red');
  });
  await modulo.actualizarSecciones();
  assert.equal(modulo.seccionDisponible('biblioteca'), false);
});

test('secciones: almacenamiento denegado conserva únicamente la política en memoria', async (t) => {
  const { modulo, respuesta } = await preparar(t);
  navegador(t, {
    caches: {
      open: async () => {
        throw new Error('denegado');
      },
    },
  });
  await modulo.iniciarSecciones();
  assert.equal(modulo.seccionDisponible('biblioteca'), true);
  respuesta(async () => Response.json(documento(1, false)));
  await modulo.actualizarSecciones();
  respuesta(async () => {
    throw new TypeError('sin red');
  });
  await modulo.actualizarSecciones();
  assert.equal(modulo.seccionDisponible('biblioteca'), false);
  assert.equal(modulo.seccionDisponible('doctor'), true);
});

test('secciones: el plazo de red conserva únicamente la última política validada', async (t) => {
  const { modulo } = await preparar(t);
  await modulo.iniciarSecciones();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(AbortSignal, 'timeout', (/** @type {number} */ plazo) => {
    assert.equal(plazo, PLAZO_SECCIONES);
    const control = new AbortController();
    setTimeout(() => control.abort(new DOMException('plazo', 'TimeoutError')), plazo);
    return control.signal;
  });
  const iniciada = Promise.withResolvers();
  navegador(t, {
    fetch: (/** @type {string} */ _url, /** @type {RequestInit} */ opciones) =>
      new Promise((_resolve, reject) => {
        opciones.signal?.addEventListener('abort', () => reject(opciones.signal?.reason), { once: true });
        iniciada.resolve(undefined);
      }),
  });
  const pendiente = modulo.actualizarSecciones();
  await iniciada.promise;
  t.mock.timers.tick(PLAZO_SECCIONES);
  await pendiente;
  assert.equal(modulo.seccionDisponible('biblioteca'), true);
});

test('secciones: una escritura tardía de otra página no vence a la revisión superior guardada', async (t) => {
  const { modulo, caches, respuesta } = await preparar(t);
  await modulo.iniciarSecciones();
  const mapa = caches.mapas.get(modulo.COPIA_SECCIONES);
  assert.ok(mapa);
  const mayor = documento(REVISION_MAYOR, false);
  const antigua = documento(2, true);
  mapa.set(`${POLITICA}?autoridad=${mayor.autoridad}`, Response.json(mayor));
  mapa.set(`${POLITICA}?actual=1`, Response.json(antigua));
  respuesta(async () => {
    throw new TypeError('sin red');
  });
  await modulo.actualizarSecciones();
  assert.equal(modulo.seccionDisponible('biblioteca'), false);
});

test('secciones: una retirada oculta el contenido abierto y reactivar lo conserva sin tocar la inercia del menú', async (t) => {
  const entorno = await preparar(t);
  const contenido = Object.assign(new Nodo(), {
    hidden: false,
    inert: true,
    before: (/** @type {Nodo} */ aviso) => entorno.ids.set('seccion-no-disponible', aviso),
  });
  const escrito = new Nodo();
  escrito.textContent = 'Contenido de esta pestaña';
  contenido.append(escrito);
  entorno.ids.set('contenido', contenido);
  navegador(t, { location: { href: new URL('biblioteca.html', BASE).href } });
  await entorno.modulo.iniciarSecciones();
  assert.equal(contenido.hidden, false);
  assert.equal(contenido.inert, true);
  entorno.respuesta(async () => Response.json(documento(1, false)));
  await entorno.modulo.actualizarSecciones();
  assert.equal(contenido.hidden, true);
  assert.equal(escrito.textContent, 'Contenido de esta pestaña');
  entorno.respuesta(async () => Response.json(documento(2, true)));
  await entorno.modulo.actualizarSecciones();
  assert.equal(contenido.hidden, false);
  assert.equal(contenido.inert, true);
  assert.equal(contenido.children[0], escrito);
});

test('secciones: la encuesta oculta tiene su propio aviso, que dice que el enlace sigue valiendo', async (t) => {
  const entorno = await preparar(t);
  const contenido = Object.assign(new Nodo(), {
    hidden: false,
    before: (/** @type {Nodo} */ aviso) => entorno.ids.set('seccion-no-disponible', aviso),
  });
  entorno.ids.set('contenido', contenido);
  navegador(t, { location: { href: new URL('encuesta.html#codigo=PROF', BASE).href } });
  const oculta = { ...documento(1), secciones: { ...documento(1).secciones, encuesta: false } };
  entorno.respuesta(async () => Response.json(oculta));
  await entorno.modulo.iniciarSecciones();
  assert.equal(contenido.hidden, true);
  assert.equal(
    entorno.ids.get('seccion-no-disponible')?.textContent,
    'La encuesta no está disponible ahora. Tu enlace sigue valiendo: vuelve a abrirlo más adelante para responder.',
  );
});

/** @param {TestContext} t */
function prepararCambioDeIdioma(t) {
  /** @type {(() => void) | undefined} */
  let avisoIdioma;
  navegador(t, {
    __capturarIdioma: (/** @type {() => void} */ fn) => {
      avisoIdioma = fn;
    },
  });
  const hooks = registerHooks({
    resolve(spec, contexto, siguiente) {
      if (contexto.parentURL?.includes('/web/scripts/secciones.js?') && spec === './idioma.js') {
        return {
          url: 'data:text/javascript,export const alCambiarIdioma = (fn) => globalThis.__capturarIdioma(fn)',
          shortCircuit: true,
        };
      }
      return siguiente(spec, contexto);
    },
  });
  t.after(() => hooks.deregister());
  return () => {
    assert.ok(avisoIdioma);
    avisoIdioma();
  };
}

/** @type {Record<string, [string, string]>} */
const MENSAJES_SECCION = {
  retirada: [
    'Esta sección está desactivada. El contenido de esta pestaña se conserva en memoria.',
    'Aquesta secció està desactivada. El contingut d’aquesta pestanya es conserva en memòria.',
  ],
  indisponible: [
    'No se puede comprobar la disponibilidad de esta sección. Vuelve a intentarlo cuando haya conexión.',
    'No es pot comprovar la disponibilitat d’aquesta secció. Torna-ho a provar quan hi hagi connexió.',
  ],
};

for (const [causa, [esperadoEs, esperadoCa]] of Object.entries(MENSAJES_SECCION)) {
  test(`secciones: cambiar idioma reescribe aviso de ${causa} sin modificar datos ni consultar red`, async (t) => {
    const cambiarIdioma = prepararCambioDeIdioma(t);
    const entorno = await preparar(t);
    const contenido = Object.assign(new Nodo(), {
      hidden: false,
      before: (/** @type {Nodo} */ aviso) => entorno.ids.set('seccion-no-disponible', aviso),
    });
    const escrito = new Nodo();
    escrito.textContent = 'Contenido conservado';
    contenido.append(escrito);
    entorno.ids.set('contenido', contenido);
    navegador(t, { location: { href: new URL('biblioteca.html', BASE).href } });
    entorno.respuesta(
      causa === 'retirada'
        ? async () => Response.json(documento(1, false))
        : async () => {
            throw new TypeError('sin red');
          },
    );
    await entorno.modulo.iniciarSecciones();
    const aviso = entorno.ids.get('seccion-no-disponible');
    assert.ok(aviso);
    assert.equal(contenido.hidden, true);
    const original = aviso.textContent;
    assert.equal(original, esperadoEs);
    const peticiones = entorno.pedidos.length;
    entorno.document.documentElement.lang = 'ca';
    cambiarIdioma();
    assert.equal(aviso.textContent, esperadoCa);
    registrarDiccionario('ca', CA);
    fijarIdioma('ca');
    cambiarIdioma();
    assert.equal(aviso.textContent, esperadoCa);
    entorno.document.documentElement.lang = 'es';
    registrarDiccionario('es', ES);
    fijarIdioma('es');
    cambiarIdioma();
    assert.equal(aviso.textContent, original);
    assert.equal(escrito.textContent, 'Contenido conservado');
    assert.equal(contenido.hidden, true);
    assert.equal(entorno.pedidos.length, peticiones);
  });
}

test('secciones: retirar todas las tarjetas de inicio no deja una sección vacía ni su enlace', async (t) => {
  const entorno = await preparar(t);
  const explorar = Object.assign(new Nodo(), { hidden: false });
  const enlace = Object.assign(new Enlace(), { hidden: false, href: '#explorar' });
  entorno.ids.set('explorar', explorar);
  entorno.consultas.set('.historias > a[href]', TARJETAS_INICIO.map(enlaceA));
  entorno.consultas.set('a[href="#explorar"]', [enlace]);
  await entorno.modulo.iniciarSecciones();
  assert.equal(explorar.hidden, false);
  // La tarjeta «Cómo funciona» lleva a una etapa de Faro: la cierra Faro aunque la clave antigua siga abierta.
  const cerrada = documento(1);
  cerrada.secciones['entender-ia'] = false;
  cerrada.secciones['que-es-faro'] = false;
  assert.equal(cerrada.secciones['como-funciona'], true);
  entorno.respuesta(async () => Response.json(cerrada));
  await entorno.modulo.actualizarSecciones();
  assert.equal(explorar.hidden, true);
  assert.equal(enlace.hidden, true);
  entorno.respuesta(async () => Response.json(documento(2)));
  await entorno.modulo.actualizarSecciones();
  assert.equal(explorar.hidden, false);
  assert.equal(enlace.hidden, false);
});

/** @param {TestContext} t */
function prepararBuscador(t) {
  const dom = pagina(t);
  class Campo extends Nodo {
    value = '';
  }
  class Dialogo extends Nodo {
    showModal() {}
  }
  const campo = new Campo();
  const dialogo = new Dialogo();
  const boton = new Boton();
  const item = new Nodo();
  item.dataset.busqueda = 'biblioteca';
  const vacio = new Nodo();
  const estado = new Nodo();
  dialogo.consultas.set('.buscador-resultados li', [item]);
  dialogo.consultas.set('.buscador-vacio', [vacio]);
  dom.ids.set('buscador', dialogo);
  dom.ids.set('buscador-consulta', campo);
  dom.ids.set('buscador-estado', estado);
  dom.consultas.set('.buscador-boton', [boton]);
  navegador(t, { HTMLInputElement: Campo, HTMLDialogElement: Dialogo, __seccionDePrueba: false });
  return { dom, campo, boton, item, estado };
}

test('secciones: buscar o vaciar la consulta no revela una sección retirada', async (t) => {
  const { dom, campo, boton, item, estado } = prepararBuscador(t);
  const hooks = registerHooks({
    resolve(especificador, contexto, siguiente) {
      if (!contexto.parentURL?.includes('/buscador-secciones.js')) {
        return siguiente(especificador, contexto);
      }
      /** @type {Record<string,string>} */
      const dobles = {
        './sitio.js': '',
        './secciones.js': 'export const accesoASeccionDisponible = () => globalThis.__seccionDePrueba;',
        './idioma.js': 'export const escribir = (elemento, texto) => { elemento.textContent = texto; };',
        './textos.js': 'export const traducible = (_clave, variables) => String(variables.numero);',
      };
      const codigo = dobles[especificador];
      return codigo === undefined
        ? siguiente(especificador, contexto)
        : { url: `data:text/javascript,${encodeURIComponent(codigo)}`, shortCircuit: true };
    },
  });
  t.after(() => hooks.deregister());
  await cargar('buscador-secciones.js');
  boton.dispatchEvent(new Event('click'));
  assert.equal(item.hidden, true);
  campo.value = 'biblioteca';
  campo.dispatchEvent(new Event('input'));
  assert.equal(item.hidden, true);
  campo.value = '';
  campo.dispatchEvent(new Event('input'));
  assert.equal(item.hidden, true);
  assert.equal(estado.textContent, '0');
  navegador(t, { __seccionDePrueba: true });
  dom.document.dispatchEvent(new Event('faro-secciones'));
  assert.equal(item.hidden, false);
  assert.equal(estado.textContent, '1');
});

test('secciones: Borrar todo elimina las copias de web/datos pero conserva la política de la entidad', async (t) => {
  const dom = pagina(t);
  const boton = new Boton();
  dom.ids.set('borrar-todo', boton);
  const politica = `faro-secciones:${BASE.href}`;
  const nombres = new Set([politica, `faro:${BASE.href}:vieja`, 'faro-paquete-vigente', 'otra-web']);
  const terminada = Promise.withResolvers();
  const cacheSimulada = {
    keys: async () => [...nombres],
    delete: async (/** @type {string} */ nombre) => nombres.delete(nombre),
  };
  navegador(t, {
    window: { caches: cacheSimulada },
    caches: cacheSimulada,
    localStorage: {},
    sessionStorage: {},
    navigator: {},
    indexedDB: undefined,
    confirm: () => true,
    location: {
      set href(/** @type {string} */ valor) {
        terminada.resolve(valor);
      },
    },
  });
  const hooks = registerHooks({
    resolve(especificador, contexto, siguiente) {
      if (!contexto.parentURL?.includes('/borrar-datos.js')) {
        return siguiente(especificador, contexto);
      }
      /** @type {Record<string,string>} */
      const dobles = {
        './sitio.js': '',
        './aviso-de-borrado.js': 'export const avisarBorrado = () => {};',
        './motor-local/modo.js': 'export const CLAVES_DE_LA_ENTIDAD = [];',
        './motor-local/secreto-firma.js': 'export const borrarSecretoDeFirma = async () => {};',
        './textos.js': 'export const texto = () => "Confirmar";',
      };
      const codigo = dobles[especificador];
      return codigo === undefined
        ? siguiente(especificador, contexto)
        : { url: `data:text/javascript,${encodeURIComponent(codigo)}`, shortCircuit: true };
    },
  });
  t.after(() => hooks.deregister());
  await cargar('borrar-datos.js');
  boton.dispatchEvent(new Event('click'));
  assert.equal(await terminada.promise, 'inicio.html');
  assert.deepEqual([...nombres], [politica, 'otra-web']);
});
