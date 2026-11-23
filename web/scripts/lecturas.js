// Los filtros y las páginas de la Biblioteca. El filtro es uno, el nivel (cada pestaña ya es un tipo: Guías, Informes o
// Notas): un desplegable que oculta las lecturas que no encajan. Es un botón (aria-expanded, aria-controls) que abre un
// panel con un grupo de botones de opción nativos, de selección única, y cada opción dice cuántas lecturas tiene el
// segmento que se ve. La elección vale para todos los segmentos de la página, que se leen como pestañas
// (scripts/etapas.js): al cambiar de segmento se conserva, y cada segmento dice cuántas de sus lecturas quedan, en su
// propia región de estado; un segmento sin ninguna sigue a la vista con su cuenta a cero. La barra repite, solo a la
// vista, el recuento del segmento que se ve y enseña «Quitar filtros» mientras haya alguna elección.
//
// Páginas: lo que deja ver el filtro en cada segmento se reparte en páginas de POR_PAGINA fichas como mucho, todas
// con el mismo número o una más en las primeras (`repartir`: nunca queda una ficha suelta), con una navegación al pie,
// centrada («1 2 3», cada número con su nombre «Página 2 de 3» y el actual con aria-current="page"), oculta si hay una
// sola página. Cambiar el filtro o de pestaña vuelve a la página 1. Pasar de página no toca la dirección ni la
// historia, ni mueve el foco, que se queda en el número pulsado: la vista solo se corrige lo justo para que la barra de
// números quede en el mismo sitio de la pantalla aunque la página nueva sea más corta, sin desplazamiento suave. El paso
// se anuncia («Página 2 de 3») en la región de estado del segmento. Una dirección con fragmento a algo de una ficha
// (#abre-…) abre la página de esa ficha. Las fichas de otras páginas llevan data-otra-pagina, que la hoja oculta solo en pantalla (al imprimir salen todas las del
// filtro).
//
// El HTML trae los filtros y la navegación de páginas ocultos y todas las lecturas a la vista, así que sin este script se
// lee todo.
//
// El enlace de una ficha con versión en catalán (data-enlace-ca) lleva a ella mientras la web está en catalán, también
// al cambiar de idioma sin recargar; en castellano, y sin este script, al original de siempre.
//
// Conducta de los desplegables: un solo panel abierto; Escape lo cierra y devuelve el foco al botón; un clic fuera, o
// salir con el tabulador, lo cierra; elegir con el ratón, el dedo o la barra espaciadora lo cierra y devuelve el foco al
// botón; las flechas cambian de opción sin cerrarlo (como en cualquier grupo de botones de opción) y Intro lo cierra.
// Importa sitio.js, que espera su intento de cargar el diccionario antes de que se inicien los filtros.

import {
  actualizarBoton,
  cerrar,
  conectarDesplegables,
  elegida,
  filtra,
  leerDesplegable,
  ponerCuentas,
} from './desplegable-con-recuento.js';
import { crear, PaginaIncompleta } from './dom.js';
import './sitio.js';
import { iniciarEnlacesBiblioteca } from './enlaces-biblioteca.js';
import { escribir, escribirAtributo } from './idioma.js';
import { marcarPasos, pasoDePagina } from './pasos-de-pagina.js';
import { traducible } from './textos.js';

/** El texto de la cuenta de cada segmento («Se muestran 5 de 12 lecturas.»), que anuncia su región de estado. */
const CLAVE_CUENTA = 'biblioteca.cuenta';
/** El nombre de cada página en su navegación: «Página {numero} de {total}». */
const CLAVE_PAGINA = 'biblioteca.pagina';
/**
 * Las fichas de cada página, como mucho: seis, repartidas por igual entre las páginas que hagan falta. Con las 25
 * lecturas de un segmento salen cinco páginas de cinco («1 2 3 4 5»); con las 8 o 9 de un nivel, dos de cuatro o de
 * cinco y cuatro; nunca queda una ficha suelta en una página. Se fijó con capturas a 1280 y a 390 px de ancho: cinco o
 * seis fichas son unas dos pantallas en el escritorio y unas tres o cuatro en el móvil.
 */
