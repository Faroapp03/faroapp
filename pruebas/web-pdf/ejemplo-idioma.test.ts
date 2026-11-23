import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// Doble acotado a las operaciones DOM del ejemplo: la identidad y hidden pertenecen al controlador de secciones.
class Elemento {
  atributos = new Map<string, string>();
  childNodes: { textContent: string }[] = [];
  hidden = false;
  getAttribute(nombre: string) {
    return this.atributos.get(nombre) ?? null;
  }
  setAttribute(nombre: string, valor: string) {
    this.atributos.set(nombre, valor);
  }
  removeAttribute(nombre: string) {
    this.atributos.delete(nombre);
  }
  cloneNode() {
    const copia = new Elemento();
    copia.atributos = new Map(this.atributos);
    copia.childNodes = this.childNodes.map((nodo) => ({ ...nodo }));
    copia.hidden = this.hidden;
    return copia;
  }
  replaceChildren(...nodos: { textContent: string }[]) {
    this.childNodes = nodos;
  }
}

const informe = new Elemento();
informe.hidden = true;
informe.setAttribute('lang', 'es');
informe.setAttribute('data-titulo-pdf', 'Ejemplo ficticio');
informe.childNodes = [{ textContent: 'Concertar citas' }];
const catalan = new Elemento();
catalan.setAttribute('lang', 'ca');
catalan.setAttribute('data-titulo-pdf', 'Exemple fictici');
catalan.setAttribute('data-marca-ia', 'procedencia catalana');
catalan.childNodes = [{ textContent: 'Concertar cites' }];
class Plantilla {
  content = { querySelector: () => catalan };
}
const preparaciones: Elemento[] = [];
const estado: { cambiar?: (idioma: 'es' | 'ca') => void } = {};
Object.defineProperties(globalThis, {
  HTMLElement: { configurable: true, value: Elemento },
  HTMLTemplateElement: { configurable: true, value: Plantilla },
  document: {
    configurable: true,
    value: { querySelector: (selector: string) => (selector === 'main.informe-breve' ? informe : new Plantilla()) },
  },
  __ejemploPreparar: { configurable: true, value: (raiz: Elemento) => preparaciones.push(raiz) },
  __ejemploCambiar: {
    configurable: true,
    value: (funcion: (idioma: 'es' | 'ca') => void) => (estado.cambiar = funcion),
  },
});
registerHooks({
  load(url, contexto, siguiente) {
    const dobles: Record<string, string> = {
      '/web/scripts/sitio.js': 'export {};',
      '/web/scripts/idioma.js': 'export const alCambiarIdioma = globalThis.__ejemploCambiar;',
      '/web/scripts/informe.js': 'export const prepararInforme = globalThis.__ejemploPreparar;',
      '/web/scripts/textos.js': 'export const idiomaActual = () => "ca";',
    };
    const codigo = Object.entries(dobles).find(([final]) => url.endsWith(final))?.[1];
    return codigo === undefined ? siguiente(url, contexto) : { format: 'module', source: codigo, shortCircuit: true };
  },
});

test('el idioma recordado y sus cambios conservan el main retirado y sus metadatos, con una preparación por cambio', async () => {
  await import('../../web/scripts/informe-ejemplo.js');
  assert.equal(informe.getAttribute('lang'), 'ca');
  assert.equal(informe.getAttribute('data-titulo-pdf'), 'Exemple fictici');
  assert.equal(informe.childNodes[0]?.textContent, 'Concertar cites');
  assert.equal(informe.hidden, true);
  assert.equal(informe.getAttribute('data-marca-ia'), 'procedencia catalana');
  assert.ok(estado.cambiar);
  estado.cambiar('es');
  assert.equal(informe.getAttribute('lang'), 'es');
  assert.equal(informe.getAttribute('data-titulo-pdf'), 'Ejemplo ficticio');
  assert.equal(informe.childNodes[0]?.textContent, 'Concertar citas');
  assert.equal(informe.getAttribute('data-marca-ia'), null);
  assert.equal(informe.hidden, true);
  // El controlador conserva la misma referencia y puede reabrirla después de una retirada.
  informe.hidden = false;
  estado.cambiar('ca');
  assert.equal(informe.hidden, false);
  assert.deepEqual(preparaciones, [informe, informe, informe]);
});
