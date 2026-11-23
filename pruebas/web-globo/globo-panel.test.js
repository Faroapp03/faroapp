// El globo sin navegador (scripts/globo/globo.js, panel.js, selector.js y ficha.js), con un DOM de prueba y la
// muestra compartida de pruebas/fixtures/datos-globales-muestra.json: al abrir, España está elegida y anunciada; el
// selector sigue el patrón combobox de WAI-ARIA 1.2 (la lista muestra siempre todos los países; al escribir se coloca en
// la primera coincidencia y la señala; flechas, Intro y Escape; la opción activa por aria-activedescendant, sin mover
// el foco, y el país elegido con aria-selected); la ficha
// empieza por «La IA en {país}» con frases «De cada 100…», sin pie de fuente ni enlaces (están en créditos), la
// estructura separa la primera tarjeta de las demás, con el empleo después, a la vista; con el archivo publicado, solo
// salen los países con algún dato oficial de la IA (uso medido o exposición calculada, con su cifra o sus cotas);
// Escape en la ficha devuelve el foco a lo que eligió el país; Ctrl o Cmd con + o − no se tocan (son el zoom del
// navegador); sin WebGL o sin las fronteras, el selector y la ficha siguen y la página lo dice. Estas pruebas no
// comprueban el dibujo en WebGL ni la maquetación. Las cifras esperadas («20,3 %») dependen de los datos de formato
// de Intl (ICU) de Node: el separador decimal y el espacio antes de «%» dependen de la versión (engines: Node ≥ 24).
// Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, beforeEach, test } from 'node:test';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';
import { paisesConIa } from '../../web/scripts/globo/datos.js';
import { PASO_DE_GIRO_GRADOS as PASO_DEL_GIRO, ZOOM } from '../../web/scripts/globo/esfera.js';
import { leerFronteras } from '../../web/scripts/globo/fronteras.js';
import { ALTO_PX } from '../../web/scripts/globo/luces.js';
import { proyeccionPlana, radioPlano, vistaPlana } from '../../web/scripts/globo/plano.js';
import { ElementoDePrueba, enfocar, html, navegadorDePrueba } from './dom-globo.ts';
import { conMedidasNacionales } from './globo-nacionales.js';

const MUESTRA = JSON.parse(readFileSync(new URL('../fixtures/datos-globales-muestra.json', import.meta.url), 'utf8'));
const FRONTERAS = readFileSync(new URL('../../web/recursos/globo/fronteras.json', import.meta.url));
const PUBLICADOS = JSON.parse(readFileSync(new URL('../../web/datos/datos-globales.json', import.meta.url), 'utf8'));
/** Los países de la muestra con algún dato, los que ofrece el selector (Estados Unidos, sin valores, no está). */
const PAISES_DE_LA_MUESTRA_CON_DATOS = Object.freeze(['DEU', 'ES51', 'ESP', 'FRA', 'ITA']);
/** La chincheta en su cuadro de 30: la punta a 29 y el centro de la cabeza a 12. */
const LADO_DE_LA_CHINCHETA = 30;
const PUNTA_DE_LA_CHINCHETA = 29;
const CABEZA_DE_LA_CHINCHETA = 12;
/** Los bytes de un píxel RGBA. */
const BYTES_DE_UN_PIXEL = 4;
/** El acercamiento tras un paso de «Acercar». */
const ZOOM_TRAS_ACERCAR = ZOOM.minimo * ZOOM.paso;
/** Los mandos del anillo: cuatro giros y «Volver a mi país» en el centro. */
const MANDOS_DEL_ANILLO = 5;
/** Colores de ejemplo para el globo: a estas pruebas, que no dibujan, no les importa cuáles son. */
/** @type {Record<string, string>} */
const TOKENS = {
  '--globo-espacio': '#05080f',
  '--globo-mar': '#0b2a4a',
  '--globo-frontera': '#f2f1ef',
  '--globo-resalte': '#ffc93c',
  '--globo-resalte-filete': '#14202b',
  '--globo-estrella': '#e6ecf5',
  '--globo-marca': '#fff',
  '--globo-marca-filete': '#14202b',
};

/** Los nodos creados en el documento de prueba, para la consulta de lo que se traduce. */
const nodos = new Set();
/** Un nodo del documento de prueba. @param {string} etiqueta */
function crearNodo(etiqueta) {
  // El DOM de prueba no tiene estilos: las barras de los gráficos ponen su largo con style.setProperty.
  const nodo = Object.assign(new ElementoDePrueba(etiqueta), {
    style: {
      propiedades: new Map(),
      setProperty(/** @type {string} */ nombre, /** @type {string} */ valor) {
        this.propiedades.set(nombre, valor);
      },
    },
  });
  nodos.add(nodo);
  return nodo;
}
// Cada prueba ve solo los nodos que crea ella.
beforeEach(() => nodos.clear());
// El navegador de mentira lo comparten todas las pruebas de este archivo (los módulos del globo se importan una vez,
// con él puesto); al terminar el archivo, todo vuelve a como estaba, también el lienzo del elemento de prueba.
navegadorDePrueba(
  { after },
  {
    HTMLElement: ElementoDePrueba,
    document: {
      documentElement: Object.assign(crearNodo('html'), { lang: 'es', dataset: { idioma: 'es' } }),
      createElement: crearNodo,
      // La línea de evolución y la flecha del selector son SVG: en el DOM de prueba, un elemento más.
      createElementNS: (/** @type {string} */ _espacio, /** @type {string} */ etiqueta) => crearNodo(etiqueta),
      activeElement: null,
      createTextNode: (/** @type {string} */ texto) => Object.assign(crearNodo('#text'), { texto }),
      getElementById: () => null,
      querySelector: () => null,
      // Solo sirve al traductor de textos (idioma.js): ignora el selector y da los nodos con datos de traducción.
      querySelectorAll: () =>
        [...nodos].filter((nodo) => nodo.dataset.texto || 'dato' in nodo.dataset || nodo.atributos.size),
    },
    window: { devicePixelRatio: 1 },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    getComputedStyle: () => ({ getPropertyValue: (/** @type {string} */ variable) => TOKENS[variable] ?? '' }),
  },
);
// Un lienzo de prueba no ofrece WebGL: el globo no se dibuja y lo dice.
ElementoDePrueba.prototype.getContext = () => null;
after(() => {
  Reflect.deleteProperty(ElementoDePrueba.prototype, 'getContext');
});

