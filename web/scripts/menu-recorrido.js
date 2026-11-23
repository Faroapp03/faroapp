// El servidor decide qué recorrido está activo. Un fallo no implica ningún modo.
import { crear } from './dom.js';
import { escribir } from './idioma.js';
import { conVersiones, traducible } from './textos.js';
import { VARIANTES_INSTALADAS } from './variantes-disponibles.js';

const BASE = new URL('../', import.meta.url);
const PLAZO_MS = 6000;
const HTTP_OK = 200;
const CAMPOS_ESTADO = 3;
class EstadoNoDisponible extends Error {}
/** El real y las variantes instaladas: cada modo con la ruta de su entrada. */
const RUTAS = Object.freeze({
  real: 'recorrido.html',
  ...Object.fromEntries(Object.entries(VARIANTES_INSTALADAS).map(([modo, variante]) => [modo, variante.ruta])),
});
/** @typedef {string} Modo */

/** @param {unknown} valor @returns {valor is {version:1,revision:number,modo:Modo}} */
export function esEstadoDelRecorrido(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return false;
  }
  const estado = /** @type {Record<string, unknown>} */ (valor);
  return (
    Object.keys(estado).length === CAMPOS_ESTADO &&
    estado.version === 1 &&
    Number.isSafeInteger(estado.revision) &&
    Number(estado.revision) >= 0 &&
    typeof estado.modo === 'string' &&
    Object.hasOwn(RUTAS, estado.modo)
  );
}
/** @param {Modo} modo */
export function direccionDelRecorrido(modo) {
  const ruta = Object.hasOwn(RUTAS, modo) ? RUTAS[/** @type {keyof typeof RUTAS} */ (modo)] : undefined;
  if (ruta === undefined) {
    throw new EstadoNoDisponible('Recorrido no disponible');
  }
  return new URL(ruta, BASE).href;
}
/** @returns {Promise<Modo>} */
async function leerModo() {
  const respuesta = await fetch(new URL('modo-recorrido.json', BASE), {
    cache: 'no-store',
    credentials: 'same-origin',
    mode: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(PLAZO_MS),
  });
  if (respuesta.status !== HTTP_OK) {
    throw new EstadoNoDisponible('Estado no disponible');
  }
  const dato = /** @type {unknown} */ (await respuesta.json());
  if (!esEstadoDelRecorrido(dato)) {
    throw new EstadoNoDisponible('Estado no válido');
  }
  return dato.modo;
}
/** @returns {HTMLAnchorElement[]} */
function enlacesDeEntrada() {
  return [...document.querySelectorAll('a[href]')]
    .filter((enlace) => {
      if (!(enlace instanceof HTMLAnchorElement)) {
        return false;
      }
      const url = new URL(enlace.href);
      return (
        url.origin === BASE.origin &&
        url.pathname === new URL('recorrido.html', BASE).pathname &&
        !url.search &&
        !url.hash
      );
    })
    .map((enlace) => /** @type {HTMLAnchorElement} */ (enlace));
}
/** @param {Modo|null} modo */
function rotuloDelModo(modo) {
  if (modo === null) {
    return traducible('comun.menu.recorrido.no-disponible');
  }
  const variante = Object.hasOwn(VARIANTES_INSTALADAS, modo)
    ? VARIANTES_INSTALADAS[/** @type {keyof typeof VARIANTES_INSTALADAS} */ (modo)]
    : undefined;
  return variante ? conVersiones(variante.estado) : traducible(`comun.menu.recorrido.${modo}`);
}
/** @param {HTMLAnchorElement[]} enlaces @param {HTMLElement} estado @param {HTMLButtonElement} reintentar @param {Modo|null} modo */
function pintar(enlaces, estado, reintentar, modo) {
  for (const enlace of enlaces) {
    if (modo !== null && modo !== 'consultando') {
      enlace.href = direccionDelRecorrido(modo);
      enlace.removeAttribute('aria-disabled');
    } else {
      enlace.removeAttribute('href');
      enlace.setAttribute('aria-disabled', 'true');
    }
  }
  reintentar.hidden = modo !== null;
  escribir(estado, rotuloDelModo(modo));
}
/** @param {HTMLAnchorElement[]} enlaces @param {HTMLElement} estado @param {HTMLButtonElement} reintentar */
function controlador(enlaces, estado, reintentar) {
  let numero = 0;
  return async () => {
    const intento = ++numero;
    pintar(enlaces, estado, reintentar, 'consultando');
    try {
      const modo = await leerModo();
      if (intento !== numero) {
        return null;
      }
      pintar(enlaces, estado, reintentar, modo);
      return modo;
    } catch (error) {
      if (
        !(
          error instanceof EstadoNoDisponible ||
          error instanceof TypeError ||
          error instanceof SyntaxError ||
          error instanceof DOMException
        )
      ) {
        throw error;
      }
      if (intento === numero) {
        pintar(enlaces, estado, reintentar, null);
      }
      return null;
    }
  };
}
/** @param {HTMLAnchorElement[]} enlaces @param {() => Promise<Modo|null>} comprobar */
function conectarEntradas(enlaces, comprobar) {
  for (const enlace of enlaces) {
    enlace.addEventListener('click', (evento) => {
      if (
        !(evento instanceof MouseEvent) ||
        evento.button !== 0 ||
        evento.metaKey ||
        evento.ctrlKey ||
        evento.shiftKey ||
        evento.altKey
      ) {
        return;
      }
      evento.preventDefault();
      void comprobar().then((modo) => {
        if (modo) {
          location.assign(direccionDelRecorrido(modo));
        }
      });
    });
  }
}
/** @returns {void} */
export function iniciarModoRecorrido() {
  const menu = document.getElementById('menu');
  if (!menu) {
    return;
  }
  const estado = escribir(
    crear('p', { className: 'menu-modo-recorrido' }),
    traducible('comun.menu.recorrido.consultando'),
  );
  estado.setAttribute('role', 'status');
  estado.setAttribute('aria-live', 'polite');
  const reintentar = escribir(
    crear('button', { type: 'button', className: 'menu-modo-reintentar' }),
    traducible('conectividad.repetir'),
  );
  menu.append(estado, reintentar);
  const enlaces = enlacesDeEntrada();
  const comprobar = controlador(enlaces, estado, reintentar);
  conectarEntradas(enlaces, comprobar);
  reintentar.addEventListener('click', () => void comprobar());
  void comprobar();
  window.addEventListener('pageshow', () => void comprobar());
  window.addEventListener('online', () => void comprobar());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void comprobar();
    }
  });
}
