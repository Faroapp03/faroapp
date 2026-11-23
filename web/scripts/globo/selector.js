// «Escribe o elige tu país»: un combobox con lista desplegable (WAI-ARIA 1.2, patrón «combobox» con «listbox»). La
// lista no se filtra nunca: ofrece siempre todos los países, de la A a la Z, y lo escrito solo la coloca. Al escribir,
// la lista se desplaza a la primera coincidencia (sin tildes ni mayúsculas: primero el nombre entero, luego una palabra
// que empieza por lo escrito y, si no, el nombre que lo contiene) y la señala como opción activa con
// aria-activedescendant, así que el foco no sale nunca del campo; si no hay coincidencia, no señala nada y lo dice.
// Por eso aria-autocomplete es «list» (se ofrece una lista de valores que completan lo escrito) y no «none»; no hay
// completado en línea («inline» ni «both»). El país elegido lleva aria-selected="true" y, al abrir la lista, queda a
// la vista; la opción activa, que puede ser otra, se distingue con data-activa. Teclado: flecha abajo y flecha arriba
// abren la lista y recorren las opciones, sin dar la vuelta (Alt + flecha abajo solo la abre), Intro elige la activa,
// Escape cierra la lista y, con la lista cerrada, vacía el campo, y Tab sale. El desplazamiento dentro de la lista es
// inmediato, sin animación. Cada opción lleva su bandera, en el formato del selector de idioma (banderas.js). Todo se
// crea con `crear` y se escribe con `escribir`: nada de HTML en cadenas. Una región (Cataluña) sale en su sitio
// alfabético, con una nota que dice de qué país es.

import { bandera } from '../datos-globales/graficos.js';
import { crear } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { textoBuscable } from '../texto-buscable.js';
import { conVersiones, idiomaActual, traducible } from '../textos.js';

/** Los ids del campo y de la lista, que se citan entre sí (aria-controls, for). */
const ID_DEL_CAMPO = 'globo-buscador';
const ID_DE_LA_LISTA = 'globo-paises';
const ID_DEL_AVISO = 'globo-paises-ninguno';
const SVG = 'http://www.w3.org/2000/svg';

/**
 * Las partes del selector y lo que necesita para funcionar.
 * @typedef {Object} Selector
 * @property {HTMLDivElement} raiz
 * @property {HTMLInputElement} campo
 * @property {HTMLButtonElement} boton abre y cierra la lista con el ratón; fuera del orden de tabulación (APG)
 * @property {HTMLUListElement} lista
 * @property {HTMLParagraphElement} ninguno lo que se ve si ningún país coincide con lo escrito; la lista sigue entera
 * @property {import('../datos-globales/datos.js').Territorio[]} territorios los países de la lista, ya ordenados
 * @property {import('../datos-globales/datos.js').Territorio | null} elegido
 * @property {HTMLLIElement | null} activa la opción señalada (aria-activedescendant), que puede no ser la elegida
 */

/** Una letra o una cifra: lo que no lo es (espacio, guion, apóstrofo, paréntesis) separa palabras. */
const LETRA_O_CIFRA = /[\p{L}\p{N}]/u;

/**
 * Si alguna palabra del nombre empieza por lo buscado (los dos ya sin tildes ni mayúsculas): «ale» encuentra
 * «Alemania» y «marfil», «Costa de Marfil», pero «mania» no encuentra «Alemania».
 * @param {string} nombre @param {string} buscado
 */
function empiezaUnaPalabra(nombre, buscado) {
  for (let i = nombre.indexOf(buscado); i !== -1; i = nombre.indexOf(buscado, i + 1)) {
    if (i === 0 || !LETRA_O_CIFRA.test(nombre.charAt(i - 1))) {
      return true;
    }
  }
  return false;
}

/** El nombre de un territorio en el idioma de la página. @param {import('../datos-globales/datos.js').Territorio} territorio */
function nombreEnLaPagina(territorio) {
  return territorio.nombre[idiomaActual()];
}

