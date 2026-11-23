// El filtro y las páginas de la Biblioteca (scripts/lecturas.js) sobre la página real, generada (web/biblioteca.html),
// en un DOM de prueba que la interpreta con parse5 y propaga los eventos hasta el documento: un solo desplegable, el del
// nivel, con su botón (aria-expanded, aria-controls), su panel y sus botones de opción; el filtrado, su persistencia al
// cambiar de segmento y la cuenta de cada segmento; la cuenta de cada opción en el segmento que se ve y las opciones a
// cero, atenuadas pero elegibles; abrir y cerrar (Escape, clic fuera, salir con el tabulador, elegir), las flechas e
// Intro; «Quitar filtros»; el recuento de la barra y el idioma. Y las páginas de cada segmento: el reparto, la
// navegación al pie (aria-current, «Página 2 de 4», oculta con una sola página), el paso de página (el foco se queda en
// el número, la barra de números no se mueve de la pantalla, sin tocar la dirección, y se anuncia), la vuelta a la página
// 1 al filtrar o al cambiar de pestaña y un fragmento que lleva a una ficha de otra página. Y el enlace de las fichas
// con versión en catalán, que sigue al idioma de la web. No comprueban la maquetación: eso lo hacen las capturas en un
// navegador real.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { defaultTreeAdapter, parse } from 'parse5';
import { leerRegistro } from '../../herramientas/web/lecturas/registro.ts';
import { generar } from '../../herramientas/web/lecturas.ts';
import { proyectarObservaciones } from '../../src/biblioteca/observaciones-lecturas.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { fijarIdioma, registrarDiccionario } from '../../web/scripts/textos.js';
import { cargar, evento, navegador } from '../web-controles/ayudas.js';
import { Elemento, Texto } from '../web-informe-lectura/dom-doble.ts';

const hooks = registerHooks({
  load(url, contexto, siguiente) {
    if (url === new URL('../../web/scripts/sitio.js', import.meta.url).href) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return siguiente(url, contexto);
  },
});
after(() => hooks.deregister());
registrarDiccionario('es', es);
registrarDiccionario('ca', ca);
/** El tipo de cada segmento, en el orden de las pestañas. */
const TIPO_DE = { guias: 'guia', informes: 'informe', notas: 'nota' };
const ID_DE_SEGMENTOS = /** @type {(keyof typeof TIPO_DE)[]} */ (Object.keys(TIPO_DE));
/** @type {{ lecturas: { id: string, nivel: string, tipo: string }[] }} */
const REGISTRO = JSON.parse(readFileSync(new URL('../../datos/lecturas.json', import.meta.url), 'utf8'));
/** Las lecturas de cada segmento según el registro: el segmento sale del tipo. */
const TOTALES = Object.fromEntries(
  ID_DE_SEGMENTOS.map((id) => [id, REGISTRO.lecturas.filter((lectura) => lectura.tipo === TIPO_DE[id]).length]),
);
const HTML = readFileSync(new URL('../../web/biblioteca.html', import.meta.url), 'utf8');
/** Las fichas por página como mucho (scripts/lecturas.js). */
const POR_PAGINA = 6;
/** El alto de una ficha en el doble: la barra de números queda debajo de las que se ven. */
const ALTO_DE_FICHA = 300;
/** Dónde empieza la lista de fichas en el documento del doble, y dónde está la vista al abrir. */
const PRINCIPIO_DE_LA_LISTA = 400;
const VISTA_INICIAL = 2000;
/** El texto de los dos botones y de las opciones, sin los espacios que sobran. @param {string} texto */
const limpio = (texto) => texto.replace(/\s+/g, ' ').trim();

/**
 * El documento de prueba: un destino de eventos con el foco, al que llegan los eventos de todo el árbol.
 * @typedef {EventTarget & { activeElement: Pieza | null, documentElement: Pieza, querySelector(css: string): Pieza | null,
 *   querySelectorAll(css: string): Pieza[], getElementById(id: string): Pieza | null, createTextNode(texto: string): Texto,
 *   createElement(etiqueta: string): Pieza, createElementNS(espacio: string, etiqueta: string): Pieza }} Documento
 */
/** @type {Documento} */
let documento;

/**
 * Un elemento del DOM de prueba: los eventos suben por sus antecesores hasta el documento y el foco avisa al que lo
 * pierde. Apunta las opciones del foco y los desplazamientos; su caja es la que fije la prueba (por omisión, a la vista).
 */
class Pieza extends Elemento {
  /** @type {{ pieza: Pieza, opciones: unknown }[]} */
  static enfoques = [];
  /** @type {{ pieza: Pieza, opciones: unknown }[]} */
  static desplazadas = [];
  /** Dónde queda la parte de arriba de la caja respecto a la ventana. */
  arriba = 100;
  /** @override @param {Event} evento */
  dispatchEvent(evento) {
    Object.defineProperty(evento, 'target', { value: this, configurable: true });
    for (let nodo = /** @type {Elemento | null} */ (this); nodo; nodo = nodo.parentElement) {
      EventTarget.prototype.dispatchEvent.call(nodo, evento);
    }
    EventTarget.prototype.dispatchEvent.call(documento, evento);
    return !evento.defaultPrevented;
  }
  /** @param {Elemento} otra */
  contains(otra) {
    for (let nodo = /** @type {Elemento | null} */ (otra); nodo; nodo = nodo.parentElement) {
      if (nodo === this) {
        return true;
      }
    }
    return false;
  }
  /** @override @param {unknown} [opciones] */
  focus(opciones) {
    Pieza.enfoques.push({ pieza: this, opciones });
    const antes = documento.activeElement;
    documento.activeElement = this;
    if (antes && antes !== this) {
      antes.dispatchEvent(Object.assign(new Event('focusout'), { relatedTarget: this }));
    }
  }
  getBoundingClientRect() {
    return { top: this.arriba };
  }
  /** @param {unknown} [opciones] */
  scrollIntoView(opciones) {
    Pieza.desplazadas.push({ pieza: this, opciones });
  }
}

/** Un botón de opción: marcado o no, con su valor. */
class Entrada extends Pieza {
  checked = false;
  get value() {
    return this.getAttribute('value') ?? '';
  }
}

/** @param {import('parse5').DefaultTreeAdapterTypes.Element} origen @returns {Pieza} */
function convertir(origen) {
  const pieza = origen.tagName === 'input' ? new Entrada('input') : new Pieza(origen.tagName);
  for (const { name, value } of origen.attrs) {
    pieza.setAttribute(name, value);
  }
  if (pieza instanceof Entrada) {
    pieza.checked = pieza.hasAttribute('checked');
  }
  for (const hijo of origen.childNodes) {
    if (defaultTreeAdapter.isElementNode(hijo)) {
      pieza.append(convertir(hijo));
    } else if (defaultTreeAdapter.isTextNode(hijo)) {
      pieza.append(new Texto(hijo.value));
    }
  }
  return pieza;
}

/** Los observadores de cambios de clase que crea la página; la prueba los avisa al cambiar de segmento. */
class ObservadorDePrueba {
  /** @type {ObservadorDePrueba[]} */
  static todos = [];
  /** @type {[Elemento, unknown][]} */
  observados = [];
  /** @param {() => void} alCambiar */
  constructor(alCambiar) {
    this.alCambiar = alCambiar;
    ObservadorDePrueba.todos.push(this);
  }
  /** @param {Elemento} nodo @param {unknown} opciones */
  observe(nodo, opciones) {
    this.observados.push([nodo, opciones]);
  }
}

/** @param {Pieza} pieza @param {string} selector */
function unico(pieza, selector) {
  const [primero, ...resto] = /** @type {Pieza[]} */ (pieza.querySelectorAll(selector));
  assert.ok(primero && resto.length === 0, `un solo ${selector}`);
  return primero;
}

