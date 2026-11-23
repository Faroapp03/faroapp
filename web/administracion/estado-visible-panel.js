// Los campos observados se muestran como texto; no se infiere actividad ni se transforma su valor.
import { idiomaActual } from '../scripts/textos.js';

/** @param {HTMLElement} destino @param {Record<string, unknown>} valores @returns {HTMLElement} */
export function detallesDelRegistro(destino, valores) {
  const detalles = document.createElement('details');
  const titulo = document.createElement('summary');
  titulo.textContent = idiomaActual() === 'ca' ? 'Veure detalls tècnics' : 'Ver detalles técnicos';
  detalles.append(titulo);
  const lista = document.createElement('dl');
  for (const [nombre, valor] of Object.entries(valores)) {
    const etiqueta = document.createElement('dt');
    etiqueta.textContent = nombre;
    const contenido = document.createElement('dd');
    contenido.textContent = valor === null || valor === undefined ? '—' : String(valor);
    lista.append(etiqueta, contenido);
  }
  detalles.append(lista);
  destino.append(detalles);
  return detalles;
}