// Instrumentación de lectura: solo observa la cuenta del Set privado de la implementación real de idioma.
const idiomaURL = new URL('../../web/scripts/idioma.js', import.meta.url).href;
const gancho = registerHooks({
  load(url, contexto, siguiente) {
    const cargado = siguiente(url, contexto);
    if (url !== idiomaURL) {
      return cargado;
    }
    return {
      ...cargado,
      source: `${String(cargado.source)}\nexport const cantidadGloboPrueba = () => alCambiar.size;\n`,
    };
  },
});
const moduloIdioma = await import('../../web/scripts/idioma.js');
const { iniciarIdioma, cambiarIdioma } = moduloIdioma;
const cuentaIdioma = /** @type {{cantidadGloboPrueba:()=>number}} */ (/** @type {unknown} */ (moduloIdioma));
after(() => gancho.deregister());
const { abrirGlobo } = await import('../../web/scripts/globo/globo.js');
const { DatosGlobalesNoValidos } = await import('../../web/scripts/datos-globales/datos.js');
await iniciarIdioma();

/** Los elementos de `raiz` con una clase. */
/** @param {ElementoDePrueba} raiz @param {string} clase */
function conClase(raiz, clase) {
  return raiz.descendientes().filter((nodo) => nodo.clases?.has(clase));
}
/** El único elemento de `raiz` con una clase. */
/** @param {ElementoDePrueba} raiz @param {string} clase */
function unico(raiz, clase) {
  const encontrados = conClase(raiz, clase);
  assert.equal(encontrados.length, 1, `.${clase}`);
  const encontrado = encontrados[0];
  assert.ok(encontrado);
  return encontrado;
}
/** Las opciones del selector que quedan a la vista, por su código. */
/** @param {ElementoDePrueba} raiz */
function aLaVista(raiz) {
  return conClase(raiz, 'globo-selector-opcion')
    .filter((opcion) => !opcion.hidden)
    .map((opcion) => opcion.dataset.territorio);
}
/** Medidas de mentira, en píxeles, para probar el desplazamiento de la lista (el DOM de prueba no maqueta). */
const altoDeLaLista = 100;
const altoDeUnaOpcion = 40;
/** Todos los territorios de la muestra, en el orden de la lista: Cataluña, en su sitio alfabético. */
const TODOS = ['DEU', 'ES51', 'ESP', 'FRA', 'ITA'];
/** Las opciones señaladas con el teclado, por su código. */
/** @param {ElementoDePrueba} raiz */
function activas(raiz) {
  return conClase(raiz, 'globo-selector-opcion')
    .filter((opcion) => opcion.getAttribute('data-activa') === 'true')
    .map((opcion) => opcion.dataset.territorio);
}
/** Las opciones del país elegido (aria-selected), por su código. */
/** @param {ElementoDePrueba} raiz */
function elegidas(raiz) {
  return conClase(raiz, 'globo-selector-opcion')
    .filter((opcion) => opcion.getAttribute('aria-selected') === 'true')
    .map((opcion) => opcion.dataset.territorio);
}
/** Una pulsación de tecla en un elemento; devuelve si se evitó lo que haría el navegador. */
/** @param {ElementoDePrueba} elemento @param {string} key @param {Record<string,unknown>} [extra] */
async function pulsar(elemento, key, extra = {}) {
  let evitado = false;
  await elemento.emitir('keydown', {
    key,
    ...extra,
    preventDefault: () => {
      evitado = true;
    },
    stopPropagation() {},
  });
  return evitado;
}
/** Escribe en el campo del selector, como la persona: cambia el valor y avisa con «input». */
/** @param {ElementoDePrueba} contenedor @param {string} texto */
async function escribirEn(contenedor, texto) {
  const campo = unico(contenedor, 'globo-selector').querySelector('input');
  assert.ok(campo);
  campo.value = texto;
  await campo.emitir('input');
  return campo;
}

/**
 * Abre el globo con la muestra, sin red de verdad: las fronteras salen del archivo publicado ('bien'), el archivo no
 * existe ('sin-archivo') o no hay red ('sin-red').
 */
/** @param {import('node:test').TestContext} contexto @param {{fronteras?:string,datos?:unknown}} [opciones] */
async function abrir(contexto, { fronteras = 'bien', datos = MUESTRA } = {}) {
  /** @type {string[]} */
  const avisos = [];
  contexto.mock.method(console, 'warn', (/** @type {unknown[]} */ ...partes) => avisos.push(partes.join(' ')));
  const fetch = async () => {
    if (fronteras === 'sin-red') {
      throw new TypeError('Failed to fetch');
    }
    return fronteras === 'bien' ? new Response(FRONTERAS) : new Response('', { status: 404 });
  };
  navegadorDePrueba(contexto, { fetch });
  const contenedor = new ElementoDePrueba('div');
  const globo = await abrirGlobo(html(contenedor), datos, { nivel: 2 });
  const campo = unico(contenedor, 'globo-selector').querySelector('input');
  assert.ok(campo);
  contexto.after(globo.cerrar);
  return { contenedor, globo, avisos, campo };
}

test('al abrir, España está elegida, escrita en el campo y anunciada, sin cuentas de indicadores', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto);
  assert.equal(unico(contenedor, 'globo-ficha-titulo').textContent, 'España');
  assert.equal(campo.value, 'España');
  assert.equal(unico(contenedor, 'globo-estado').textContent, 'Ficha del país: España.');
  assert.equal(unico(contenedor, 'globo-estado').clases.has('solo-lectores'), true);
  assert.doesNotMatch(contenedor.textContent, /indicador/);
  const lienzo = unico(contenedor, 'globo-lienzo');
  assert.equal(lienzo.getAttribute('role'), 'img');
  const descripcion = lienzo.getAttribute('aria-label');
  assert.ok(descripcion);
  assert.match(descripcion, /Territorio elegido: España\.$/);
});

