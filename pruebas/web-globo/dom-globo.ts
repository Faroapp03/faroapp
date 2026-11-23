// Extiende solo el DOM de pruebas ya admitido con las operaciones que usa el selector del globo; no renderiza.
import type { TestContext } from 'node:test';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento } from '../web-informe-lectura/dom-doble.ts';

export class ElementoDePrueba extends Elemento {
  focos = 0;
  texto = '';
  value = '';
  htmlFor = '';
  tabIndex = 0;
  src = '';
  alt = '';
  width = 0;
  height = 0;
  clientWidth = 640;
  clientHeight = 480;
  offsetTop = 0;
  offsetHeight = 0;
  scrollTop = 0;
  style = {
    propiedades: new Map<string, string>(),
    setProperty(nombre: string, valor: string) {
      this.propiedades.set(nombre, valor);
    },
  };
  get clases() {
    return new Set(this.className.split(/\s+/));
  }
  override get textContent(): string {
    return this.texto + super.textContent;
  }
  override set textContent(valor: string) {
    this.texto = '';
    super.textContent = valor;
  }
  descendientes(): ElementoDePrueba[] {
    return this.children.flatMap((hijo) => [hijo as ElementoDePrueba, ...(hijo as ElementoDePrueba).descendientes()]);
  }
  override querySelector(selector: string): ElementoDePrueba | null {
    return super.querySelector(selector) as ElementoDePrueba | null;
  }
  override focus() {
    this.focos++;
  }
  scrollIntoView() {}
  replaceWith(otro: ElementoDePrueba) {
    this.before(otro);
    this.remove();
  }
  contains(otro: Elemento | null): boolean {
    for (let nodo = otro; nodo; nodo = nodo.parentElement) {
      if (nodo === this) {
        return true;
      }
    }
    return false;
  }
  getContext(): WebGLRenderingContext | null {
    return null;
  }
  emitir(tipo: string, datos: Record<string, unknown> = {}) {
    const evento = new Event(tipo, { cancelable: true });
    for (const [nombre, value] of Object.entries(datos)) {
      Object.defineProperty(evento, nombre, { configurable: true, value });
    }
    this.dispatchEvent(evento);
    return Promise.resolve();
  }
  click() {
    return this.emitir('click');
  }
}

export function navegadorDePrueba(contexto: { after: (fn: () => void) => void }, piezas: Record<string, unknown>) {
  // navegador solo necesita after para restituir los globals, también en la instalación del archivo completo.
  navegador(contexto as TestContext, piezas);
}

export const html = (nodo: ElementoDePrueba) => nodo as unknown as HTMLElement;
export function enfocar(nodo: ElementoDePrueba | null) {
  (document as unknown as { activeElement: ElementoDePrueba | null }).activeElement = nodo;
}
