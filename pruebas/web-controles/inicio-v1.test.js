import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const CARGA_LENTA_MS = 5000;
const RETARDO_INICIO_MS = 50;
const MARCA_ANTIGUA_MS = 3000;
const leer = (/** @type {string} */ p) => readFileSync(new URL(`../../web/${p}`, import.meta.url), 'utf8');
/** @param {{ marca?: null | '1' | {origen:string, destino:string, instante:number}, tipo?: string, reducido?: boolean, falla?: boolean, inicio?: number, referrer?: string }} [opciones] */
function inicial({
  marca = null,
  tipo = 'navigate',
  reducido = false,
  falla = false,
  inicio = Date.now(),
  referrer = 'https://faro.test/otra.html',
} = {}) {
  const clases = new Set();
  const almacen = new Map(
    marca
      ? [
          [
            'faro-inicio-desde-menu',
            JSON.stringify(
              marca === '1'
                ? {
                    origen: 'https://faro.test/otra.html',
                    destino: 'https://faro.test/inicio.html',
                    instante: Date.now(),
                  }
                : marca,
            ),
          ],
        ]
      : [],
  );
  const contexto = {
    URL,
    location: { href: 'https://faro.test/inicio.html' },
    document: {
      referrer,
      documentElement: {
        classList: {
          add: (/** @type {string[]} */ ...xs) =>
            xs.forEach((x) => {
              clases.add(x);
            }),
          remove: (/** @type {string} */ x) => clases.delete(x),
        },
      },
    },
    performance: { timeOrigin: inicio, getEntriesByType: () => [{ type: tipo }] },
    matchMedia: () => ({ matches: reducido }),
    setTimeout: () => {},
    sessionStorage: {
      getItem: (/** @type {string} */ k) => {
        if (falla) {
          throw Error();
        }
        return almacen.get(k);
      },
      removeItem: (/** @type {string} */ k) => almacen.delete(k),
    },
  };
  vm.runInNewContext(leer('scripts/inicio-animacion-inicial.js'), contexto);
  return { clases, almacen };
}
test('entrada y recarga animan, retorno por menú y atrás no; consume marca', () => {
  assert.ok(inicial().clases.has('inicio-permitido'));
  const menu = inicial({ marca: '1' });
  assert.equal(menu.clases.size, 0);
  assert.equal(menu.almacen.size, 0);
  assert.ok(inicial({ marca: '1', tipo: 'reload' }).clases.has('inicio-permitido'));
  assert.equal(inicial({ tipo: 'back_forward' }).clases.size, 0);
  const inicioLento = Date.now() - CARGA_LENTA_MS;
  assert.equal(
    inicial({
      inicio: inicioLento,
      marca: {
        origen: 'https://faro.test/otra.html',
        destino: 'https://faro.test/inicio.html',
        instante: inicioLento + RETARDO_INICIO_MS,
      },
    }).clases.size,
    0,
  );
  assert.equal(inicial({ reducido: true }).clases.size, 0);
  assert.ok(inicial({ falla: true }).clases.has('inicio-permitido'));
  assert.ok(
    inicial({
      marca: {
        origen: 'https://faro.test/otra.html',
        destino: 'https://faro.test/inicio.html',
        instante: Date.now() - MARCA_ANTIGUA_MS,
      },
    }).clases.has('inicio-permitido'),
  );
  assert.ok(
    inicial({
      marca: { origen: 'https://faro.test/otro.html', destino: 'https://faro.test/inicio.html', instante: Date.now() },
    }).clases.has('inicio-permitido'),
  );
});
test('Inicio conserva foto corregida y no incluye buscador', () => {
  const html = leer('inicio.html');
  assert.match(html, /faro-penmon-800\.webp/);
  assert.match(html, /faro-penmon\.webp/);
  assert.doesNotMatch(html, /buscador-(?:franja|secciones|boton)|id="buscador"/);
  const selector = /<div class="idioma" data-selector-idioma>[\s\S]*?<\/div>\s*<\/div>/;
  const referencia = leer('recorrido.html').match(selector);
  assert.ok(referencia, 'El recorrido ofrece el menú de idiomas con bandera');
  assert.equal(html.match(selector)?.[0], referencia[0], 'Inicio ofrece el mismo selector de idioma que el recorrido');
});
test('tarjetas sin soporte de observador siguen visibles', () => {
  const clases = new Set(['inicio-permitido']);
  const tarjetas = Array.from({ length: 3 }, () => ({ classList: { add() {} } }));
  const imagen = { complete: true, addEventListener() {} };
  const contexto = {
    document: {
      documentElement: {
        classList: {
          contains: (/** @type {string} */ x) => clases.has(x),
          add: (/** @type {string} */ x) => clases.add(x),
          remove: (/** @type {string} */ x) => clases.delete(x),
        },
      },
      querySelector: () => imagen,
      querySelectorAll: () => tarjetas,
    },
    window: {},
    setTimeout() {},
  };
  vm.runInNewContext(leer('scripts/inicio-animacion.js'), contexto);
  assert.equal(clases.has('inicio-observar'), false);
});
test('si el módulo no llega, el plazo vuelve a mostrar el texto', () => {
  const clases = new Set();
  let vencimiento;
  const contexto = {
    document: {
      documentElement: {
        classList: {
          add: (/** @type {string[]} */ ...xs) =>
            xs.forEach((x) => {
              clases.add(x);
            }),
          remove: (/** @type {string} */ x) => clases.delete(x),
        },
      },
    },
    performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    matchMedia: () => ({ matches: false }),
    sessionStorage: { getItem: () => null, removeItem() {} },
    setTimeout: (/** @type {() => void} */ fn) => {
      vencimiento = fn;
    },
  };
  vm.runInNewContext(leer('scripts/inicio-animacion-inicial.js'), contexto);
  assert.ok(clases.has('inicio-esperar'));
  /** @type {() => void} */ (/** @type {unknown} */ (vencimiento))();
  assert.equal(clases.has('inicio-esperar'), false);
});
test('una tarjeta intersectada se revela una vez y se deja de observar', () => {
  const clases = new Set(['inicio-permitido', 'inicio-esperar']);
  const reveladas = new Set();
  /** @type {((entradas: {target: {classList: {add: (x: string) => unknown}}, isIntersecting: boolean}[]) => void) | undefined} */
  let aviso;
  let bajas = 0;
  const tarjeta = { classList: { add: (/** @type {string} */ x) => reveladas.add(x) } };
  class Observador {
    constructor(
      /** @type {(entradas: {target: {classList: {add: (x: string) => unknown}}, isIntersecting: boolean}[]) => void} */ cb,
    ) {
      aviso = cb;
    }
    observe() {}
    unobserve() {
      bajas++;
    }
  }
  const contexto = {
    document: {
      documentElement: {
        classList: {
          contains: (/** @type {string} */ x) => clases.has(x),
          add: (/** @type {string} */ x) => clases.add(x),
          remove: (/** @type {string} */ x) => clases.delete(x),
        },
      },
      querySelector: () => ({ complete: true }),
      querySelectorAll: () => [tarjeta],
    },
    window: { IntersectionObserver: Observador },
    IntersectionObserver: Observador,
  };
  vm.runInNewContext(leer('scripts/inicio-animacion.js'), contexto);
  assert.ok(clases.has('inicio-abrir'));
  assert.ok(clases.has('inicio-observar'));
  assert.ok(aviso);
  aviso([{ target: tarjeta, isIntersecting: false }]);
  assert.equal(bajas, 0);
  aviso([{ target: tarjeta, isIntersecting: true }]);
  assert.ok(reveladas.has('historia-visible'));
  assert.equal(bajas, 1);
});
test('fallo al observar deja las tarjetas visibles', () => {
  const clases = new Set(['inicio-permitido']);
  class Observador {
    observe() {
      throw Error('observación no disponible');
    }
    disconnect() {}
  }
  const contexto = {
    document: {
      documentElement: {
        classList: {
          contains: (/** @type {string} */ x) => clases.has(x),
          add: (/** @type {string} */ x) => clases.add(x),
          remove: (/** @type {string} */ x) => clases.delete(x),
        },
      },
      querySelector: () => ({ complete: true }),
      querySelectorAll: () => [{}],
    },
    window: { IntersectionObserver: Observador },
    IntersectionObserver: Observador,
  };
  vm.runInNewContext(leer('scripts/inicio-animacion.js'), contexto);
  assert.equal(clases.has('inicio-observar'), false);
});
test('Inicio conserva el arranque común y el título original', () => {
  const html = leer('inicio.html');
  assert.match(html, /src="scripts\/sitio\.js"/);
  assert.doesNotMatch(html, /apertura-titular/);
  assert.match(html, /class="apertura-entradilla"/);
});