test('el campo es un combobox de WAI-ARIA 1.2 con su lista; cada opción lleva su bandera si Faro la tiene', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto);
  const lista = unico(contenedor, 'globo-selector-lista');
  assert.deepEqual(
    ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls'].map((nombre) => campo.getAttribute(nombre)),
    ['combobox', 'list', 'false', lista.id],
  );
  assert.equal(lista.getAttribute('role'), 'listbox');
  assert.equal(lista.hidden, true);
  assert.equal(lista.tabIndex, -1, 'la lista con scroll no recibe el foco con Tab: Tab sale del campo');
  const etiqueta = unico(contenedor, 'globo-selector').querySelector('label');
  assert.ok(etiqueta);
  assert.equal(etiqueta.htmlFor, campo.id);
  assert.equal(etiqueta.textContent, 'Escribe o elige tu país');
  assert.equal(unico(contenedor, 'globo-selector-abrir').tabIndex, -1);
  const opciones = conClase(contenedor, 'globo-selector-opcion');
  assert.deepEqual(
    opciones.map((opcion) => [opcion.getAttribute('role'), opcion.textContent]),
    [
      ['option', 'Alemania'],
      ['option', 'Cataluña (región de España)'],
      ['option', 'España'],
      ['option', 'Francia'],
      ['option', 'Italia'],
    ],
  );
  const primera = opciones[0];
  assert.ok(primera);
  const bandera = primera.querySelector('img');
  assert.ok(bandera);
  assert.match(bandera.src, /bandera-alemania\.svg$/);
  assert.equal(bandera.alt, '');
});

test('escribir no oculta ningún país: la lista sigue entera y señala la primera coincidencia, sin tildes ni mayúsculas', async (contexto) => {
  const { contenedor } = await abrir(contexto);
  const campo = await escribirEn(contenedor, 'FRAN');
  assert.equal(campo.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(aLaVista(contenedor), TODOS, 'todos los territorios, aunque solo uno coincida');
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-FRA');
  assert.deepEqual(activas(contenedor), ['FRA']);
  assert.equal(unico(contenedor, 'globo-selector-lista').hidden, false);
  assert.equal(unico(contenedor, 'globo-selector-ninguno').hidden, true);
  assert.equal(await pulsar(campo, 'ArrowDown'), true);
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-ITA', 'las flechas recorren la lista entera');
  assert.equal(await pulsar(campo, 'ArrowUp'), true);
  assert.equal(await pulsar(campo, 'ArrowUp'), true);
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-ESP');
  assert.deepEqual(activas(contenedor), ['ESP'], 'una sola opción activa a la vez');
  await pulsar(campo, 'ArrowDown');
  assert.equal(await pulsar(campo, 'Enter'), true);
  const titulo = unico(contenedor, 'globo-ficha-titulo');
  assert.equal(titulo.textContent, 'Francia');
  assert.equal(titulo.focos, 0, 'el foco se queda en el campo');
  assert.equal(campo.value, 'Francia');
  assert.equal(campo.getAttribute('aria-expanded'), 'false');
  assert.equal(campo.hasAttribute('aria-activedescendant'), false);
  assert.deepEqual(elegidas(contenedor), ['FRA']);
  assert.equal(unico(contenedor, 'globo-estado').textContent, 'Ficha del país: Francia.');
});

test('sin coincidencia no se señala nada, la lista sigue entera, se avisa y Intro no elige', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto);
  await escribirEn(contenedor, 'peru');
  assert.deepEqual(aLaVista(contenedor), TODOS, 'la lista no se vacía');
  assert.equal(unico(contenedor, 'globo-selector-lista').hidden, false);
  assert.equal(campo.hasAttribute('aria-activedescendant'), false);
  assert.deepEqual(activas(contenedor), []);
  const aviso = unico(contenedor, 'globo-selector-ninguno');
  assert.equal(aviso.hidden, false);
  assert.equal(campo.getAttribute('aria-describedby'), aviso.id, 'el aviso describe al campo');
  assert.equal(unico(contenedor, 'globo-estado').textContent, 'Ningún país con datos se llama así.');
  assert.equal(await pulsar(campo, 'Enter'), false, 'sin opción activa, Intro no elige nada');
  assert.equal(unico(contenedor, 'globo-ficha-titulo').textContent, 'España');
  await escribirEn(contenedor, 'ital');
  assert.equal(aviso.hidden, true, 'el aviso desaparece en cuanto hay coincidencia');
  assert.equal(campo.hasAttribute('aria-describedby'), false);
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-ITA');
});

test('al abrir con un país elegido se ven todos, con el elegido marcado; Alt+flecha abajo solo abre', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto);
  assert.deepEqual(elegidas(contenedor), ['ESP'], 'el elegido está marcado también con la lista cerrada');
  assert.equal(await pulsar(campo, 'ArrowDown', { altKey: true }), true);
  assert.equal(unico(contenedor, 'globo-selector-lista').hidden, false);
  assert.deepEqual(aLaVista(contenedor), TODOS, 'con el elegido escrito, la lista entera');
  assert.deepEqual(elegidas(contenedor), ['ESP']);
  assert.equal(campo.hasAttribute('aria-activedescendant'), false);
  await pulsar(campo, 'Escape');
  assert.equal(campo.value, 'España', 'Escape cierra sin tocar el campo ni la elección');
  await pulsar(campo, 'ArrowDown');
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-ESP', 'las flechas abren en el elegido');
  await pulsar(campo, 'Escape');
  await pulsar(campo, 'Escape');
  assert.equal(campo.value, '');
  assert.deepEqual(elegidas(contenedor), ['ESP'], 'vaciar el campo no cambia el país elegido');
  await pulsar(campo, 'ArrowDown');
  assert.deepEqual(aLaVista(contenedor), TODOS);
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-ESP');
  await pulsar(campo, 'ArrowDown');
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-FRA');
  await pulsar(campo, 'ArrowUp');
  await pulsar(campo, 'ArrowUp');
  await pulsar(campo, 'ArrowUp');
  await pulsar(campo, 'ArrowUp');
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-DEU', 'sin dar la vuelta');
});

