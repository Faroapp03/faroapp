// Extensión local del doble admitido: CSSOM y SVG; no simula disposición del navegador.
import type { TestContext } from 'node:test';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento, Texto } from '../web-informe-lectura/dom-doble.ts';

export class Pieza extends Elemento {
  style = {
    propiedades: new Map<string, string>(),
    setProperty(nombre: string, valor: string) {
      this.propiedades.set(nombre, valor);
    },
  };
  replaceWith(nuevo: Pieza) {
    const padre = this.parentElement;
    if (!padre) {
      return;
    }
    const indice = padre.childNodes.indexOf(this);
    padre.childNodes.splice(indice, 1, nuevo);
    nuevo.parentElement = padre;
    this.parentElement = null;
  }
}

export function dom(t: TestContext) {
  const raiz = new Pieza('html');
  const body = new Pieza('body');
  raiz.append(body);
  const creados: Pieza[] = [];
  const crear = (etiqueta: string) => {
    const pieza = new Pieza(etiqueta);
    creados.push(pieza);
    return pieza;
  };
  const documento = {
    documentElement: raiz,
    body,
    createElement: crear,
    createElementNS: (_espacio: string, etiqueta: string) => crear(etiqueta),
    createTextNode: (texto: string) => new Texto(texto),
    querySelectorAll: (selector: string) => creados.filter((pieza) => pieza.matches(selector)),
    querySelector: (selector: string) => creados.find((pieza) => pieza.matches(selector)) ?? null,
    getElementById: (id: string) => creados.find((pieza) => pieza.id === id) ?? null,
  };
  navegador(t, {
    document: documento,
    HTMLElement: Elemento,
    Element: Elemento,
    Node: Elemento,
    location: { href: 'https://ejemplo.invalid/web/datos-globales.html' },
    fetch: () => {
      throw new Error('Red real prohibida en esta prueba');
    },
  });
  const conId = (id: string) => {
    const pieza = crear('div');
    pieza.id = id;
    body.append(pieza);
    return pieza;
  };
  return { raiz, body, creados, crear, conId };
}