function codigoDelMenu() {
  const fuente = leer('scripts/menu.js')
    .replace(/^import .*;$/gm, '')
    .replace('export function iniciarMenu()', 'function iniciarMenu()');
  return `${fuente}\niniciarMenu();`;
}

function prepararMenuDePrueba() {
  /** @type {Record<string, (...args: any[]) => void> & { 'menu-click': (evento: object) => void, pagehide: () => void, pageshow: (evento: {persisted: boolean}) => void }} */
  const manejadores = /** @type {any} */ ({});
  const almacen = new Map();
  /** @type {() => void} */
  let caducar;
  class Elemento {
    constructor(href = '') {
      this.href = href;
      this.target = '';
    }
    closest(/** @type {string} */ selector) {
      return selector === 'a' ? this : null;
    }
    hasAttribute() {
      return false;
    }
    addEventListener(/** @type {string} */ tipo, /** @type {(...args: any[]) => void} */ fn) {
      if (this === menu) {
        manejadores[`menu-${tipo}`] = fn;
      }
    }
  }
  class Boton extends Elemento {}
  const [menu, boton, velo] = [new Elemento(), new Boton(), new Elemento()];
  const contexto = {
    URL,
    Element: Elemento,
    HTMLElement: Elemento,
    HTMLButtonElement: Boton,
    location: { href: 'https://faro.test/otra.html' },
    window: {
      addEventListener: (/** @type {string} */ tipo, /** @type {(...args: any[]) => void} */ fn) => {
        manejadores[tipo] = fn;
      },
    },
    document: {
      querySelector: () => boton,
      getElementById: (/** @type {string} */ id) => (id === 'menu' ? menu : velo),
      addEventListener() {},
    },
    sessionStorage: {
      setItem: (/** @type {string} */ k, /** @type {string} */ v) => almacen.set(k, v),
      removeItem: (/** @type {string} */ k) => almacen.delete(k),
    },
    setTimeout: (/** @type {() => void} */ fn) => {
      caducar = fn;
    },
  };
  vm.runInNewContext(codigoDelMenu(), contexto);
  const clic = (extras = {}, href = 'https://faro.test/inicio.html') => {
    const evento = { target: new Elemento(href), button: 0, defaultPrevented: false, ...extras };
    manejadores['menu-click'](evento);
    return evento;
  };
  return { clic, almacen, manejadores, caducar: () => caducar() };
}