/** La flecha del botón, de adorno. */
function flecha() {
  const dibujo = document.createElementNS(SVG, 'svg');
  dibujo.setAttribute('viewBox', '0 0 16 16');
  dibujo.setAttribute('aria-hidden', 'true');
  dibujo.setAttribute('focusable', 'false');
  const trazo = document.createElementNS(SVG, 'path');
  trazo.setAttribute('d', 'm3 6 5 5 5-5');
  dibujo.append(trazo);
  return dibujo;
}

/** Las opciones de la lista, que son siempre todos los países. @param {Selector} selector @returns {HTMLLIElement[]} */
function opcionesDe({ lista }) {
  return /** @type {HTMLLIElement[]} */ ([...lista.children]);
}

/** La opción del país elegido, o null. @param {Selector} selector */
function opcionElegida(selector) {
  return opcionesDe(selector).find((opcion) => opcion.getAttribute('aria-selected') === 'true') ?? null;
}

/**
 * Desplaza la lista, dentro de sí misma y de golpe, hasta una opción: `inicio` la sube arriba, `centro` la pone en el
 * medio y `visible` solo se mueve lo justo para que se vea. La lista ha de estar abierta (cerrada no tiene medidas).
 * @param {Selector} selector @param {HTMLLIElement} opcion @param {'inicio' | 'centro' | 'visible'} modo
 */
function colocar({ lista }, opcion, modo) {
  const arriba = opcion.offsetTop;
  const abajo = arriba + opcion.offsetHeight;
  if (modo === 'inicio') {
    lista.scrollTop = arriba;
  } else if (modo === 'centro') {
    lista.scrollTop = arriba - (lista.clientHeight - opcion.offsetHeight) / 2;
  } else if (arriba < lista.scrollTop) {
    lista.scrollTop = arriba;
  } else if (abajo > lista.scrollTop + lista.clientHeight) {
    lista.scrollTop = abajo - lista.clientHeight;
  }
}

/**
 * Señala una opción (o ninguna) y la coloca a la vista dentro de la lista.
 * @param {Selector} selector @param {HTMLLIElement | null} opcion @param {'inicio' | 'centro' | 'visible'} [modo]
 */
function activar(selector, opcion, modo = 'visible') {
  if (selector.activa) {
    selector.activa.dataset.activa = 'false';
  }
  selector.activa = opcion;
  if (!opcion) {
    selector.campo.removeAttribute('aria-activedescendant');
    return;
  }
  opcion.dataset.activa = 'true';
  selector.campo.setAttribute('aria-activedescendant', opcion.id);
  colocar(selector, opcion, modo);
}

/** Abre o cierra la lista. @param {Selector} selector @param {boolean} abierta */
function mostrar(selector, abierta) {
  selector.lista.hidden = !abierta;
  selector.campo.setAttribute('aria-expanded', String(abierta));
  selector.boton.setAttribute('aria-expanded', String(abierta));
  if (!abierta) {
    activar(selector, null);
  }
}

/** Lo escrito en el campo, listo para comparar. @param {Selector} selector */
function buscadoEn({ campo }) {
  return textoBuscable(campo.value.trim());
}

/**
 * La primera opción que coincide con lo escrito: la del nombre entero o, si no hay, la primera con una palabra que
 * empieza por lo escrito o, si no, la primera que lo contiene; null sin nada escrito o sin coincidencia.
 * @param {Selector} selector @returns {HTMLLIElement | null}
 */
function primeraCoincidencia(selector) {
  const buscado = buscadoEn(selector);
  if (buscado === '') {
    return null;
  }
  const opciones = opcionesDe(selector);
  const nombre = (/** @type {HTMLLIElement} */ opcion) => opcion.dataset.busqueda ?? '';
  return (
    opciones.find((opcion) => nombre(opcion) === buscado) ??
    opciones.find((opcion) => empiezaUnaPalabra(nombre(opcion), buscado)) ??
    opciones.find((opcion) => nombre(opcion).includes(buscado)) ??
    null
  );
}