/** El documento de prueba sobre la página convertida. @param {Pieza} raiz @returns {Documento} */
function documentoDoble(raiz) {
  return Object.assign(new EventTarget(), {
    baseURI: 'https://ejemplo.invalid/biblioteca.html',
    activeElement: /** @type {Pieza | null} */ (null),
    documentElement: raiz,
    querySelector: (/** @type {string} */ css) => /** @type {Pieza | null} */ (raiz.querySelector(css)),
    querySelectorAll: (/** @type {string} */ css) => /** @type {Pieza[]} */ (raiz.querySelectorAll(css)),
    getElementById: (/** @type {string} */ id) =>
      /** @type {Pieza | null} */ (raiz.querySelectorAll('*').find((pieza) => pieza.id === id) ?? null),
    createTextNode: (/** @type {string} */ texto) => new Texto(texto),
    createElement: (/** @type {string} */ etiqueta) => new Pieza(etiqueta),
    createElementNS: (/** @type {string} */ _espacio, /** @type {string} */ etiqueta) => new Pieza(etiqueta),
  });
}

/**
 * La ventana del doble, con su vista y las correcciones que pide el script (scrollBy). La barra de números de cada
 * segmento queda debajo de sus fichas a la vista, como en la página.
 * @param {Pieza} raiz
 */
function ventanaDoble(raiz) {
  /** @type {{ top: number, behavior: unknown }[]} */
  const correcciones = [];
  const ventana = Object.assign(new EventTarget(), {
    scrollY: VISTA_INICIAL,
    scrollBy: (/** @type {{ top: number, behavior: unknown }} */ { top, behavior }) => {
      correcciones.push({ top, behavior });
      ventana.scrollY += top;
    },
  });
  for (const nav of /** @type {Pieza[]} */ (raiz.querySelectorAll('[data-paginas]'))) {
    const bloque = /** @type {Pieza} */ (nav.parentElement);
    nav.getBoundingClientRect = () => {
      const fichas = bloque
        .querySelectorAll('[data-filtrable]')
        .filter((lectura) => !lectura.hidden && !lectura.hasAttribute('data-otra-pagina')).length;
      return { top: PRINCIPIO_DE_LA_LISTA + fichas * ALTO_DE_FICHA - ventana.scrollY };
    };
  }
  return { ventana, correcciones };
}

/**
 * La Biblioteca real en el doble, con scripts/lecturas.js ya cargado y el primer segmento a la vista (lo que dejan las
 * pestañas de scripts/etapas.js).
 * @param {import('node:test').TestContext} contexto
 * @param {(raiz: Pieza) => void} [preparar] Cambia la página antes de cargar el script.
 * @param {string} [fragmento] El fragmento de la dirección al abrir.
 */
async function abrir(contexto, preparar = () => {}, fragmento = '') {
  const documentoHtml = parse(HTML);
  const raizHtml = documentoHtml.childNodes.find(defaultTreeAdapter.isElementNode);
  assert.ok(raizHtml);
  const raiz = convertir(raizHtml);
  raiz.lang = 'es';
  fijarIdioma('es');
  documento = documentoDoble(raiz);
  ObservadorDePrueba.todos = [];
  Pieza.enfoques = [];
  Pieza.desplazadas = [];
  const red = contexto.mock.fn(() => {
    throw new Error('Las lecturas se filtran en el dispositivo');
  });
  const historia = { pushState: contexto.mock.fn(), replaceState: contexto.mock.fn() };
  const { ventana, correcciones } = ventanaDoble(raiz);
  const ubicacion = { hash: fragmento };
  navegador(contexto, {
    document: documento,
    window: ventana,
    location: ubicacion,
    history: historia,
    Node: Elemento,
    HTMLElement: Elemento,
    HTMLFormElement: Pieza,
    HTMLInputElement: Entrada,
    MutationObserver: ObservadorDePrueba,
    fetch: red,
  });
  preparar(raiz);
  const formulario = /** @type {Pieza | null} */ (raiz.querySelector('form[data-filtros]'));
  const segmentos = /** @type {Pieza[]} */ (raiz.querySelectorAll('.lecturas-bloque'));
  const cambiarSegmento = (/** @type {string} */ id) => {
    for (const segmento of segmentos) {
      segmento.setAttribute('class', `etapa lecturas-bloque${segmento.id === id ? ' etapa--actual' : ''}`);
    }
    for (const observador of ObservadorDePrueba.todos) {
      observador.alCambiar();
    }
  };
  cambiarSegmento(ID_DE_SEGMENTOS[0] ?? '');
  await cargar('lecturas.js');
  return { raiz, formulario, segmentos, red, historia, ventana, ubicacion, correcciones, cambiarSegmento };
}

/** Lo que el script toca de la página, ya localizado. @param {Awaited<ReturnType<typeof abrir>>} pagina */
function piezasDe({ raiz, formulario: posible, segmentos }) {
  const formulario = posible ?? assert.fail('la página no tiene su formulario de filtros');
  const boton = unico(raiz, '#filtro-nivel-boton');
  const panel = unico(raiz, '#filtro-nivel-panel');
  const nivel = {
    filtro: 'nivel',
    boton,
    panel,
    radios: /** @type {Entrada[]} */ (panel.querySelectorAll('input')),
    etiquetas: /** @type {Pieza[]} */ (panel.querySelectorAll('label')),
    raiz: /** @type {Pieza} */ (boton.parentElement),
  };
  /** @param {Pieza} bloque */
  const lecturasDe = (bloque) => /** @type {Pieza[]} */ (bloque.querySelectorAll('[data-filtrable]'));
  return {
    nivel,
    quitar: unico(formulario, '[data-quitar]'),
    recuento: unico(formulario, '[data-recuento]'),
    cuentas: segmentos.map((segmento) => unico(segmento, '[data-cuenta]')),
    lecturas: segmentos.map(lecturasDe),
  };
}

/** @typedef {ReturnType<typeof piezasDe>['nivel']} Desplegable */

/**
 * Marca una opción como lo hace el navegador (la deja marcada y desmarca las otras del grupo) y avisa con change.
 * @param {Desplegable} desplegable @param {string} valor
 */
function marcar(desplegable, valor) {
  for (const radio of desplegable.radios) {
    radio.checked = radio.value === valor;
  }
  const marcada = desplegable.radios.find((radio) => radio.value === valor);
  assert.ok(marcada);
  marcada.dispatchEvent(evento('change'));
}

/** Elegir con el ratón o el dedo: el gesto empieza con pointerdown dentro del desplegable. */
function elegirConPuntero(/** @type {Desplegable} */ desplegable, /** @type {string} */ valor) {
  desplegable.raiz.dispatchEvent(evento('pointerdown'));
  marcar(desplegable, valor);
}

/** Pulsa una tecla en un elemento; devuelve si el guion la dejó pasar (sin preventDefault). */
function pulsar(/** @type {Pieza} */ en, /** @type {string} */ key) {
  return en.dispatchEvent(evento('keydown', { key }));
}

const abierto = (/** @type {Desplegable} */ { boton, panel }) => {
  assert.equal(boton.getAttribute('aria-expanded') === 'true', !panel.hidden, 'aria-expanded y hidden dicen lo mismo');
  return !panel.hidden;
};
/** Las lecturas de cada segmento que deja ver el filtro, en cualquier página. */
const filtradas = (/** @type {Pieza[][]} */ lecturas) =>
  lecturas.map((lista) => lista.filter((lectura) => !lectura.hidden).length);
/** Las fichas que se ven en la página actual de un segmento. @param {Pieza[]} lista */
const aLaVista = (lista) => lista.filter((lectura) => !lectura.hidden && !lectura.hasAttribute('data-otra-pagina'));

/**
 * Cuántas lecturas del segmento encajan con el nivel, según el registro; «todo» no excluye nada.
 * @param {string} segmento @param {string} [nivel]
 */
function esperadas(segmento, nivel = 'todo') {
  const tipo = TIPO_DE[/** @type {keyof typeof TIPO_DE} */ (segmento)];
  return REGISTRO.lecturas.filter((lectura) => lectura.tipo === tipo && (nivel === 'todo' || lectura.nivel === nivel))
    .length;
}

/**
 * Un DOM de prueba para los casos que la selección real puede no tener (un nivel vacío, una sola ficha de un nivel): las
 * fichas del segmento con ese nivel pasan a otro (el script filtra por data-nivel), sin cambiar cuántas hay.
 * @param {Pieza} raiz @param {string} segmento @param {string} nivel @param {string} otro
 */
function cambiarNivel(raiz, segmento, nivel, otro) {
  const bloque = raiz.querySelector(`#${segmento}`) ?? assert.fail(segmento);
  for (const ficha of bloque.querySelectorAll('[data-filtrable]')) {
    if (ficha.dataset.nivel === nivel) {
      ficha.setAttribute('data-nivel', otro);
    }
  }
}