test('la marca del menú exige salida efectiva y un clic ordinario sin cancelar', () => {
  const { clic, almacen, manejadores, caducar } = prepararMenuDePrueba();
  const evento = clic();
  assert.equal(almacen.size, 0);
  evento.defaultPrevented = true;
  manejadores.pagehide();
  assert.equal(almacen.size, 0);
  clic({ ctrlKey: true });
  manejadores.pagehide();
  assert.equal(almacen.size, 0);
  clic({}, 'https://faro.test/otra.html#apartado');
  manejadores.pagehide();
  assert.equal(almacen.size, 0);
  clic();
  caducar();
  manejadores.pagehide();
  assert.equal(almacen.size, 0);
  clic();
  manejadores.pagehide();
  assert.equal(almacen.size, 1);
  manejadores.pageshow({ persisted: true });
  assert.equal(almacen.size, 0);
});

test('el retorno desde el menú funciona con la política sin referente', () => {
  const marca = {
    origen: 'https://faro.test/otra.html',
    destino: 'https://faro.test/inicio.html',
    instante: Date.now(),
  };
  assert.equal(inicial({ marca, referrer: '' }).clases.size, 0);
  assert.ok(
    inicial({ marca: { ...marca, origen: 'https://ajeno.test/otra.html' }, referrer: '' }).clases.has(
      'inicio-permitido',
    ),
  );
});