test('escribir «Alemania» la señala sin ocultar los demás; elegida y vuelta a abrir, se ven todos con ella marcada', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto, { datos: PUBLICADOS });
  const todos = paisesConIa(leerDatosGlobales(PUBLICADOS)).length;
  await escribirEn(contenedor, 'Alemania');
  assert.equal(aLaVista(contenedor).length, todos);
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-DEU', 'la coincidencia, señalada');
  await escribirEn(contenedor, 'al');
  assert.equal(aLaVista(contenedor).length, todos);
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-ALB', 'por inicio de palabra, la primera');
  await escribirEn(contenedor, 'mania');
  assert.equal(aLaVista(contenedor).length, todos);
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-DEU', 'sin inicio de palabra, por contenido');
  await escribirEn(contenedor, 'ESLOVENIA');
  assert.equal(await pulsar(campo, 'Enter'), true);
  assert.equal(unico(contenedor, 'globo-ficha-titulo').textContent, 'Eslovenia');
  assert.equal(campo.value, 'Eslovenia');
  await unico(contenedor, 'globo-selector-abrir').click();
  assert.equal(aLaVista(contenedor).length, todos, 'el botón, con el elegido escrito, abre la lista entera');
  assert.deepEqual(elegidas(contenedor), ['SVN']);
  await escribirEn(contenedor, 'Eslovenia');
  assert.equal(aLaVista(contenedor).length, todos);
  assert.equal(campo.getAttribute('aria-activedescendant'), 'globo-pais-SVN');
  await escribirEn(contenedor, '');
  assert.equal(aLaVista(contenedor).length, todos, 'con el campo vacío, la lista entera');
  assert.equal(campo.hasAttribute('aria-activedescendant'), false);
  assert.deepEqual(elegidas(contenedor), ['SVN']);
});

test('la lista se desplaza dentro de sí misma, de golpe, hasta la coincidencia y hasta el país elegido', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto);
  const lista = unico(contenedor, 'globo-selector-lista');
  lista.clientHeight = altoDeLaLista;
  /** Elegir un país vuelve a crear las opciones: se miden de nuevo, una detrás de otra. */
  const medir = () => {
    const opciones = conClase(contenedor, 'globo-selector-opcion');
    for (const [indice, opcion] of opciones.entries()) {
      opcion.offsetTop = indice * altoDeUnaOpcion;
      opcion.offsetHeight = altoDeUnaOpcion;
    }
    return (/** @type {string} */ codigo) =>
      opciones.find((opcion) => opcion.dataset.territorio === codigo)?.offsetTop ?? 0;
  };
  const sobrante = altoDeLaLista - altoDeUnaOpcion;
  let arribaDe = medir();
  await escribirEn(contenedor, 'ita');
  assert.equal(lista.scrollTop, arribaDe('ITA'), 'la coincidencia, arriba de la lista');
  await pulsar(campo, 'ArrowUp');
  assert.equal(lista.scrollTop, arribaDe('FRA'), 'subir a una opción que queda por encima la deja a la vista');
  await pulsar(campo, 'Escape');
  await pulsar(campo, 'Escape');
  lista.scrollTop = 0;
  await unico(contenedor, 'globo-selector-abrir').click();
  assert.equal(lista.scrollTop, arribaDe('ESP') - sobrante / 2, 'el elegido, en el centro de la lista');
  await pulsar(campo, 'Escape');
  await escribirEn(contenedor, 'ital');
  await pulsar(campo, 'Enter');
  assert.equal(campo.value, 'Italia');
  arribaDe = medir();
  lista.scrollTop = 0;
  await unico(contenedor, 'globo-selector-abrir').click();
  assert.equal(lista.scrollTop, arribaDe('ITA') - sobrante / 2, 'con su nombre escrito, también en el centro');
});

test('Escape cierra la lista; con la lista cerrada vacía el campo; vacío, no hace nada', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto);
  await escribirEn(contenedor, 'ita');
  assert.equal(await pulsar(campo, 'Escape'), true);
  assert.equal(campo.getAttribute('aria-expanded'), 'false');
  assert.equal(campo.value, 'ita');
  assert.equal(await pulsar(campo, 'Escape'), true);
  assert.equal(campo.value, '');
  assert.equal(await pulsar(campo, 'Escape'), false);
  assert.equal(unico(contenedor, 'globo-ficha-titulo').textContent, 'España', 'la ficha no cambia');
});

test('pulsar una opción la elige; el botón de la flecha abre la lista y devuelve el foco al campo', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto);
  await unico(contenedor, 'globo-selector-abrir').click();
  assert.equal(campo.getAttribute('aria-expanded'), 'true');
  assert.equal(campo.focos, 1);
  const italia = conClase(contenedor, 'globo-selector-opcion').find((opcion) => opcion.dataset.territorio === 'ITA');
  assert.ok(italia);
  await unico(contenedor, 'globo-selector-lista').emitir('click', { target: italia.querySelector('span') });
  assert.equal(unico(contenedor, 'globo-ficha-titulo').textContent, 'Italia');
  assert.equal(campo.value, 'Italia');
});

