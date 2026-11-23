import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { crear, PaginaIncompleta, PropiedadProhibida, porId, pulsaFuera } from '../../web/scripts/dom.js';
import { fijarIdioma, registrarDiccionario, traducible } from '../../web/scripts/textos.js';
import { Boton, cargar, evento, leer, Nodo, navegador, pagina } from './ayudas.js';

registrarDiccionario('es', es);
registrarDiccionario('ca', ca);

for (const propiedad of ['innerHTML', 'outerHTML', 'srcdoc', 'onclick', 'ONERROR']) {
  test(`DOM rechaza ${propiedad} antes de crear nodos`, (contexto) => {
    navegador(contexto, { document: { createElement: () => assert.fail('no debe crear nada') } });
    assert.throws(() => crear('div', { [propiedad]: '<b>dato</b>' }), PropiedadProhibida);
  });
}

test('DOM conserva texto literal, hijos y adopción de select; porId comprueba presencia/clase', (contexto) => {
  const p = pagina(contexto);
  const adoptados = [];
  Object.assign(p.document, {
    implementation: { createHTMLDocument: () => ({ createElement: () => new Nodo() }) },
    adoptNode: (/** @type {Nodo} */ nodo) => {
      adoptados.push(nodo);
      return nodo;
    },
  });
  const hijo = crear('span', { textContent: 'hijo' });
  const parrafo = crear('p', { textContent: '<b>literal</b>' }, hijo);
  assert.equal(parrafo.textContent, '<b>literal</b>');
  assert.deepEqual(parrafo.children, [hijo]);
  crear('select');
  assert.equal(adoptados.length, 1);
  assert.throws(() => porId('ausente'), PaginaIncompleta);
  p.ids.set('presente', new Nodo());
  assert.throws(() => porId('presente', HTMLButtonElement), PaginaIncompleta);
  assert.equal(porId('presente'), p.ids.get('presente'));
});

test('el velo del diálogo excluye hijos y bordes de la caja', () => {
  const caja = { left: 10, right: 30, top: 20, bottom: 40 };
  const dialogo = /** @type {HTMLDialogElement} */ (/** @type {unknown} */ ({ getBoundingClientRect: () => caja }));
  const casos = [
    [caja.left, caja.top, false],
    [caja.right, caja.bottom, false],
    [caja.left - 1, caja.top, true],
    [caja.left, caja.bottom + 1, true],
  ];
  for (const [clientX, clientY, esperado] of casos) {
    const clic = /** @type {MouseEvent} */ (/** @type {unknown} */ ({ target: dialogo, clientX, clientY }));
    assert.equal(pulsaFuera(dialogo, clic), esperado);
  }
  assert.equal(pulsaFuera(dialogo, /** @type {MouseEvent} */ (/** @type {unknown} */ ({ target: {} }))), false);
});

for (const idioma of ['es', 'ca']) {
  test(`menú ${idioma}: apertura, Escape, foco e inercia previamente existente`, async (contexto) => {
    const p = pagina(contexto);
    navegador(contexto, { window: new EventTarget() });
    fijarIdioma(idioma);
    const boton = new Boton();
    const enlace = new Nodo();
    const menu = new Nodo();
    const velo = new Nodo();
    const contenido = new Nodo();
    const yaInerte = new Nodo();
    yaInerte.inert = true;
    p.enfocable(boton);
    p.enfocable(enlace);
    menu.consultas.set('a', [enlace]);
    p.document.body.append(boton, menu, velo, contenido, yaInerte);
    p.consultas.set('.menu-boton', [boton]);
    p.ids.set('menu', menu);
    p.ids.set('menu-velo', velo);
    const modulo = /** @type {typeof import('../../web/scripts/menu.js')} */ (await cargar('menu.js'));
    modulo.iniciarMenu();
    boton.dispatchEvent(evento('click'));
    assert.equal(menu.hidden, false);
    assert.equal(contenido.inert, true);
    assert.equal(p.document.activeElement, enlace);
    assert.equal(boton.getAttribute('aria-label'), idioma === 'es' ? 'Cerrar menú' : 'Tancar el menú');
    p.document.dispatchEvent(evento('keydown', { key: 'Escape' }));
    assert.equal(menu.hidden, true);
    assert.equal(contenido.inert, false);
    assert.equal(yaInerte.inert, true);
    assert.equal(p.document.activeElement, boton);
  });
}

