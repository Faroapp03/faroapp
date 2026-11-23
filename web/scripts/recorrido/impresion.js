import { prepararHojaParaImprimir } from './documento-hoja.js';

// Qué se imprime (o se guarda en PDF) desde «Tu carpeta»: el informe, la hoja de ruta o los dos seguidos, cada uno
// empezando en página nueva. Antes de window.print() se pone en <html> la clase de lo que se imprime, y se quita con
// afterprint: las reglas de impresión (estilos/recorrido/documento-hoja.css) enseñan solo eso, aunque la vista que
// está abierta sea otra o ninguna.

/** Lo que se puede imprimir, con su clase de impresión. */
const CLASES_DE_IMPRESION = Object.freeze({
  informe: 'imprimir-informe',
  hoja: 'imprimir-hoja',
  'los-dos': 'imprimir-los-dos',
});

/** @typedef {keyof typeof CLASES_DE_IMPRESION} QueSeImprime */

/** Quita las clases de impresión de <html>. @returns {void} */
function quitarClasesDeImpresion() {
  document.documentElement.classList.remove(...Object.values(CLASES_DE_IMPRESION));
}

/**
 * Imprime `que`: pone su clase, abre el diálogo de impresión y la quita al acabar (afterprint).
 * @param {QueSeImprime} que @returns {void}
 */
export function imprimir(que) {
  quitarClasesDeImpresion();
  document.documentElement.classList.add(CLASES_DE_IMPRESION[que]);
  if (que !== 'informe' && !prepararHojaParaImprimir()) {
    quitarClasesDeImpresion();
    return;
  }
  window.addEventListener('afterprint', quitarClasesDeImpresion, { once: true });
  window.print();
}

/**
 * Lo que enseña la vista abierta del paso 4: la hoja de ruta, el informe pintado a la vista o nada.
 * @returns {QueSeImprime | null}
 */
function vistaAbierta() {
  if (document.querySelector('#paso-4[data-vista="hoja"] .hd')) {
    return 'hoja';
  }
  const paso = document.getElementById('paso-4');
  return paso && !paso.hidden && !paso.dataset.vista && paso.querySelector('#informe .informe-breve')
    ? 'informe'
    : null;
}

/**
 * También comprueba el menú nativo: beforeprint puede llegar antes de activar el medio print. Sin un botón que haya
 * elegido qué imprimir, se imprime la vista abierta con la misma clase que su botón.
 */
function comprobarAntesDeImprimir() {
  const raiz = document.documentElement;
  const explicita = Object.values(CLASES_DE_IMPRESION).some((clase) => raiz.classList.contains(clase));
  const vista = explicita ? null : vistaAbierta();
  if (vista) {
    raiz.classList.add(CLASES_DE_IMPRESION[vista]);
  }
  if (raiz.classList.contains(CLASES_DE_IMPRESION.hoja) || raiz.classList.contains(CLASES_DE_IMPRESION['los-dos'])) {
    prepararHojaParaImprimir();
  }
}
// Las pruebas de creación de documentos también importan este módulo sin ventana de navegador.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', comprobarAntesDeImprimir);
  window.addEventListener('afterprint', quitarClasesDeImpresion);
}
