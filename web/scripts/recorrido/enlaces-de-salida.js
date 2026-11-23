// Los enlaces que sacan de la página del recorrido. Faro no guarda la conversación (recorrido.js): salir de la página la
// borra. Mientras haya algo que perder, los enlaces a otras páginas de Faro se abren en otra pestaña y la conversación
// sigue intacta en esta; sin nada que perder, se navega en la misma pestaña, como en el resto del sitio. Qué es «algo
// que perder» lo decide quien llama, con la misma función que usa el aviso al cerrar o recargar la página.
//
// Se cambian los atributos de cada enlace (target, rel y aria-describedby), no su clic: el navegador hace lo de siempre
// con las teclas de modificación y con el clic central, y el lector de pantalla anuncia el comportamiento real («Se abre
// en otra pestaña»). Los atributos se ponen al día con cada cambio que puede alterar la respuesta (lo escrito, los
// mensajes, el paso) y, además, al enfocar o pulsar cualquier cosa de la página, antes de que el navegador siga el
// enlace. Un enlace que ya trae su propio target (los de otras webs) no se toca. No se guarda nada ni se pide nada.

/** El texto oculto que describe un enlace que se abre en otra pestaña (recorrido.html). */
const AVISO_OTRA_PESTANA = 'rc-abre-en-otra-pestana';
/** Los atributos del <body> que marcan la conversación y el paso: su cambio puede cambiar la respuesta. */
const MARCAS_DEL_RECORRIDO = Object.freeze(['data-paso', 'data-conversacion']);

/** Los enlaces que esta pieza ha mandado a otra pestaña: solo a ellos se les devuelve la misma. @type {WeakSet<Element>} */
const enOtraPestana = new WeakSet();

/**
 * Pone o quita una palabra de un atributo con una lista de palabras (rel, aria-describedby) sin tocar las demás; si la
 * lista se queda vacía, quita el atributo.
 * @param {Element} elemento @param {string} atributo @param {string} palabra @param {boolean} poner
 */
function cambiarPalabra(elemento, atributo, palabra, poner) {
  const palabras = (elemento.getAttribute(atributo) ?? '').split(/\s+/).filter((otra) => otra && otra !== palabra);
  if (poner) {
    palabras.push(palabra);
  }
  if (palabras.length) {
    elemento.setAttribute(atributo, palabras.join(' '));
  } else {
    elemento.removeAttribute(atributo);
  }
}

/**
 * Si seguir el enlace saca de esta página hacia otra de Faro: la misma web, otra dirección o la misma sin fragmento (que
 * la vuelve a cargar). Un fragmento de esta misma página («Saltar al contenido»), otra web, un teléfono o una descarga no.
 * @param {HTMLAnchorElement} enlace @returns {boolean}
 */
function llevaAOtraPagina(enlace) {
  if (enlace.origin !== location.origin || enlace.hasAttribute('download')) {
    return false;
  }
  const mismaPagina = enlace.pathname === location.pathname && enlace.search === location.search;
  return !mismaPagina || enlace.hash === '';
}

/** @param {HTMLAnchorElement} enlace @param {boolean} otraPestana */
function cambiarDestino(enlace, otraPestana) {
  if (otraPestana) {
    enlace.setAttribute('target', '_blank');
    enOtraPestana.add(enlace);
  } else {
    enlace.removeAttribute('target');
    enOtraPestana.delete(enlace);
  }
  cambiarPalabra(enlace, 'rel', 'noopener', otraPestana);
  cambiarPalabra(enlace, 'aria-describedby', AVISO_OTRA_PESTANA, otraPestana);
}

/**
 * Deja cada enlace que saca de la página en otra pestaña si hay algo que perder, y en la misma si no.
 * @param {boolean} hayQuePerder
 */
function ponerAlDia(hayQuePerder) {
  for (const enlace of document.querySelectorAll('a[href]')) {
    if (!(enlace instanceof HTMLAnchorElement)) {
      continue;
    }
    const nuestro = enOtraPestana.has(enlace);
    if (nuestro === hayQuePerder) {
      continue;
    }
    if (nuestro || (!enlace.hasAttribute('target') && llevaAOtraPagina(enlace))) {
      cambiarDestino(enlace, hayQuePerder);
    }
  }
}

/**
 * Conecta los enlaces de la página con lo que hay que perder. Se llama una sola vez, al arrancar el recorrido: sus
 * escuchas no se retiran.
 * @param {() => boolean} hayAlgoQuePerder Si salir de la página perdería algo; la misma respuesta que el aviso al salir.
 * @returns {void}
 */
export function abrirFueraSinPerderLaConversacion(hayAlgoQuePerder) {
  const alCambiar = () => ponerAlDia(hayAlgoQuePerder());
  // Los mensajes, las tarjetas y el informe que entran o salen, y el paso y la marca de conversación del <body>.
  new MutationObserver(alCambiar).observe(document.body, {
    subtree: true,
    childList: true,
    attributeFilter: [...MARCAS_DEL_RECORRIDO],
  });
  // Lo escrito en la barra no cambia el DOM.
  document.addEventListener('input', alCambiar);
  // Antes de que el lector de pantalla anuncie el enlace enfocado y antes de que el navegador siga el pulsado.
  document.addEventListener('focusin', alCambiar, true);
  document.addEventListener('click', alCambiar, true);
  alCambiar();
}