/** Un DOM de prueba con solo las `cuantas` primeras fichas del segmento. @param {Pieza} raiz @param {string} segmento @param {number} cuantas */
function recortar(raiz, segmento, cuantas) {
  const bloque = raiz.querySelector(`#${segmento}`) ?? assert.fail(segmento);
  const fichas = bloque.querySelectorAll('[data-filtrable]');
  assert.ok(fichas.length >= cuantas, `${segmento}: al menos ${cuantas} fichas`);
  for (const ficha of fichas.slice(cuantas)) {
    ficha.remove();
  }
}

/** Cuántas fichas de una lista del doble son de ese nivel; «todo» no excluye nada. @param {Pieza[]} lista @param {string} nivel */
const delNivel = (lista, nivel) =>
  lista.filter((lectura) => nivel === 'todo' || lectura.dataset.nivel === nivel).length;

/** El reparto esperado de `total` fichas: como mucho seis por página, por igual. @param {number} total */
function tamanos(total) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return Array.from(
    { length: paginas },
    (_, pagina) => Math.floor(total / paginas) + (pagina < total % paginas ? 1 : 0),
  );
}

/** La cuenta que escribe el script en cada opción del desplegable. */
const cuentasDeOpciones = (/** @type {Desplegable} */ { etiquetas }) =>
  etiquetas.map((etiqueta) => limpio(etiqueta.textContent));

/** La navegación de páginas de un segmento: si se ve y sus botones. @param {Pieza} segmento */
function paginasDe(segmento) {
  const nav = unico(segmento, '[data-paginas]');
  const botones = /** @type {Pieza[]} */ (nav.querySelectorAll('button.lecturas-pagina'));
  const [anterior, siguiente] = /** @type {Pieza[]} */ (nav.querySelectorAll('button.lecturas-paso'));
  return {
    nav,
    botones,
    anterior,
    siguiente,
    numeros: botones.map((boton) => boton.textContent),
    nombres: botones.map((boton) => boton.getAttribute('aria-label')),
    actual: botones.findIndex((boton) => boton.getAttribute('aria-current') === 'page'),
  };
}

test('Biblioteca: un solo desplegable, el del nivel, cerrado, con su botón, su panel, su fieldset y sus opciones', async (contexto) => {
  const pagina = await abrir(contexto, (raiz) => {
    assert.equal(unico(raiz, 'form[data-filtros]').hidden, true, 'el formulario parte oculto: sin script se ve todo');
  });
  const { nivel, quitar } = piezasDe(pagina);
  assert.equal(pagina.formulario?.hidden, false);
  assert.equal(pagina.raiz.querySelectorAll('[data-desplegable]').length, 1, 'sin filtro de tipo: cada pestaña es uno');
  assert.equal(pagina.raiz.querySelector('#filtro-tipo-boton'), null);
  assert.equal(nivel.boton.tagName, 'BUTTON');
  assert.equal(nivel.boton.getAttribute('type'), 'button');
  assert.equal(nivel.boton.getAttribute('aria-expanded'), 'false');
  assert.equal(nivel.boton.getAttribute('aria-controls'), nivel.panel.id);
  assert.equal(nivel.panel.hidden, true);
  const fieldset = unico(nivel.panel, 'fieldset');
  assert.equal(limpio(unico(fieldset, 'legend').textContent), 'Nivel');
  assert.ok(nivel.radios.every((radio) => radio.getAttribute('type') === 'radio'));
  assert.deepEqual(
    nivel.radios.map((radio) => `${radio.getAttribute('name')}=${radio.value}`),
    ['nivel=todo', 'nivel=empezar', 'nivel=profundizar', 'nivel=investigacion'],
    'los ids internos de los niveles no cambian',
  );
  assert.equal(limpio(nivel.boton.textContent), 'Nivel · Todos');
  assert.equal(quitar.hidden, true, '«Quitar filtros» solo aparece con algún filtro');
  assert.equal(nivel.boton.hasAttribute('data-activo'), false);
  assert.equal(pagina.red.mock.callCount(), 0);
});

test('Biblioteca: un solo observador de los cambios de segmento, sobre las tres secciones y solo su clase', async (contexto) => {
  await abrir(contexto);
  assert.equal(ObservadorDePrueba.todos.length, 1);
  assert.deepEqual(
    ObservadorDePrueba.todos[0]?.observados.map(([nodo, opciones]) => [nodo.id, opciones]),
    ID_DE_SEGMENTOS.map((id) => [id, { attributes: true, attributeFilter: ['class'] }]),
  );
});

test('Biblioteca: el filtro de nivel y la cuenta de cada segmento, sin ocultar ninguno', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel, cuentas, lecturas } = piezasDe(pagina);
  assert.deepEqual(Object.fromEntries(pagina.segmentos.map(({ id }, i) => [id, lecturas[i]?.length])), TOTALES);
  assert.ok(
    lecturas.every((lista, i) =>
      lista.every((lectura) => lectura.dataset.tipo === TIPO_DE[ID_DE_SEGMENTOS[i] ?? 'guias']),
    ),
    'cada segmento reúne su tipo',
  );
  assert.deepEqual(
    cuentas.map(({ textContent }) => textContent),
    Object.values(TOTALES).map((total) => `Se muestran ${total} de ${total} lecturas.`),
  );
  for (const valor of ['empezar', 'profundizar', 'investigacion', 'todo']) {
    marcar(nivel, valor);
    const vistas = filtradas(lecturas);
    assert.deepEqual(
      vistas,
      ID_DE_SEGMENTOS.map((id) => esperadas(id, valor)),
      valor,
    );
    assert.deepEqual(
      cuentas.map(({ textContent }) => textContent),
      vistas.map((numero, posicion) => `Se muestran ${numero} de ${Object.values(TOTALES)[posicion]} lecturas.`),
    );
    assert.ok(
      pagina.segmentos.every((segmento) => !segmento.hidden),
      'un segmento vacío sigue a la vista, con su cuenta',
    );
  }
  assert.equal(pagina.red.mock.callCount(), 0);
});

test('Biblioteca: un segmento sin lecturas del nivel queda a cero; «Todos» lo restituye y no se envía nada', async (contexto) => {
  // Un DOM de prueba: «Notas» sin ninguna de nivel Avanzado (las suyas pasan a Intermedio), las tenga o no la selección.
  const pagina = await abrir(contexto, (raiz) => cambiarNivel(raiz, 'notas', 'investigacion', 'profundizar'));
  const { nivel, cuentas, lecturas } = piezasDe(pagina);
  assert.equal(lecturas[2]?.length, TOTALES.notas, 'las mismas fichas');
  assert.equal(delNivel(lecturas[2] ?? [], 'investigacion'), 0);
  marcar(nivel, 'investigacion');
  assert.equal(cuentas[2]?.textContent, `Se muestran 0 de ${TOTALES.notas} lecturas.`);
  assert.equal(pagina.segmentos[2]?.hidden, false);
  assert.equal(
    cuentas[0]?.textContent,
    `Se muestran ${esperadas('guias', 'investigacion')} de ${TOTALES.guias} lecturas.`,
    'los otros segmentos, con las suyas',
  );
  marcar(nivel, 'todo');
  assert.ok(lecturas.every((lista) => lista.every((lectura) => !lectura.hidden)));
  const envio = evento('submit');
  pagina.formulario?.dispatchEvent(envio);
  assert.equal(envio.defaultPrevented, true);
  assert.equal(pagina.red.mock.callCount(), 0);
});

test('Biblioteca: cada opción cuenta lo que dejaría ver en el segmento que se ve, con las etiquetas Inicial, Intermedio y Avanzado', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel } = piezasDe(pagina);
  for (const id of ID_DE_SEGMENTOS) {
    pagina.cambiarSegmento(id);
    assert.deepEqual(
      cuentasDeOpciones(nivel),
      [
        `Todos (${esperadas(id)})`,
        `Inicial (${esperadas(id, 'empezar')})`,
        `Intermedio (${esperadas(id, 'profundizar')})`,
        `Avanzado (${esperadas(id, 'investigacion')})`,
      ],
      id,
    );
  }
});