/** Enseña u oculta el aviso de «sin coincidencias» y lo une o no al campo. @param {Selector} selector @param {boolean} hay */
function avisarSinCoincidencias({ campo, ninguno }, hay) {
  ninguno.hidden = !hay;
  if (hay) {
    campo.setAttribute('aria-describedby', ninguno.id);
  } else {
    campo.removeAttribute('aria-describedby');
  }
}

/**
 * Con la lista abierta, la coloca donde toca: en la primera coincidencia con lo escrito (arriba) o, con el campo vacío,
 * en el país elegido o, si no hay, arriba del todo. El país elegido queda siempre en el medio, con sus vecinos. Avisa si lo escrito no coincide con nada. Devuelve la
 * opción a la que ha llegado, sin señalarla. @param {Selector} selector @returns {HTMLLIElement | null}
 */
function colocarLista(selector) {
  const escrito = buscadoEn(selector) !== '';
  const destino = escrito ? primeraCoincidencia(selector) : opcionElegida(selector);
  avisarSinCoincidencias(selector, escrito && !destino);
  if (destino) {
    colocar(selector, destino, destino === opcionElegida(selector) ? 'centro' : 'inicio');
  } else {
    selector.lista.scrollTop = 0;
  }
  return destino;
}

/**
 * Mueve la opción activa: `paso` 1 baja y −1 sube, sin dar la vuelta, desde la activa o, si no hay, desde el país
 * elegido; sin ninguna de las dos, a la primera o a la última. @param {Selector} selector @param {1 | -1} paso
 */
function mover(selector, paso) {
  const opciones = opcionesDe(selector);
  const desde = selector.activa ?? opcionElegida(selector);
  const actual = desde ? opciones.indexOf(desde) : -1;
  let siguiente = actual + paso;
  if (actual === -1) {
    siguiente = paso === 1 ? 0 : opciones.length - 1;
  }
  activar(selector, opciones[Math.min(opciones.length - 1, Math.max(0, siguiente))] ?? null);
}

/** Escribe en el campo el nombre del país elegido, o lo deja vacío. @param {Selector} selector */
function escribirElegido(selector) {
  selector.campo.value = selector.elegido ? nombreEnLaPagina(selector.elegido) : '';
}

// ---------- Lo público ----------

/**
 * Crea el selector, sin opciones (las pone `pintarOpciones`).
 * @returns {Selector}
 */
export function crearSelector() {
  const campo = crear('input', { type: 'text', id: ID_DEL_CAMPO, autocomplete: 'off', spellcheck: false });
  for (const [nombre, valor] of /** @type {const} */ ([
    ['role', 'combobox'],
    ['aria-autocomplete', 'list'],
    ['aria-expanded', 'false'],
    ['aria-controls', ID_DE_LA_LISTA],
    ['autocapitalize', 'off'],
  ])) {
    campo.setAttribute(nombre, valor);
  }
  const boton = crear('button', { type: 'button', className: 'globo-selector-abrir', tabIndex: -1 }, flecha());
  boton.setAttribute('aria-controls', ID_DE_LA_LISTA);
  boton.setAttribute('aria-expanded', 'false');
  escribirAtributo(boton, 'aria-label', traducible('globo.selector.abrir'));
  // tabIndex −1: una lista con scroll es enfocable con Tab en Chromium; el foco no debe entrar en ella (Tab sale del campo).
  const lista = crear('ul', { id: ID_DE_LA_LISTA, className: 'globo-selector-lista', hidden: true, tabIndex: -1 });
  lista.setAttribute('role', 'listbox');
  escribirAtributo(lista, 'aria-label', traducible('globo.selector.lista'));
  const ninguno = escribir(
    crear('p', { id: ID_DEL_AVISO, className: 'globo-selector-ninguno', hidden: true }),
    traducible('globo.selector.ninguno'),
  );
  const etiqueta = escribir(crear('label', { htmlFor: ID_DEL_CAMPO }), traducible('globo.buscar'));
  const raiz = crear(
    'div',
    { className: 'globo-selector' },
    etiqueta,
    crear(
      'div',
      { className: 'globo-selector-campo' },
      crear('div', { className: 'globo-selector-entrada' }, campo, boton),
      ninguno,
      lista,
    ),
  );
  return { raiz, campo, boton, lista, ninguno, territorios: [], elegido: null, activa: null };
}