export const POR_PAGINA = 6;
/** La marca de las fichas de otra página (la hoja las oculta en pantalla). */
const OTRA_PAGINA = 'data-otra-pagina';
/** El recuento de la barra sin filtro que excluya nada («12 lecturas») y con él («5 de 12 lecturas»). */
const CLAVE_RECUENTO = 'biblioteca.recuento';
const CLAVE_RECUENTO_PARCIAL = 'biblioteca.recuento-parcial';
/** El valor de un grupo de filtros que no excluye nada. */
const TODO = 'todo';
/** La clase con que scripts/etapas.js marca el segmento que se ve. */
const CLASE_SEGMENTO_ACTUAL = 'etapa--actual';

/**
 * Un segmento con sus lecturas, su cuenta (su región de estado), la navegación de sus páginas (con su lista) y la página
 * que se ve, desde 0.
 * @typedef {{ bloque: HTMLElement, lecturas: HTMLElement[], cuenta: HTMLElement | null, paginas: HTMLElement | null,
 *   lista: HTMLElement | null, pagina: number }} Segmento
 */

/** @import { Desplegable } from './desplegable-con-recuento.js' */

/**
 * Los elementos que casan con el selector dentro de `raiz`, ya estrechados a HTMLElement.
 * @param {ParentNode} raiz @param {string} selector @returns {HTMLElement[]}
 */
function elementos(raiz, selector) {
  return [...raiz.querySelectorAll(selector)].filter((elemento) => elemento instanceof HTMLElement);
}

/**
 * La barra de filtros: sus desplegables, los segmentos, el recuento y «Quitar filtros»; `conFlechas` dice si el último
 * gesto sobre un panel abierto fue una flecha, con la que elegir no lo cierra, y `visible`, el segmento que se veía la
 * última vez que se miró (para volver a la página 1 al cambiar de pestaña).
 * @typedef {{ desplegables: Desplegable[], segmentos: Segmento[], recuento: HTMLElement, quitar: HTMLElement,
 *   conFlechas: boolean, visible: Segmento | null }} Barra
 */

/**
 * El reparto de `total` fichas en páginas de `porPagina` como mucho: las páginas que hagan falta y en cada una el mismo
 * número de fichas, o una más en las primeras (25 de 6 en 6: cinco páginas de 5; 14: 5, 5 y 4; 8: 4 y 4). Devuelve el
 * principio y el final (sin incluir) de cada página; sin fichas, una página vacía.
 * @param {number} total @param {number} [porPagina] @returns {[number, number][]}
 */
export function repartir(total, porPagina = POR_PAGINA) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const base = Math.floor(total / paginas);
  const conUnaMas = total % paginas;
  /** @type {[number, number][]} */
  const reparto = [];
  let desde = 0;
  for (let pagina = 0; pagina < paginas; pagina += 1) {
    const hasta = desde + base + (pagina < conUnaMas ? 1 : 0);
    reparto.push([desde, hasta]);
    desde = hasta;
  }
  return reparto;
}

/**
 * Si la lectura encaja con la elección de los desplegables, salvo la del que se nombra (para contar las opciones de ese
 * mismo desplegable: cada una cuenta lo que dejaría ver con la elección del otro).
 * @param {HTMLElement} lectura @param {Desplegable[]} desplegables @param {Desplegable | null} [salvo]
 */
function encaja(lectura, desplegables, salvo = null) {
  return desplegables.every((desplegable) => {
    const valor = elegida(desplegable)?.radio.value ?? TODO;
    return desplegable === salvo || valor === TODO || lectura.dataset[desplegable.filtro] === valor;
  });
}

/**
 * Pone o quita un atributo sin valor.
 * @param {HTMLElement} elemento @param {string} nombre @param {boolean} puesto
 */