test('Biblioteca: las opciones a cero se atenúan (data-vacia) y se pueden elegir', async (contexto) => {
  // El mismo DOM de prueba: «Notas» sin ninguna de nivel Avanzado.
  const pagina = await abrir(contexto, (raiz) => cambiarNivel(raiz, 'notas', 'investigacion', 'profundizar'));
  const { nivel, cuentas, recuento, lecturas } = piezasDe(pagina);
  pagina.cambiarSegmento('notas');
  const vacias = ['todo', 'empezar', 'profundizar', 'investigacion'].map(
    (valor) => delNivel(lecturas[2] ?? [], valor) === 0,
  );
  assert.deepEqual(vacias, [false, false, false, true], 'solo Avanzado, a cero');
  assert.deepEqual(
    nivel.etiquetas.map((etiqueta) => etiqueta.hasAttribute('data-vacia')),
    vacias,
  );
  assert.equal(
    nivel.radios.some((radio) => radio.hasAttribute('disabled')),
    false,
    'atenuadas, no desactivadas',
  );
  elegirConPuntero(nivel, 'investigacion');
  assert.equal(cuentas[2]?.textContent, `Se muestran 0 de ${TOTALES.notas} lecturas.`);
  assert.equal(limpio(recuento.textContent), `0 de ${TOTALES.notas} lecturas`);
  assert.equal(limpio(nivel.boton.textContent), 'Nivel · Avanzado');
});

test('Biblioteca: el recuento de la barra es el del segmento que se ve, «22 lecturas» o «10 de 22 lecturas»', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel, recuento } = piezasDe(pagina);
  assert.equal(limpio(recuento.textContent), `${TOTALES.guias} lecturas`);
  assert.equal(recuento.getAttribute('aria-hidden'), 'true', 'lo anuncia la región de estado del segmento');
  for (const id of ID_DE_SEGMENTOS) {
    pagina.cambiarSegmento(id);
    assert.equal(limpio(recuento.textContent), `${TOTALES[id]} lecturas`);
  }
  marcar(nivel, 'profundizar');
  for (const id of ID_DE_SEGMENTOS) {
    pagina.cambiarSegmento(id);
    const [vistas, total] = [esperadas(id, 'profundizar'), esperadas(id)];
    assert.equal(
      limpio(recuento.textContent),
      vistas === total ? `${total} lecturas` : `${vistas} de ${total} lecturas`,
      id,
    );
  }
  const regiones = pagina.segmentos.map((segmento) => unico(segmento, '[data-cuenta]'));
  assert.ok(
    regiones.every((region) => region.getAttribute('role') === 'status'),
    'la región aria-live de cada segmento',
  );
});

test('Biblioteca: abrir y cerrar con el botón y aria-expanded al día', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel } = piezasDe(pagina);
  nivel.boton.dispatchEvent(evento('click'));
  assert.equal(abierto(nivel), true);
  nivel.boton.dispatchEvent(evento('click'));
  assert.equal(abierto(nivel), false, 'el mismo botón lo cierra');
});

test('Biblioteca: Escape cierra y devuelve el foco al botón; sin panel abierto no hace nada', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel } = piezasDe(pagina);
  assert.equal(pulsar(nivel.boton, 'Escape'), true, 'cerrado: la tecla sigue su camino');
  nivel.boton.dispatchEvent(evento('click'));
  nivel.radios[0]?.focus();
  assert.equal(pulsar(nivel.radios[0] ?? nivel.boton, 'Escape'), false);
  assert.equal(abierto(nivel), false);
  assert.equal(documento.activeElement, nivel.boton);
});

test('Biblioteca: un clic fuera cierra; un clic dentro del desplegable no', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel } = piezasDe(pagina);
  const fuera = unico(pagina.raiz, 'h1');
  nivel.boton.dispatchEvent(evento('click'));
  nivel.etiquetas[1]?.dispatchEvent(evento('click'));
  assert.equal(abierto(nivel), true, 'un clic en una opción no es un clic fuera');
  fuera.dispatchEvent(evento('click'));
  assert.equal(abierto(nivel), false);
});

test('Biblioteca: salir con el tabulador cierra el panel; un enfoque sin destino, no', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel } = piezasDe(pagina);
  const fuera = unico(pagina.raiz, 'h1');
  nivel.boton.dispatchEvent(evento('click'));
  nivel.radios[0]?.focus();
  nivel.radios[0]?.dispatchEvent(Object.assign(evento('focusout'), { relatedTarget: null }));
  assert.equal(abierto(nivel), true, 'el clic en el texto de una opción no enfoca nada: no cierra');
  nivel.radios[0]?.dispatchEvent(Object.assign(evento('focusout'), { relatedTarget: nivel.boton }));
  assert.equal(abierto(nivel), true, 'volver al botón desde su panel no cierra');
  fuera.focus();
  assert.equal(abierto(nivel), false);
});

test('Biblioteca: elegir con el ratón cierra, devuelve el foco, rotula el botón y marca el filtro activo', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel, quitar } = piezasDe(pagina);
  nivel.boton.dispatchEvent(evento('click'));
  nivel.radios[1]?.focus();
  elegirConPuntero(nivel, 'empezar');
  assert.equal(abierto(nivel), false);
  assert.equal(documento.activeElement, nivel.boton);
  assert.equal(limpio(nivel.boton.textContent), 'Nivel · Inicial');
  assert.equal(nivel.boton.getAttribute('data-activo'), '');
  assert.equal(quitar.hidden, false);
  elegirConPuntero(nivel, 'todo');
  assert.equal(nivel.boton.hasAttribute('data-activo'), false, 'volver a «Todos» quita la marca');
  assert.equal(quitar.hidden, true);
});

test('Biblioteca: elegir sin gesto previo (un lector de pantalla) también cierra', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel } = piezasDe(pagina);
  nivel.boton.dispatchEvent(evento('click'));
  marcar(nivel, 'profundizar');
  assert.equal(abierto(nivel), false);
  assert.equal(documento.activeElement, nivel.boton);
});

test('Biblioteca: las flechas cambian de opción sin cerrar; Intro cierra; la barra espaciadora elige y cierra', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel, lecturas } = piezasDe(pagina);
  nivel.boton.dispatchEvent(evento('click'));
  nivel.radios[0]?.focus();
  for (const [tecla, valor, texto] of [
    ['ArrowDown', 'empezar', 'Inicial'],
    ['ArrowDown', 'profundizar', 'Intermedio'],
    ['ArrowUp', 'empezar', 'Inicial'],
    ['ArrowRight', 'profundizar', 'Intermedio'],
  ]) {
    assert.ok(tecla && valor);
    const actual = nivel.radios.find((radio) => radio.checked);
    assert.ok(actual);
    pulsar(actual, tecla);
    marcar(nivel, valor);
    assert.equal(abierto(nivel), true, `${tecla} no cierra el panel`);
    assert.equal(limpio(nivel.boton.textContent), `Nivel · ${texto}`);
  }
  assert.deepEqual(filtradas(lecturas)[0], esperadas('guias', 'profundizar'));
  const intro = pulsar(nivel.radios.find((radio) => radio.checked) ?? nivel.boton, 'Enter');
  assert.equal(intro, false, 'Intro no envía el formulario');
  assert.equal(abierto(nivel), false);
  assert.equal(documento.activeElement, nivel.boton);
  assert.equal(pulsar(nivel.boton, 'Enter'), true, 'Intro sobre el botón es del propio botón');
  nivel.boton.dispatchEvent(evento('click'));
  const marcada = nivel.radios.find((radio) => radio.checked);
  assert.ok(marcada);
  pulsar(marcada, 'ArrowUp');
  marcar(nivel, 'empezar');
  assert.equal(abierto(nivel), true);
  pulsar(nivel.radios.find((radio) => radio.value === 'investigacion') ?? marcada, ' ');
  marcar(nivel, 'investigacion');
  assert.equal(abierto(nivel), false);
});