test('la ficha empieza por «La IA en…», con frases «De cada 100…», su cifra y la fuente con su tabla, como en «Cataluña»', async (contexto) => {
  const { contenedor } = await abrir(contexto);
  assert.equal(unico(contenedor, 'globo-ficha-apartado').textContent, 'La IA en España');
  const datos = conClase(contenedor, 'globo-dato');
  assert.deepEqual(
    datos.map((dato) => unico(dato, 'globo-dato-titulo').textContent),
    ['Empresas que usan IA', 'Personas que usan IA generativa'],
  );
  const primero = datos[0];
  assert.ok(primero);
  assert.equal(
    unico(primero, 'dg-clave-texto').textContent,
    'De cada 100 empresas con 10 o más trabajadores, 20 usan IA (2025).',
  );
  assert.equal(unico(primero, 'dg-clave-cifra').getAttribute('aria-hidden'), 'true');
  for (const dato of datos) {
    // Cada gráfico es una figura del sistema de las otras páginas: título, año, dibujo y pie con la fuente y su tabla.
    const [figura] = conClase(dato, 'dg-figura');
    assert.ok(figura, 'una figura por tarjeta');
    assert.match(unico(figura, 'dg-figura-pie').textContent, /^Fuente: Eurostat \(isoc_[a-z_]+\)/u);
    assert.equal(conClase(dato, 'dg-grafico-fuente').length, 0, 'sin barras de fuente en el gráfico');
    assert.equal(dato.querySelector('a'), null, 'los enlaces y licencias, en créditos');
    assert.doesNotMatch(dato.textContent, /Medido|publicación original|2021/u, 'sin el año no comparable');
  }
  assert.match(
    unico(primero, 'dg-figura-sub').textContent,
    /^De 2023 a 2025/u,
    'la serie, desde el primer año comparable',
  );
});

test('solo salen los países con datos oficiales de la IA; uno solo con empleo, como Afganistán, no', async (contexto) => {
  const { contenedor } = await abrir(contexto, { datos: PUBLICADOS });
  const codigos = conClase(contenedor, 'globo-selector-opcion').map((opcion) => opcion.dataset.territorio);
  for (const codigo of ['ESP', 'USA', 'CHL', 'BRA', 'COL', 'URY', 'ISL', 'GBR', 'CHE', 'ISR', 'KOR']) {
    assert.ok(codigos.includes(codigo), codigo);
  }
  for (const codigo of ['AFG', 'EU27_2020']) {
    assert.equal(codigos.includes(codigo), false, codigo);
  }
  assert.ok(codigos.includes('ES51'), 'Cataluña, con su cifra de empresas');
  await escribirEn(contenedor, 'peru');
  assert.equal(unico(contenedor, 'globo-estado').textContent, 'Ningún país con datos se llama así.');
});

test('Cataluña: ficha de la región con su cifra de empresas y «Sin dato para Cataluña» en lo demás, nunca la de España', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto, { datos: PUBLICADOS });
  await escribirEn(contenedor, 'cataluña');
  await pulsar(campo, 'Enter');
  assert.equal(unico(contenedor, 'globo-ficha-titulo').textContent, 'Cataluña');
  assert.equal(unico(contenedor, 'globo-estado').textContent, 'Ficha de la región: Cataluña.');
  assert.match(unico(contenedor, 'globo-ficha-cabecera').textContent, /^Ficha de la región/);
  const tarjetas = conClase(contenedor, 'globo-dato');
  assert.deepEqual(
    tarjetas.map((tarjeta) => unico(tarjeta, 'globo-dato-titulo').textContent),
    ['Empresas que usan IA', 'Sin dato para Cataluña'],
  );
  const [empresas, sinDato] = tarjetas;
  assert.ok(empresas && sinDato);
  assert.equal(
    unico(empresas, 'dg-clave-texto').textContent,
    'De cada 100 empresas con 10 o más trabajadores, 24 usan IA (2025).',
  );
  assert.deepEqual(
    [...unico(sinDato, 'globo-sin-dato').children].map((punto) => punto.textContent),
    [
      'Personas que usan IA generativa',
      'Mujeres y hombres',
      'Según el tipo de trabajo',
      'Exposición a la IA generativa (calculada)',
      'Cómo se reparte el empleo',
    ],
  );
  assert.match(sinDato.textContent, /No se pone en su lugar la cifra de España/);
  assert.equal(conClase(contenedor, 'globo-empleo').length, 0, 'sin el empleo de España');
  assert.doesNotMatch(contenedor.textContent, /\b20 usan IA/, 'la cifra de empresas de España (20) no sale');
});

test('la exposición calculada va en su tarjeta, con su intervalo o con sus cotas y la parte sin asignar', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto, { datos: PUBLICADOS });
  await escribirEn(contenedor, 'Uruguay');
  await pulsar(campo, 'Enter');
  const [uruguay] = conClase(contenedor, 'globo-dato');
  assert.ok(uruguay);
  assert.equal(unico(uruguay, 'globo-dato-titulo').textContent, 'Exposición a la IA generativa (calculada)');
  assert.equal(
    unico(uruguay, 'dg-clave-texto').textContent,
    'De cada 100 personas ocupadas, 9 trabajan en ocupaciones con exposición alta a la IA generativa según el índice de la OIT (2023).',
  );
  assert.match(uruguay.textContent, /con un 95 % de confianza, está entre 9,1 y 9,9\./);
  assert.match(uruguay.textContent, /no es el uso de la IA ni una predicción/);
  await escribirEn(contenedor, 'Chile');
  await pulsar(campo, 'Enter');
  const [chile] = conClase(contenedor, 'globo-dato');
  assert.ok(chile);
  assert.equal(unico(chile, 'dg-clave-cifra').textContent, '2,5–3,3');
  assert.match(unico(chile, 'dg-clave-texto').textContent, /^De cada 100 personas ocupadas, entre 2,5 y 3,3 trabajan/);
  assert.equal(
    chile.textContent.match(/El 11,0 % del empleo no se puede asignar con exactitud/g)?.length,
    1,
    'una vez',
  );
  await escribirEn(contenedor, 'Brasil');
  await pulsar(campo, 'Enter');
  assert.equal(unico(contenedor, 'globo-ficha-titulo').textContent, 'Brasil');
  assert.equal(conClase(contenedor, 'globo-empleo').length, 0, 'la OIT no publica su empleo: sin ese apartado');
});

