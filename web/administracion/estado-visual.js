// Un estado del panel siempre se muestra con icono y palabra, nunca solo con color: así se lee también en escala de
// grises, con daltonismo o con un lector de pantalla (el icono es decorativo y la palabra lo dice todo).
// Cinco símbolos: círculo con marca (bien), con reloj (en curso), triángulo (atención), con aspa (fallo) y con raya
// (sin activar o sin dato).
import { icono } from './iconos-panel.js';

/** @typedef {'bien'|'curso'|'atencion'|'fallo'|'nada'} TonoEstado */

/** @param {TonoEstado} tono @param {string} palabra @returns {HTMLElement} */
export function marcaEstado(tono, palabra) {
  const marca = document.createElement('span');
  marca.className = `panel-estado panel-estado--${tono}`;
  const texto = document.createElement('span');
  texto.className = 'panel-estado-palabra';
  texto.textContent = palabra;
  marca.append(icono(`estado-${tono}`), texto);
  return marca;
}