function marcar(elemento, nombre, puesto) {
  if (puesto) {
    elemento.setAttribute(nombre, '');
  } else {
    elemento.removeAttribute(nombre);
  }
}

/**
 * Lee la barra de filtros del formulario.
 * @param {HTMLFormElement} formulario @returns {Barra}
 * @throws {PaginaIncompleta} Si falta algún desplegable, el recuento o «Quitar filtros».
 */
function leerBarra(formulario) {
  const desplegables = elementos(formulario, '[data-desplegable]').map(leerDesplegable);
  const [recuento] = elementos(formulario, '[data-recuento]');
  const [quitar] = elementos(formulario, '[data-quitar]');
  if (desplegables.length === 0 || !recuento || !quitar) {
    throw new PaginaIncompleta(
      'Los filtros de la Biblioteca necesitan sus desplegables, su recuento y «Quitar filtros»',
    );
  }
  const segmentos = elementos(document, '.lecturas-bloque').map((bloque) => {
    const [cuenta = null] = elementos(bloque, '[data-cuenta]');
    const [paginas = null] = elementos(bloque, '[data-paginas]');
    const [lista = null] = paginas ? elementos(paginas, 'ol') : [];
    return { bloque, lecturas: elementos(bloque, '[data-filtrable]'), cuenta, paginas, lista, pagina: 0 };
  });
  return { desplegables, segmentos, recuento, quitar, conFlechas: false, visible: null };
}

/** Escribe el valor elegido en cada botón y marca como activos los que filtran. @param {Barra} barra */
function actualizarBotones({ desplegables, quitar }) {
  for (const desplegable of desplegables) {
    actualizarBoton(desplegable);
  }
  quitar.hidden = !desplegables.some(filtra);
}

/**
 * Cuenta cada opción de un desplegable sobre las lecturas dadas, con la elección de los otros, y atenúa las que quedan
 * a cero (se pueden elegir igual).
 * @param {Desplegable} desplegable @param {Desplegable[]} desplegables @param {HTMLElement[]} lecturas
 */
function contarOpciones(desplegable, desplegables, lecturas) {
  const delResto = lecturas.filter((lectura) => encaja(lectura, desplegables, desplegable));
  const cuentas = new Map(
    desplegable.opciones.map(({ radio }) => [
      radio.value,
      delResto.filter((lectura) => radio.value === TODO || lectura.dataset[desplegable.filtro] === radio.value).length,
    ]),
  );
  ponerCuentas(desplegable, cuentas, (numero) => `(${numero})`);
}

/** El segmento que marca como visible el componente de pestañas, o null sin él. @param {Barra} barra */
function segmentoVisible({ segmentos }) {
  return segmentos.find(({ bloque }) => bloque.classList.contains(CLASE_SEGMENTO_ACTUAL)) ?? null;
}

/**
 * Cuenta las opciones de cada desplegable y escribe el recuento de la barra, sobre el segmento que se ve. Sin el
 * componente de pestañas (que marca con una clase el segmento que se ve) todos se ven seguidos, y cuenta con todos.
 * @param {Barra} barra
 */
function actualizarCuentas(barra) {
  const { desplegables, segmentos, recuento } = barra;
  const visible = segmentoVisible(barra);
  const lecturas = (visible ? [visible] : segmentos).flatMap((segmento) => segmento.lecturas);
  for (const desplegable of desplegables) {
    contarOpciones(desplegable, desplegables, lecturas);
  }
  const vistas = lecturas.filter((lectura) => !lectura.hidden).length;
  const total = lecturas.length;
  escribir(
    recuento,
    vistas === total ? traducible(CLAVE_RECUENTO, { total }) : traducible(CLAVE_RECUENTO_PARCIAL, { vistas, total }),
  );
}

/** Las lecturas de un segmento que deja ver el filtro, en su orden. @param {Segmento} segmento */
function filtradas({ lecturas }) {
  return lecturas.filter((lectura) => !lectura.hidden);
}

