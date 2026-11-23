// Desplegables de selección única con recuentos: Biblioteca y Cursos comparten teclado, cierre, foco y estado.
import { PaginaIncompleta } from './dom.js';
import { escribir } from './idioma.js';
import { traducible } from './textos.js';

const TODO = 'todo';
const TECLAS_DE_FLECHA = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** @typedef {{ radio: HTMLInputElement, etiqueta: HTMLElement | null, texto: HTMLElement | null,
 *   cuenta: HTMLElement | null }} Opcion */
/** @typedef {{ filtro: string, raiz: HTMLElement, boton: HTMLElement, valor: HTMLElement | null, panel: HTMLElement,
 *   opciones: Opcion[] }} Desplegable */
/** @typedef {{ desplegables: Desplegable[], conFlechas: boolean }} ControlDesplegables */
/** @param {ParentNode} raiz @param {string} selector @returns {HTMLElement[]} */
function elementos(raiz, selector) {
  return [...raiz.querySelectorAll(selector)].filter((elemento) => elemento instanceof HTMLElement);
}

/**
 * Lee un desplegable del contenedor.
 * @param {HTMLElement} raiz El elemento [data-desplegable].
 * @returns {Desplegable}
 * @throws {PaginaIncompleta} Si falta su botón o su panel, o no tiene botones de opción de un único grupo.
 */
export function leerDesplegable(raiz) {
  const [boton] = elementos(raiz, '[data-desplegable-boton]');
  const [panel] = elementos(raiz, '[data-desplegable-panel]');
  const radios = [...raiz.querySelectorAll('input[type="radio"]')].filter((radio) => radio instanceof HTMLInputElement);
  const filtros = new Set(radios.map((radio) => radio.getAttribute('name') ?? ''));
  const [filtro = ''] = filtros;
  if (!boton || !panel || filtros.size !== 1 || filtro === '') {
    throw new PaginaIncompleta('Un desplegable necesita su botón, su panel y un grupo de opciones');
  }
  const [valor = null] = elementos(boton, '[data-valor]');
  const opciones = radios.map((radio) => {
    const etiqueta = radio.closest('label');
    const [texto = null] = etiqueta ? elementos(etiqueta, '[data-opcion]') : [];
    const [cuenta = null] = etiqueta ? elementos(etiqueta, '[data-n]') : [];
    return { radio, etiqueta, texto, cuenta };
  });
  return { filtro, raiz, boton, valor, panel, opciones };
}

/** La opción elegida de un desplegable; la que no excluye nada si no hay ninguna. @param {Desplegable} desplegable */
export function elegida({ opciones }) {
  return opciones.find(({ radio }) => radio.checked) ?? opciones.find(({ radio }) => radio.value === TODO);
}

/** Si el desplegable tiene una elección que excluye lecturas. @param {Desplegable} desplegable */
export function filtra(desplegable) {
  const opcion = elegida(desplegable);
  return opcion !== undefined && opcion.radio.value !== TODO;
}

/**
 * Escribe el texto de una opción (el elegido, en el botón) conservando su clave de traducción, si la tiene.
 * @param {HTMLElement} destino @param {HTMLElement} texto
 */
function copiarTexto(destino, texto) {
  const clave = texto.dataset.texto;
  escribir(destino, clave ? traducible(clave) : (texto.textContent ?? ''));
}

/** @param {ControlDesplegables} barra @param {Desplegable} desplegable @param {boolean} [devolverFoco] Si el foco vuelve a su botón. */
export function cerrar(barra, desplegable, devolverFoco = false) {
  barra.conFlechas = false;
  desplegable.panel.hidden = true;
  desplegable.boton.setAttribute('aria-expanded', 'false');
  if (devolverFoco) {
    desplegable.boton.focus();
  }
}

/** Abre un panel y cierra los demás: solo hay uno abierto. @param {ControlDesplegables} barra @param {Desplegable} desplegable */
function abrir(barra, desplegable) {
  for (const otro of barra.desplegables) {
    if (otro !== desplegable) {
      cerrar(barra, otro);
    }
  }
  barra.conFlechas = false;
  desplegable.panel.hidden = false;
  desplegable.boton.setAttribute('aria-expanded', 'true');
}

