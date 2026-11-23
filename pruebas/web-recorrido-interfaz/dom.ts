import type { TestContext } from 'node:test';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento, Texto } from '../web-informe-lectura/dom-doble.ts';

/** Solo DOM de interacción; no interpreta HTML ni simula maquetación. */
export class Nodo extends Elemento {
  value = '';
  maxLength = 8000;
  readOnly = false;
  type = '';
  name = '';
  get href() {
    return this.getAttribute('href') ?? '';
  }
  set href(valor: string) {
    this.setAttribute('href', valor);
  }
  scrollHeight = 20;
  style: Record<string, string> = {};
  seleccion: number[] = [];
  desplazamientos: unknown[] = [];
  open = false;
  override get classList() {
    const clases = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const cambiar = (nombre: string, poner: boolean) => {
      const lista = clases();
      if (poner) {
        lista.add(nombre);
      } else {
        lista.delete(nombre);
      }
      this.className = [...lista].join(' ');
    };
    return {
      contains: (nombre: string) => clases().has(nombre),
      add: (nombre: string) => cambiar(nombre, true),
      remove: (nombre: string) => cambiar(nombre, false),
      toggle: (nombre: string, poner: boolean) => cambiar(nombre, poner),
    };
  }
  override matches(selector: string): boolean {
    if (selector === 'button:not([data-volver])') {
      return this.tagName === 'BUTTON' && !this.hasAttribute('data-volver');
    }
    return super.matches(selector);
  }
  override focus() {
    documento.activeElement = this;
  }
  setSelectionRange(inicio: number, fin: number) {
    this.seleccion = [inicio, fin];
  }
  scrollIntoView(opciones: unknown) {
    this.desplazamientos.push(opciones);
  }
  requestSubmit() {
    this.dispatchEvent(new Event('submit', { cancelable: true }));
  }
  prepend(...hijos: Nodo[]) {
    for (const hijo of hijos) {
      hijo.parentElement = this;
    }
    this.childNodes.unshift(...hijos);
  }
  toggleAttribute(nombre: string, poner: boolean) {
    if (poner) {
      this.setAttribute(nombre, '');
    } else {
      this.removeAttribute(nombre);
    }
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }
  cloneNode(profundo: boolean): Nodo {
    const copia = new Nodo(this.tagName);
    for (const [k, v] of this.atributos) {
      copia.setAttribute(k, v);
    }
    Object.assign(copia.dataset, this.dataset);
    if (profundo) {
      for (const hijo of this.childNodes) {
        copia.append(hijo instanceof Nodo ? hijo.cloneNode(true) : new Texto(hijo.textContent));
      }
    }
    return copia;
  }
}
const inicial = new Nodo('html');
const body = new Nodo('body');
export const documento = Object.assign(new EventTarget(), {
  documentElement: inicial,
  body,
  activeElement: null as Nodo | null,
  createElement: (tag: string) => new Nodo(tag),
  createTextNode: (s: string) => new Texto(s),
  getElementById: (id: string) => documento.body.querySelector(`#${id}`),
  querySelectorAll: (css: string) => documento.body.querySelectorAll(css),
  querySelector: (css: string) => documento.body.querySelector(css),
});
export function nodo(tag: string, id = '', padre = documento.body) {
  const nuevo = new Nodo(tag);
  nuevo.id = id;
  padre.append(nuevo);
  return nuevo;
}
export function entorno(t: TestContext) {
  documento.body.replaceChildren();
  documento.body.dataset = {};
  documento.documentElement.lang = 'es';
  documento.activeElement = null;
  const ventana = new EventTarget();
  navegador(t, {
    document: documento,
    window: ventana,
    Element: Nodo,
    HTMLElement: Nodo,
    Node: Nodo,
    HTMLTextAreaElement: Nodo,
    HTMLFormElement: Nodo,
    HTMLButtonElement: Nodo,
    HTMLOListElement: Nodo,
    HTMLDialogElement: Nodo,
    navigator: { platform: 'Linux', onLine: true },
    getComputedStyle: () => ({ paddingTop: '0', paddingBottom: '0', lineHeight: '20' }),
  });
  return { ventana };
}
export const html = (n: Nodo) => n as unknown as HTMLElement;
export function evento(tipo: string, datos: Record<string, unknown> = {}) {
  const nuevo = new Event(tipo, { cancelable: true });
  for (const [k, value] of Object.entries(datos)) {
    Object.defineProperty(nuevo, k, { value });
  }
  return nuevo;
}
export function base() {
  for (const id of ['conversacion', 'sugerencias', 'rc-estado']) {
    nodo('div', id);
  }
}
export function barra() {
  const form = nodo('form', 'compositor');
  const campo = nodo('textarea', 'mensaje', form);
  nodo('button', '', form).className = 'rc-enviar';
  for (const id of [
    'etiqueta-mensaje',
    'contador-mensaje',
    'rc-sin-conexion',
    'rc-teclas',
    'ampliar-texto',
    'abrir-privacidad',
    'cerrar-privacidad',
    'ampliar',
    't-privacidad',
  ]) {
    nodo('div', id);
  }
  nodo('div', 'aviso-privacidad').hidden = true;
  return { form, campo };
}
