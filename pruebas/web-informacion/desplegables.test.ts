// scripts/desplegables.js y scripts/desplegables-de-pagina.js: las referencias (y los desplegables de las guías) se
// abren al seguir una cita o un fragmento y al imprimir, y Datos globales sigue abriendo los suyos por el mismo camino.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { entradaConSri } from '../ayudas/web-construida.ts';
import { navegador } from '../web-controles/ayudas.js';

const WEB = new URL('../../web/', import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, WEB), 'utf8');
const { abrirDesplegablesAlImprimir, abrirDesplegablesAlSeguirEnlaces, abrirDesplegablesDelFragmento } = await import(
  '../../web/scripts/desplegables.js'
);

type Oyente = (evento: unknown) => void;

/** Un `<details>` mínimo: su id, lo que contiene y si está abierto. */
function desplegable(id: string, contiene: string[], abierto = false) {
  const atributos = new Map<string, string>(abierto ? [['open', '']] : []);
  return {
    id,
    closest: () => null,
    querySelector: (selector: string) => (contiene.includes(selector.slice(1)) ? {} : null),
    hasAttribute: (nombre: string) => atributos.has(nombre),
    setAttribute: (nombre: string, valor: string) => atributos.set(nombre, valor),
    removeAttribute: (nombre: string) => atributos.delete(nombre),
  };
}

/** La ventana, la dirección y el documento del doble, con los oyentes apuntados. */
function montar(t: import('node:test').TestContext, hash = '') {
  const oyentesVentana = new Map<string, Oyente>();
  const oyentesDocumento = new Map<string, Oyente>();
  const vistas: string[] = [];
  const enfocados: Array<{ id: string; opciones: unknown }> = [];
  const destinos = new Map<string, unknown>();
  class Elemento {}
  const ubicacion = { hash };
  navegador(t, {
    location: ubicacion,
    addEventListener: (tipo: string, oyente: Oyente) => oyentesVentana.set(tipo, oyente),
    Element: Elemento,
    document: {
      addEventListener: (tipo: string, oyente: Oyente) => oyentesDocumento.set(tipo, oyente),
      getElementById: (id: string) => destinos.get(id) ?? null,
    },
  });
  /** Un destino de la página (un `<li id="ref-N">`) que apunta su desplazamiento y su foco. */
  const destino = (id: string) => {
    const atributos = new Map<string, string>();
    const pieza = {
      tabIndex: -1,
      hasAttribute: (nombre: string) => atributos.has(nombre),
      setAttribute: (nombre: string, valor: string) => atributos.set(nombre, valor),
      scrollIntoView: (opciones: { behavior: string }) => vistas.push(`${id}:${opciones.behavior}`),
      focus: (opciones: unknown) => enfocados.push({ id, opciones }),
      atributos,
    };
    destinos.set(id, pieza);
    return pieza;
  };
  const cita = (href: string) =>
    Object.assign(new Elemento(), {
      closest: (selector: string) => (selector === 'a[href^="#ref-"]' && href.startsWith('#ref-') ? cita_(href) : null),
    });
  const cita_ = (href: string) => ({ getAttribute: () => href });
  return { ubicacion, oyentesVentana, oyentesDocumento, vistas, enfocados, destino, cita };
}

test('al cargar con #ref-N, el desplegable se abre y la vista y el foco van al destino, de una vez', (t) => {
  const { oyentesVentana, vistas, enfocados, destino } = montar(t, '#ref-3');
  const ref = destino('ref-3');
  const referencias = desplegable('referencias-desplegable', ['ref-1', 'ref-3']);
  abrirDesplegablesAlSeguirEnlaces([referencias] as never);
  assert.equal(referencias.hasAttribute('open'), true);
  assert.deepEqual(vistas, ['ref-3:instant'], 'sin desplazamiento suave');
  assert.deepEqual(enfocados, [{ id: 'ref-3', opciones: { preventScroll: true } }]);
  assert.equal(ref.atributos.get('tabindex'), '-1', 'el destino admite el foco');
  assert.ok(oyentesVentana.has('hashchange'));
});

test('sin fragmento, o con uno que no está dentro, nada se abre ni se mueve', (t) => {
  const { vistas, oyentesVentana, ubicacion, destino } = montar(t);
  destino('otro');
  const referencias = desplegable('referencias-desplegable', ['ref-1']);
  abrirDesplegablesAlSeguirEnlaces([referencias] as never);
  assert.equal(referencias.hasAttribute('open'), false);
  ubicacion.hash = '#otro';
  oyentesVentana.get('hashchange')?.({});
  ubicacion.hash = '#no es un id';
  oyentesVentana.get('hashchange')?.({});
  assert.equal(referencias.hasAttribute('open'), false);
  assert.deepEqual(vistas, []);
});