/**
 * Pone las opciones (los países, ya ordenados) y escribe en el campo el elegido. Se llama al abrir y al cambiar de
 * idioma, para ordenar y nombrar en el idioma nuevo.
 * @param {Selector} selector @param {import('../datos-globales/datos.js').Territorio[]} territorios
 * @param {import('../datos-globales/datos.js').Territorio | null} elegido
 */
export function pintarOpciones(selector, territorios, elegido) {
  selector.territorios = territorios;
  selector.elegido = elegido;
  const opciones = territorios.map((territorio) => {
    const opcion = crear('li', { id: `globo-pais-${territorio.codigo}`, className: 'globo-selector-opcion' });
    opcion.setAttribute('role', 'option');
    opcion.setAttribute('aria-selected', String(territorio.codigo === elegido?.codigo));
    opcion.dataset.activa = 'false';
    opcion.dataset.territorio = territorio.codigo;
    opcion.dataset.busqueda = textoBuscable(nombreEnLaPagina(territorio));
    const imagen = bandera(territorio.codigo, { delJuego: true });
    const hueco = crear('span', { className: 'globo-selector-bandera' }, ...(imagen ? [imagen] : []));
    hueco.setAttribute('aria-hidden', 'true');
    const nombre = escribir(crear('span'), conVersiones(territorio.nombre));
    // Una región (Cataluña) dice de qué país es, en su sitio alfabético: «Cataluña (región de España)».
    const nota =
      territorio.tipo === 'region'
        ? escribir(crear('span', { className: 'globo-selector-nota' }), traducible('globo.selector.region'))
        : null;
    opcion.append(hueco, nota ? crear('span', {}, nombre, ' ', nota) : nombre);
    return opcion;
  });
  selector.lista.replaceChildren(...opciones);
  selector.activa = null;
  mostrar(selector, false);
  escribirElegido(selector);
  avisarSinCoincidencias(selector, false);
}

/**
 * Abre la lista, colocada en la primera coincidencia con lo escrito o en el país elegido (ver `colocarLista`), sin
 * señalar nada. Devuelve la opción a la que ha llegado. @param {Selector} selector @returns {HTMLLIElement | null}
 */
function abrir(selector) {
  mostrar(selector, true);
  return colocarLista(selector);
}

/**
 * Elige una opción: el país queda escrito en el campo, la lista se cierra y se avisa a quien escucha.
 * @param {Selector} selector @param {Element | null | undefined} opcion
 * @param {(territorio: import('../datos-globales/datos.js').Territorio) => void} alElegir
 */
function elegirOpcion(selector, opcion, alElegir) {
  const territorio = selector.territorios.find(
    ({ codigo }) => codigo === /** @type {HTMLElement | undefined} */ (opcion)?.dataset.territorio,
  );
  if (!territorio) {
    return;
  }
  selector.elegido = territorio;
  for (const una of opcionesDe(selector)) {
    una.setAttribute('aria-selected', String(una === opcion));
  }
  mostrar(selector, false);
  escribirElegido(selector);
  avisarSinCoincidencias(selector, false);
  alElegir(territorio);
}

/**
 * Flecha abajo o arriba: abre la lista si está cerrada y señala la opción a la que llega (la primera coincidencia con
 * lo escrito o el país elegido, si lo hay), y con la lista abierta recorre las opciones; con Alt, solo abre la lista.
 * @param {Selector} selector @param {KeyboardEvent} evento @returns {boolean} si la tecla se ha usado
 */