test('Biblioteca: «Quitar filtros» aparece con el filtro, lo deja en «Todos» y lleva el foco al desplegable', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel, quitar, recuento, lecturas } = piezasDe(pagina);
  pagina.cambiarSegmento('informes');
  assert.equal(quitar.hidden, true);
  elegirConPuntero(nivel, 'profundizar');
  assert.equal(quitar.hidden, false);
  assert.notDeepEqual(filtradas(lecturas), Object.values(TOTALES));
  nivel.boton.dispatchEvent(evento('click'));
  quitar.dispatchEvent(evento('click'));
  assert.equal(quitar.hidden, true);
  assert.deepEqual(filtradas(lecturas), Object.values(TOTALES));
  assert.deepEqual(
    nivel.radios.map((radio) => radio.checked),
    [true, false, false, false],
  );
  assert.equal(limpio(nivel.boton.textContent), 'Nivel · Todos');
  assert.equal(nivel.boton.hasAttribute('data-activo'), false);
  assert.equal(limpio(recuento.textContent), `${TOTALES.informes} lecturas`);
  assert.equal(abierto(nivel), false);
  assert.equal(documento.activeElement, nivel.boton);
});

test('Biblioteca: la elección se conserva al cambiar de segmento, que dice su propia cuenta', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel, recuento, cuentas } = piezasDe(pagina);
  elegirConPuntero(nivel, 'investigacion');
  for (const id of ID_DE_SEGMENTOS) {
    pagina.cambiarSegmento(id);
    const [vistas, total] = [esperadas(id, 'investigacion'), esperadas(id)];
    assert.equal(limpio(recuento.textContent), `${vistas} de ${total} lecturas`, id);
    assert.equal(limpio(nivel.boton.textContent), 'Nivel · Avanzado');
    assert.deepEqual(
      nivel.radios.map((radio) => radio.checked),
      [false, false, false, true],
    );
  }
  assert.deepEqual(
    cuentas.map(({ textContent }) => textContent),
    ID_DE_SEGMENTOS.map((id) => `Se muestran ${esperadas(id, 'investigacion')} de ${TOTALES[id]} lecturas.`),
  );
});

test('Biblioteca: la cuenta, la barra y las páginas se traducen sin perder la elección', async (contexto) => {
  const pagina = await abrir(contexto);
  const { nivel, cuentas, recuento, quitar } = piezasDe(pagina);
  elegirConPuntero(nivel, 'profundizar');
  pagina.cambiarSegmento('informes');
  const vistas = esperadas('informes', 'profundizar');
  assert.equal(cuentas[1]?.textContent, `Se muestran ${vistas} de ${TOTALES.informes} lecturas.`);
  fijarIdioma('ca');
  const { reescribirTextos } = await import('../../web/scripts/idioma.js');
  reescribirTextos();
  assert.equal(cuentas[1]?.textContent, `Es mostren ${vistas} de ${TOTALES.informes} lectures.`);
  assert.equal(limpio(recuento.textContent), `${vistas} de ${TOTALES.informes} lectures`);
  assert.equal(limpio(nivel.boton.textContent), 'Nivell · Intermedi');
  assert.equal(limpio(quitar.textContent), 'Treure els filtres');
  assert.deepEqual(cuentasDeOpciones(nivel), [
    `Tots (${esperadas('informes')})`,
    `Inicial (${esperadas('informes', 'empezar')})`,
    `Intermedi (${esperadas('informes', 'profundizar')})`,
    `Avançat (${esperadas('informes', 'investigacion')})`,
  ]);
  elegirConPuntero(nivel, 'todo');
  const guias = () => paginasDe(pagina.segmentos[0] ?? assert.fail());
  assert.equal(guias().nombres[1], `Pàgina 2 de ${tamanos(TOTALES.guias ?? 0).length}`);
  fijarIdioma('es');
  reescribirTextos();
  assert.equal(guias().nombres[1], `Página 2 de ${tamanos(TOTALES.guias ?? 0).length}`);
  assert.equal(limpio(nivel.boton.textContent), 'Nivel · Todos');
  assert.equal(pagina.red.mock.callCount(), 0);
});

test('Biblioteca: sin el componente de pestañas todos los segmentos se ven seguidos y la barra cuenta con todos', async (contexto) => {
  const pagina = await abrir(contexto, (raiz) => {
    for (const segmento of raiz.querySelectorAll('.lecturas-bloque')) {
      segmento.setAttribute('class', 'etapa lecturas-bloque');
    }
  });
  const { nivel, recuento } = piezasDe(pagina);
  for (const segmento of pagina.segmentos) {
    segmento.setAttribute('class', 'etapa lecturas-bloque');
  }
  ObservadorDePrueba.todos[0]?.alCambiar();
  const total = Object.values(TOTALES).reduce((suma, numero) => suma + numero, 0);
  assert.equal(limpio(recuento.textContent), `${total} lecturas`);
  marcar(nivel, 'empezar');
  const vistas = ID_DE_SEGMENTOS.reduce((suma, id) => suma + esperadas(id, 'empezar'), 0);
  assert.equal(limpio(recuento.textContent), `${vistas} de ${total} lecturas`);
});

test('Biblioteca: un marcado incompleto no enseña los filtros y la página se lee entera', async (contexto) => {
  const { PaginaIncompleta } = await import('../../web/scripts/dom.js');
  for (const [que, quitarDe] of /** @type {[string, (raiz: Pieza) => void][]} */ ([
    ['sin «Quitar filtros»', (raiz) => unico(raiz, '[data-quitar]').remove()],
    ['sin recuento', (raiz) => unico(raiz, '[data-recuento]').remove()],
    ['sin panel', (raiz) => unico(raiz, '#filtro-nivel-panel').remove()],
    ['sin desplegable', (raiz) => unico(raiz, '[data-desplegable]').remove()],
  ])) {
    await assert.rejects(
      abrir(contexto, (raiz) => {
        quitarDe(raiz);
        assert.equal(unico(raiz, 'form[data-filtros]').hidden, true);
      }),
      PaginaIncompleta,
      que,
    );
    assert.equal(
      unico(documento.documentElement, 'form[data-filtros]').hidden,
      true,
      `${que}: el formulario sigue oculto`,
    );
    assert.ok(
      documento.documentElement.querySelectorAll('[data-paginas]').every((nav) => nav.hidden),
      `${que}: sin páginas, se ven todas las fichas`,
    );
  }
});

test('una página sin formulario de lecturas conserva su funcionamiento', async (contexto) => {
  const pagina = await abrir(contexto, (raiz) => {
    unico(raiz, 'form[data-filtros]').remove();
  });
  assert.equal(pagina.formulario, null);
  assert.equal(ObservadorDePrueba.todos.length, 0, 'sin filtros no se observa nada');
  assert.ok(pagina.segmentos.every((segmento) => unico(segmento, '[data-paginas]').hidden));
  assert.equal(pagina.red.mock.callCount(), 0);
});

test('Páginas: el reparto es de seis como mucho, por igual, y nunca deja una ficha suelta', async (contexto) => {
  await abrir(contexto);
  const { repartir, POR_PAGINA: maximo } = await cargar('lecturas.js');
  assert.equal(maximo, POR_PAGINA);
  const medidas = (/** @type {number} */ total) =>
    repartir(total)
      .map((/** @type {[number, number]} */ [desde, hasta]) => hasta - desde)
      .join(' ');
  // Cuántas fichas lleva cada página según las que deja ver el filtro: 25 lecturas de un segmento, «1 2 3 4 5».
  const ESPERADOS = {
    25: '5 5 5 5 5',
    9: '5 4',
    8: '4 4',
    22: '6 6 5 5',
    20: '5 5 5 5',
    14: '5 5 4',
    7: '4 3',
    6: '6',
    1: '1',
    0: '0',
  };
  for (const [total, esperado] of Object.entries(ESPERADOS)) {
    assert.equal(medidas(Number(total)), esperado, total);
  }
  const HASTA = 80;
  for (let total = 2; total <= HASTA; total += 1) {
    const reparto = /** @type {number[]} */ (medidas(total).split(' ').map(Number));
    assert.equal(
      reparto.reduce((/** @type {number} */ suma, /** @type {number} */ n) => suma + n, 0),
      total,
      `${total}: todas las fichas`,
    );
    assert.ok(Math.max(...reparto) <= POR_PAGINA, `${total}: como mucho seis`);
    assert.ok(Math.max(...reparto) - Math.min(...reparto) <= 1, `${total}: por igual`);
    assert.ok(Math.min(...reparto) > 1, `${total}: sin una ficha suelta`);
  }
  assert.equal(repartir(Number('13')).flat().join(' '), '0 5 5 9 9 13', 'principio y final de cada página');
});

