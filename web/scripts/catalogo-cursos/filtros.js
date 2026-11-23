/** Construye controles nativos; Biblioteca aporta su comportamiento común. */
import { actualizarBoton, elegida, leerDesplegable, ponerCuentas } from '../desplegable-con-recuento.js';
import { escribir } from '../idioma.js';
import { texto, traducible } from '../textos.js';
import { VALORES_FILTRO } from './parametros.js';

/** @import { Desplegable } from '../desplegable-con-recuento.js' */
/** @import { ConsultaListado, FiltrosCatalogo } from '../../recursos/catalogo-cursos/lector.js' */
/** @param {string} etiqueta @param {string} clase @param {string} [clave] */
function pieza(etiqueta, clase, clave) {
  const nodo = document.createElement(etiqueta);
  nodo.className = clase;
  if (clave) {
    escribir(nodo, traducible(clave));
  }
  return nodo;
}
/** @param {string} campo @param {string} valor */
function claveOpcion(campo, valor) {
  return valor === 'todo' ? 'catalogo.todos' : `catalogo.${campo}.${valor}`;
}
/** @param {string} campo @param {string} valor */
function opcion(campo, valor) {
  const label = pieza('label', 'lecturas-opcion');
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = campo;
  radio.value = valor;
  const nombre = pieza('span', 'lecturas-opcion-texto', claveOpcion(campo, valor));
  nombre.dataset.opcion = '';
  label.append(radio, nombre);
  if (campo !== 'orden') {
    const cuenta = pieza('span', 'lecturas-opcion-n');
    cuenta.dataset.n = '';
    cuenta.setAttribute('aria-hidden', 'true');
    label.append(cuenta);
  }
  return label;
}
/** @param {string} campo */
function boton(campo) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'lecturas-desplegable-boton';
  boton.dataset.desplegableBoton = '';
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-controls', `cursos-panel-${campo}`);
  const nombre = pieza('span', 'lecturas-desplegable-texto');
  const valor = pieza('span', 'lecturas-desplegable-valor');
  valor.dataset.valor = '';
  nombre.append(
    pieza('span', 'lecturas-desplegable-nombre', `catalogo.${campo}`),
    pieza('span', 'lecturas-desplegable-separador'),
    valor,
  );
  const separador = nombre.querySelector('.lecturas-desplegable-separador');
  if (separador) {
    separador.textContent = ' · ';
  }
  const flecha = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  flecha.setAttribute('class', 'lecturas-chevron');
  flecha.setAttribute('viewBox', '0 0 24 24');
  flecha.setAttribute('aria-hidden', 'true');
  flecha.setAttribute('focusable', 'false');
  const trazo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trazo.setAttribute('d', 'm6 9 6 6 6-6');
  flecha.append(trazo);
  boton.append(nombre, flecha);
  return boton;
}
/** @param {HTMLElement} destino @param {keyof typeof VALORES_FILTRO} campo @returns {Desplegable} */
export function montarDesplegable(destino, campo) {
  const raiz = pieza('div', 'lecturas-desplegable');
  raiz.dataset.desplegable = '';
  const panel = pieza('div', 'lecturas-desplegable-panel');
  panel.id = `cursos-panel-${campo}`;
  panel.dataset.desplegablePanel = '';
  panel.hidden = true;
  const grupo = document.createElement('fieldset');
  grupo.className = 'lecturas-filtro';
  grupo.append(pieza('legend', '', `catalogo.${campo}`));
  const valores = campo === 'orden' ? VALORES_FILTRO[campo] : ['todo', ...VALORES_FILTRO[campo]];
  grupo.append(...valores.map((valor) => opcion(campo, valor)));
  panel.append(grupo);
  raiz.append(boton(campo), panel);
  destino.append(raiz);
  return leerDesplegable(raiz);
}
/** @param {readonly Desplegable[]} controles @param {FiltrosCatalogo} filtros */
export function seleccionar(controles, filtros) {
  for (const control of controles) {
    const valor = filtros[/** @type {keyof typeof VALORES_FILTRO} */ (control.filtro)] || 'todo';
    for (const { radio } of control.opciones) {
      radio.checked = radio.value === valor;
    }
    actualizarBoton(control);
    if (control.filtro === 'orden') {
      control.boton.removeAttribute('data-activo');
    }
  }
}
/** @param {readonly Desplegable[]} controles @param {string} consulta @returns {FiltrosCatalogo} */
export function leerFiltros(controles, consulta) {
  const estado = Object.fromEntries(controles.map((c) => [c.filtro, elegida(c)?.radio.value ?? 'todo']));
  const valor = (/** @type {string} */ campo) => (estado[campo] === 'todo' ? '' : (estado[campo] ?? ''));
  return {
    texto: consulta,
    idioma: valor('idioma'),
    nivel: valor('nivel'),
    modalidad: valor('modalidad'),
    tema: valor('tema'),
    orden: valor('orden'),
  };
}
/** @param {readonly Desplegable[]} controles @param {ConsultaListado} consulta */
export function actualizarCuentas(controles, consulta) {
  for (const control of controles) {
    const cuentas = consulta.cuentas.get(/** @type {'idioma'|'nivel'|'modalidad'|'tema'} */ (control.filtro));
    if (cuentas) {
      ponerCuentas(control, cuentas, (n) => texto('catalogo.numero', { n }));
    }
    actualizarBoton(control);
    if (control.filtro === 'orden') {
      control.boton.removeAttribute('data-activo');
    }
  }
}