function alPulsarFlecha(selector, evento) {
  if (!selector.lista.hidden) {
    if (!evento.altKey) {
      mover(selector, evento.key === 'ArrowDown' ? 1 : -1);
    }
    return true;
  }
  const destino = abrir(selector);
  if (evento.altKey) {
    return true;
  }
  if (destino) {
    activar(selector, destino);
  } else {
    mover(selector, evento.key === 'ArrowDown' ? 1 : -1);
  }
  return true;
}

/**
 * Intro: con la lista abierta, elige la opción activa; sin ella, no hace nada.
 * @param {Selector} selector @param {KeyboardEvent} _evento @param {Parameters<typeof elegirOpcion>[2]} alElegir
 * @returns {boolean} si la tecla se ha usado
 */
function alPulsarIntro(selector, _evento, alElegir) {
  if (selector.lista.hidden || !selector.activa) {
    return false;
  }
  elegirOpcion(selector, selector.activa, alElegir);
  return true;
}

/**
 * Escape: cierra la lista; con la lista cerrada, vacía el campo (patrón combobox de WAI-ARIA).
 * @param {Selector} selector @returns {boolean} si la tecla se ha usado
 */
function alPulsarEscape(selector) {
  if (!selector.lista.hidden) {
    mostrar(selector, false);
  } else if (selector.campo.value !== '') {
    selector.campo.value = '';
    avisarSinCoincidencias(selector, false);
  } else {
    return false;
  }
  return true;
}

/** Las teclas que usa el campo; las demás (Inicio, Fin, el texto…) son del propio campo. */
const TECLAS = Object.freeze({
  ArrowDown: alPulsarFlecha,
  ArrowUp: alPulsarFlecha,
  Enter: alPulsarIntro,
  Escape: alPulsarEscape,
});

/**
 * Escucha el teclado, la escritura y el ratón. `alElegir` recibe el país elegido; `alNoHaber` se llama cuando lo
 * escrito no coincide con ningún país (para anunciarlo).
 * @param {Selector} selector
 * @param {{ alElegir: Parameters<typeof elegirOpcion>[2], alNoHaber: () => void }} acciones
 * @param {AbortSignal} signal
 */
export function escucharSelector(selector, { alElegir, alNoHaber }, signal) {
  const alEscribir = () => {
    mostrar(selector, true);
    const destino = colocarLista(selector);
    // Con el campo vacío la lista se queda en el país elegido, pero no se señala ninguna opción.
    activar(selector, buscadoEn(selector) === '' ? null : destino);
    if (!selector.ninguno.hidden) {
      alNoHaber();
    }
  };
  const alTeclear = (/** @type {KeyboardEvent} */ evento) => {
    const usar = Object.hasOwn(TECLAS, evento.key) ? TECLAS[/** @type {keyof typeof TECLAS} */ (evento.key)] : null;
    if (!usar?.(selector, evento, alElegir)) {
      return;
    }
    evento.preventDefault();
    evento.stopPropagation();
  };
  const alPulsarBoton = () => {
    if (selector.lista.hidden) {
      abrir(selector);
    } else {
      mostrar(selector, false);
    }
    selector.campo.focus();
  };
  selector.campo.addEventListener('input', alEscribir, { signal });
  selector.campo.addEventListener('keydown', alTeclear, { signal });
  selector.boton.addEventListener('click', alPulsarBoton, { signal });
  // Pulsar una opción no le quita el foco al campo: así se elige sin que la lista se cierre antes por perderlo.
  selector.lista.addEventListener('pointerdown', (evento) => evento.preventDefault(), { signal });
  selector.lista.addEventListener(
    'click',
    (evento) => elegirOpcion(selector, /** @type {Element} */ (evento.target).closest?.('li'), alElegir),
    { signal },
  );
  selector.raiz.addEventListener(
    'focusout',
    (evento) => {
      if (!selector.raiz.contains(/** @type {Node | null} */ (evento.relatedTarget))) {
        mostrar(selector, false);
      }
    },
    { signal },
  );
}
