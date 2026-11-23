// La encuesta del piloto (encuesta.html). Toma el código de la invitación del fragmento de la dirección (lo recoge y lo
// quita scripts/encuesta-fragmento.js) o del campo donde se teclea, enseña las preguntas de su tipo (PART, las personas
// que han usado Faro; PROF, las profesionales de orientación) y envía las respuestas cerradas al servidor, que las
// suma al agregado y gasta el código (src/encuesta/punto-publico.ts). Las preguntas son las de
// src/encuesta/cuestionario.ts. No guarda nada en el dispositivo y no envía nada
// más que el código y las respuestas. Sin JavaScript se lee la página, pero no se puede responder.

import { FORMATO, normalizarCodigo } from './encuesta-codigo.js';
import { tomarCodigo } from './encuesta-fragmento.js';
import { olvidarInvitacion } from './invitacion.js';
import './sitio.js';
import { porId } from './dom.js';
import { escribir } from './idioma.js';
import { traducible } from './textos.js';

/** El punto del servidor que recibe las respuestas. */
const RUTA = '/encuesta/responder';
/** Los puntos de la escala de 1 a 5, que se envían como números enteros; cualquier otro valor va como texto. */
const PUNTO_DE_ESCALA = /^[1-5]$/;
/** La primera pregunta de las personas y su respuesta «No he podido llegar a verlo», que envía solo esa pregunta. */
const FILTRO = 'informe';
const SIN_VER = 'sin_ver';
/** Las respuestas del servidor que tienen mensaje propio; cualquier otra, o ninguna, es un fallo del envío. */
const SUMADA = 200;
const SOLICITUD_INCORRECTA = 400;
const CODIGO_QUE_NO_SIRVE = 409;
const DEMASIADOS_ENVIOS = 429;
const NO_DISPONIBLE = 503;

const pasoCodigo = porId('encuesta-paso-codigo');
const formularioCodigo = porId('encuesta-formulario-codigo', HTMLFormElement);
const campo = porId('encuesta-codigo', HTMLInputElement);
const participante = porId('encuesta-participante', HTMLFormElement);
const profesional = porId('encuesta-profesional', HTMLFormElement);
const siVisto = porId('encuesta-si-visto');
const entradaParticipante = porId('encuesta-entrada-participante');
const entradaProfesional = porId('encuesta-entrada-profesional');
const estado = porId('encuesta-estado');
const cambiar = porId('encuesta-cambiar', HTMLButtonElement);
const gracias = porId('encuesta-gracias');

/** El código en uso, en forma canónica, o null mientras no hay uno con la forma correcta. */
let codigo = /** @type {string | null} */ (null);

/** @param {string | null} clave - La clave del mensaje, o null para vaciarlo. @param {boolean} [enfocar] */
function avisar(clave, enfocar = false) {
  if (clave === null) {
    estado.replaceChildren();
    return;
  }
  escribir(estado, traducible(`encuesta.estado.${clave}`));
  if (enfocar) {
    estado.focus();
  }
}

/** @param {HTMLFormElement} formulario @param {boolean} ocupado */
function ocupar(formulario, ocupado) {
  for (const boton of formulario.querySelectorAll('button[type="submit"]')) {
    if (boton instanceof HTMLButtonElement) {
      boton.disabled = ocupado;
    }
  }
}

/** Enseña las preguntas del tipo del código y lleva el foco a la primera. @param {string} valido */
function empezar(valido) {
  codigo = valido;
  const esProfesional = valido.startsWith('PROF');
  const formulario = esProfesional ? profesional : participante;
  // Cada formulario lleva su propia entrada: qué se pregunta, cuánto se tarda y qué se guarda.
  entradaParticipante.hidden = esProfesional;
  entradaProfesional.hidden = !esProfesional;
  pasoCodigo.hidden = true;
  formulario.hidden = false;
  cambiar.hidden = false;
  avisar(null);
  formulario.querySelector('input')?.focus();
}

/** Vuelve al paso del código, con el campo vacío y las respuestas sin marcar. */
function otroCodigo() {
  codigo = null;
  for (const formulario of [participante, profesional]) {
    formulario.reset();
    formulario.hidden = true;
  }
  mostrarSiVisto(true);
  entradaParticipante.hidden = false;
  entradaProfesional.hidden = true;
  cambiar.hidden = true;
  pasoCodigo.hidden = false;
  campo.value = '';
  avisar(null);
  campo.focus();
}

