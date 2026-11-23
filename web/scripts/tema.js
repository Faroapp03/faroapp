// Botón de modo día / noche. El tema inicial lo pone tema-inicial.js; aquí solo se cambia y se recuerda.

import { escribir, escribirAtributo } from './idioma.js';
import { traducible } from './textos.js';

/** La misma clave que lee tema-inicial.js al cargar cada página (copia que comprueba pruebas/web-controles/controles.test.js). */
const CLAVE_TEMA = 'faro-tema';
const TEMA_CLARO = 'claro';
const TEMA_OSCURO = 'oscuro';
/** El color de la barra del navegador en cada tema: el fondo de su tema en tokens.css (copia de tema-inicial.js). */
const COLORES_DE_LA_BARRA = { claro: '#f4f3f0', oscuro: '#111317' };

/** El tema que se ve ahora: el de <html data-tema>, y el claro si no dice otra cosa. @returns {string} */
function temaActual() {
  return document.documentElement.dataset.tema === TEMA_OSCURO ? TEMA_OSCURO : TEMA_CLARO;
}

/**
 * El botón dice lo que hará, no el estado actual: «Cambiar a modo noche» en modo día. El de la cabecera es un icono y
 * lo dice en su nombre accesible; los de texto (data-cambiar-tema, como el del recorrido en los móviles), en su texto.
 * @param {HTMLElement} boton
 */
function rotular(boton) {
  const rotulo = traducible(temaActual() === TEMA_CLARO ? 'comun.tema.a-noche' : 'comun.tema.a-dia');
  if (boton.matches('[data-cambiar-tema]')) {
    escribir(boton, rotulo);
  } else {
    escribirAtributo(boton, 'aria-label', rotulo);
  }
}

/**
 * Cambia al otro tema, con el color de la barra del navegador, y lo recuerda. El rótulo del botón lo renueva la
 * vigilancia de data-tema.
 */
function cambiarTema() {
  const siguiente = temaActual() === TEMA_CLARO ? TEMA_OSCURO : TEMA_CLARO;
  document.documentElement.dataset.tema = siguiente;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORES_DE_LA_BARRA[siguiente]);
  try {
    localStorage.setItem(CLAVE_TEMA, siguiente);
  } catch {
    // Sin almacenamiento, el cambio vale mientras la página esté abierta.
  }
}

/**
 * Rotula los botones de tema según el tema actual y los conecta. Si la página no tiene ninguno, no hace nada.
 * Los rótulos se renuevan cada vez que cambia data-tema.
 * Se llama una sola vez por página (desde sitio.js): ni los oyentes ni la vigilancia se liberan, viven lo que la página.
 * @returns {void}
 */
export function iniciarTema() {
  const botones = [...document.querySelectorAll('.tema-boton, [data-cambiar-tema]')].filter(
    (boton) => boton instanceof HTMLElement,
  );
  if (!botones.length) {
    return;
  }
  const rotularTodos = () => {
    for (const boton of botones) {
      rotular(boton);
    }
  };
  rotularTodos();
  for (const boton of botones) {
    boton.addEventListener('click', cambiarTema);
  }
  new MutationObserver(rotularTodos).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-tema'],
  });
}
