import assert from 'node:assert/strict';
import { after } from 'node:test';
import { Elemento, Texto } from '../web-informe-lectura/dom-doble.ts';

/** Solo DOM de contratos/eventos: no simula layout ni comportamiento de un navegador real. */
export class Nodo extends Elemento {
  value = '';
  type = '';
  name = '';
  checked = false;
  disabled = false;
  htmlFor = '';
  role = '';
  override get classList() {
    return {
      contains: (clase: string) => this.className.split(/\s+/).includes(clase),
      add: (...clases: string[]) => {
        this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...clases])].join(' ');
      },
    };
  }
  override getAttribute(nombre: string): string | null {
    if (nombre === 'for') {
      return this.htmlFor || null;
    }
    if (['type', 'name', 'value', 'role'].includes(nombre)) {
      return String(Reflect.get(this, nombre)) || null;
    }
    return super.getAttribute(nombre);
  }
  override matches(selector: string): boolean {
    return selector.split(',').some((parte) => {
      const base = parte.replace(/:not\(([^)]+)\)/g, '');
      const excluidos = [...parte.matchAll(/:not\(([^)]+)\)/g)].map((m) => m[1] ?? '');
      const marcada = !base.includes(':checked') || this.checked;
      const normal = base
        .replace(':checked', '')
        .replace(/'([^']*)'/g, '"$1"')
        .replace(/\[([\w-]+)=([^\]"']+)\]/g, '[$1="$2"]');
      // «:disabled» lo dice la propiedad, como en un navegador; las demás exclusiones, el selector simple.
      const excluido = (x: string) => (x === ':disabled' ? this.disabled : super.matches(x));
      return marcada && !excluidos.some(excluido) && super.matches(normal);
    });
  }
  override focus() {
    pagina.activeElement = this;
  }
  scrollIntoView() {}
  scrollTo() {}
  prepend(...hijos: Nodo[]) {
    this.replaceChildren(...hijos, ...this.childNodes);
  }
}

const crear = (nombre: string) => new Nodo(nombre);
export const pagina = {
  documentElement: new Nodo('html'),
  body: new Nodo('body'),
  activeElement: null as Nodo | null,
  createElement: crear,
  createTextNode: (texto: string) => new Texto(texto),
  implementation: { createHTMLDocument: () => ({ createElement: crear }) },
  adoptNode: (nodo: Nodo) => nodo,
  getElementById: (id: string) => pagina.body.querySelector(`#${id}`),
  querySelector: (selector: string) => pagina.body.querySelector(selector),
  querySelectorAll: (selector: string) => pagina.body.querySelectorAll(selector),
};
pagina.documentElement.lang = 'es';

/** Idioma.js conserva la raíz al importar; estas piezas duran solo el proceso aislado de este archivo de pruebas. */
const anteriores = new Map<string, PropertyDescriptor | undefined>();
for (const [nombre, valor] of Object.entries({
  document: pagina,
  HTMLElement: Nodo,
  Element: Nodo,
  HTMLInputElement: Nodo,
  HTMLSelectElement: Nodo,
  HTMLTextAreaElement: Nodo,
  Text: Texto,
  fetch: async () => {
    throw new Error('Estas pruebas no admiten red');
  },
})) {
  anteriores.set(nombre, Object.getOwnPropertyDescriptor(globalThis, nombre));
  Object.defineProperty(globalThis, nombre, { configurable: true, writable: true, value: valor });
}
after(() => {
  for (const [nombre, descriptor] of anteriores) {
    if (descriptor) {
      Object.defineProperty(globalThis, nombre, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, nombre);
    }
  }
});

export function prepararDom() {
  pagina.body = new Nodo('body');
  pagina.activeElement = null;
  for (const id of [
    'compositor',
    'form-ocupacion',
    'tarjeta-ocupacion',
    'sugerencias',
    'form-tareas',
    'rc-estado',
    'avisos-tareas',
    'bloques-oficiales',
    'lista-tareas',
    'ocupacion-elegida',
    'revisar-ocupacion',
    'boton-anadir',
  ]) {
    const elemento = new Nodo(id.startsWith('form-') || id === 'compositor' ? 'form' : 'div');
    elemento.id = id;
    pagina.body.append(elemento);
  }
  const boton = new Nodo('button');
  boton.type = 'submit';
  buscar('compositor').append(boton);
}

export function buscar(id: string): Nodo {
  const nodo = pagina.getElementById(id);
  assert.ok(nodo instanceof Nodo, id);
  return nodo;
}
export function html(nodo: Nodo): HTMLElement {
  return nodo as unknown as HTMLElement;
}
