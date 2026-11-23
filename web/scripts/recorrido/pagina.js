// Lo que el recorrido anuncia a la persona fuera de la conversación y la espera mientras responde la API.
//
// Anuncios: #rc-estado (role="status", solo para lectores de pantalla) confirma acciones pequeñas que no son un
// mensaje de Faro («Tarea 2 quitada»). Está siempre en la página, vacía cuando no hay nada que decir: un lector de
// pantalla anuncia el texto que se escribe en una región que ya existe, no siempre el de una que aparece de golpe.
//
// Fallos: los cuenta Faro en la conversación, con palabras claras y el paso siguiente; nunca un error técnico.
//
// Espera: mientras se espera a la API, Faro lo dice con un mensaje fijo, el formulario que la pidió queda ocupado
// (aria-busy) y sus botones, bloqueados. aria-busy va solo en ese formulario, nunca en un antecesor de la
// conversación, para no silenciar sus mensajes.

import { crear, porId } from '../dom.js';
import { escribir } from '../idioma.js';
import { ERROR_GENERICO, ErrorFaro, esCancelacion } from './api/errores.js';
import { decirFaro, mostrarEspera, quitarEspera } from './conversacion.js';

/** @import { Parte } from '../textos.js' */

/**
 * Los botones que se bloquean mientras se espera: todos los del formulario menos «Volver», que cancela la espera.
 * Se bloquean con aria-disabled y no con disabled, para que el foco se quede donde estaba.
 */
const BOTONES_BLOQUEABLES = 'button:not([data-volver])';

/**
 * Lo que necesita una espera (enEspera): el botón que la pidió, el mensaje fijo de Faro, el trabajo que se espera y,
 * si se da, cómo contar su fallo.
 * @template Resultado
 * @typedef {Object} Espera
 * @property {Element | null} boton
 * @property {Parte} aviso
 * @property {() => Promise<Resultado>} trabajo
 * @property {(error: unknown) => void} [alFallar]
 */

/** Hay una petición en curso: ninguna acción del recorrido empieza otra hasta que termine (enEspera, soltarEspera). */
let peticionEnCurso = false;
/**
 * Cada espera tiene su turno. Al soltarla (la persona vuelve atrás o borra todo) el turno cambia: lo que la espera
 * vieja haga al terminar ya no toca la página, que puede estar esperando otra respuesta. Lo suben enEspera y
 * soltarEspera.
 */
let turno = 0;
/**
 * Cada mensaje de error que señala un campo necesita su propio id, para que el campo pueda citarlo; lo sube
 * marcarCampoConError.
 */
let erroresSenalados = 0;
/**
 * Cada campo conserva una sola marca de error y la forma de retirarla sin perder su ayuda original.
 * @type {WeakMap<HTMLElement, () => void>}
 */
const erroresPorCampo = new WeakMap();

/**
 * Hay una petición a la API sin responder: nada del recorrido empieza otra.
 * @returns {boolean}
 */
export function hayPeticionEnCurso() {
  return peticionEnCurso;
}

/**
 * Lo que se escribe aquí (un traducible) lo leen los lectores de pantalla (role="status").
 * @param {Parte} aviso @returns {void}
 */
export function anunciar(aviso) {
  escribir(porId('rc-estado'), aviso);
}

/**
 * Faro cuenta en la conversación qué ha fallado y qué se puede hacer.
 * @param {Parte} explicacion
 * @returns {HTMLElement} el mensaje de Faro
 */
export function mostrarError(explicacion) {
  return decirFaro(explicacion, { tipo: 'error' });
}

/**
 * Apunta en `campo` el error que Faro acaba de contar: aria-invalid y aria-describedby al mensaje. La marca se quita
 * al cambiar el campo o elegir otra opción de su grupo de radios. Un error nuevo sustituye la marca anterior.
 * @param {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null} campo @param {HTMLElement} mensaje
 * @returns {void}
 */
function marcarCampoConError(campo, mensaje) {
  if (!campo) {
    return;
  }
  erroresPorCampo.get(campo)?.();
  erroresSenalados += 1;
  mensaje.id = `rc-error-${erroresSenalados}`;
  const descripcionesAntes = campo.getAttribute('aria-describedby');
  const citados = (descripcionesAntes ?? '').split(/\s+/).filter(Boolean);
  campo.setAttribute('aria-invalid', 'true');
  campo.setAttribute('aria-describedby', [...new Set([...citados, mensaje.id])].join(' '));
  const limpiar = new AbortController();
  const quitarLaMarca = () => {
    limpiar.abort();
    erroresPorCampo.delete(campo);
    campo.removeAttribute('aria-invalid');
    if (descripcionesAntes === null) {
      campo.removeAttribute('aria-describedby');
    } else {
      campo.setAttribute('aria-describedby', descripcionesAntes);
    }
  };
  erroresPorCampo.set(campo, quitarLaMarca);
  const grupo = campo.type === 'radio' ? campo.closest('fieldset') : null;
  /** @param {Event} evento */
  const alCorregir = (evento) => {
    // El cambio llega de un campo del formulario (un <input>), que tiene `type` y `name`.
    const objetivo = /** @type {{ type?: string, name?: string } | null} */ (evento.target);
    if (grupo && (objetivo?.type !== 'radio' || objetivo.name !== campo.name)) {
      return;
    }
    quitarLaMarca();
  };
  for (const cambio of ['input', 'change']) {
    (grupo ?? campo).addEventListener(cambio, alCorregir, { signal: limpiar.signal });
  }
}

