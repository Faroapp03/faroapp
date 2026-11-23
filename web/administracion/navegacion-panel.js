// Navegación lateral del Panel de Control: grupos plegables, una sola selección y un apartado visible cada vez.
// El apartado sale del fragmento de la dirección (#fuentes): los enlaces del Inicio, atrás y adelante funcionan igual.
// En pantallas estrechas la lateral es un menú que se abre con el mismo botón y se cierra al elegir o con Escape.
// El buscador de la barra lleva a los mismos apartados por su nombre.
import { iniciarBuscador } from './buscador-panel.js';

const INICIO = 'inicio';
const ESTRECHA = '(max-width: 760px)';

/** @param {ParentNode} raiz @param {string} selector @returns {HTMLElement[]} */
const todos = (raiz, selector) => Array.from(raiz.querySelectorAll(selector));

/** @typedef {{doc:Document, ventana:Window, armazon:Element, nav:Element, plegar:HTMLElement}} Piezas */

/** @param {Element} nav @param {string} grupo @param {boolean} abierto */
function abrirGrupo(nav, grupo, abierto) {
  nav.querySelector(`button[data-grupo="${grupo}"]`)?.setAttribute('aria-expanded', String(abierto));
  const lista = /** @type {HTMLElement|null} */ (nav.querySelector(`[data-de="${grupo}"]`));
  if (lista) {
    lista.hidden = !abierto;
  }
}
/** @param {Piezas} piezas @param {boolean} abierta */
function ponerNavegacion({ armazon, plegar }, abierta) {
  armazon.setAttribute('data-navegacion', abierta ? 'abierta' : 'plegada');
  plegar.setAttribute('aria-expanded', String(abierta));
}
/** @param {Window} ventana */
const estrecha = (ventana) => ventana.matchMedia?.(ESTRECHA).matches === true;

/** Una sola selección: el enlace del apartado lleva aria-current y su grupo queda abierto. @param {Element} nav @param {string} elegido */
function marcarEnlaces(nav, elegido) {
  for (const enlace of todos(nav, 'a[data-ir]')) {
    if (enlace.getAttribute('data-ir') !== elegido) {
      enlace.removeAttribute('aria-current');
      continue;
    }
    enlace.setAttribute('aria-current', 'page');
    const grupo = enlace.closest('[data-de]')?.getAttribute('data-de');
    if (grupo) {
      abrirGrupo(nav, grupo, true);
    }
  }
}
/** @param {Piezas} piezas */
function crearSeleccion(piezas) {
  const { doc, ventana, nav } = piezas;
  const apartados = todos(doc, '[data-apartado]');
  const ids = new Set(apartados.map((a) => a.getAttribute('data-apartado')));
  let elegido = INICIO;
  /** Un fragmento que no es un apartado (el salto al contenido, por ejemplo) no cambia la selección. @param {boolean} enfocar */
  return function mostrar(enfocar) {
    // Los enlaces llevan al id de cada apartado («#apartado-fuentes»); también vale el nombre corto («#fuentes»).
    const pedido = ventana.location.hash.slice(1).replace(/^apartado-/, '');
    elegido = ids.has(pedido) ? pedido : elegido;
    for (const apartado of apartados) {
      apartado.hidden = apartado.getAttribute('data-apartado') !== elegido;
    }
    marcarEnlaces(nav, elegido);
    if (estrecha(ventana)) {
      ponerNavegacion(piezas, false);
    }
    if (enfocar) {
      /** @type {HTMLElement|null} */ (
        doc.querySelector(`[data-apartado="${elegido}"] .panel-apartado-titulo`)
      )?.focus();
    }
  };
}
/** @param {Piezas} piezas */
function escucharControles(piezas) {
  const { nav, plegar, armazon, ventana } = piezas;
  for (const boton of todos(nav, 'button[data-grupo]')) {
    boton.addEventListener('click', () => {
      abrirGrupo(nav, String(boton.getAttribute('data-grupo')), boton.getAttribute('aria-expanded') !== 'true');
    });
  }
  plegar.addEventListener('click', () =>
    ponerNavegacion(piezas, armazon.getAttribute('data-navegacion') !== 'abierta'),
  );
  nav.addEventListener('keydown', (evento) => {
    if (/** @type {KeyboardEvent} */ (evento).key === 'Escape' && estrecha(ventana)) {
      ponerNavegacion(piezas, false);
      plegar.focus();
    }
  });
}
/** @param {Document} doc @param {Window} ventana */
export function iniciarNavegacion(doc, ventana) {
  const armazon = doc.querySelector('[data-armazon]');
  const nav = doc.querySelector('#navegacion-panel');
  const plegar = /** @type {HTMLElement|null} */ (doc.querySelector('#plegar-navegacion'));
  if (!armazon || !nav || !plegar) {
    return null;
  }
  const piezas = { doc, ventana, armazon, nav, plegar };
  const mostrar = crearSeleccion(piezas);
  escucharControles(piezas);
  ventana.addEventListener('hashchange', () => mostrar(true));
  doc.addEventListener('panel:entrar', () => mostrar(true));
  ponerNavegacion(piezas, !estrecha(ventana));
  mostrar(false);
  enlazarOrdenes(doc);
  enlazarEnfoques(doc);
  const buscador = iniciarBuscador(doc, ventana);
  return { mostrar, buscador };
}

/**
 * Cada orden de la barra de un apartado pulsa el botón de su tarjeta y copia su estado: si la tarjeta no la permite
 * ahora, la orden tampoco. Así hay una sola lógica por acción y ninguna orden promete algo que no hará.
 * @param {Document} doc
 */
function enlazarOrdenes(doc) {
  for (const orden of todos(doc, 'button[data-orden]')) {
    const objetivo = doc.getElementById(String(orden.getAttribute('data-orden')));
    if (!(objetivo instanceof HTMLButtonElement)) {
      continue;
    }
    const copiar = () => {
      /** @type {HTMLButtonElement} */ (orden).disabled = objetivo.disabled || objetivo.hidden === true;
    };
    orden.addEventListener('click', () => objetivo.click());
    if (typeof MutationObserver === 'function') {
      new MutationObserver(copiar).observe(objetivo, { attributes: true, attributeFilter: ['disabled', 'hidden'] });
    }
    copiar();
  }
}
/**
 * Una orden que lleva al campo de su apartado (por ejemplo, «Añadir administrador» al correo del alta). El campo lo
 * pinta su vista cuando tiene datos: hasta que existe, la orden queda desactivada.
 * @param {Document} doc
 */
function enlazarEnfoques(doc) {
  for (const orden of todos(doc, 'button[data-enfocar]')) {
    const selector = String(orden.getAttribute('data-enfocar'));
    const apartado = orden.closest('[data-apartado]');
    const campo = () => /** @type {HTMLElement|null} */ (apartado?.querySelector(selector) ?? null);
    const copiar = () => {
      /** @type {HTMLButtonElement} */ (orden).disabled = campo() === null;
    };
    orden.addEventListener('click', () => campo()?.focus());
    if (apartado && typeof MutationObserver === 'function') {
      new MutationObserver(copiar).observe(apartado, { childList: true, subtree: true });
    }
    copiar();
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.querySelector?.('[data-armazon]')) {
  iniciarNavegacion(document, window);
}
