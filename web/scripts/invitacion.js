// La invitación del piloto: cada participante recibe un enlace /inicio.html#invitacion=<código> con un código de un
// solo uso de la encuesta. Al evaluarse este módulo (lo importa sitio.js, así que llega a todas las páginas), el código
// sale del fragmento y de la dirección de la pestaña y se guarda solo en el almacenamiento de la pestaña
// (sessionStorage), hasta que se responde la encuesta, se pulsa «Borrar todo» o se cierra la pestaña. Un código sin la
// forma de un código de participante se ignora sin decir nada. El código no viaja al servidor hasta que se responde:
// la encuesta lo recibe en el fragmento de su dirección (encuesta.html#codigo=…) y lo envía en el cuerpo del envío.
// Mientras haya una invitación guardada, el pie de la página lleva un enlace discreto a la encuesta; la vista final del
// recorrido la ofrece de forma destacada (recorrido/entrega-final.js). Con la encuesta oculta en la web, el pie dice en
// su lugar que no está disponible ahora y la invitación sigue guardada: al volver a mostrarla, el mismo enlace vale.

import { escucharBorrado } from './aviso-de-borrado.js';
import { crear } from './dom.js';
import { FORMATO } from './encuesta-codigo.js';
import { escribir, escribirAtributo } from './idioma.js';
import { seccionOculta } from './secciones.js';
import { conVersiones } from './textos.js';

/** La marca del fragmento que lleva la invitación, como la escribe el panel en cada enlace de participante. */
const MARCA = '#invitacion=';
/** La clave de la pestaña: empieza por «faro-», así que «Borrar todo» la retira (borrar-datos.js). */
export const CLAVE_INVITACION = 'faro-invitacion';
/** El canal con que una pestaña avisa a las demás de esta web (no sale del dispositivo) del código ya usado. */
const CANAL_INVITACION = 'faro-invitacion';
const PREFIJO_PARTICIPANTE = 'PART-';
const CLASE_DEL_ENLACE = 'pie-encuesta';
const TEXTO_DEL_ENLACE = conVersiones({ es: 'Encuesta del piloto', ca: 'Enquesta de la prova pilot' });
/** Su nombre para los lectores de pantalla, que avisa de que se abre en otra pestaña. */
const NOMBRE_DEL_ENLACE = conVersiones({
  es: 'Encuesta del piloto (se abre en otra pestaña)',
  ca: 'Enquesta de la prova pilot (s’obre en una altra pestanya)',
});
const TEXTO_NO_DISPONIBLE = conVersiones({
  es: 'La encuesta no está disponible ahora. Tu invitación sigue guardada en esta pestaña.',
  ca: 'L’enquesta no està disponible ara. La teva invitació continua desada en aquesta pestanya.',
});
/** Si esta pestaña ya escucha los avisos de las demás: se abren una sola vez. */
let escuchando = false;

/** @param {unknown} valor @returns {valor is string} */
function esInvitacion(valor) {
  return typeof valor === 'string' && FORMATO.test(valor) && valor.startsWith(PREFIJO_PARTICIPANTE);
}

/** La dirección de la encuesta con el código ya puesto, en el fragmento. @param {string} codigo @returns {string} */
export function enlaceDeLaEncuesta(codigo) {
  return `encuesta.html#codigo=${codigo}`;
}

/** El código de la invitación guardada en esta pestaña, o null. @returns {string | null} */
export function invitacionGuardada() {
  try {
    const valor = sessionStorage.getItem(CLAVE_INVITACION);
    return esInvitacion(valor) ? valor : null;
  } catch {
    // Sin almacenamiento de la pestaña (bloqueado o inexistente) no hay invitación guardada.
    return null;
  }
}

/** Quita de la página los accesos a la encuesta que dependen de la invitación. */
function retirarAccesos() {
  if (typeof document === 'undefined') {
    return;
  }
  for (const acceso of document.querySelectorAll(`.${CLASE_DEL_ENLACE}, .rc-entrega-encuesta`)) {
    acceso.remove();
  }
}

/** Borra la invitación de esta pestaña y sus accesos, sin avisar a las demás. */
function borrarAqui() {
  try {
    sessionStorage.removeItem(CLAVE_INVITACION);
  } catch {
    // Sin almacenamiento de la pestaña no hay nada que borrar.
  }
  retirarAccesos();
}

/** Si `usado` es el código de la invitación de esta pestaña, la olvida. @param {unknown} usado */
function olvidarSiEs(usado) {
  if (usado === invitacionGuardada()) {
    borrarAqui();
  }
}