test('la medida nacional de las personas va en su tarjeta, aparte de las empresas, con su frase propia', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto, { datos: conMedidasNacionales() });
  await escribirEn(contenedor, 'corea');
  await pulsar(campo, 'Enter');
  const [corea] = conClase(contenedor, 'globo-dato');
  assert.ok(corea);
  assert.equal(
    unico(corea, 'globo-dato-titulo').textContent,
    'Personas que han usado IA generativa, según la estadística del país',
  );
  assert.equal(
    unico(corea, 'dg-clave-texto').textContent,
    'De cada 100 personas, 33 han usado alguna vez IA generativa según la encuesta nacional (2025).',
  );
  assert.match(corea.textContent, /Personas de 3 años o más que han usado alguna vez IA generativa/);
  await escribirEn(contenedor, 'islandia');
  await pulsar(campo, 'Enter');
  const [islandia] = conClase(contenedor, 'globo-dato');
  assert.ok(islandia);
  assert.equal(unico(islandia, 'globo-dato-titulo').textContent, 'Empresas que usan IA, según la estadística del país');
});

test('la primera tarjeta va junto al globo, las demás debajo y después el empleo, a la vista', async (contexto) => {
  const { contenedor } = await abrir(contexto, { datos: PUBLICADOS });
  const [arranque, resto] = conClase(contenedor, 'globo-ficha');
  assert.ok(arranque);
  assert.ok(resto);
  assert.equal(conClase(arranque, 'globo-dato').length, 1);
  assert.equal(resto.clases.has('globo-tarjetas'), true);
  assert.ok(conClase(resto, 'globo-dato').length > 1);
  const empleo = unico(resto, 'globo-empleo');
  assert.equal(empleo.tagName, 'SECTION');
  assert.equal(resto.children.at(-1), empleo, 'el empleo, después de los datos de la IA');
  assert.equal(unico(empleo, 'globo-ficha-apartado').textContent, 'Cómo se reparte el empleo');
  assert.equal(conClase(empleo, 'globo-dato').length, 2);
  assert.equal(conClase(contenedor, 'globo-ficha-sin-ia').length, 0);
});

test('Escape en la ficha devuelve el foco a lo que eligió el país; fuera de la ficha, no hace nada', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto);
  const raiz = unico(contenedor, 'globo');
  enfocar(unico(contenedor, 'globo-ficha-titulo'));
  assert.equal(await pulsar(raiz, 'Escape'), false, 'antes de elegir nada, no hay a quién volver');
  await escribirEn(contenedor, 'alem');
  await pulsar(campo, 'ArrowDown');
  await pulsar(campo, 'Enter');
  const focosAntes = campo.focos;
  enfocar(unico(contenedor, 'globo-ficha-titulo'));
  assert.equal(await pulsar(raiz, 'Escape'), true);
  assert.equal(campo.focos, focosAntes + 1);
  enfocar(null);
  assert.equal(await pulsar(raiz, 'Escape'), false);
});

test('con el foco en el globo, + y − lo acercan; con Ctrl o Cmd son el zoom del navegador y no se tocan', async (contexto) => {
  const { contenedor } = await abrir(contexto);
  const lienzo = unico(contenedor, 'globo-lienzo');
  assert.equal(await pulsar(lienzo, '+'), true);
  assert.equal(await pulsar(lienzo, '-'), true);
  assert.equal(await pulsar(lienzo, '+', { ctrlKey: true }), false);
  assert.equal(await pulsar(lienzo, '-', { metaKey: true }), false);
  assert.equal(await pulsar(lienzo, '=', { ctrlKey: true }), false);
});

test('sin WebGL, la escena se oculta, la página lo dice y el selector y la ficha siguen', async (contexto) => {
  const { contenedor, avisos } = await abrir(contexto);
  assert.equal(unico(contenedor, 'globo-escena').hidden, true);
  const aviso = unico(contenedor, 'globo-aviso');
  assert.equal(aviso.hidden, false);
  assert.match(aviso.textContent, /^Este navegador no puede dibujar el globo\./);
  assert.equal(avisos.length, 1);
  assert.deepEqual(
    conClase(contenedor, 'globo-selector-opcion').map((opcion) => opcion.dataset.territorio),
    PAISES_DE_LA_MUESTRA_CON_DATOS,
    'Estados Unidos, sin valores, no está',
  );
});

test('sin las fronteras, la página dice que el globo no ha cargado y el selector sigue', async (contexto) => {
  const { contenedor } = await abrir(contexto, { fronteras: 'sin-archivo' });
  assert.match(unico(contenedor, 'globo-aviso').textContent, /^No se ha podido cargar el globo\./);
  assert.equal(conClase(contenedor, 'globo-selector-opcion').length, PAISES_DE_LA_MUESTRA_CON_DATOS.length);
});

test('sin red y sin copia, la página dice que el globo no ha cargado y la ficha sigue', async (contexto) => {
  const { contenedor } = await abrir(contexto, { fronteras: 'sin-red' });
  assert.match(unico(contenedor, 'globo-aviso').textContent, /^No se ha podido cargar el globo\./);
  assert.equal(unico(contenedor, 'globo-ficha-titulo').textContent, 'España');
});

test('unos datos que no cumplen el contrato no pintan nada ni piden nada a la red', async (contexto) => {
  navegadorDePrueba(contexto, {
    fetch: () => assert.fail('con datos inválidos no se pide ni el archivo de fronteras'),
  });
  const contenedor = new ElementoDePrueba('div');
  await assert.rejects(abrirGlobo(html(contenedor), { ...MUESTRA, version: '9' }), DatosGlobalesNoValidos);
  assert.equal(contenedor.children.length, 0);
});

test('cerrar quita el globo de la página', async (contexto) => {
  const { contenedor, globo } = await abrir(contexto);
  globo.cerrar();
  assert.equal(contenedor.children.length, 0);
});

