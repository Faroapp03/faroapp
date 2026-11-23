// Las filas permanecen en el DOM: una elección sigue activa al cambiar de página.
import { crear } from '../../dom.js';
import { escribir, escribirAtributo } from '../../idioma.js';
import { conVersiones } from '../../textos.js';

const POR_PAGINA = 6;
const TEXTOS = {
  es: {
    pagina: 'Página',
    anterior: 'Página anterior',
    siguiente: 'Página siguiente',
    navegacion: 'Páginas de cursos',
    elegido: 'Curso elegido',
  },
  ca: {
    pagina: 'Pàgina',
    anterior: 'Pàgina anterior',
    siguiente: 'Pàgina següent',
    navegacion: 'Pàgines de cursos',
    elegido: 'Curs escollit',
  },
};

/** @param {HTMLElement[]} filas @param {HTMLElement} elegida */
function conectarEleccion(filas, elegida) {
  for (const fila of filas) {
    const entrada = fila.querySelector('input');
    entrada?.addEventListener('change', () => {
      if (entrada.checked) {
        const titulo = fila.querySelector('label')?.textContent ?? '';
        escribir(
          elegida,
          conVersiones({ es: `${TEXTOS.es.elegido}: ${titulo}`, ca: `${TEXTOS.ca.elegido}: ${titulo}` }),
        );
        elegida.hidden = false;
      }
    });
  }
}

/** @param {HTMLElement[]} filas @returns {HTMLElement|null} */
export function paginarCursos(filas) {
  if (filas.length <= POR_PAGINA) {
    return null;
  }
  const versiones = (/** @type {keyof typeof TEXTOS.es} */ clave) =>
    conVersiones({ es: TEXTOS.es[clave], ca: TEXTOS.ca[clave] });
  const total = Math.ceil(filas.length / POR_PAGINA);
  const nav = crear('nav', { className: 'rc-plan-paginas' });
  escribirAtributo(nav, 'aria-label', versiones('navegacion'));
  const cuenta = crear('span', { role: 'status', ariaLive: 'polite' });
  const anterior = crear('button', { type: 'button', textContent: '←' });
  const siguiente = crear('button', { type: 'button', textContent: '→' });
  escribirAtributo(anterior, 'aria-label', versiones('anterior'));
  escribirAtributo(siguiente, 'aria-label', versiones('siguiente'));
  const elegida = crear('span', { className: 'rc-plan-seleccion', role: 'status', ariaLive: 'polite', hidden: true });
  let pagina = 0;
  function pintar() {
    filas.forEach((fila, indice) => {
      fila.hidden = Math.floor(indice / POR_PAGINA) !== pagina;
    });
    anterior.disabled = pagina === 0;
    siguiente.disabled = pagina === total - 1;
    escribir(
      cuenta,
      conVersiones({
        es: `${TEXTOS.es.pagina} ${pagina + 1} / ${total}`,
        ca: `${TEXTOS.ca.pagina} ${pagina + 1} / ${total}`,
      }),
    );
  }
  anterior.addEventListener('click', () => {
    if (pagina > 0) {
      pagina--;
      pintar();
    }
  });
  siguiente.addEventListener('click', () => {
    if (pagina < total - 1) {
      pagina++;
      pintar();
    }
  });
  conectarEleccion(filas, elegida);
  nav.append(anterior, cuenta, siguiente, elegida);
  pintar();
  return nav;
}
