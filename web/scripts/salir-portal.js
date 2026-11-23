// La salida solo se ofrece cuando el servidor confirma que el portal está activo.
import { crear } from './dom.js';
import { escribir } from './idioma.js';
import { traducible } from './textos.js';

const PLAZO_MS = 6000;
const CORRECTO = 200;
class CierreNoConfirmado extends Error {}
const opciones = () => ({
  mode: /** @type {RequestMode} */ ('cors'),
  credentials: /** @type {RequestCredentials} */ ('same-origin'),
  redirect: /** @type {RequestRedirect} */ ('error'),
  signal: AbortSignal.timeout(PLAZO_MS),
});
/** @returns {Promise<boolean>} */
async function portalActivo() {
  try {
    const respuesta = await fetch(new URL('/acceso-web/estado', location.origin), opciones());
    if (respuesta.status !== CORRECTO) {
      return false;
    }
    const dato = /** @type {unknown} */ (await respuesta.json());
    return (
      !!dato &&
      typeof dato === 'object' &&
      !Array.isArray(dato) &&
      Object.keys(dato).length === 1 &&
      /** @type {{portal?:unknown}} */ (dato).portal === true
    );
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError || error instanceof DOMException) {
      return false;
    }
    throw error;
  }
}
/** @param {HTMLButtonElement} boton @param {HTMLElement} aviso */
async function salir(boton, aviso) {
  boton.disabled = true;
  aviso.hidden = true;
  try {
    const respuesta = await fetch(new URL('/acceso-web/salir', location.origin), { ...opciones(), method: 'POST' });
    const dato = /** @type {unknown} */ (await respuesta.json());
    if (
      respuesta.status !== CORRECTO ||
      !dato ||
      typeof dato !== 'object' ||
      Array.isArray(dato) ||
      Object.keys(dato).length !== 1 ||
      /** @type {{ok?:unknown}} */ (dato).ok !== true
    ) {
      throw new CierreNoConfirmado();
    }
    location.assign(new URL('/', location.origin).href);
  } catch (error) {
    if (
      !(
        error instanceof CierreNoConfirmado ||
        error instanceof TypeError ||
        error instanceof SyntaxError ||
        error instanceof DOMException
      )
    ) {
      throw error;
    }
    escribir(aviso, traducible('comun.menu.salir-error'));
    aviso.hidden = false;
    boton.disabled = false;
  }
}
/** @returns {Promise<void>} */
export async function iniciarSalirPortal() {
  const menu = document.getElementById('menu');
  if (!menu || menu.querySelector('.menu-salir') || !(await portalActivo()) || menu.querySelector('.menu-salir')) {
    return;
  }
  const boton = escribir(
    crear('button', { type: 'button', className: 'menu-modo-reintentar menu-salir' }),
    traducible('comun.menu.salir'),
  );
  const aviso = crear('p', { className: 'menu-modo-recorrido', hidden: true });
  aviso.setAttribute('role', 'status');
  aviso.setAttribute('aria-live', 'polite');
  boton.addEventListener('click', () => void salir(boton, aviso));
  menu.append(boton, aviso);
}