test('cerrar retira la escucha real de idioma, también con segundo cierre y cambio posterior', async (contexto) => {
  const antes = cuentaIdioma.cantidadGloboPrueba();
  const { contenedor, globo } = await abrir(contexto);
  assert.ok(cuentaIdioma.cantidadGloboPrueba() > antes);
  globo.cerrar();
  assert.equal(cuentaIdioma.cantidadGloboPrueba(), antes);
  globo.cerrar();
  assert.equal(cuentaIdioma.cantidadGloboPrueba(), antes);
  await cambiarIdioma('ca');
  assert.equal(contenedor.children.length, 0);
  await cambiarIdioma('es');
});

test('reemplazar la ficha retira el gráfico anterior y cerrar deja cero suscripciones', async (contexto) => {
  assert.equal(cuentaIdioma.cantidadGloboPrueba(), 0);
  const { contenedor, campo, globo } = await abrir(contexto);
  const cantidad = cuentaIdioma.cantidadGloboPrueba();
  const anteriores = contenedor.descendientes().filter((nodo) => nodo.tagName === 'SVG');
  const cambios = anteriores.map((nodo) => contexto.mock.method(nodo, 'replaceWith'));
  await escribirEn(contenedor, 'alem');
  await pulsar(campo, 'Enter');
  assert.equal(cuentaIdioma.cantidadGloboPrueba(), cantidad);
  await cambiarIdioma('ca');
  assert.ok(
    cambios.every((cambio) => cambio.mock.callCount() === 0),
    'ninguna notificación al gráfico retirado',
  );
  globo.cerrar();
  assert.equal(cuentaIdioma.cantidadGloboPrueba(), 0);
  const creados = nodos.size;
  await cambiarIdioma('es');
  assert.equal(nodos.size, creados, 'ningún dibujo ni ficha después de cerrar');
});

test('un error después de construir el gráfico retira su escucha de idioma', async (contexto) => {
  assert.equal(cuentaIdioma.cantidadGloboPrueba(), 0);
  const reemplazar = ElementoDePrueba.prototype.replaceChildren;
  const fallo = new Error('fallo al colocar la ficha');
  contexto.mock.method(
    ElementoDePrueba.prototype,
    'replaceChildren',
    /** @this {ElementoDePrueba} */
    function (/** @type {Parameters<ElementoDePrueba['replaceChildren']>} */ ...hijos) {
      if (this.clases.has('globo-ficha') && hijos.length) {
        throw fallo;
      }
      return reemplazar.apply(this, hijos);
    },
  );
  const contenedor = new ElementoDePrueba('div');
  await assert.rejects(abrirGlobo(html(contenedor), MUESTRA), (error) => error === fallo);
  assert.equal(cuentaIdioma.cantidadGloboPrueba(), 0);
  const creados = nodos.size;
  await cambiarIdioma('ca');
  assert.equal(nodos.size, creados, 'el gráfico fallido no recibe el cambio');
  await cambiarIdioma('es');
});

test('las instrucciones no se ven: describen el globo para los lectores de pantalla; los créditos están en Créditos', async (contexto) => {
  const { contenedor } = await abrir(contexto);
  const instrucciones = unico(contenedor, 'globo-instrucciones');
  assert.equal(instrucciones.clases.has('solo-lectores'), true);
  assert.equal(unico(contenedor, 'globo-lienzo').getAttribute('aria-describedby'), instrucciones.id);
  assert.match(instrucciones.textContent, /La del país elegido es amarilla y más grande\..*flechas, \+ y −\.$/);
  assert.equal(conClase(contenedor, 'globo-creditos').length, 0);
  assert.doesNotMatch(contenedor.textContent, /Blue Marble|Natural Earth/);
});

test('el mando redondo: cuatro giros y «Volver a mi país» en el anillo, el zoom aparte, con nombre en los dos idiomas', async (contexto) => {
  const { contenedor } = await abrir(contexto);
  const nombres = () => conClase(contenedor, 'globo-mando').map((boton) => boton.getAttribute('aria-label'));
  const anillo = unico(contenedor, 'globo-mandos-anillo');
  const zoom = unico(contenedor, 'globo-mandos-zoom');
  assert.equal(conClase(anillo, 'globo-mando').length, MANDOS_DEL_ANILLO);
  assert.equal(conClase(zoom, 'globo-mando').length, 2);
  assert.equal(unico(anillo, 'globo-mando--centrar').getAttribute('aria-label'), 'Volver a mi país');
  assert.deepEqual(nombres(), [
    'Girar hacia arriba',
    'Girar a la izquierda',
    'Volver a mi país',
    'Girar a la derecha',
    'Girar hacia abajo',
    'Acercar',
    'Alejar',
  ]);
  await cambiarIdioma('ca');
  assert.deepEqual(nombres(), [
    'Girar cap amunt',
    'Girar cap a l’esquerra',
    'Tornar al meu país',
    'Girar cap a la dreta',
    'Girar cap avall',
    'Apropar',
    'Allunyar',
  ]);
  await cambiarIdioma('es');
});

/** Un dibujo 2D de prueba: anota el nombre de cada operación y da una imagen vacía del tamaño pedido. */
function dibujo2dDePrueba() {
  /** @type {string[]} */
  const operaciones = [];
  const dibujo = new Proxy(
    {
      createImageData: (/** @type {number} */ ancho, /** @type {number} */ alto) => ({
        data: new Uint8ClampedArray(ancho * alto * BYTES_DE_UN_PIXEL),
      }),
    },
    {
      get(objeto, clave) {
        if (clave in objeto) {
          return objeto[/** @type {'createImageData'} */ (clave)];
        }
        return (/** @type {unknown[]} */ ..._argumentos) => operaciones.push(String(clave));
      },
      set: () => true,
    },
  );
  return { dibujo, operaciones };
}

