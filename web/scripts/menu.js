// Menú lateral accesible: se abre y se cierra sin animación, deja inerte el resto de la página mientras está abierto
// y devuelve el foco al botón al cerrarse.

import { escribirAtributo } from './idioma.js';
import { traducible } from './textos.js';

/** Lo que el menú volvió inerte al abrirse: al cerrarse se devuelve solo eso, no lo que ya era inerte antes.
 * @type {HTMLElement[]}
 */
let inertes = [];

/** Vuelve inertes los hijos de <body> que no contienen nada de `conservar` y apunta cuáles eran.
 * @param {Element[]} conservar
 */
function volverInerteElResto(conservar) {
  /** @param {Element} elemento */
  const conservaAlguno = (elemento) => conservar.some((conservado) => elemento.contains(conservado));
  inertes = [...document.body.children]
    .filter((elemento) => elemento instanceof HTMLElement)
    .filter((elemento) => !conservaAlguno(elemento) && !elemento.inert);
  for (const elemento of inertes) {
    elemento.inert = true;
  }
}

/** Devuelve a la página lo que el menú volvió inerte, y solo eso. */
function devolverElResto() {
  for (const elemento of inertes) {
    elemento.inert = false;
  }
  inertes = [];
}

const PLAZO_MARCA_MS = 2000;

/** Comprueba que el enlace navegue en esta pestaña sin modificadores.
 * @param {HTMLAnchorElement | null} enlace @param {MouseEvent} evento @returns {boolean | null}
 */
function esClicOrdinario(enlace, evento) {
  return (
    enlace &&
    !evento.defaultPrevented &&
    evento.button === 0 &&
    !evento.metaKey &&
    !evento.ctrlKey &&
    !evento.shiftKey &&
    !evento.altKey &&
    !enlace.hasAttribute('download') &&
    (!enlace.target || enlace.target === '_self')
  );
}

/** @typedef {{evento: MouseEvent, destino: string, instante: number}} NavegacionAInicio */
/** Guarda la marca de navegación al salir de la página.
 * @param {NavegacionAInicio} navegacionAInicio
 */
function guardarMarca(navegacionAInicio) {
  try {
    sessionStorage.setItem(
      'faro-inicio-desde-menu',
      JSON.stringify({
        origen: location.href.split('#')[0],
        destino: navegacionAInicio.destino,
        instante: Date.now(),
      }),
    );
  } catch {
    /* Sin almacenamiento, se anima. */
  }
}

/** Registra el retorno a Inicio y cierra el menú al elegir un control.
 * @param {HTMLElement} menu @param {() => void} cerrar
 */
function conectarNavegacion(menu, cerrar) {
  /** @type {NavegacionAInicio | null} */
  let navegacionAInicio = null;
  window.addEventListener('pagehide', () => {
    if (
      !navegacionAInicio ||
      navegacionAInicio.evento.defaultPrevented ||
      Date.now() - navegacionAInicio.instante > PLAZO_MARCA_MS
    ) {
      return;
    }
    guardarMarca(navegacionAInicio);
    navegacionAInicio = null;
  });
  window.addEventListener('pageshow', (evento) => {
    navegacionAInicio = null;
    if (evento.persisted) {
      try {
        sessionStorage.removeItem('faro-inicio-desde-menu');
      } catch {
        /* Sin almacenamiento. */
      }
    }
  });
  menu.addEventListener('click', (evento) => {
    const { target } = evento;
    const enlace = target instanceof Element ? target.closest('a') : null;
    // La marca solo se guarda al abandonar el documento, si el clic sigue sin cancelar.
    if (enlace && esClicOrdinario(enlace, evento)) {
      const destino = new URL(enlace.href);
      const origen = new URL(location.href);
      destino.hash = '';
      origen.hash = '';
      if (
        destino.origin === origen.origin &&
        destino.pathname.endsWith('/inicio.html') &&
        destino.href !== origen.href
      ) {
        const candidata = { evento, destino: destino.href, instante: Date.now() };
        navegacionAInicio = candidata;
        setTimeout(() => {
          if (navegacionAInicio === candidata) {
            navegacionAInicio = null;
          }
        }, PLAZO_MARCA_MS);
      }
    }
    // Cualquier enlace o botón del menú lo cierra («Pasar a otro dispositivo», el selector de idioma, el de tema…).
    if (target instanceof Element && target.closest('a, button')) {
      cerrar();
    }
  });
}

/**
 * Conecta el botón del menú, el menú y su velo. Sin alguno de los tres, la página se queda sin menú lateral. Se llama
 * una sola vez por página (desde sitio.js): el manejador de Escape en `document` no se retira nunca.
 * @returns {void}
 */
export function iniciarMenu() {
  const boton = document.querySelector('.menu-boton');
  const menu = document.getElementById('menu');
  const velo = document.getElementById('menu-velo');
  if (!(boton instanceof HTMLButtonElement) || !menu || !velo) {
    return;
  }

  const abierto = () => boton.getAttribute('aria-expanded') === 'true';
  const abrir = () => {
    menu.hidden = false;
    velo.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
    escribirAtributo(boton, 'aria-label', traducible('comun.menu.cerrar'));
    document.body.classList.add('menu-abierto');
    volverInerteElResto([boton, menu, velo]);
    menu.querySelector('a')?.focus();
  };
  const cerrar = () => {
    menu.hidden = true;
    velo.hidden = true;
    boton.setAttribute('aria-expanded', 'false');
    escribirAtributo(boton, 'aria-label', traducible('comun.menu.abrir'));
    document.body.classList.remove('menu-abierto');
    devolverElResto();
    boton.focus();
  };

  boton.addEventListener('click', () => {
    if (abierto()) {
      cerrar();
    } else {
      abrir();
    }
  });
  conectarNavegacion(menu, cerrar);
  velo.addEventListener('click', cerrar);
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && abierto()) {
      cerrar();
    }
  });
}