/**
 * Al responder la encuesta con `usado`: la invitación con ese código se olvida en esta pestaña y en las demás de esta
 * web que la tengan (la encuesta se abre en otra pestaña, que no comparte el almacenamiento de la del recorrido).
 * @param {string} usado
 */
export function olvidarInvitacion(usado) {
  olvidarSiEs(usado);
  if (typeof BroadcastChannel === 'function') {
    const canal = new BroadcastChannel(CANAL_INVITACION);
    canal.postMessage(usado);
    canal.close();
  }
}

/** El valor descodificado de `#invitacion=…`, o null si no se puede descodificar. @param {string} valor */
function descodificado(valor) {
  try {
    return decodeURIComponent(valor);
  } catch {
    return null;
  }
}

/**
 * Toma la invitación de participante del fragmento, la retira de la dirección de la pestaña y la guarda en ella.
 * Devuelve el código, o null si la dirección no traía una invitación con la forma correcta. Solo toca los fragmentos
 * cuyo valor empieza por PART-: la misma marca `#invitacion=` lleva también la invitación de socio de
 * activar-acceso.html (conectividad/fragmento.js), que se queda intacta para su página, cargue antes o después que este
 * módulo; y cualquier otro fragmento del sitio (#t-datos, #pasar=…) tampoco se toca.
 * @returns {string | null}
 */
export function recogerInvitacion() {
  if (typeof location === 'undefined' || !location.hash.startsWith(MARCA)) {
    return null;
  }
  const codigo = descodificado(location.hash.slice(MARCA.length));
  if (codigo === null || !codigo.startsWith(PREFIJO_PARTICIPANTE)) {
    return null;
  }
  // Empieza como una invitación de participante: sale de la dirección aunque no tenga la forma completa.
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  if (!esInvitacion(codigo)) {
    return null;
  }
  try {
    sessionStorage.setItem(CLAVE_INVITACION, codigo);
  } catch {
    // Almacenamiento bloqueado: la invitación no se puede conservar y la persona responde sin ella.
    return null;
  }
  return codigo;
}

/**
 * Si hay una invitación guardada, añade al pie un enlace discreto a la encuesta, que abre en otra pestaña para no
 * perder el recorrido, o, con la encuesta oculta, la frase que dice que no está disponible ahora. En la propia encuesta
 * no se añade.
 */
function mostrarAccesoALaEncuesta() {
  const codigo = invitacionGuardada();
  const pie = document.querySelector('footer nav');
  const yaEsta = pie?.querySelector(`.${CLASE_DEL_ENLACE}`);
  if (codigo === null || !pie || yaEsta || location.pathname.endsWith('/encuesta.html')) {
    return;
  }
  if (seccionOculta('encuesta')) {
    pie.append(escribir(crear('span', { className: CLASE_DEL_ENLACE }), TEXTO_NO_DISPONIBLE));
    return;
  }
  const enlace = crear('a', {
    className: CLASE_DEL_ENLACE,
    href: enlaceDeLaEncuesta(codigo),
    target: '_blank',
    rel: 'noopener',
  });
  escribirAtributo(enlace, 'aria-label', NOMBRE_DEL_ENLACE);
  pie.append(escribir(enlace, TEXTO_DEL_ENLACE));
}

/**
 * Lo que hace la invitación en cada página, desde sitio.js con los textos ya cargados: el enlace del pie y las escuchas
 * de las demás pestañas (la encuesta ya respondida y «Borrar todo»).
 */
export function iniciarInvitacion() {
  // Sin invitación en esta pestaña no hay nada que mostrar ni que olvidar: no se abre ninguna escucha.
  if (invitacionGuardada() === null) {
    return;
  }
  mostrarAccesoALaEncuesta();
  if (escuchando) {
    return;
  }
  escuchando = true;
  if (typeof BroadcastChannel === 'function') {
    new BroadcastChannel(CANAL_INVITACION).addEventListener('message', (evento) => olvidarSiEs(evento.data));
  }
  escucharBorrado(borrarAqui);
}

// Al evaluarse, antes que el resto de la página: la invitación sale de la dirección en cuanto se carga el módulo.
recogerInvitacion();
// Pegar el enlace en una pestaña que ya muestra la misma página de Faro no la recarga: solo cambia el fragmento.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (recogerInvitacion() !== null) {
      iniciarInvitacion();
    }
  });
}