/**
 * Lo que necesita la prueba del mapa plano para pulsar la cabeza de una chincheta: el lienzo, con su caja y la captura
 * del puntero, el centro de cada territorio en las fronteras publicadas y `pulsarChincheta`, que pulsa la de `codigo`
 * con la vista centrada en `centro` y devuelve el título de la ficha.
 * @param {ElementoDePrueba} contenedor
 */
function pulsadorDeChinchetas(contenedor) {
  const lienzo = unico(contenedor, 'globo-lienzo');
  const [ancho, alto] = [lienzo.clientWidth, lienzo.clientHeight];
  Object.assign(lienzo, {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: ancho, height: alto }),
    setPointerCapture() {},
  });
  const fronteras = leerFronteras(JSON.parse(FRONTERAS.toString('utf8')));
  const centroDe = (/** @type {string} */ codigo) =>
    fronteras.territorios.find((territorio) => territorio.codigo === codigo)?.centro ?? { longitud: 0, latitud: 0 };
  const pulsarChincheta = async (
    /** @type {string} */ codigo,
    /** @type {{ longitud: number, latitud: number }} */ centro,
    zoom = 1,
  ) => {
    const vista = vistaPlana({ centro, zoom }, ancho, alto);
    const radio = radioPlano(ancho, alto, zoom);
    const { longitud, latitud } = centroDe(codigo);
    const { horizontal, vertical } = proyeccionPlana(ancho, alto).proyectar(vista, longitud, latitud);
    const subida = ((PUNTA_DE_LA_CHINCHETA - CABEZA_DE_LA_CHINCHETA) / LADO_DE_LA_CHINCHETA) * ALTO_PX;
    const puntero = {
      button: 0,
      pointerId: 1,
      clientX: ancho / 2 + horizontal * radio,
      clientY: alto / 2 - vertical * radio - subida,
    };
    await lienzo.emitir('pointerdown', puntero);
    await lienzo.emitir('pointerup', puntero);
    return unico(contenedor, 'globo-ficha-titulo').textContent;
  };
  return { pulsarChincheta, centroDe, lienzo };
}

test('sin WebGL se ve el mapa plano: dibuja, pulsar una chincheta elige, y el mando y el teclado lo mueven', async (contexto) => {
  const { dibujo, operaciones } = dibujo2dDePrueba();
  contexto.mock.method(ElementoDePrueba.prototype, 'getContext', (/** @type {string} */ tipo) =>
    tipo === '2d' ? dibujo : null,
  );
  contexto.mock.method(console, 'info', () => undefined);
  navegadorDePrueba(contexto, {
    requestAnimationFrame: (/** @type {(tiempo: number) => void} */ hacer) => {
      hacer(0);
      return 1;
    },
    Path2D: class {
      arc() {}
    },
  });
  const { contenedor, avisos } = await abrir(contexto);
  assert.equal(unico(contenedor, 'globo-escena').hidden, false);
  assert.equal(unico(contenedor, 'globo-aviso').hidden, true);
  const nota = unico(contenedor, 'globo-nota');
  assert.equal(nota.hidden, false);
  assert.equal(nota.textContent, 'Vista plana: este navegador no dibuja el globo en 3D.');
  assert.ok(operaciones.includes('fillRect') && operaciones.includes('stroke'), 'el mapa se ha dibujado');
  assert.ok(operaciones.filter((nombre) => nombre === 'fill').length >= PAISES_DE_LA_MUESTRA_CON_DATOS.length);
  const { pulsarChincheta, centroDe, lienzo } = pulsadorDeChinchetas(contenedor);
  assert.equal(await pulsarChincheta('ES51', centroDe('ESP')), 'Cataluña', 'pulsar su chincheta elige Cataluña');
  // El teclado desplaza el mapa: la chincheta de Francia está donde la deja la flecha.
  assert.equal(await pulsar(lienzo, 'ArrowRight'), true);
  const desplazado = { longitud: centroDe('ES51').longitud + PASO_DEL_GIRO, latitud: 0 };
  assert.equal(await pulsarChincheta('FRA', desplazado), 'Francia');
  // El mando gira y su centro vuelve al país elegido; el zoom acerca.
  await unico(contenedor, 'globo-mando--izquierda').click();
  await unico(contenedor, 'globo-mando--centrar').click();
  await unico(contenedor, 'globo-mando--acercar').click();
  // Al volver, la latitud del mapa sigue acotada a la del acercamiento mínimo (0°): solo cambia la longitud.
  const enFrancia = { longitud: centroDe('FRA').longitud, latitud: 0 };
  assert.equal(await pulsarChincheta('DEU', enFrancia, ZOOM_TRAS_ACERCAR), 'Alemania');
  assert.deepEqual(
    avisos.filter((aviso) => !/banderas no han llegado|imagen de la Tierra/.test(aviso)),
    [],
    'sin errores: solo faltan, en la prueba, la imagen y las banderas',
  );
});

test('los gráficos de la ficha son los de «Cataluña»: sin el año no comparable, pesas para mujeres y hombres, el país en gris', async (contexto) => {
  const { contenedor, campo } = await abrir(contexto, { datos: PUBLICADOS });
  await escribirEn(contenedor, 'alemania');
  await pulsar(campo, 'Enter');
  const [empresas, , genero] = conClase(contenedor, 'globo-dato');
  assert.ok(empresas && genero);
  assert.doesNotMatch(unico(empresas, 'dg-figura-sub').textContent, /2021/u);
  assert.match(
    unico(empresas, 'dg-figura-pie').textContent,
    /Sin dato comparable en 2021: la fuente lo marca como no comparable/u,
    'lo que no se muestra se dice',
  );
  const lineas = conClase(empresas, 'linea');
  assert.ok(
    lineas.length > 0 && lineas.every((linea) => linea.getAttribute('class')?.includes('c-resto')),
    'el país, en gris',
  );
  assert.equal(conClase(genero, 'punto').filter((punto) => punto.tagName === 'CIRCLE').length, 2, 'un círculo por uso');
  assert.equal(conClase(genero, 'punto').filter((punto) => punto.tagName === 'RECT').length, 2, 'y un cuadrado');
});