test('Páginas: al abrir, cada segmento enseña su página 1 y, al pie, sus números con el actual marcado', async (contexto) => {
  const pagina = await abrir(contexto, (raiz) => {
    assert.ok(
      raiz.querySelectorAll('[data-paginas]').every((nav) => nav.hidden && nav.querySelectorAll('button').length === 0),
      'sin script, sin páginas: se ven todas las fichas',
    );
  });
  const { lecturas } = piezasDe(pagina);
  for (const [posicion, id] of ID_DE_SEGMENTOS.entries()) {
    const segmento = pagina.segmentos[posicion] ?? assert.fail();
    const reparto = tamanos(TOTALES[id] ?? 0);
    const lista = lecturas[posicion] ?? [];
    assert.deepEqual(aLaVista(lista), lista.slice(0, reparto[0]), `${id}: las primeras, en su orden`);
    const { nav, botones, numeros, nombres, actual } = paginasDe(segmento);
    assert.equal(nav.tagName, 'NAV');
    assert.equal(nav.getAttribute('aria-label'), 'Páginas');
    assert.equal(nav.hidden, false);
    assert.deepEqual(
      numeros,
      reparto.map((_, n) => String(n + 1)),
    );
    assert.deepEqual(
      nombres,
      reparto.map((_, n) => `Página ${n + 1} de ${reparto.length}`),
    );
    assert.equal(actual, 0);
    assert.equal(botones.filter((boton) => boton.hasAttribute('aria-current')).length, 1);
    assert.ok(botones.every((boton) => boton.parentElement?.tagName === 'LI'));
  }
});

/** Un DOM de prueba con 22 guías, «6 6 5 5»: páginas de distinto tamaño, para ver la corrección de la vista. */
const GUIAS = 22;
/** @param {Pieza} raiz */
const conVeintidosGuias = (raiz) => recortar(raiz, 'guias', GUIAS);

test('Páginas: pasar de página cambia las fichas y el actual; el foco se queda en el número, la barra no se mueve y no se toca la dirección', async (contexto) => {
  const pagina = await abrir(contexto, conVeintidosGuias);
  const { lecturas, cuentas } = piezasDe(pagina);
  const guias = pagina.segmentos[0] ?? assert.fail();
  const nav = unico(guias, '[data-paginas]');
  const reparto = tamanos(lecturas[0]?.length ?? 0);
  assert.equal(reparto.join(' '), '6 6 5 5', 'las 22 guías');
  const [primera = 0, segunda = 0] = reparto;
  const pulsar = (/** @type {number} */ numero) => {
    const boton = paginasDe(guias).botones[numero] ?? assert.fail();
    boton.focus();
    Pieza.enfoques = [];
    boton.dispatchEvent(evento('click'));
    return boton;
  };
  // De la 1 a la 2 (seis fichas en las dos): la barra queda donde estaba sin tocar la vista.
  const arriba = nav.getBoundingClientRect().top;
  const segundo = pulsar(1);
  assert.deepEqual(aLaVista(lecturas[0] ?? []), (lecturas[0] ?? []).slice(primera, primera + segunda));
  assert.equal(paginasDe(guias).actual, 1);
  assert.equal(documento.activeElement, segundo, 'el foco se queda en el número pulsado');
  assert.ok(paginasDe(guias).botones.includes(segundo), 'el mismo botón, no uno nuevo');
  assert.deepEqual(Pieza.enfoques, [], 'nadie mueve el foco');
  assert.deepEqual(pagina.correcciones, []);
  assert.equal(nav.getBoundingClientRect().top, arriba);
  assert.equal(cuentas[0]?.textContent, 'Página 2 de 4', 'se anuncia en la región de estado del segmento');
  // De la 2 a la 3 (de seis a cinco): la vista sube lo justo, una ficha, de golpe, y la barra sigue en su sitio.
  const vista = pagina.ventana.scrollY;
  pulsar(2);
  assert.equal(paginasDe(guias).actual, 2);
  assert.deepEqual(pagina.correcciones, [{ top: -ALTO_DE_FICHA, behavior: 'instant' }]);
  assert.equal(pagina.ventana.scrollY, vista - ALTO_DE_FICHA, 'solo lo justo: nunca hasta la lista');
  assert.equal(nav.getBoundingClientRect().top, arriba);
  assert.deepEqual(Pieza.desplazadas, [], 'ni scrollIntoView');
  assert.equal(cuentas[0]?.textContent, 'Página 3 de 4');
  // De la 3 a la 1 (de cinco a seis): baja lo justo.
  pulsar(0);
  assert.deepEqual(pagina.correcciones.at(-1), { top: ALTO_DE_FICHA, behavior: 'instant' });
  assert.equal(nav.getBoundingClientRect().top, arriba);
  // La página que ya se ve no hace nada.
  pulsar(0);
  assert.equal(pagina.correcciones.length, 2);
  assert.equal(pagina.historia.pushState.mock.callCount(), 0, 'no añade nada a la historia');
  assert.equal(pagina.historia.replaceState.mock.callCount(), 0);
  assert.equal(pagina.ubicacion.hash, '');
  // Los otros segmentos siguen en su página 1.
  assert.equal(paginasDe(pagina.segmentos[1] ?? assert.fail()).actual, 0);
});

test('Páginas: el enlace de una ficha con versión en catalán sigue al idioma de la web, sin recargar', async (contexto) => {
  const pagina = await abrir(contexto);
  const conCatalan = /** @type {Pieza[]} */ (pagina.raiz.querySelectorAll('a[data-enlace-ca]'));
  assert.ok(conCatalan.length > 0);
  const originales = conCatalan.map((enlace) => enlace.getAttribute('href'));
  assert.ok(originales.every((href, n) => href && href !== conCatalan[n]?.dataset.enlaceCa));
  const { cambiarIdioma } = await import('../../web/scripts/idioma.js');
  await cambiarIdioma('ca');
  assert.deepEqual(
    conCatalan.map((enlace) => enlace.getAttribute('href')),
    conCatalan.map((enlace) => enlace.dataset.enlaceCa),
  );
  await cambiarIdioma('es');
  assert.deepEqual(
    conCatalan.map((enlace) => enlace.getAttribute('href')),
    originales,
  );
  // Las que no tienen versión en catalán no cambian.
  const sinCatalan = /** @type {Pieza[]} */ (pagina.raiz.querySelectorAll('h3 a')).filter(
    (enlace) => !enlace.hasAttribute('data-enlace-ca'),
  );
  const antes = sinCatalan.map((enlace) => enlace.getAttribute('href'));
  await cambiarIdioma('ca');
  assert.deepEqual(
    sinCatalan.map((enlace) => enlace.getAttribute('href')),
    antes,
  );
  await cambiarIdioma('es');
});

/** Un DOM de prueba: una sola guía de nivel Avanzado (la última) y ninguna nota de ese nivel. @param {Pieza} raiz */
function unaGuiaAvanzadaYNingunaNota(raiz) {
  cambiarNivel(raiz, 'guias', 'investigacion', 'profundizar');
  raiz
    .querySelector('#guias')
    ?.querySelectorAll('[data-filtrable]')
    .at(-1)
    ?.setAttribute('data-nivel', 'investigacion');
  cambiarNivel(raiz, 'notas', 'investigacion', 'profundizar');
}

