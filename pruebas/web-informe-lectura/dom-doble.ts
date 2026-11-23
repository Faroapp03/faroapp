import type { TestContext } from 'node:test';
import { navegador } from '../web-controles/ayudas.js';

type Hijo = Elemento | Texto;

export class Texto {
  parentElement: Elemento | null = null;
  textContent: string;
  constructor(textContent: string) {
    this.textContent = textContent;
  }
}

function coincideSimple(nodo: Elemento, selector: string): boolean {
  const etiqueta = selector.match(/^[\w-]+/)?.[0];
  const id = selector.match(/#([\w-]+)/)?.[1];
  const clases = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const atributos = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
  return (
    (!etiqueta || nodo.tagName === etiqueta.toUpperCase()) &&
    (!id || nodo.id === id) &&
    clases.every((clase) => clase !== undefined && nodo.classList.contains(clase)) &&
    atributos.every(
      (m) => m[1] !== undefined && nodo.hasAttribute(m[1]) && (m[2] === undefined || nodo.getAttribute(m[1]) === m[2]),
    )
  );
}

function coincide(nodo: Elemento, selector: string): boolean {
  const partes = selector.trim().split(/\s+/);
  if (!coincideSimple(nodo, partes.at(-1) ?? '')) {
    return false;
  }
  let antecesor = nodo.parentElement;
  for (const parte of partes.slice(0, -1).reverse()) {
    while (antecesor && !coincideSimple(antecesor, parte)) {
      antecesor = antecesor.parentElement;
    }
    if (!antecesor) {
      return false;
    }
    antecesor = antecesor.parentElement;
  }
  return true;
}

const claveDato = (nombre: string) =>
  nombre.slice('data-'.length).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export class Elemento extends EventTarget {
  readonly tagName: string;
  parentElement: Elemento | null = null;
  childNodes: Hijo[] = [];
  dataset: Record<string, string> = {};
  atributos = new Map<string, string>();
  constructor(etiqueta: string) {
    super();
    this.tagName = etiqueta.toUpperCase();
  }
  get children(): Elemento[] {
    return this.childNodes.filter((n) => n instanceof Elemento);
  }
  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(valor: string) {
    this.replaceChildren(new Texto(valor));
  }
  get id(): string {
    return this.getAttribute('id') ?? '';
  }
  set id(valor: string) {
    this.setAttribute('id', valor);
  }
  get className(): string {
    return this.getAttribute('class') ?? '';
  }
  set className(valor: string) {
    this.setAttribute('class', valor);
  }
  get lang(): string {
    return this.getAttribute('lang') ?? '';
  }
  set lang(valor: string) {
    this.setAttribute('lang', valor);
  }
  get hidden(): boolean {
    return this.hasAttribute('hidden');
  }
  set hidden(valor: boolean) {
    if (valor) {
      this.setAttribute('hidden', '');
    } else {
      this.removeAttribute('hidden');
    }
  }
  get classList() {
    return { contains: (clase: string) => this.className.split(/\s+/).includes(clase) };
  }
  getAttribute(nombre: string): string | null {
    return nombre.startsWith('data-')
      ? (this.dataset[claveDato(nombre)] ?? null)
      : (this.atributos.get(nombre) ?? null);
  }
  hasAttribute(nombre: string): boolean {
    return this.getAttribute(nombre) !== null;
  }
  setAttribute(nombre: string, valor: string) {
    if (nombre.startsWith('data-')) {
      this.dataset[claveDato(nombre)] = String(valor);
    } else {
      this.atributos.set(nombre, String(valor));
    }
  }
  removeAttribute(nombre: string) {
    if (nombre.startsWith('data-')) {
      delete this.dataset[claveDato(nombre)];
    } else {
      this.atributos.delete(nombre);
    }
  }
  append(...hijos: (Hijo | string)[]) {
    for (const hijo of hijos) {
      const nodo = typeof hijo === 'string' ? new Texto(hijo) : hijo;
      nodo.parentElement = this;
      this.childNodes.push(nodo);
    }
  }
  replaceChildren(...hijos: Hijo[]) {
    for (const hijo of this.childNodes) {
      hijo.parentElement = null;
    }
    this.childNodes = [];
    this.append(...hijos);
  }
  before(...hijos: Elemento[]) {
    const padre = this.parentElement;
    if (!padre) {
      return;
    }
    for (const hijo of hijos) {
      hijo.parentElement = padre;
    }
    padre.childNodes.splice(padre.childNodes.indexOf(this), 0, ...hijos);
  }
  remove() {
    const padre = this.parentElement;
    if (padre) {
      padre.childNodes = padre.childNodes.filter((hijo) => hijo !== this);
    }
    this.parentElement = null;
  }
  matches(selector: string): boolean {
    return selector.split(',').some((parte) => coincide(this, parte));
  }
  querySelectorAll(selector: string): Elemento[] {
    return this.children
      .flatMap((hijo) => [hijo, ...hijo.querySelectorAll('*')])
      .filter((hijo) => selector === '*' || hijo.matches(selector));
  }
  querySelector(selector: string): Elemento | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string): Elemento | null {
    return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }
  focus() {
    documento.activeElement = this;
  }
}

export const documento = {
  documentElement: new Elemento('html'),
  activeElement: null as Elemento | null,
  createElement: (tag: string) => new Elemento(tag),
  createTextNode: (text: string) => new Texto(text),
};
documento.documentElement.lang = 'es';

export function nodo(tag: string, atributos: Record<string, string> = {}, ...hijos: (Hijo | string)[]): Elemento {
  const elemento = new Elemento(tag);
  for (const [k, v] of Object.entries(atributos)) {
    elemento.setAttribute(k, v);
  }
  elemento.append(...hijos);
  return elemento;
}

export function instalar(contexto: TestContext, piezas: Record<string, unknown> = {}) {
  navegador(contexto, {
    document: documento,
    Element: Elemento,
    HTMLElement: Elemento,
    Text: Texto,
    window: new EventTarget(),
    navigator: {},
    ...piezas,
  });
}

export const html = (elemento: Elemento) => elemento as unknown as HTMLElement;
export const pulsar = (elemento: Elemento) => elemento.dispatchEvent(new Event('click'));
export const avanzar = () => new Promise<void>((resolve) => setImmediate(resolve));

export function informe(idioma = 'es') {
  const completa = nodo(
    'section',
    {},
    nodo('h2', {}, 'Datos'),
    nodo('p', {}, 'Valor ', nodo('strong', {}, '0,735'), '.'),
    nodo('details', {}, nodo('summary', {}, 'CONTROL'), nodo('p', { lang: 'ca' }, 'Plegat llegible')),
    nodo('p', { hidden: '' }, 'OCULTO'),
    nodo('img', { alt: 'Alternativa' }),
    nodo('img', { alt: '' }),
    nodo('div', { 'aria-hidden': 'true' }, 'DECORATIVO'),
  );
  const portada = nodo('header', { class: 'portada' }, nodo('h1', {}, 'Informe 14·10·2026'));
  const cierre = nodo(
    'footer',
    { class: 'cierre' },
    nodo('button', { id: 'borrar' }),
    nodo('p', { class: 'marca-final' }),
  );
  const raizInforme = nodo(
    'article',
    { 'data-titulo-pdf': 'Título sintético', lang: idioma },
    portada,
    completa,
    cierre,
  );
  const estado = nodo('p', { id: 'estado' }, 'Estado vigente');
  const raiz = nodo('section', {}, raizInforme, estado);
  return { raiz, raizInforme, completa, portada, cierre, estado };
}
