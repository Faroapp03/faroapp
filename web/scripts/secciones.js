// Disponibilidad pública: una respuesta válida manda; sin respuesta solo vale la última política recibida.
// La copia de la entidad es compartida con el service worker y sobrevive a versiones y a «Borrar todo».
// Una copia desconectada no puede recibir una retirada nueva. No se borra lo escrito en una pestaña abierta.
import { TEXTOS_SECCIONES as CA } from '../idiomas/ca/secciones.js';
import { TEXTOS_SECCIONES as ES } from '../idiomas/es/secciones.js';
import { alCambiarIdioma } from './idioma.js';
import { seccionDeLaRuta } from './secciones-contrato.js';
import { consultarAutoridadSecciones } from './secciones-publicas.js';
import { hayDiccionario, idiomaActual, resolver, traducible } from './textos.js';

/** @typedef {import('../../src/administracion/secciones-web.js').DocumentoSecciones} DocumentoSecciones */
/** @typedef {import('../../src/administracion/secciones-web.js').IdSeccionPublica} IdSeccionPublica */
const BASE = new URL('../', import.meta.url);
const URL_SECCIONES = new URL('secciones-v3.json', BASE).href;
export const COPIA_SECCIONES = `faro-secciones-v3:${BASE.href}`;
const PLAZO_SECCIONES_MS = 3000;
/** @type {import('./secciones-publicas.js').MemoriaAutoridad} */
const memoriaSecciones = { actual: null, porAutoridad: new Map(), soloMemoria: false };
/** @type {DocumentoSecciones|null} */
let efectiva = null;
/** @type {Promise<void>|undefined} */
let lectura;
/** @type {Promise<void>|undefined} */
let actualizacion;
let iniciada = false;
/** @type {HTMLElement|null} */
let paginaOcultada = null;
/** @type {Set<HTMLElement>} */
const ocultados = new Set();

/** La red, la comparación y la escritura se serializan con el service worker. */
async function consultar() {
  const resultado = await consultarAutoridadSecciones({
    url: URL_SECCIONES,
    memoria: memoriaSecciones,
    abrir: () => caches.open(COPIA_SECCIONES),
    solicitar: () =>
      fetch(URL_SECCIONES, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(PLAZO_SECCIONES_MS) }),
    bloquear: navigator.locks ? (accion) => navigator.locks.request(COPIA_SECCIONES, accion) : null,
  });
  return resultado.fallo ? null : resultado.documento;
}

/** @param {IdSeccionPublica} id */
export function seccionDisponible(id) {
  return efectiva?.secciones[id] === true;
}
/** Si la política recibida retira la sección; sin política conocida no se sabe y no lo está. @param {IdSeccionPublica} id */
export function seccionOculta(id) {
  return efectiva?.secciones[id] === false;
}
/** @param {HTMLAnchorElement} enlace @returns {IdSeccionPublica|undefined} */
function seccionDelEnlace(enlace) {
  const url = new URL(enlace.href, BASE);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) {
    return undefined;
  }
  return seccionDeLaRuta(`/${url.pathname.slice(BASE.pathname.length)}`);
}
/** El buscador combina este permiso con su filtro, sin poder reabrir una sección retirada.
 * @param {HTMLElement} elemento
 */
export function accesoASeccionDisponible(elemento) {
  const enlace = elemento instanceof HTMLAnchorElement ? elemento : elemento.querySelector('a[href]');
  const seccion = enlace instanceof HTMLAnchorElement ? seccionDelEnlace(enlace) : undefined;
  return seccion === undefined || seccionDisponible(seccion);
}
/** @param {HTMLElement} unidad */
function ocultarUnidad(unidad) {
  if (unidad.hidden) {
    return;
  }
  if (document.activeElement && unidad.contains(document.activeElement)) {
    const boton = document.querySelector('.menu-boton');
    if (boton instanceof HTMLElement) {
      boton.focus();
    }
  }
  unidad.hidden = true;
  ocultados.add(unidad);
}
/**
 * Oculta la unidad semántica del acceso: no deja un li vacío, una tarjeta sin destino ni el grupo de acciones de la
 * apertura de Inicio sin sus enlaces («Empezar» y el informe de ejemplo son los dos del recorrido), ni la invitación a la
 * encuesta del final del recorrido sin su botón.
 */