test('Páginas: al filtrar o al cambiar de pestaña se vuelve a la página 1; con una sola página, la navegación se oculta', async (contexto) => {
  const pagina = await abrir(contexto, unaGuiaAvanzadaYNingunaNota);
  const { nivel, lecturas, cuentas } = piezasDe(pagina);
  const guias = pagina.segmentos[0] ?? assert.fail();
  paginasDe(guias).botones[2]?.dispatchEvent(evento('click'));
  assert.equal(paginasDe(guias).actual, 2);
  // Con «Intermedio», las guías de ese nivel, repartidas desde la página 1.
  elegirConPuntero(nivel, 'profundizar');
  const intermedias = (lecturas[0] ?? []).filter((lectura) => lectura.dataset.nivel === 'profundizar');
  const reparto = tamanos(intermedias.length);
  assert.equal(paginasDe(guias).actual, 0);
  assert.deepEqual(
    paginasDe(guias).numeros,
    reparto.map((_, n) => String(n + 1)),
  );
  assert.deepEqual(aLaVista(lecturas[0] ?? []), intermedias.slice(0, reparto[0]));
  assert.equal(
    cuentas[0]?.textContent,
    `Se muestran ${intermedias.length} de ${TOTALES.guias} lecturas.`,
    'la cuenta no cambia por paginar',
  );
  // Con «Avanzado» hay una sola guía: una página, sin navegación.
  elegirConPuntero(nivel, 'investigacion');
  assert.equal(delNivel(lecturas[0] ?? [], 'investigacion'), 1);
  assert.equal(paginasDe(guias).nav.hidden, true);
  assert.equal(paginasDe(guias).botones.length, 0);
  assert.equal(aLaVista(lecturas[0] ?? []).length, 1);
  // Sin ninguna (Notas · Avanzado), tampoco.
  assert.equal(delNivel(lecturas[2] ?? [], 'investigacion'), 0);
  assert.equal(paginasDe(pagina.segmentos[2] ?? assert.fail()).nav.hidden, true);
  // Cambiar de pestaña también vuelve a la página 1.
  elegirConPuntero(nivel, 'todo');
  const informes = pagina.segmentos[1] ?? assert.fail();
  pagina.cambiarSegmento('informes');
  paginasDe(informes).botones[1]?.dispatchEvent(evento('click'));
  assert.equal(paginasDe(informes).actual, 1);
  pagina.cambiarSegmento('notas');
  pagina.cambiarSegmento('informes');
  assert.equal(paginasDe(informes).actual, 0);
  assert.deepEqual(aLaVista(lecturas[1] ?? []), (lecturas[1] ?? []).slice(0, tamanos(TOTALES.informes ?? 0)[0]));
});

test('Páginas: una dirección con el fragmento de una ficha de otra página abre esa página y lleva la vista hasta ella', async (contexto) => {
  const documentoHtml = parse(HTML);
  const raizHtml = documentoHtml.childNodes.find(defaultTreeAdapter.isElementNode);
  assert.ok(raizHtml);
  const guias = /** @type {Pieza} */ (convertir(raizHtml).querySelector('#guias'));
  const reparto = tamanos(TOTALES.guias ?? 0);
  const desde = reparto.slice(0, -1).reduce((suma, n) => suma + n, 0);
  // Una ficha enlazada de la última página (las guías en preparación no tienen «abre-…»).
  const destino = guias
    .querySelectorAll('[data-filtrable]')
    .slice(desde)
    .flatMap((lectura) => lectura.querySelectorAll('dd'))
    .find((dd) => dd.id.startsWith('abre-'));
  assert.ok(destino);
  const pagina = await abrir(contexto, () => {}, `#${destino.id}`);
  const segmento = pagina.segmentos[0] ?? assert.fail();
  assert.equal(paginasDe(segmento).actual, reparto.length - 1, 'la última página, donde está la ficha');
  const visibles = aLaVista(piezasDe(pagina).lecturas[0] ?? []);
  assert.ok(visibles.some((lectura) => lectura.querySelectorAll('dd').some((dd) => dd.id === destino.id)));
  assert.deepEqual(
    Pieza.desplazadas.map(({ pieza }) => pieza.id),
    [destino.id],
  );
  // Y lo mismo con un hashchange, desde otra página.
  paginasDe(segmento).botones[0]?.dispatchEvent(evento('click'));
  Pieza.desplazadas = [];
  pagina.ubicacion.hash = `#${destino.id}`;
  pagina.ventana.dispatchEvent(new Event('hashchange'));
  assert.equal(paginasDe(segmento).actual, reparto.length - 1);
  assert.equal(Pieza.desplazadas.length, 1);
});

test('Páginas: «Anterior» y «Siguiente» a los lados, desactivados en los extremos; el foco pasa al número si se desactiva', async (contexto) => {
  const pagina = await abrir(contexto, conVeintidosGuias);
  const guias = pagina.segmentos[0] ?? assert.fail();
  const { anterior, siguiente, botones } = paginasDe(guias);
  assert.ok(anterior && siguiente, 'los dos pasos');
  assert.deepEqual(
    [anterior, siguiente].map((paso) => paso.getAttribute('aria-label')),
    ['Página anterior', 'Página siguiente'],
  );
  assert.equal(limpio(anterior.textContent), 'Anterior', 'la palabra, que la hoja oculta en el móvil');
  assert.equal(anterior.hasAttribute('disabled'), true, 'en la primera página, «Anterior» desactivado');
  assert.equal(siguiente.hasAttribute('disabled'), false);
  siguiente.focus();
  siguiente.dispatchEvent(evento('click'));
  assert.equal(paginasDe(guias).actual, 1, 'avanza');
  assert.equal(documento.activeElement, siguiente, 'el foco se queda en el paso pulsado');
  assert.equal(anterior.hasAttribute('disabled'), false);
  for (const _ of ['tercera', 'cuarta']) {
    siguiente.dispatchEvent(evento('click'));
  }
  assert.equal(paginasDe(guias).actual, botones.length - 1, 'hasta la última');
  assert.equal(siguiente.hasAttribute('disabled'), true, 'en la última, «Siguiente» desactivado');
  assert.equal(documento.activeElement, botones.at(-1), 'el foco pasa al número de la página actual');
  anterior.dispatchEvent(evento('click'));
  assert.equal(paginasDe(guias).actual, botones.length - 2, 'retrocede');
});

test('la evidencia de cada idioma controla su enlace sin que cambiar de lengua reactive el desactivado', async (contexto) => {
  const pagina = await abrir(contexto, (raiz) => {
    const enlace = raiz.querySelector('a[data-enlace-ca]');
    assert.ok(enlace);
    enlace.setAttribute('data-abrir-es', 'false');
    enlace.setAttribute('data-abrir-ca', 'true');
  });
  const enlace = pagina.raiz.querySelector('a[data-enlace-ca]');
  assert.ok(enlace);
  const ficha = enlace.closest('[data-lectura]');
  assert.ok(ficha);
  const aviso = ficha.querySelector('[data-comprobacion-enlace]');
  assert.ok(aviso);
  assert.equal(enlace.hasAttribute('href'), false);
  assert.equal(aviso.hidden, false);
  assert.equal(aviso.textContent, 'Enlace no disponible');
  const { cambiarIdioma } = await import('../../web/scripts/idioma.js');
  await cambiarIdioma('ca');
  assert.equal(enlace.getAttribute('href'), enlace.getAttribute('data-enlace-ca'));
  assert.equal(aviso.hidden, true, 'variante catalana desconocida, sin marca de comprobación');
  await cambiarIdioma('es');
  assert.equal(enlace.hasAttribute('href'), false);
  assert.equal(enlace.getAttribute('aria-disabled'), 'true');
  assert.equal(pagina.red.mock.callCount(), 0);
});

test('la fecha de comprobación se mantiene en la página abierta: el tiempo no la oculta', async (contexto) => {
  const inicio = Date.parse('2026-10-23T12:00:00Z');
  const anio = Date.parse('2027-10-23T12:00:00Z') - inicio;
  contexto.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: inicio });
  const pagina = await abrir(contexto, (raiz) => {
    const enlace = raiz.querySelector('a[data-enlace-ca]');
    assert.ok(enlace);
    enlace.setAttribute('data-comprobado-es', '2026-10-22T12:00:01Z');
  });
  const enlace = pagina.raiz.querySelector('a[data-enlace-ca]');
  assert.ok(enlace);
  const aviso = enlace.closest('[data-lectura]')?.querySelector('[data-comprobacion-enlace]');
  assert.ok(aviso);
  assert.equal(aviso.hidden, false);
  assert.equal(aviso.textContent, 'Comprobado: 22/10/2026');
  contexto.mock.timers.tick(anio);
  assert.equal(aviso.hidden, false);
  assert.equal(aviso.textContent, 'Comprobado: 22/10/2026');
  assert.equal(enlace.getAttribute('href'), enlace.getAttribute('data-enlace-es'));
  assert.equal(enlace.getAttribute('data-comprobado-es'), '2026-10-22T12:00:01Z');
  assert.equal(pagina.red.mock.callCount(), 0);
});