/** @param {boolean} visible - Si se ven las preguntas de quien ha visto su informe. */
function mostrarSiVisto(visible) {
  siVisto.hidden = !visible;
  for (const entrada of siVisto.querySelectorAll('input')) {
    entrada.disabled = !visible;
  }
}

/**
 * Las respuestas marcadas, como las espera el servidor, o el primer grupo sin respuesta.
 * @param {HTMLFormElement} formulario
 * @returns {{ respuestas: Record<string, string | number> } | { falta: HTMLFieldSetElement }}
 */
function leerRespuestas(formulario) {
  /** @type {Record<string, string | number>} */
  const respuestas = {};
  for (const grupo of formulario.querySelectorAll('fieldset[data-pregunta]')) {
    if (!(grupo instanceof HTMLFieldSetElement) || grupo.closest('[hidden]')) {
      continue;
    }
    const nombre = grupo.dataset.pregunta ?? '';
    const marcada = grupo.querySelector('input:checked');
    if (!(marcada instanceof HTMLInputElement)) {
      return { falta: grupo };
    }
    respuestas[nombre] = PUNTO_DE_ESCALA.test(marcada.value) ? Number(marcada.value) : marcada.value;
  }
  return { respuestas };
}

/** @param {number} estadoHttp @returns {string} La clave del mensaje de un envío rechazado. */
function motivoDe(estadoHttp) {
  switch (estadoHttp) {
    case CODIGO_QUE_NO_SIRVE:
      return 'codigo-no-valido';
    case SOLICITUD_INCORRECTA:
      return 'faltan';
    case DEMASIADOS_ENVIOS:
      return 'muchos';
    case NO_DISPONIBLE:
      return 'no-disponible';
    default:
      return 'sin-conexion';
  }
}

/** @param {HTMLFormElement} formulario @param {Record<string, string | number>} respuestas */
async function enviar(formulario, respuestas) {
  ocupar(formulario, true);
  avisar('enviando');
  let estadoHttp = 0;
  try {
    const respuesta = await fetch(RUTA, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codigo, respuestas }),
      cache: 'no-store',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
    estadoHttp = respuesta.status;
  } catch {
    estadoHttp = 0;
  } finally {
    ocupar(formulario, false);
  }
  if (estadoHttp === SUMADA) {
    // El código ya no sirve: si era el de la invitación guardada, se olvida en todas las pestañas.
    if (codigo !== null) {
      olvidarInvitacion(codigo);
    }
    codigo = null;
    formulario.hidden = true;
    cambiar.hidden = true;
    avisar(null);
    gracias.hidden = false;
    gracias.focus();
    return;
  }
  avisar(motivoDe(estadoHttp), true);
}

/** @param {SubmitEvent} evento */
function alResponder(evento) {
  evento.preventDefault();
  const formulario = /** @type {HTMLFormElement} */ (evento.currentTarget);
  if (codigo === null) {
    return;
  }
  const leidas = leerRespuestas(formulario);
  if ('falta' in leidas) {
    avisar('faltan');
    leidas.falta.querySelector('input')?.focus();
    return;
  }
  const { respuestas } = leidas;
  void enviar(formulario, respuestas[FILTRO] === SIN_VER ? { [FILTRO]: SIN_VER } : respuestas);
}

formularioCodigo.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const canonico = normalizarCodigo(campo.value);
  campo.value = canonico;
  if (!FORMATO.test(canonico)) {
    avisar('codigo-formato', true);
    return;
  }
  empezar(canonico);
});
participante.addEventListener('change', (evento) => {
  const objetivo = evento.target;
  if (objetivo instanceof HTMLInputElement && objetivo.name === FILTRO) {
    mostrarSiVisto(objetivo.value !== SIN_VER);
  }
});
participante.addEventListener('submit', alResponder);
profesional.addEventListener('submit', alResponder);
cambiar.addEventListener('click', otroCodigo);

// El paso del código empieza oculto: quien llega con su enlace pasa directo a las preguntas y nunca ve el campo; solo
// se enseña a quien llega sin código o con uno que no tiene la forma correcta.
const recibido = tomarCodigo();
const canonico = recibido === null ? null : normalizarCodigo(recibido);
if (canonico !== null && FORMATO.test(canonico)) {
  empezar(canonico);
} else {
  pasoCodigo.hidden = false;
  if (canonico !== null) {
    campo.value = canonico;
    avisar('codigo-formato');
  }
}