/** Los fondos de día y de noche que declaran los tokens: --color-fondo: light-dark(día, noche). */
function fondosDeLosTokens() {
  const tokens = readFileSync(new URL('../../web/estilos/tokens.css', import.meta.url), 'utf8');
  const [, claro, oscuro] = /--color-fondo: light-dark\((#[0-9a-f]+), (#[0-9a-f]+)\);/u.exec(tokens) ?? [];
  assert.ok(claro && oscuro);
  return { claro, oscuro };
}

test('tema inicial: sin elección guardada, cualquier página abre en claro; la elección guardada manda', () => {
  const fondos = fondosDeLosTokens();
  for (const guardado of [null, 'claro', 'oscuro', 'estropeado', 'bloqueado']) {
    const raiz = { dataset: /** @type {{ tema?: string }} */ ({}) };
    const barra = new Nodo();
    const document = {
      documentElement: raiz,
      querySelector: (/** @type {string} */ css) => (css === 'meta[name="theme-color"]' ? barra : null),
    };
    const localStorage = {
      getItem: () => {
        if (guardado === 'bloqueado') {
          throw new Error('denegado');
        }
        return guardado;
      },
    };
    // Sin matchMedia en el contexto: si el guion preguntara por el tema del sistema, fallaría aquí.
    runInNewContext(leer('tema-inicial.js'), { document, localStorage });
    const tema = guardado === 'oscuro' ? 'oscuro' : 'claro';
    assert.equal(raiz.dataset.tema, tema, `guardado: ${guardado}`);
    assert.equal(barra.getAttribute('content'), fondos[tema], `barra con guardado: ${guardado}`);
  }
});

test('las páginas no fijan su propio tema y declaran el color de barra del modo día antes del guion de tema', () => {
  const web = new URL('../../web/', import.meta.url);
  const paginas = [
    ...readdirSync(web)
      .filter((nombre) => nombre.endsWith('.html'))
      .map((nombre) => new URL(nombre, web)),
    new URL('administracion/index.html', web),
  ];
  assert.ok(paginas.length > 10);
  const fondoDeDia = fondosDeLosTokens().claro;
  for (const pagina of paginas) {
    const html = readFileSync(pagina, 'utf8');
    const ruta = pagina.href.slice(web.href.length);
    assert.doesNotMatch(/<html\b[^>]*>/u.exec(html)?.[0] ?? '', /data-tema/u, ruta);
    const colores = [...html.matchAll(/<meta\s+name="theme-color"[^>]*>/gu)].map(([meta]) => meta);
    assert.deepEqual(colores, [`<meta name="theme-color" content="${fondoDeDia}" />`], ruta);
    // tema-inicial.js cambia el color de la barra: la etiqueta tiene que existir ya cuando el guion se ejecuta.
    const guion = html.search(/<script src="[^"]*scripts\/tema-inicial\.js"><\/script>/u);
    assert.ok(guion > html.indexOf(colores[0] ?? '<sin barra>'), `${ruta}: theme-color antes de tema-inicial.js`);
    // La barra de estado de iPhone instalado no cambia con el tema: es la clara, como el modo día de arranque.
    for (const [estado] of html.matchAll(/<meta\s+name="apple-mobile-web-app-status-bar-style"[^>]*>/gu)) {
      assert.equal(estado, '<meta name="apple-mobile-web-app-status-bar-style" content="default" />', ruta);
    }
  }
});

test('botones de tema conservan rótulos y elección aunque el almacén falle', async (contexto) => {
  const p = pagina(contexto);
  fijarIdioma('es');
  p.document.documentElement.dataset.tema = 'claro';
  const boton = new Boton();
  const texto = new Boton();
  texto.consultas.set('[data-cambiar-tema]', []);
  p.consultas.set('.tema-boton, [data-cambiar-tema]', [boton, texto]);
  const barra = new Nodo();
  p.consultas.set('meta[name="theme-color"]', [barra]);
  const fondos = fondosDeLosTokens();
  let alMutar = () => {};
  navegador(contexto, {
    MutationObserver: class {
      constructor(/** @type {() => void} */ funcion) {
        alMutar = funcion;
      }
      observe() {}
    },
    localStorage: {
      setItem: () => {
        throw new Error('cuota');
      },
    },
  });
  const modulo = /** @type {typeof import('../../web/scripts/tema.js')} */ (await cargar('tema.js'));
  modulo.iniciarTema();
  assert.equal(boton.getAttribute('aria-label'), es['comun.tema.a-noche']);
  assert.equal(texto.textContent, es['comun.tema.a-noche']);
  boton.dispatchEvent(evento('click'));
  alMutar();
  assert.equal(p.document.documentElement.dataset.tema, 'oscuro');
  assert.equal(barra.getAttribute('content'), fondos.oscuro);
  assert.equal(texto.textContent, es['comun.tema.a-dia']);
  boton.dispatchEvent(evento('click'));
  assert.equal(p.document.documentElement.dataset.tema, 'claro');
  assert.equal(barra.getAttribute('content'), fondos.claro);
});

test('aviso: texto, anuncio independiente, botón y ocultación', async (contexto) => {
  const p = pagina(contexto);
  const modulo = /** @type {typeof import('../../web/scripts/aviso.js')} */ (await cargar('aviso.js'));
  let pulsaciones = 0;
  const aviso = modulo.crearAviso({
    nombre: traducible('comun.cerrar'),
    botones: [{ texto: 'Cerrar', alPulsar: () => pulsaciones++ }],
  });
  aviso.mostrar('<b>literal</b>', 'anuncio');
  const [viva, franja] = p.document.body.children;
  assert.ok(viva && franja);
  assert.equal(franja.hidden, false);
  assert.equal(franja.children.at(0)?.textContent, '<b>literal</b>');
  assert.equal(viva.textContent, 'anuncio');
  franja.children.at(1)?.dispatchEvent(evento('click'));
  assert.equal(pulsaciones, 1);
  aviso.ocultar();
  assert.equal(viva.textContent, '');
  assert.equal(franja.hidden, true);
});

test('selector: flechas circulares, Inicio/Fin, Escape global, Tab y marcas de idioma', async (contexto) => {
  const p = pagina(contexto);
  fijarIdioma('es');
  const selector = new Nodo();
  const boton = new Boton();
  const lista = new Nodo();
  const opciones = ['es', 'ca'].map((idioma) => {
    const opcion = new Boton();
    opcion.dataset.cambiarIdioma = idioma;
    opcion.setAttribute('role', 'menuitemradio');
    p.enfocable(opcion);
    return opcion;
  });
  p.enfocable(boton);
  selector.append(boton, lista);
  lista.append(...opciones);
  selector.consultas.set('[aria-haspopup="menu"]', [boton]);
  selector.consultas.set('[role="menu"]', [lista]);
  lista.consultas.set('[role="menuitemradio"]', opciones);
  p.consultas.set('[data-selector-idioma]', [selector]);
  p.consultas.set('[data-cambiar-idioma]', opciones);
  const modulo = /** @type {typeof import('../../web/scripts/selector-idioma.js')} */ (
    await cargar('selector-idioma.js')
  );
  modulo.iniciarSelectorIdioma();
  boton.dispatchEvent(evento('keydown', { key: 'ArrowUp' }));
  assert.equal(p.document.activeElement, opciones.at(-1));
  for (const [key, indice] of [
    ['ArrowDown', 0],
    ['ArrowUp', -1],
    ['Home', 0],
    ['End', -1],
  ]) {
    lista.dispatchEvent(evento('keydown', { key }));
    assert.equal(p.document.activeElement, opciones.at(Number(indice)));
  }
  assert.equal(opciones.at(0)?.getAttribute('aria-checked'), 'true');
  p.document.dispatchEvent(evento('keydown', { key: 'Escape' }));
  assert.equal(lista.hidden, true);
  assert.equal(p.document.activeElement, boton);
  boton.dispatchEvent(evento('click'));
  lista.dispatchEvent(evento('keydown', { key: 'Tab' }));
  assert.equal(lista.hidden, true);
});

test('marcas del recorrido: solo el mensaje de la persona cuenta', async (contexto) => {
  const p = pagina(contexto);
  const modulo = /** @type {typeof import('../../web/scripts/marcas-del-recorrido.js')} */ (
    await cargar('marcas-del-recorrido.js')
  );
  assert.equal(modulo.hayMensajeDeLaPersona(), false);
  p.consultas.set('#conversacion .rc-mensaje[data-autor="persona"]', [new Nodo()]);
  assert.equal(modulo.hayMensajeDeLaPersona(), true);
});

test('el tema clásico conserva la clave, los temas y los colores de barra compartidos con el módulo', () => {
  const clave = /const CLAVE_TEMA = '([^']+)';/;
  const inicial = leer('tema-inicial.js');
  const modulo = leer('tema.js');
  assert.equal(clave.exec(inicial)?.[1], clave.exec(modulo)?.[1]);
  const temas = /const TEMAS = \[([^\]]+)\]/.exec(inicial)?.[1] ?? '';
  const valores = [...temas.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(valores, [
    /const TEMA_CLARO = '([^']+)'/.exec(modulo)?.[1],
    /const TEMA_OSCURO = '([^']+)'/.exec(modulo)?.[1],
  ]);
  const barra = /const COLORES_DE_LA_BARRA = \{ claro: '(#[0-9a-f]+)', oscuro: '(#[0-9a-f]+)' \};/u;
  const [, claro, oscuro] = barra.exec(inicial) ?? [];
  assert.deepEqual([claro, oscuro], barra.exec(modulo)?.slice(1));
  assert.deepEqual({ claro, oscuro }, fondosDeLosTokens());
});
