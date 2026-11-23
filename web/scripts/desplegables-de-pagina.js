// Los desplegables de las guías (`<details class="desplegable">`, hoy las referencias de «Qué es la IA» y «Qué es
// Faro»): se abren al seguir una cita (#ref-N) y al imprimir. Sin ninguno en la página, no hace nada. Sin JavaScript,
// el <details> nativo funciona con el ratón y el teclado.

import { abrirDesplegablesAlImprimir, abrirDesplegablesAlSeguirEnlaces } from './desplegables.js';

const desplegables = [...document.querySelectorAll('details.desplegable')].filter(
  (elemento) => elemento instanceof HTMLElement,
);
if (desplegables.length > 0) {
  abrirDesplegablesAlSeguirEnlaces(desplegables);
  abrirDesplegablesAlImprimir(desplegables);
}
