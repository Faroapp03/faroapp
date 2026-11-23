import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { prepararImpresion } from '../../web/scripts/pdf/impresion.js';
import { Nodo, navegador } from '../web-controles/ayudas.js';

function entorno(contexto: TestContext, conTitulo = true) {
  class Detalle extends Nodo {
    open = false;
  }
  const raiz = new Nodo();
  const cerrado = new Detalle();
  const abierto = new Detalle();
  abierto.open = true;
  raiz.consultas.set('details', [cerrado, abierto]);
  if (conTitulo) {
    raiz.consultas.set('[data-titulo-pdf]', [raiz]);
    raiz.setAttribute('data-titulo-pdf', 'Informe de Faro');
  }
  const window = new EventTarget();
  const clases = new Set<string>();
  const document = {
    title: 'Página de origen',
    documentElement: { lang: 'es', classList: { contains: (clase: string) => clases.has(clase) } },
    body: { dataset: {} },
  };
  navegador(contexto, { window, document, HTMLDetailsElement: Detalle });
  const control = new AbortController();
  prepararImpresion(raiz as unknown as HTMLElement, control.signal);
  return { window, document, control, cerrado, abierto, raiz, clases };
}

test('dos beforeprint conservan el título original y dejan los desplegables como estén', (contexto) => {
  const e = entorno(contexto);
  e.window.dispatchEvent(new Event('beforeprint'));
  e.window.dispatchEvent(new Event('beforeprint'));
  assert.equal(e.document.title, 'Informe de Faro');
  assert.equal(e.cerrado.open, false);
  assert.equal(e.abierto.open, true);
  e.window.dispatchEvent(new Event('afterprint'));
  assert.equal(e.document.title, 'Página de origen');
  assert.equal(e.cerrado.open, false);
  assert.equal(e.abierto.open, true);
  e.control.abort();
});

test('borrar el informe antes de afterprint restaura también el título', (contexto) => {
  const e = entorno(contexto);
  e.window.dispatchEvent(new Event('beforeprint'));
  e.control.abort();
  assert.equal(e.document.title, 'Página de origen');
  assert.equal(e.cerrado.open, false);
  e.document.title = 'Otro informe';
  e.window.dispatchEvent(new Event('afterprint'));
  e.window.dispatchEvent(new Event('beforeprint'));
  assert.equal(e.document.title, 'Otro informe');
});

test('cada nueva impresión captura el título vigente y afterprint suelto no lo cambia', (contexto) => {
  const e = entorno(contexto);
  e.window.dispatchEvent(new Event('beforeprint'));
  e.window.dispatchEvent(new Event('afterprint'));
  e.document.title = 'Título actualizado';
  e.window.dispatchEvent(new Event('afterprint'));
  assert.equal(e.document.title, 'Título actualizado');
  e.window.dispatchEvent(new Event('beforeprint'));
  e.window.dispatchEvent(new Event('afterprint'));
  assert.equal(e.document.title, 'Título actualizado');
  e.control.abort();
});

test('sin título PDF no se inventa un nombre de documento', (contexto) => {
  const e = entorno(contexto, false);
  e.window.dispatchEvent(new Event('beforeprint'));
  assert.equal(e.document.title, 'Página de origen');
  assert.equal(e.cerrado.open, false);
  e.control.abort();
  assert.equal(e.cerrado.open, false);
});

test('informe CA en página ES presta el idioma y lo restaura al cerrar la impresión', (contexto) => {
  const e = entorno(contexto);
  e.raiz.setAttribute('lang', 'ca');
  e.window.dispatchEvent(new Event('beforeprint'));
  assert.equal(e.document.documentElement.lang, 'ca');
  e.window.dispatchEvent(new Event('beforeprint'));
  e.window.dispatchEvent(new Event('afterprint'));
  assert.equal(e.document.documentElement.lang, 'es');
  e.control.abort();
});

test('informe CA en página ES restaura idioma al abortar y no atiende afterprint tardío', (contexto) => {
  const e = entorno(contexto);
  e.raiz.setAttribute('lang', 'ca');
  e.window.dispatchEvent(new Event('beforeprint'));
  assert.equal(e.document.documentElement.lang, 'ca');
  e.control.abort();
  assert.equal(e.document.documentElement.lang, 'es');
  e.document.documentElement.lang = 'fr';
  e.window.dispatchEvent(new Event('afterprint'));
  assert.equal(e.document.documentElement.lang, 'fr');
});

test('solo formación conserva título, idioma y detalles; la impresión laboral siguiente funciona', (contexto) => {
  const e = entorno(contexto);
  e.raiz.setAttribute('lang', 'ca');
  e.clases.add('imprimir-hoja');
  e.window.dispatchEvent(new Event('beforeprint'));
  e.window.dispatchEvent(new Event('beforeprint'));
  assert.equal(e.document.title, 'Página de origen');
  assert.equal(e.document.documentElement.lang, 'es');
  assert.equal(e.cerrado.open, false);
  assert.equal(e.abierto.open, true);
  e.window.dispatchEvent(new Event('afterprint'));
  e.clases.delete('imprimir-hoja');
  e.window.dispatchEvent(new Event('beforeprint'));
  assert.equal(e.document.title, 'Informe de Faro');
  assert.equal(e.document.documentElement.lang, 'ca');
  e.window.dispatchEvent(new Event('afterprint'));
  assert.equal(e.document.title, 'Página de origen');
  assert.equal(e.document.documentElement.lang, 'es');
  assert.equal(e.cerrado.open, false);
  e.control.abort();
});

test('abortar durante solo formación no restaura metadatos que el informe laboral no tomó', (contexto) => {
  const e = entorno(contexto);
  e.clases.add('imprimir-hoja');
  e.window.dispatchEvent(new Event('beforeprint'));
  e.document.title = 'Título de formación vigente';
  e.document.documentElement.lang = 'ca';
  e.control.abort();
  e.window.dispatchEvent(new Event('afterprint'));
  assert.equal(e.document.title, 'Título de formación vigente');
  assert.equal(e.document.documentElement.lang, 'ca');
  assert.equal(e.cerrado.open, false);
});

for (const clase of ['imprimir-informe', 'imprimir-los-dos']) {
  test(`${clase} conserva el préstamo laboral y su restauración`, (contexto) => {
    const e = entorno(contexto);
    e.clases.add(clase);
    e.raiz.setAttribute('lang', 'ca');
    e.window.dispatchEvent(new Event('beforeprint'));
    assert.equal(e.document.title, 'Informe de Faro');
    assert.equal(e.document.documentElement.lang, 'ca');
    e.window.dispatchEvent(new Event('afterprint'));
    assert.equal(e.document.title, 'Página de origen');
    assert.equal(e.document.documentElement.lang, 'es');
    e.control.abort();
  });
}