/**
 * Faro cuenta en la conversación qué falta y `campo` queda marcado como el que hay que corregir, citando el mensaje de
 * Faro (aria-invalid y aria-describedby). Así un lector de pantalla lee el error al llegar el foco al campo, aunque el
 * salto del foco corte el anuncio de la conversación (WCAG 3.3.1). Quien llama lleva el foco al campo después.
 * @param {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null} campo @param {Parte} explicacion
 * @returns {HTMLElement} el mensaje de Faro
 */
export function mostrarErrorDe(campo, explicacion) {
  const mensaje = mostrarError(explicacion);
  marcarCampoConError(campo, mensaje);
  return mensaje;
}

/**
 * Pinta los avisos como párrafos, cada uno con su tipo: los del recorrido son traducibles; los de la API, literales
 * con su idioma.
 * @param {HTMLElement} contenedor @param {{ tipo: string, texto: Parte }[]} avisos @returns {void}
 */
export function pintarAvisos(contenedor, avisos) {
  const parrafos = avisos.map((aviso) => {
    const parrafo = escribir(crear('p'), aviso.texto);
    parrafo.dataset.tipo = aviso.tipo;
    return parrafo;
  });
  contenedor.replaceChildren(...parrafos);
}

/**
 * Lleva el foco a `elemento`. El navegador solo desplaza la página si no se ve, y respeta el hueco de la barra de
 * escritura (scroll-padding en estilos/recorrido/conversacion.css), así que nada queda enfocado detrás de ella.
 * @param {HTMLElement | null | undefined} elemento @returns {void}
 */
export function enfocar(elemento) {
  elemento?.focus();
}

/**
 * Marca el formulario como ocupado (aria-busy) y bloquea sus botones, o lo libera.
 * @param {Element | null | undefined} formulario @param {boolean} ocupado @returns {void}
 */
function marcarOcupado(formulario, ocupado) {
  if (!formulario) {
    return;
  }
  if (ocupado) {
    formulario.setAttribute('aria-busy', 'true');
  } else {
    formulario.removeAttribute('aria-busy');
  }
  for (const boton of formulario.querySelectorAll(BOTONES_BLOQUEABLES)) {
    if (ocupado) {
      boton.setAttribute('aria-disabled', 'true');
    } else {
      boton.removeAttribute('aria-disabled');
    }
  }
}

/**
 * Faro cuenta el fallo con palabras claras; la pista técnica de un fallo inesperado va a la consola.
 * @param {unknown} error @returns {void}
 */
export function avisarDelFallo(error) {
  const esDeFaro = error instanceof ErrorFaro;
  mostrarError(esDeFaro ? error.explicacion : ERROR_GENERICO);
  if (!esDeFaro) {
    console.error(error);
  }
}

/**
 * Mientras se espera a la API: el formulario de `boton` ocupado, sus botones bloqueados y `aviso` como mensaje fijo de
 * Faro. Devuelve lo que devuelva `trabajo`, o undefined si ha fallado, si se ha cancelado o soltado, o si ya había
 * otra petición en curso. Un fallo lo cuenta Faro; `alFallar(error)`, si se da, lo cuenta a su manera (con sus
 * respuestas rápidas).
 * @template Resultado
 * @param {Espera<Resultado>} espera @returns {Promise<Resultado | undefined>}
 */
export async function enEspera({ boton, aviso, trabajo, alFallar = avisarDelFallo }) {
  if (peticionEnCurso) {
    return undefined;
  }
  turno += 1;
  const miTurno = turno;
  const formulario = boton?.closest('form');
  peticionEnCurso = true;
  marcarOcupado(formulario, true);
  mostrarEspera(aviso);
  try {
    const resultado = await trabajo();
    // Si la espera se soltó mientras llegaba la respuesta, ya no le corresponde a lo que se ve.
    return miTurno === turno ? resultado : undefined;
  } catch (error) {
    if (miTurno !== turno) {
      return undefined;
    }
    quitarEspera();
    if (!esCancelacion(error)) {
      alFallar(error);
    }
    return undefined;
  } finally {
    // Con éxito, se libera el formulario y se retira la espera antes de que quien llamó pinte la respuesta o diga lo
    // siguiente. En un fallo, `alFallar` ya ha corrido en el `catch`, con la espera quitada pero el formulario aún
    // ocupado; el `finally` lo libera justo después.
    if (miTurno === turno) {
      peticionEnCurso = false;
      marcarOcupado(formulario, false);
      quitarEspera();
    }
  }
}

/**
 * Suelta la espera en curso sin esperar a que termine: la persona ha vuelto atrás o ha borrado todo (las peticiones
 * ya se han cancelado). Todo queda libre en el acto para lo siguiente, que puede ser otra petición.
 * @returns {void}
 */
export function soltarEspera() {
  turno += 1;
  peticionEnCurso = false;
  for (const formulario of document.querySelectorAll('form[aria-busy]')) {
    marcarOcupado(formulario, false);
  }
  quitarEspera();
}