/**
 * El botón de una página: su número a la vista y su nombre («Página 2 de 3»); aria-current lo pone `marcarActual`.
 * @param {Segmento} segmento @param {number} pagina @param {number} total
 */
function botonDePagina(segmento, pagina, total) {
  const boton = crear('button', { type: 'button', className: 'lecturas-pagina', textContent: String(pagina + 1) });
  escribirAtributo(boton, 'aria-label', traducible(CLAVE_PAGINA, { numero: pagina + 1, total }));
  boton.addEventListener('click', () => irAPagina(segmento, pagina));
  return crear('li', {}, boton);
}

/**
 * Marca con aria-current el número de la página que se ve y desactiva «Anterior» o «Siguiente» en los extremos.
 * @param {Segmento} segmento
 */
function marcarActual({ lista, pagina }) {
  const numeros = lista ? elementos(lista, 'button.lecturas-pagina') : [];
  for (const [posicion, boton] of numeros.entries()) {
    if (posicion === pagina) {
      boton.setAttribute('aria-current', 'page');
    } else {
      boton.removeAttribute('aria-current');
    }
  }
  if (lista) {
    marcarPasos(lista, pagina, numeros.length, numeros[pagina] ?? null);
  }
}

/**
 * Deja a la vista solo las fichas filtradas de la página del segmento y pone al día su navegación, oculta si hay una
 * sola página. Si el número de páginas no cambia, los botones son los mismos (el foco sigue en el que se pulsó).
 * @param {Segmento} segmento
 */
function paginar(segmento) {
  const vistas = filtradas(segmento);
  const reparto = repartir(vistas.length);
  segmento.pagina = Math.min(Math.max(segmento.pagina, 0), reparto.length - 1);
  const [desde, hasta] = reparto[segmento.pagina] ?? [0, vistas.length];
  for (const lectura of segmento.lecturas) {
    marcar(lectura, OTRA_PAGINA, false);
  }
  for (const [posicion, lectura] of vistas.entries()) {
    marcar(lectura, OTRA_PAGINA, posicion < desde || posicion >= hasta);
  }
  const { paginas, lista } = segmento;
  if (!paginas || !lista) {
    return;
  }
  const botones = reparto.length < 2 ? 0 : reparto.length;
  paginas.hidden = botones === 0;
  if (elementos(lista, 'button.lecturas-pagina').length !== botones) {
    const numeros = reparto.slice(0, botones).map((_, pagina) => botonDePagina(segmento, pagina, botones));
    lista.replaceChildren(
      ...(botones
        ? [
            pasoDePagina('anterior', 'lecturas-paso', () => irAPagina(segmento, segmento.pagina - 1)),
            ...numeros,
            pasoDePagina('siguiente', 'lecturas-paso', () => irAPagina(segmento, segmento.pagina + 1)),
          ]
        : []),
    );
  }
  marcarActual(segmento);
}

/**
 * Pasa a otra página del segmento sin mover el foco (sigue en el número pulsado) ni la dirección: la vista solo se
 * corrige, de golpe, lo justo para que la barra de números quede donde estaba en la pantalla. El paso se anuncia en la
 * región de estado del segmento.
 * @param {Segmento} segmento @param {number} pagina
 */
function irAPagina(segmento, pagina) {
  const total = repartir(filtradas(segmento).length).length;
  if (pagina === segmento.pagina || pagina < 0 || pagina >= total) {
    return;
  }
  const { paginas, cuenta } = segmento;
  const antes = paginas?.getBoundingClientRect().top;
  segmento.pagina = pagina;
  paginar(segmento);
  const despues = paginas?.getBoundingClientRect().top;
  if (antes !== undefined && despues !== undefined && despues !== antes) {
    window.scrollBy({ top: despues - antes, behavior: 'instant' });
  }
  if (cuenta) {
    const total = repartir(filtradas(segmento).length).length;
    escribir(cuenta, traducible(CLAVE_PAGINA, { numero: pagina + 1, total }));
  }
}