/**
 * Las teclas de un desplegable abierto: Escape lo cierra y Intro, estando en una opción, también, y los dos devuelven el
 * foco al botón; una flecha cambia de opción sin cerrarlo.
 * @param {ControlDesplegables} barra @param {Desplegable} desplegable @param {KeyboardEvent} evento
 */
function pulsarTecla(barra, desplegable, evento) {
  if (desplegable.panel.hidden) {
    return;
  }
  if (evento.key === 'Escape' || (evento.key === 'Enter' && evento.target !== desplegable.boton)) {
    evento.preventDefault();
    cerrar(barra, desplegable, true);
  } else {
    barra.conFlechas = TECLAS_DE_FLECHA.has(evento.key);
  }
}

/**
 * Conecta un desplegable: su botón lo abre y lo cierra, las teclas lo gobiernan y salir de él con el tabulador lo cierra.
 * @param {ControlDesplegables} barra @param {Desplegable} desplegable
 */
function conectarDesplegable(barra, desplegable) {
  const { raiz, boton, panel } = desplegable;
  boton.addEventListener('click', () => (panel.hidden ? abrir(barra, desplegable) : cerrar(barra, desplegable)));
  raiz.addEventListener('keydown', (evento) => pulsarTecla(barra, desplegable, evento));
  raiz.addEventListener('pointerdown', () => {
    barra.conFlechas = false;
  });
  // Sin destino (un clic en el texto de una opción, que no se enfoca) no se cierra: el clic de fuera ya lo hace, y este
  // no debe quitar el panel de debajo del dedo.
  raiz.addEventListener('focusout', (evento) => {
    const destino = evento.relatedTarget;
    if (!panel.hidden && destino instanceof Node && !raiz.contains(destino)) {
      cerrar(barra, desplegable);
    }
  });
}

/** Actualiza la elección visible y su marca; las claves de traducción se conservan.
 * @param {Desplegable} desplegable */
export function actualizarBoton(desplegable) {
  const texto = elegida(desplegable)?.texto;
  if (desplegable.valor && texto) {
    copiarTexto(desplegable.valor, texto);
  }
  if (filtra(desplegable)) {
    desplegable.boton.setAttribute('data-activo', '');
  } else {
    desplegable.boton.removeAttribute('data-activo');
  }
}
/** Las opciones vacías siguen siendo elegibles; su recuento se calcula en la consulta de cada página.
 * @param {Desplegable} desplegable @param {ReadonlyMap<string, number>} cuentas
 * @param {(numero:number)=>string} [formatear] */
export function ponerCuentas(desplegable, cuentas, formatear = String) {
  for (const { radio, etiqueta, cuenta } of desplegable.opciones) {
    const numero = cuentas.get(radio.value) ?? 0;
    if (cuenta) {
      cuenta.textContent = formatear(numero);
    }
    if (etiqueta) {
      if (numero === 0) {
        etiqueta.setAttribute('data-vacia', '');
      } else {
        etiqueta.removeAttribute('data-vacia');
      }
    }
  }
}
/** Un solo panel abierto, teclas nativas y cierre al salir. La página aplica su consulta al cambiar una opción.
 * @param {ControlDesplegables} control @param {HTMLElement} contenedor @param {()=>void} alCambiar */
export function conectarDesplegables(control, contenedor, alCambiar) {
  for (const desplegable of control.desplegables) {
    conectarDesplegable(control, desplegable);
  }
  document.addEventListener('click', (evento) => {
    for (const desplegable of control.desplegables) {
      const dentro = evento.target instanceof Node && desplegable.raiz.contains(evento.target);
      if (!(desplegable.panel.hidden || dentro)) {
        cerrar(control, desplegable);
      }
    }
  });
  contenedor.addEventListener('change', (evento) => {
    alCambiar();
    const origen = control.desplegables.find(({ opciones }) => opciones.some(({ radio }) => radio === evento.target));
    if (origen && !control.conFlechas) {
      cerrar(control, origen, true);
    }
  });
}
