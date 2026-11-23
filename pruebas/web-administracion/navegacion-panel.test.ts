/** La estructura real del Panel de Control (index.html) y su navegación lateral, en el doble de página por etapas. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parse } from 'parse5';
import { iniciarNavegacion } from '../../web/administracion/navegacion-panel.js';
import { navegador } from '../web-controles/ayudas.js';
import { Pieza } from '../web-informacion/etapas-doble.ts';
import { Texto } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';

const html = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');

/** Pieza con lo que usan la barra de órdenes y el buscador: pulsar, el estado desactivado y el valor de un campo. */
class PiezaPanel extends Pieza {
  value = '';
  validez = '';
  setCustomValidity(mensaje: string) {
    this.validez = mensaje;
  }
  reportValidity() {
    return this.validez === '';
  }
  click() {
    this.dispatchEvent(new Event('click'));
  }
  get disabled() {
    return this.hasAttribute('disabled');
  }
  set disabled(valor: boolean) {
    if (valor) {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }
}
function convertir(nodo: DefaultTreeAdapterTypes.Element): PiezaPanel {
  const pieza = new PiezaPanel(nodo.tagName);
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
function abrirPanel(t: TestContext, { fragmento = '', estrecha = false } = {}) {
  const raizHtml = parse(html).childNodes.find(defaultTreeAdapter.isElementNode);
  assert.ok(raizHtml);
  const raiz = convertir(raizHtml);
  const ubicacion = { hash: fragmento };
  const ventana = Object.assign(new EventTarget(), {
    location: ubicacion,
    matchMedia: () => ({ matches: estrecha }),
  });
  const documento = Object.assign(new EventTarget(), {
    querySelectorAll: (selector: string) => raiz.querySelectorAll(selector),
    querySelector: (selector: string) => raiz.querySelector(selector),
    getElementById: (id: string) => (raiz.querySelectorAll('*') as Pieza[]).find((pieza) => pieza.id === id) ?? null,
    createElement: (etiqueta: string) => new PiezaPanel(etiqueta),
  });
  navegador(t, { HTMLButtonElement: PiezaPanel });
  Pieza.enfocado = null;
  const porId = (id: string) => documento.getElementById(id) as PiezaPanel;
  const navegar = (nuevo: string) => {
    ubicacion.hash = nuevo;
    ventana.dispatchEvent(new Event('hashchange'));
  };
  const navegacion = iniciarNavegacion(documento as unknown as Document, ventana as unknown as Window);
  return { raiz, porId, navegar, navegacion, documento, ubicacion };
}
/** La pieza que recibió el foco por última vez, leída en el momento. */
const enfocado = () => (Pieza.enfocado as { pieza: Pieza } | null)?.pieza;
const visibles = (raiz: Pieza) =>
  (raiz.querySelectorAll('[data-apartado]') as Pieza[])
    .filter((a) => !a.hidden)
    .map((a) => a.getAttribute('data-apartado'));
const actuales = (raiz: Pieza) =>
  (raiz.querySelectorAll('a[data-ir]') as Pieza[])
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.getAttribute('data-ir'));

/**
 * Las tarjetas actuales siguen en su apartado; la lista de administradores nace diciendo que se está leyendo (nunca
 * una tarjeta vacía) y la visibilidad de la encuesta la pinta su propio módulo.
 */
function comprobarContenedores(porId: (id: string) => PiezaPanel): void {
  assert.ok(porId('apartado-actualizaciones').contains(porId('trabajos')));
  assert.ok(porId('apartado-avisos').contains(porId('avisos')));
  assert.ok(porId('apartado-claves').contains(porId('accesos')));
  assert.ok(porId('apartado-encuesta').contains(porId('encuesta')));
  const administradores = porId('vista-administradores').children as Pieza[];
  assert.deepEqual(
    administradores.map((hijo) => hijo.getAttribute('data-texto')),
    ['panel.administradores.leyendo'],
  );
  assert.equal(porId('vista-encuesta-visibilidad').children.length, 0);
}

test('la lateral tiene los grupos y apartados acordados, y cada apartado sus migas, título, frase y rejilla', (t) => {
  const { raiz, porId } = abrirPanel(t);
  assert.deepEqual(
    (raiz.querySelectorAll('a[data-ir]') as Pieza[]).map((a) => a.getAttribute('data-ir')),
    [
      'inicio',
      'fuentes',
      'actualizaciones',
      'publicaciones',
      'revision',
      'secciones',
      'conectividad',
      'administradores',
      'instituciones',
      'claves',
      'avisos',
      'encuesta',
      'registro',
    ],
  );
  assert.deepEqual(
    (raiz.querySelectorAll('button[data-grupo]') as Pieza[]).map((b) => b.getAttribute('data-grupo')),
    ['datos', 'web', 'accesos'],
  );
  for (const apartado of raiz.querySelectorAll('[data-apartado]') as Pieza[]) {
    const clave = apartado.getAttribute('data-apartado');
    assert.ok(apartado.querySelector('.panel-migas'), `${clave}: migas`);
    assert.ok(apartado.querySelector('h2.panel-apartado-titulo')?.textContent, `${clave}: título`);
    assert.ok(apartado.querySelector('.panel-frase')?.textContent, `${clave}: frase`);
    assert.ok(apartado.querySelector('.panel-rejilla'), `${clave}: rejilla`);
  }
  comprobarContenedores(porId);
  for (const retirado of ['recorrido-publicado', 'abrir', 'cerrar', 'aviso-apertura', 'tablero-salud']) {
    assert.equal(porId(retirado), null, retirado);
  }
  assert.doesNotMatch(html, /Recorrido publicado|Abrir panel aquí|Cerrar panel|Persona/);
});

test('una sola selección: el fragmento elige el apartado, abre su grupo y enfoca su título', (t) => {
  const { raiz, porId, navegar } = abrirPanel(t);
  assert.deepEqual(visibles(raiz), ['inicio']);
  assert.deepEqual(actuales(raiz), ['inicio']);
  assert.equal(Pieza.enfocado, null, 'al cargar no se mueve el foco');
  navegar('#fuentes');
  assert.deepEqual(visibles(raiz), ['fuentes']);
  assert.deepEqual(actuales(raiz), ['fuentes']);
  assert.equal(raiz.querySelector('button[data-grupo="datos"]')?.getAttribute('aria-expanded'), 'true');
  assert.equal(porId('nav-datos').hidden, false);
  assert.equal(enfocado(), porId('titulo-apartado-fuentes'));
  // El salto al contenido no es un apartado: la selección no cambia.
  navegar('#contenido');
  assert.deepEqual(visibles(raiz), ['fuentes']);
  navegar('#registro');
  assert.deepEqual(actuales(raiz), ['registro']);
});

test('los grupos se pliegan con su botón y la lateral se pliega entera; al entrar se enfoca el apartado', (t) => {
  const { raiz, porId, documento } = abrirPanel(t, { fragmento: '#secciones' });
  const web = raiz.querySelector('button[data-grupo="web"]') as Pieza;
  assert.equal(web.getAttribute('aria-expanded'), 'true');
  web.dispatchEvent(new Event('click'));
  assert.equal(web.getAttribute('aria-expanded'), 'false');
  assert.equal(porId('nav-web').hidden, true);
  const plegar = porId('plegar-navegacion');
  assert.equal(porId('armazon-panel').getAttribute('data-navegacion'), 'abierta');
  plegar.dispatchEvent(new Event('click'));
  assert.equal(porId('armazon-panel').getAttribute('data-navegacion'), 'plegada');
  assert.equal(plegar.getAttribute('aria-expanded'), 'false');
  documento.dispatchEvent(new Event('panel:entrar'));
  assert.equal(enfocado(), porId('titulo-apartado-secciones'));
});

test('en pantalla estrecha la lateral es un menú: empieza cerrado, se cierra al elegir y con Escape', (t) => {
  const { porId, navegar } = abrirPanel(t, { estrecha: true });
  const armazon = porId('armazon-panel');
  assert.equal(armazon.getAttribute('data-navegacion'), 'plegada');
  porId('plegar-navegacion').dispatchEvent(new Event('click'));
  assert.equal(armazon.getAttribute('data-navegacion'), 'abierta');
  navegar('#avisos');
  assert.equal(armazon.getAttribute('data-navegacion'), 'plegada');
  porId('plegar-navegacion').dispatchEvent(new Event('click'));
  const teclaEscape = Object.assign(new Event('keydown'), { key: 'Escape' });
  porId('navegacion-panel').dispatchEvent(teclaEscape);
  assert.equal(armazon.getAttribute('data-navegacion'), 'plegada');
  assert.equal(enfocado(), porId('plegar-navegacion'));
});

test('cada orden «Actualizar» pulsa el botón de su tarjeta y copia si está desactivado', (t) => {
  const { raiz, porId } = abrirPanel(t);
  const orden = raiz.querySelector('button[data-orden="consultar-datos"]') as PiezaPanel;
  assert.ok(orden);
  let pulsado = 0;
  porId('consultar-datos').addEventListener('click', () => {
    pulsado += 1;
  });
  orden.click();
  assert.equal(pulsado, 1);
  assert.equal(orden.disabled, false);
  const desactivada = raiz.querySelector('button[data-orden="consultar-trabajo"]') as PiezaPanel;
  assert.equal(desactivada.disabled, porId('consultar-trabajo').disabled);
});

/** El símbolo que dibuja un icono SVG en línea: el destino de su <use>. */
const simbolo = (pieza: Pieza | null | undefined) => pieza?.querySelector('svg use')?.getAttribute('href') ?? null;

test('la navegación lleva el icono de la maqueta en cada grupo y apartado, la flecha de grupo y los separadores', (t) => {
  const { raiz } = abrirPanel(t);
  const nav = raiz.querySelector('#navegacion-panel') as Pieza;
  const principales = (nav.querySelectorAll('.panel-nav-item') as Pieza[]).filter(
    (item) => !item.closest('.panel-nav-sub'),
  );
  assert.deepEqual(
    principales.map((item) => [item.textContent.trim(), simbolo(item)]),
    [
      ['Inicio', '#panel-i-inicio'],
      ['Datos', '#panel-i-datos'],
      ['Web', '#panel-i-web'],
      ['Accesos', '#panel-i-accesos'],
      ['Avisos', '#panel-i-avisos'],
      ['Encuesta', '#panel-i-encuesta'],
      ['Registro del panel', '#panel-i-registro'],
    ],
  );
  for (const grupo of nav.querySelectorAll('button[data-grupo]') as Pieza[]) {
    const flecha = grupo.querySelector('.panel-nav-flecha');
    assert.equal(flecha?.querySelector('use')?.getAttribute('href'), '#panel-i-chevron');
  }
  // Cada icono es decorativo; el nombre está en texto y sigue ahí con la lateral plegada.
  for (const svg of nav.querySelectorAll('svg') as Pieza[]) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(nav.querySelectorAll('.panel-nav-separador').length, 2);
  // Todo icono del documento apunta a un símbolo declarado, y los símbolos no llevan imágenes data:.
  for (const [, id = ''] of html.matchAll(/<use href="#([\w-]+)"/g)) {
    assert.match(html, new RegExp(`<symbol id="${id}"`), id);
  }
  assert.doesNotMatch(html, /data:image/);
});

test('«Actualizar datos ahora» del Inicio pulsa el mismo botón que «Actualizar datos» de Actualizaciones', (t) => {
  const { raiz, porId } = abrirPanel(t);
  const orden = raiz.querySelector('button[data-orden="actualizar-datos"]') as PiezaPanel;
  assert.ok(porId('apartado-inicio').contains(orden));
  assert.equal(orden.textContent.trim(), 'Actualizar datos ahora');
  assert.equal(orden.disabled, porId('actualizar-datos').disabled, 'copia si el botón está desactivado');
  let pulsado = 0;
  porId('actualizar-datos').addEventListener('click', () => {
    pulsado += 1;
  });
  orden.click();
  assert.equal(pulsado, 1);
  assert.ok(porId('inicio-exportar').disabled, '«Exportar informe» espera a que el Inicio se pinte');
});

test('el buscador lleva a un apartado por su nombre, sin acentos ni mayúsculas, y ⌘K pone el cursor en él', (t) => {
  activarIdiomaPanel('es');
  t.after(() => activarIdiomaPanel());
  const { raiz, porId, ubicacion, documento } = abrirPanel(t);
  const campo = porId('panel-buscar');
  campo.dispatchEvent(new Event('focus'));
  const apartados = raiz.querySelectorAll('#navegacion-panel a[data-ir]').length;
  assert.equal(porId('panel-buscar-apartados').children.length, apartados, 'una sugerencia por apartado');
  const intro = () => campo.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }));
  campo.value = 'revision';
  intro();
  assert.equal(ubicacion.hash, '#apartado-revision');
  assert.equal(campo.value, '');
  campo.value = 'claves';
  intro();
  assert.equal(ubicacion.hash, '#apartado-claves');
  campo.value = 'xyz';
  intro();
  assert.equal(ubicacion.hash, '#apartado-claves', 'sin coincidencia no se mueve');
  assert.match(campo.validez, /^Ningún apartado se llama así\. Prueba con otro nombre/);
  const atajo = () => documento.dispatchEvent(Object.assign(new Event('keydown'), { key: 'k', metaKey: true }));
  atajo();
  assert.notEqual(enfocado(), campo, 'con la bienvenida a la vista el atajo no hace nada');
  porId('armazon-panel').hidden = false;
  atajo();
  assert.equal(enfocado(), campo);
});

test('«Añadir administrador» espera al formulario de la vista y después lleva al campo del correo', (t) => {
  const { raiz, porId } = abrirPanel(t);
  const orden = raiz.querySelector('button[data-enfocar]') as PiezaPanel;
  assert.ok(porId('apartado-administradores').contains(orden));
  assert.equal(orden.disabled, true);
  const correo = new PiezaPanel('input');
  correo.className = 'administradores-alta-correo';
  porId('vista-administradores').append(correo);
  orden.click();
  assert.equal(enfocado(), correo);
});