test('un enlace con incidencia sigue abierto y avisa junto a él, con la fecha de comprobación', async (contexto) => {
  const pagina = await abrir(contexto, (raiz) => {
    const enlace = raiz.querySelector('a[data-enlace-ca]');
    assert.ok(enlace);
    enlace.setAttribute('data-comprobado-es', '2026-10-22T12:00:01Z');
    enlace.setAttribute('data-incidencia-es', '2026-10-23T08:00:00Z');
  });
  const enlace = pagina.raiz.querySelector('a[data-enlace-ca]');
  assert.ok(enlace);
  const aviso = enlace.closest('[data-lectura]')?.querySelector('[data-comprobacion-enlace]');
  assert.ok(aviso);
  assert.equal(enlace.getAttribute('href'), enlace.getAttribute('data-enlace-es'));
  assert.equal(aviso.hidden, false);
  assert.equal(aviso.getAttribute('data-texto'), 'biblioteca.comprobado-con-incidencia');
  assert.equal(pagina.red.mock.callCount(), 0);
});

/** Una captura del contrato de enlaces_lecturas para `url`, confirmada o con 404, capturada en `instante`. */
function capturaDe(/** @type {string} */ url, /** @type {boolean} */ confirmada, /** @type {string} */ instante) {
  const vence = new Date(Date.parse(instante) + SIETE_DIAS_MS).toISOString().replace('.000Z', 'Z');
  const comun = { url, capturado_utc: instante, error_tipo: null, vence_utc: vence };
  return confirmada
    ? {
        ...comun,
        url_final: url,
        cuerpo_sha256: 'a'.repeat(LONGITUD_SHA),
        content_type: 'text/html',
        resultado: 'respuesta',
        codigo_http: null,
        estado: 'verificado',
        identidad_acreditada: true,
        lectura_tecnica: { estado: 'legible_html' },
      }
    : {
        ...comun,
        url_final: null,
        cuerpo_sha256: null,
        content_type: '',
        resultado: 'http_error',
        codigo_http: HTTP_NO_ENCONTRADO,
        estado: 'http_no_encontrado',
        identidad_acreditada: false,
        lectura_tecnica: { estado: 'http_error' },
      };
}
const SIETE_DIAS_MS = 604_800_000;
const LONGITUD_SHA = 64;
const HTTP_NO_ENCONTRADO = 404;
const CONFIRMADA_EL = '2026-10-20T08:00:00Z';
const NO_ENCONTRADA_EL = '2026-10-23T08:00:00Z';
const ATRIBUTOS_DE_EVIDENCIA = ['abrir', 'comprobado', 'incidencia'].flatMap((dato) => [
  `data-${dato}-es`,
  `data-${dato}-ca`,
]);

/**
 * El recorrido real: proyección (src/biblioteca/observaciones-lecturas.ts) de una confirmación seguida de un 404, o de un
 * 404 sin confirmación, generación de la ficha (herramientas/web/lecturas.ts) y los atributos que deja en su enlace.
 * @param {string} id @param {boolean} confirmadaAntes
 */
function enlaceGenerado(id, confirmadaAntes) {
  const registro = leerRegistro();
  const lectura = registro.lecturas.find((fila) => fila.id === id);
  assert.ok(lectura?.enlace && lectura.enlace_ca);
  const objetivos = [
    { objetivo: `${id}:enlace`, id, campo: 'enlace', url: lectura.enlace },
    { objetivo: `${id}:enlace_ca`, id, campo: 'enlace_ca', url: lectura.enlace_ca },
  ];
  const filas = objetivos.map((objetivo) => {
    const confirmada = confirmadaAntes ? capturaDe(objetivo.url, true, CONFIRMADA_EL) : null;
    const ausente = capturaDe(objetivo.url, false, NO_ENCONTRADA_EL);
    return {
      ...objetivo,
      estado: ausente.estado,
      ultimo_intento: ausente,
      ultima_confirmacion: confirmada,
      ultima_evidencia: ausente,
    };
  });
  const sha = 'b'.repeat(LONGITUD_SHA);
  const proyeccion = proyectarObservaciones({
    catalogoSha256: sha,
    objetivos,
    ahora: '2026-10-25T09:00:00Z',
    observaciones: {
      version: 2,
      catalogo_sha256: sha,
      validez_dias: 7,
      revision_editorial: 'fuera_del_alcance',
      objetivos: filas,
      verificados: 0,
    },
  });
  const { paginas, diccionarios } = generar(registro, proyeccion.objetivos);
  const html = paginas['biblioteca.html'] ?? assert.fail('sin biblioteca.html');
  const desde = html.indexOf(`data-lectura="${id}"`);
  const ficha = html.slice(desde, html.indexOf('</li>', desde));
  const enlace = /<a\b[^>]*data-enlace-es=[^>]*>/.exec(ficha)?.[0] ?? assert.fail('ficha sin enlace');
  const atributos = [...enlace.matchAll(/\s(data-(?:abrir|comprobado|incidencia)-(?:es|ca))="([^"]*)"/g)].map(
    ([, nombre = '', valor = '']) => /** @type {[string, string]} */ ([nombre, valor]),
  );
  return { proyeccion: proyeccion.objetivos, atributos, abierto: /<a href="/.test(enlace), diccionarios };
}

for (const [caso, confirmadaAntes] of /** @type {const} */ ([
  ['confirmado y después 404', true],
  ['nunca confirmado y 404', false],
])) {
  test(`recorrido real ${caso}: enlace abierto, aviso y la fecha solo si se comprobó`, async (contexto) => {
    /** @type {ReturnType<typeof enlaceGenerado> | undefined} */
    let generado;
    const pagina = await abrir(contexto, (raiz) => {
      const enlace = raiz.querySelector('a[data-enlace-ca]');
      const id = enlace?.closest('[data-lectura]')?.getAttribute('data-lectura');
      assert.ok(enlace && id);
      generado = enlaceGenerado(id, confirmadaAntes);
      for (const nombre of ATRIBUTOS_DE_EVIDENCIA) {
        enlace.removeAttribute(nombre);
      }
      for (const [nombre, valor] of generado.atributos) {
        enlace.setAttribute(nombre, valor);
      }
      registrarDiccionario('es', { ...es, ...generado.diccionarios.es });
      registrarDiccionario('ca', { ...ca, ...generado.diccionarios.ca });
    });
    assert.ok(generado);
    for (const dato of generado.proyeccion) {
      assert.equal(dato.abrir, true);
      assert.equal(dato.estado, confirmadaAntes ? 'comprobado_antes_con_evidencia_contraria' : 'no_comprobado');
      assert.equal(dato.comprobado_utc, confirmadaAntes ? CONFIRMADA_EL : null);
      assert.deepEqual(dato.incidencia, { tipo: 'http_no_encontrado', fecha: NO_ENCONTRADA_EL });
    }
    assert.equal(generado.abierto, true, 'el HTML sin script enlaza el original');
    const enlace = pagina.raiz.querySelector('a[data-enlace-ca]');
    assert.ok(enlace);
    const aviso = enlace.closest('[data-lectura]')?.querySelector('[data-comprobacion-enlace]');
    assert.ok(aviso);
    const { cambiarIdioma } = await import('../../web/scripts/idioma.js');
    const esperados = {
      es: confirmadaAntes
        ? 'Comprobado: 20/10/2026. En la última revisión, este enlace no respondió como se esperaba. Si no se abre, busca el documento por su título en la web de la fuente.'
        : 'En la última revisión, este enlace no respondió como se esperaba. Si no se abre, busca el documento por su título en la web de la fuente.',
      ca: confirmadaAntes
        ? 'Comprovat: 20/10/2026. A la darrera revisió, aquest enllaç no va respondre com s’esperava. Si no s’obre, cerca el document pel seu títol al web de la font.'
        : 'A la darrera revisió, aquest enllaç no va respondre com s’esperava. Si no s’obre, cerca el document pel seu títol al web de la font.',
    };
    for (const idioma of /** @type {const} */ (['es', 'ca'])) {
      await cambiarIdioma(idioma);
      assert.equal(enlace.getAttribute('href'), enlace.getAttribute(`data-enlace-${idioma}`), idioma);
      assert.equal(aviso.hidden, false, idioma);
      assert.equal(limpio(aviso.textContent ?? ''), esperados[idioma], idioma);
    }
    await cambiarIdioma('es');
    registrarDiccionario('es', es);
    registrarDiccionario('ca', ca);
    assert.equal(pagina.red.mock.callCount(), 0);
  });
}
