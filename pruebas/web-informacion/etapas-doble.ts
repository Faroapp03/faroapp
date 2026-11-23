// El doble de una página por etapas para las pruebas de scripts/etapas.js: el HTML real convertido a piezas del doble
// admitido (web-informe-lectura/dom-doble.ts), con su ventana, su dirección y su historia. Lo comparten la página
// «Qué es la IA» (etapas.test.ts) y la página «Qué es Faro» (faro-etapas.test.ts).
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parse } from 'parse5';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento, Texto } from '../web-informe-lectura/dom-doble.ts';

// Extensión local del doble admitido: contains, classList completo, foco y desplazamiento apuntados. No simula
// disposición ni navegación: el fragmento se cambia a mano y se avisa con hashchange o popstate, como hace el
// navegador; pushState apunta la dirección sin avisar, como él.
export class Pieza extends Elemento {
  static enfocado: { pieza: Pieza; opciones: unknown } | null = null;
  static desplazadas: Pieza[] = [];
  contains(otra: Pieza): boolean {
    for (let nodo: Elemento | null = otra; nodo; nodo = nodo.parentElement) {
      if (nodo === this) {
        return true;
      }
    }
    return false;
  }
  override get classList() {
    const clases = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const guardar = (conjunto: Set<string>) => this.setAttribute('class', [...conjunto].join(' '));
    return {
      contains: (clase: string) => clases().has(clase),
      add: (clase: string) => guardar(clases().add(clase)),
      toggle: (clase: string, poner: boolean) => {
        const conjunto = clases();
        if (poner) {
          conjunto.add(clase);
        } else {
          conjunto.delete(clase);
        }
        guardar(conjunto);
      },
    };
  }
  override focus(opciones?: unknown) {
    Pieza.enfocado = { pieza: this, opciones };
  }
  scrollIntoView() {
    Pieza.desplazadas.push(this);
  }
}

/** Dónde está la vista de partida en el doble, y adónde la lleva el salto nativo de un navegador al fragmento. */
export const VISTA = 120;
export const SALTO = 900;

/** El árbol de parse5 como piezas del doble: elementos y textos; comentarios fuera. */
function convertir(nodo: DefaultTreeAdapterTypes.Element): Pieza {
  const pieza = new Pieza(nodo.tagName);
  for (const { name, value } of nodo.attrs) {
    pieza.setAttribute(name, value);
  }
  for (const hijo of nodo.childNodes) {
    if (defaultTreeAdapter.isElementNode(hijo)) {
      pieza.append(convertir(hijo));
    } else if (defaultTreeAdapter.isTextNode(hijo)) {
      pieza.append(new Texto(hijo.value));
    }
  }
  return pieza;
}

/** El history del doble: apunta las direcciones que la página añade con pushState y cambia el fragmento, sin avisar. */
function historiaDoble(ubicacion: { hash: string }) {
  const apuntadas: string[] = [];
  const pushState = (_estado: unknown, _titulo: string, url: string) => {
    apuntadas.push(url);
    ubicacion.hash = url;
  };
  return { apuntadas, historia: { pushState } };
}

/** Una página real en el doble, con el fragmento de partida; el módulo de etapas aún sin cargar. */
export function abrirEtapas(t: TestContext, html: string, fragmento = '') {
  const documento = parse(html);
  const raizHtml = documento.childNodes.find(defaultTreeAdapter.isElementNode);
  assert.ok(raizHtml);
  const raiz = convertir(raizHtml);
  const ventana = Object.assign(new EventTarget(), {
    scrollY: VISTA,
    scrollTo: ({ top }: { top: number }) => {
      ventana.scrollY = top;
    },
  });
  const ubicacion = { hash: fragmento };
  const { apuntadas, historia } = historiaDoble(ubicacion);
  navegador(t, {
    document: {
      baseURI: 'https://ejemplo.invalid/entender-ia.html',
      documentElement: raiz,
      querySelectorAll: (selector: string) => raiz.querySelectorAll(selector),
      querySelector: (selector: string) => raiz.querySelector(selector),
      getElementById: (id: string) => (raiz.querySelectorAll('*') as Pieza[]).find((pieza) => pieza.id === id) ?? null,
      createElement: (etiqueta: string) => new Pieza(etiqueta),
      createTextNode: (texto: string) => new Texto(texto),
    },
    window: ventana,
    location: ubicacion,
    history: historia,
    HTMLElement: Pieza,
    Element: Pieza,
  });
  Pieza.enfocado = null;
  Pieza.desplazadas = [];
  const porId = (id: string) => (raiz.querySelectorAll('*') as Pieza[]).find((pieza) => pieza.id === id) as Pieza;
  const contenedor = raiz.querySelector('[data-etapas]') as Pieza;
  const etapas = contenedor.children.filter((hijo) => hijo.hasAttribute('data-etapa')) as Pieza[];
  const enlaces = contenedor.querySelector('[data-etapas-barra]')?.querySelectorAll('a') as Pieza[];
  /** Cambia el fragmento como un enlace, atrás o adelante, y avisa. */
  const navegar = (nuevo: string) => {
    ubicacion.hash = nuevo;
    ventana.dispatchEvent(new Event('hashchange'));
  };
  /**
   * Atrás o adelante: el navegador avisa con popstate y, si cambia el fragmento, con hashchange; entre los dos salta
   * al elemento del fragmento, que acaba de dejar de estar oculto.
   */
  const volver = (nuevo: string, conHashchange = true) => {
    ubicacion.hash = nuevo;
    ventana.dispatchEvent(new Event('popstate'));
    if (conHashchange) {
      ventana.scrollY = SALTO;
      ventana.dispatchEvent(new Event('hashchange'));
    }
  };
  return { raiz, porId, contenedor, etapas, enlaces, navegar, volver, ventana, ubicacion, apuntadas };
}