/**
 * Si el fragmento de la dirección señala algo dentro de una ficha que está en otra página de su segmento, pasa a esa
 * página y lleva la vista hasta ello, como haría el enlace con la ficha a la vista.
 * @param {Barra} barra
 */
function seguirAlFragmento(barra) {
  const literal = location.hash.replace(/^#/, '');
  let descifrado = literal;
  try {
    descifrado = decodeURIComponent(literal);
  } catch {
    // Una secuencia %XX mal formada no descifra a nada: se busca el literal.
  }
  const destino = literal ? (document.getElementById(literal) ?? document.getElementById(descifrado)) : null;
  if (!destino) {
    return;
  }
  for (const segmento of barra.segmentos) {
    const posicion = filtradas(segmento).findIndex((lectura) => lectura.contains(destino));
    const pagina = repartir(filtradas(segmento).length).findIndex(([, hasta]) => posicion < hasta);
    if (posicion !== -1 && pagina !== segmento.pagina) {
      segmento.pagina = pagina;
      paginar(segmento);
      destino.scrollIntoView({ block: 'start' });
    }
  }
}

/**
 * Oculta las lecturas que no encajan, escribe la cuenta de cada segmento, vuelve a la página 1 y deja la barra al día.
 * @param {Barra} barra
 */
function aplicar(barra) {
  for (const segmento of barra.segmentos) {
    const { lecturas, cuenta } = segmento;
    for (const lectura of lecturas) {
      lectura.hidden = !encaja(lectura, barra.desplegables);
    }
    if (cuenta) {
      escribir(cuenta, traducible(CLAVE_CUENTA, { vistas: filtradas(segmento).length, total: lecturas.length }));
    }
    segmento.pagina = 0;
    paginar(segmento);
  }
  actualizarBotones(barra);
  actualizarCuentas(barra);
}

/**
 * Al cambiar de pestaña, cada segmento vuelve a su página 1 (salvo que la dirección lleve a una ficha de otra) y las
 * cuentas siguen al segmento que se ve.
 * @param {Barra} barra
 */
function alCambiarDeSegmento(barra) {
  const visible = segmentoVisible(barra);
  if (visible !== barra.visible) {
    barra.visible = visible;
    for (const segmento of barra.segmentos) {
      segmento.pagina = 0;
      paginar(segmento);
    }
    seguirAlFragmento(barra);
  }
  actualizarCuentas(barra);
}

/**
 * «Quitar filtros»: deja todo en «Todos» (y cada segmento en su página 1), cierra los paneles y lleva el foco al primer
 * desplegable.
 * @param {Barra} barra
 */
function quitarFiltros(barra) {
  for (const desplegable of barra.desplegables) {
    for (const { radio } of desplegable.opciones) {
      radio.checked = radio.value === TODO;
    }
    cerrar(barra, desplegable);
  }
  aplicar(barra);
  barra.desplegables[0]?.boton.focus();
}

/** Enseña los filtros de la página y aplica la elección a cada cambio. @param {HTMLFormElement} formulario */
function iniciarFiltros(formulario) {
  const barra = leerBarra(formulario);
  conectarDesplegables(barra, formulario, () => aplicar(barra));
  barra.quitar.addEventListener('click', () => quitarFiltros(barra));
  formulario.addEventListener('submit', (evento) => evento.preventDefault());
  // El componente de pestañas marca con una clase el segmento que se ve: al cambiar de segmento se vuelve a la página 1 y
  // se cuentan sus opciones.
  const cambioDeSegmento = new MutationObserver(() => alCambiarDeSegmento(barra));
  for (const { bloque } of barra.segmentos) {
    cambioDeSegmento.observe(bloque, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('hashchange', () => seguirAlFragmento(barra));
  formulario.hidden = false;
  barra.visible = segmentoVisible(barra);
  aplicar(barra);
  seguirAlFragmento(barra);
}

iniciarEnlacesBiblioteca();

const formulario = document.querySelector('form[data-filtros]');
if (formulario instanceof HTMLFormElement) {
  iniciarFiltros(formulario);
}
