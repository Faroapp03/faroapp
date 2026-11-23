/** Controlador: la fecha describe la entrega, también con cero cursos; un reloj atrasado o inválido la oculta. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { proyectarListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import { TEXTOS_CATALOGO_CURSOS as CA } from '../../web/idiomas/ca/catalogo-cursos.js';
import { ERRORES_RECORRIDO as ERRORES_CA } from '../../web/idiomas/ca/errores-recorrido.js';
import { TEXTOS_CATALOGO_CURSOS as ES } from '../../web/idiomas/es/catalogo-cursos.js';
import { ERRORES_RECORRIDO as ERRORES_ES } from '../../web/idiomas/es/errores-recorrido.js';
import { fijarIdioma, registrarDiccionario } from '../../web/scripts/textos.js';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento, html, Texto } from '../web-informe-lectura/dom-doble.ts';

class Campo extends Elemento {
  checked = false;
  get type() {
    return this.getAttribute('type') ?? '';
  }
  set type(valor: string) {
    this.setAttribute('type', valor);
  }
  get name() {
    return this.getAttribute('name') ?? '';
  }
  set name(valor: string) {
    this.setAttribute('name', valor);
  }
  get value() {
    return this.getAttribute('value') ?? '';
  }
  set value(valor: string) {
    this.setAttribute('value', valor);
  }
}
function montarPagina() {
  const raiz = new Elemento('main');
  const piezas = new Map<string, Elemento>();
  for (const nombre of [
    'filtros',
    'grupos',
    'orden',
    'lista',
    'cuenta',
    'recuento',
    'actualizado',
    'fecha',
    'vacio',
    'mas',
    'ver-mas',
    'quitar',
    'quitar-vacio',
    'limpiar',
  ]) {
    const pieza = new Elemento(nombre === 'filtros' ? 'form' : 'div');
    pieza.setAttribute(`data-${nombre}`, '');
    raiz.append(pieza);
    piezas.set(nombre, pieza);
  }
  const consulta = new Campo('input');
  consulta.setAttribute('data-consulta', '');
  raiz.append(consulta);
  return { raiz, piezas };
}
function instalarPagina(t: TestContext, raiz: Elemento) {
  const ventana = new EventTarget();
  const documento = Object.assign(new EventTarget(), {
    documentElement: new Elemento('html'),
    hidden: false,
    createElement: (tag: string) => (tag === 'input' ? new Campo(tag) : new Elemento(tag)),
    createElementNS: (_espacio: string, tag: string) => new Elemento(tag),
    createTextNode: (texto: string) => new Texto(texto),
    querySelectorAll: (selector: string) => raiz.querySelectorAll(selector),
  });
  navegador(t, {
    document: documento,
    window: ventana,
    HTMLElement: Elemento,
    Element: Elemento,
    HTMLInputElement: Campo,
    Node: Elemento,
    location: { href: 'https://example.invalid/cursos.html' },
    history: { replaceState() {} },
  });
  t.after(() => ventana.dispatchEvent(new Event('pagehide')));
  return ventana;
}

const RELOJ_ATRASADO = 'recorrido.error.reloj-atrasado';
const CORRECTO = Date.parse('2026-10-22T11:00:00Z');

async function abrirPagina(t: TestContext, relojes: { ahora: number }) {
  const catalogo = leerCatalogo(
    readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url)),
    JSON.parse(readFileSync(new URL('../fixtures/catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8')),
  );
  t.mock.method(Date, 'now', () => relojes.ahora);
  const error = t.mock.method(console, 'error', () => {});
  registrarDiccionario('es', { ...ES, ...ERRORES_ES });
  registrarDiccionario('ca', { ...CA, ...ERRORES_CA });
  fijarIdioma('es');
  const { raiz, piezas } = montarPagina();
  const ventana = instalarPagina(t, raiz);
  const { iniciarVista } = await import('../../web/scripts/catalogo-cursos/vista.js');
  iniciarVista(html(raiz), proyectarListado(catalogo));
  return { piezas, ventana, error };
}

test('fecha visible con cero ofertas, oculta ante un reloj inválido y recuperada al volver a un reloj válido', async (t) => {
  const reloj = { ahora: CORRECTO };
  const { piezas, ventana, error } = await abrirPagina(t, reloj);
  assert.equal(piezas.get('lista')?.children.length, 0);
  assert.equal(piezas.get('actualizado')?.hidden, false);
  assert.equal(piezas.get('fecha')?.textContent, 'Actualizado: 22 de octubre de 2026');
  reloj.ahora = Number.NaN;
  ventana.dispatchEvent(new Event('pageshow'));
  assert.equal(piezas.get('actualizado')?.hidden, true);
  assert.equal(piezas.get('cuenta')?.textContent, ES['catalogo.error']);
  assert.equal(error.mock.callCount(), 1);
  reloj.ahora = CORRECTO;
  ventana.dispatchEvent(new Event('pageshow'));
  assert.equal(piezas.get('actualizado')?.hidden, false);
  assert.equal(piezas.get('fecha')?.textContent, 'Actualizado: 22 de octubre de 2026');
});

test('con el reloj anterior al corte, Cursos dice que la fecha del dispositivo está atrasada, en los dos idiomas, y se recupera al corregirla', async (t) => {
  const reloj = { ahora: 0 };
  const { piezas, ventana } = await abrirPagina(t, reloj);
  assert.equal(piezas.get('actualizado')?.hidden, true);
  assert.equal(piezas.get('cuenta')?.textContent, ERRORES_ES[RELOJ_ATRASADO]);
  assert.notEqual(piezas.get('cuenta')?.textContent, ES['catalogo.error']);
  fijarIdioma('ca');
  ventana.dispatchEvent(new Event('pageshow'));
  assert.equal(piezas.get('cuenta')?.textContent, ERRORES_CA[RELOJ_ATRASADO]);
  assert.notEqual(piezas.get('cuenta')?.textContent, CA['catalogo.error']);
  fijarIdioma('es');
  reloj.ahora = CORRECTO;
  ventana.dispatchEvent(new Event('pageshow'));
  assert.equal(piezas.get('actualizado')?.hidden, false);
  assert.equal(piezas.get('fecha')?.textContent, 'Actualizado: 22 de octubre de 2026');
  assert.notEqual(piezas.get('cuenta')?.textContent, ERRORES_ES[RELOJ_ATRASADO]);
  fijarIdioma('ca');
  ventana.dispatchEvent(new Event('pageshow'));
  assert.equal(piezas.get('fecha')?.textContent, 'Actualitzat: 22 d’octubre del 2026');
  fijarIdioma('es');
});