test('en cada hashchange se abre el desplegable que contiene el destino y se lleva la vista; ya abierto, no se repite', (t) => {
  const { oyentesVentana, ubicacion, vistas, destino } = montar(t);
  destino('ref-2');
  const referencias = desplegable('referencias-desplegable', ['ref-2']);
  abrirDesplegablesAlSeguirEnlaces([referencias] as never);
  ubicacion.hash = '#ref-2';
  oyentesVentana.get('hashchange')?.({});
  assert.equal(referencias.hasAttribute('open'), true);
  assert.deepEqual(vistas, ['ref-2:instant']);
  oyentesVentana.get('hashchange')?.({});
  assert.deepEqual(vistas, ['ref-2:instant'], 'abierto ya, el navegador lleva la vista solo');
});

test('al pulsar una cita (a[href^="#ref-"]) se abre el desplegable antes de que el navegador salte', (t) => {
  const { oyentesDocumento, cita } = montar(t);
  const referencias = desplegable('referencias-desplegable', ['ref-5']);
  abrirDesplegablesAlSeguirEnlaces([referencias] as never);
  const clic = oyentesDocumento.get('click');
  assert.ok(clic);
  clic({ target: { closest: () => null } });
  assert.equal(referencias.hasAttribute('open'), false, 'un clic en otra cosa no abre nada');
  const enlace = cita('#ref-5');
  clic({ target: enlace });
  assert.equal(referencias.hasAttribute('open'), true);
});

test('al imprimir se abren todos y después cada uno vuelve a su estado', (t) => {
  const { oyentesVentana } = montar(t);
  const cerrado = desplegable('a', []);
  const abierto = desplegable('b', [], true);
  abrirDesplegablesAlImprimir([cerrado, abierto] as never);
  oyentesVentana.get('beforeprint')?.({});
  assert.equal(cerrado.hasAttribute('open'), true);
  assert.equal(abierto.hasAttribute('open'), true);
  oyentesVentana.get('afterprint')?.({});
  assert.equal(cerrado.hasAttribute('open'), false, 'el que estaba cerrado se cierra');
  assert.equal(abierto.hasAttribute('open'), true, 'el que la persona abrió sigue abierto');
});

test('Datos globales abre sus desplegables por el fragmento', (t) => {
  const { oyentesVentana, ubicacion } = montar(t, '#datos-globales-fuentes-desplegable');
  const fuentes = desplegable('datos-globales-fuentes-desplegable', []);
  const metodo = desplegable('datos-globales-metodo-desplegable', ['dg-metodo-x']);
  abrirDesplegablesDelFragmento([fuentes, metodo] as never);
  assert.equal(fuentes.hasAttribute('open'), true);
  assert.equal(metodo.hasAttribute('open'), false);
  ubicacion.hash = '#dg-metodo-x';
  oyentesVentana.get('hashchange')?.({});
  assert.equal(metodo.hasAttribute('open'), true, 'un fragmento de dentro lo abre');
});

test('las guías cargan el guion con su huella y Datos globales sigue importando la función de siempre', () => {
  for (const archivo of ['entender-ia.html', 'que-es-faro.html']) {
    assert.match(
      leer(archivo),
      /<script\s+type="module"\s+src="scripts\/desplegables-de-pagina\.js"\s*><\/script>/u,
      archivo,
    );
    assert.ok(entradaConSri(archivo));
  }
  const paginacion = leer('scripts/datos-globales/paginacion.js');
  assert.match(paginacion, /export \{ abrirDesplegablesDelFragmento \} from '\.\.\/desplegables\.js';/u);
  for (const guion of ['scripts/datos-globales.js', 'scripts/datos-globales-ue.js']) {
    assert.match(leer(guion), /abrirDesplegablesDelFragmento[^;]*from '\.\/datos-globales\/paginacion\.js'/u, guion);
  }
  const pagina = leer('scripts/desplegables-de-pagina.js');
  assert.match(pagina, /details\.desplegable/u);
  assert.doesNotMatch(pagina + leer('scripts/desplegables.js'), /innerHTML|eval\(|setTimeout|requestAnimationFrame/u);
});