function aplicarEnlaces() {
  for (const elemento of ocultados) {
    elemento.hidden = false;
  }
  ocultados.clear();
  for (const enlace of document.querySelectorAll('a[href]')) {
    if (!(enlace instanceof HTMLAnchorElement) || accesoASeccionDisponible(enlace)) {
      continue;
    }
    const unidad =
      enlace.closest(
        '.menu-lista > li, .buscador-resultados > li, .historia, .apertura-acciones, .rc-entrega-encuesta',
      ) ?? enlace;
    if (unidad instanceof HTMLElement) {
      ocultarUnidad(unidad);
    }
  }
  aplicarPortada();
  document.dispatchEvent(new Event('faro-secciones'));
}
/** Sin tarjetas, tampoco quedan una introducción vacía ni un enlace a esa introducción. */
function aplicarPortada() {
  const tarjetas = [...document.querySelectorAll('.historias > a[href]')];
  if (
    !tarjetas.length ||
    tarjetas.some((tarjeta) => tarjeta instanceof HTMLElement && accesoASeccionDisponible(tarjeta))
  ) {
    return;
  }
  const explorar = document.getElementById('explorar');
  if (explorar instanceof HTMLElement) {
    ocultarUnidad(explorar);
  }
  for (const enlace of document.querySelectorAll('a[href="#explorar"]')) {
    if (enlace instanceof HTMLElement) {
      ocultarUnidad(enlace);
    }
  }
}
/** La Encuesta oculta tiene su propio aviso: quien llega con su enlace sabe que le seguirá valiendo.
 * @param {IdSeccionPublica} seccion */
function claveDelAviso(seccion) {
  if (!efectiva) {
    return 'secciones.error';
  }
  return seccion === 'encuesta' ? 'secciones.retirada-encuesta' : 'secciones.retirada';
}
/** @param {HTMLElement} contenido @param {boolean} bloqueada @param {IdSeccionPublica} seccion */
function avisoDeSecciones(contenido, bloqueada, seccion) {
  let aviso = document.getElementById('seccion-no-disponible');
  if (!aviso && bloqueada) {
    aviso = document.createElement('section');
    aviso.id = 'seccion-no-disponible';
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('tabindex', '-1');
    contenido.before(aviso);
  }
  if (!aviso) {
    return null;
  }
  const idioma = document.documentElement.lang === 'ca' ? 'ca' : 'es';
  const clave = claveDelAviso(seccion);
  // El aviso debe funcionar incluso antes de cargar el diccionario o si su descarga falla.
  const respaldo = (idioma === 'ca' ? CA : ES)[clave];
  const traducido = hayDiccionario(idioma) && idiomaActual() === idioma ? resolver(traducible(clave)) : clave;
  const mensaje = traducido === clave ? respaldo : traducido;
  aviso.textContent = bloqueada ? mensaje : '';
  aviso.hidden = !bloqueada;
  return aviso;
}
/** @param {HTMLElement} contenido @param {HTMLElement|null} aviso @param {boolean} bloqueada */
function ocultarPagina(contenido, aviso, bloqueada) {
  if (bloqueada && !contenido.hidden) {
    paginaOcultada = contenido;
    contenido.hidden = true;
    if (aviso instanceof HTMLElement && document.activeElement && contenido.contains(document.activeElement)) {
      aviso.focus();
    }
  } else if (!bloqueada && paginaOcultada === contenido) {
    contenido.hidden = false;
    paginaOcultada = null;
  }
}
/** Una pestaña abierta conserva su contenido en memoria; se oculta sin fingir un borrado remoto. */
function aplicarPagina() {
  const ruta = new URL(location.href).pathname;
  if (!ruta.startsWith(BASE.pathname)) {
    return;
  }
  const seccion = seccionDeLaRuta(`/${ruta.slice(BASE.pathname.length)}`);
  const contenido = document.getElementById('contenido');
  if (!seccion || !(contenido instanceof HTMLElement)) {
    return;
  }
  const bloqueada = !seccionDisponible(seccion);
  const aviso = avisoDeSecciones(contenido, bloqueada, seccion);
  ocultarPagina(contenido, aviso, bloqueada);
  const salto = document.querySelector('a.salto');
  if (salto instanceof HTMLAnchorElement) {
    salto.href = bloqueada ? '#seccion-no-disponible' : '#contenido';
  }
}
/** Una sola consulta concurrente por página; la revisión también protege frente a otras pestañas y al SW. */
export function actualizarSecciones() {
  actualizacion ??= consultar()
    .then((documento) => {
      efectiva = documento;
      aplicarEnlaces();
      aplicarPagina();
    })
    .finally(() => {
      actualizacion = undefined;
    });
  return actualizacion;
}
/** Se espera antes de iniciar los módulos de página; no añade sondeos ni reinicia recorridos. */
export function iniciarSecciones() {
  if (!iniciada) {
    iniciada = true;
    alCambiarIdioma(aplicarPagina);
    window.addEventListener('online', () => {
      void actualizarSecciones();
    });
    window.addEventListener('pageshow', () => {
      void actualizarSecciones();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void actualizarSecciones();
      }
    });
  }
  lectura ??= actualizarSecciones();
  return lectura;
}
