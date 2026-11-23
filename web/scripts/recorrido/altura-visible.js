// La altura visible de la pantalla. En los móviles, el teclado tapa parte de la pantalla sin cambiar su altura (100dvh
// en iOS), y la barra de escritura quedaría debajo de él. Mientras la página no esté ampliada con los dedos, el
// recorrido mide lo que se ve (visualViewport) y lo deja en --alto-visible, que estilos/recorrido/pagina.css usa como
// alto de la página. En Android basta con interactive-widget=resizes-content (en la etiqueta viewport de
// recorrido.html).
// Con muy poco alto (el 400 % de ampliación, WCAG 1.4.10) la página no cabe y se desplaza entera (pagina.css). Al
// enfocar una opción de una tarjeta, el navegador desplaza solo lo justo para ver su casilla, pero lo que se ve
// enfocado es la opción entera, con su texto y su recuadro de foco (estilos/recorrido/tarjetas.css): sin más, quedaría
// cortada al borde de la pantalla (2.4.11). Por eso, entonces, la opción enfocada se lleva entera a la vista, sin
// animación. Con más alto, la conversación se desplaza por dentro y nada cambia.

/** Con la página ampliada (zoom de pellizco), lo visible es un trozo: la página conserva su alto normal. */
const SIN_AMPLIAR = 1;
/** Por debajo de este alto se desplaza la página entera: el mismo límite que en estilos/recorrido/pagina.css. */
const PAGINA_QUE_SE_DESPLAZA = '(max-height: 320px)';

/** Deja el alto de lo que se ve en --alto-visible, o lo quita con la página ampliada. @param {VisualViewport} vista */
function anotarAltura(vista) {
  const raiz = document.documentElement.style;
  if (vista.scale > SIN_AMPLIAR) {
    raiz.removeProperty('--alto-visible');
    return;
  }
  raiz.setProperty('--alto-visible', `${Math.round(vista.height)}px`);
}

/**
 * Sigue la altura visible mientras la página esté abierta. Sin visualViewport, la página usa 100dvh.
 */
export function seguirAlturaVisible() {
  const vista = window.visualViewport;
  if (!vista) {
    return;
  }
  vista.addEventListener('resize', () => anotarAltura(vista));
  anotarAltura(vista);
}

/**
 * Con la página desplazándose entera (PAGINA_QUE_SE_DESPLAZA), lleva a la vista la opción entera que recibe el foco, y
 * no solo su casilla (ver la cabecera). Respeta el margen de la página (scroll-padding en pagina.css).
 */
export function llevarLaOpcionEnfocadaALaVista() {
  const conPocoAlto = matchMedia(PAGINA_QUE_SE_DESPLAZA);
  document.addEventListener('focusin', ({ target }) => {
    const opcion = target instanceof Element ? target.closest('.rc-opcion') : null;
    if (opcion && conPocoAlto.matches) {
      opcion.scrollIntoView({ block: 'nearest' });
    }
  });
}
