import { readFileSync } from 'node:fs';

/** @import { TestContext } from 'node:test' */

/** @type {WeakMap<TestContext, Map<string, PropertyDescriptor | undefined>>} */
const originales = new WeakMap();

/** Restituye cada global incluso si la prueba lo reemplaza varias veces. @param {TestContext} contexto @param {Record<string, unknown>} piezas */
export function navegador(contexto, piezas) {
  let deLaPrueba = originales.get(contexto);
  if (!deLaPrueba) {
    const guardados = new Map();
    deLaPrueba = guardados;
    originales.set(contexto, guardados);
    contexto.after(() => {
      for (const [nombre, antes] of guardados) {
        if (antes) {
          Object.defineProperty(globalThis, nombre, antes);
        } else {
          Reflect.deleteProperty(globalThis, nombre);
        }
      }
    });
  }
  for (const [nombre, value] of Object.entries(piezas)) {
    if (!deLaPrueba.has(nombre)) {
      deLaPrueba.set(nombre, Object.getOwnPropertyDescriptor(globalThis, nombre));
    }
    Object.defineProperty(globalThis, nombre, { configurable: true, writable: true, value });
  }
}

/** @param {Record<string, string>} [valores] */
export function almacen(valores = {}) {
  const mapa = new Map(Object.entries(valores));
  return {
    mapa,
    getItem: (/** @type {string} */ clave) => mapa.get(clave) ?? null,
    setItem: (/** @type {string} */ clave, /** @type {string} */ valor) => mapa.set(clave, valor),
  };
}

/** Eventos sintéticos cancelables con las propiedades que lee el control. @param {string} tipo @param {Record<string, unknown>} [datos] */
export function evento(tipo, datos = {}) {
  return Object.assign(new Event(tipo, { cancelable: true, bubbles: true }), datos);
}

/** DOM mínimo para contratos de controles; no interpreta HTML ni simula renderizado. */
export class Nodo extends EventTarget {
  /** @type {Record<string, string>} */
  dataset = {};
  /** @type {Nodo[]} */
  children = [];
  /** @type {Nodo | null} */
  parentElement = null;
  atributos = new Map();
  /** @type {Map<string, Nodo[]>} */
  consultas = new Map();
  clases = new Set();
  hidden = true;
  inert = false;
  textContent = '';
  lang = '';
  /** @type {() => void} */
  alEnfocar = () => {};
  focus() {
    this.alEnfocar();
  }
  /** @param {...(Nodo | string)} hijos */
  append(...hijos) {
    for (const hijo of hijos) {
      if (typeof hijo !== 'string') {
        hijo.parentElement = this;
        this.children.push(hijo);
      }
    }
  }
  /** @param {string} nombre @param {string} valor */
  setAttribute(nombre, valor) {
    this.atributos.set(nombre, valor);
  }
  /** @param {string} nombre @returns {string | null} */
  getAttribute(nombre) {
    return this.atributos.get(nombre) ?? null;
  }
  /** @param {string} nombre */
  hasAttribute(nombre) {
    return this.atributos.has(nombre);
  }
  /** @param {string} nombre */
  removeAttribute(nombre) {
    this.atributos.delete(nombre);
  }
  /** @param {string} css */
  querySelectorAll(css) {
    return this.consultas.get(css) ?? [];
  }
  /** @param {string} css */
  querySelector(css) {
    return this.querySelectorAll(css).at(0) ?? null;
  }
  /** @param {Nodo} otro @returns {boolean} */
  contains(otro) {
    return this === otro || this.children.some((hijo) => hijo.contains(otro));
  }
  /** @param {string} css */
  matches(css) {
    return this.consultas.has(css);
  }
  /** @param {string} css @returns {Nodo | null} */
  closest(css) {
    return this.matches(css) ? this : (this.parentElement?.closest(css) ?? null);
  }
  get classList() {
    return {
      add: (/** @type {string} */ nombre) => this.clases.add(nombre),
      remove: (/** @type {string} */ nombre) => this.clases.delete(nombre),
    };
  }
}

export class Boton extends Nodo {}

/** @param {TestContext} contexto */
export function pagina(contexto) {
  const body = new Nodo();
  const documentElement = new Nodo();
  documentElement.lang = 'es';
  /** @type {Nodo | null} */
  let activeElement = body;
  /** @type {Map<string, Nodo[]>} */
  const consultas = new Map();
  const ids = new Map();
  const document = Object.assign(new EventTarget(), {
    body,
    documentElement,
    get activeElement() {
      return activeElement;
    },
    querySelectorAll: (/** @type {string} */ css) => consultas.get(css) ?? [],
    querySelector: (/** @type {string} */ css) => consultas.get(css)?.at(0) ?? null,
    getElementById: (/** @type {string} */ id) => ids.get(id) ?? null,
    createElement: () => new Nodo(),
  });
  // Object.assign materializa el getter; definirlo conserva el foco mutable de este documento.
  Object.defineProperty(document, 'activeElement', { get: () => activeElement });
  const enfocable = (/** @type {Nodo} */ nodo) => {
    nodo.alEnfocar = () => {
      activeElement = nodo;
    };
    return nodo;
  };
  navegador(contexto, { document, HTMLElement: Nodo, Element: Nodo, Node: Nodo, HTMLButtonElement: Boton });
  return { document, consultas, ids, enfocable };
}

let instancia = 0;
/** @param {string} archivo */
export function cargar(archivo) {
  return import(new URL(`../../web/scripts/${archivo}?control=${++instancia}`, import.meta.url).href);
}

/** @param {string} archivo */
export function leer(archivo) {
  return readFileSync(new URL(`../../web/scripts/${archivo}`, import.meta.url), 'utf8');
}
