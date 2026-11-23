import { after } from 'node:test';
import { almacen, navegador } from '../web-controles/ayudas.js';
import { Elemento, Texto } from '../web-informe-lectura/dom-doble.ts';

/** Extensión del doble admitido: CSSOM y clases que usan gráficos y capítulos; sin interpretar HTML o maquetar. */
export class Nodo extends Elemento {
  get src() {
    return this.getAttribute('src') ?? '';
  }
  set src(valor: string) {
    this.setAttribute('src', valor);
  }
  readonly style = {
    propiedades: new Map<string, string>(),
    setProperty(nombre: string, valor: string) {
      this.propiedades.set(nombre, String(valor));
    },
    getPropertyValue(nombre: string) {
      return this.propiedades.get(nombre) ?? '';
    },
  };
  override get classList() {
    return {
      contains: (clase: string) => this.className.split(/\s+/).includes(clase),
      add: (...clases: string[]) => {
        this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...clases])].join(' ');
      },
    };
  }
  override querySelectorAll(selector: string): Nodo[] {
    return super.querySelectorAll(selector).filter((n): n is Nodo => n instanceof Nodo);
  }
  override querySelector(selector: string): Nodo | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  replaceWith(nuevo: Nodo) {
    const padre = this.parentElement;
    if (!padre) {
      return;
    }
    const indice = padre.childNodes.indexOf(this);
    if (indice < 0) {
      throw new Error('Nodo sin posición en su padre');
    }
    padre.childNodes.splice(indice, 1, nuevo);
    nuevo.parentElement = padre;
    this.parentElement = null;
  }
}
const raiz = new Nodo('html');
export function paginaDePrueba({ ids = [] }: { ids?: string[] } = {}) {
  const nodos: Nodo[] = [];
  const crear = (etiqueta: string) => {
    const nodo = new Nodo(etiqueta);
    nodos.push(nodo);
    return nodo;
  };
  const porId = new Map(
    ids.map((id) => {
      const n = crear(id.endsWith('-claves') ? 'ol' : 'div');
      n.id = id;
      return [id, n] as const;
    }),
  );
  raiz.lang = 'es';
  raiz.dataset.idioma = 'es';
  const body = crear('body');
  body.append(...porId.values());
  const documento = {
    documentElement: raiz,
    body,
    createElement: crear,
    createElementNS: (_espacio: string, etiqueta: string) => crear(etiqueta),
    createTextNode: (texto: string) => new Texto(texto),
    getElementById: (id: string) => porId.get(id) ?? null,
    querySelector: (_selector: string): Nodo | null => null,
    querySelectorAll: (_selector: string) =>
      nodos.filter((n) => n.dataset.texto !== undefined || n.dataset.dato !== undefined || n.atributos.size > 0),
  };
  return { documento, nodos, porId };
}
export const CLASES_DE_NODO = {
  Element: Nodo,
  HTMLElement: Nodo,
  Node: Nodo,
  Text: Texto,
  HTMLOListElement: Nodo,
  HTMLButtonElement: Nodo,
};
export const almacenEnMemoria = almacen;
export const navegadorDePrueba = navegador;
export { Nodo as ElementoDePrueba };
export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Cada caso instala sus respuestas; cualquier lectura olvidada falla sin salir a la red. */
export function sinRedDeVerdad() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Red no sustituida en prueba de capítulos');
  };
  after(() => {
    globalThis.fetch = original;
  });
}
export function elemento(nodo: unknown): Nodo {
  if (!(nodo instanceof Nodo)) {
    throw new Error('Falta un nodo esperado de la prueba');
  }
  return nodo;
}

export function definido<T>(valor: T | null | undefined): T {
  if (valor === null || valor === undefined) {
    throw new Error('Falta un valor esperado de la fixture');
  }
  return valor;
}
