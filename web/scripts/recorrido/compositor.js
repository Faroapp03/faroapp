// La barra de escritura del recorrido, al pie de la conversación: un campo que crece con el texto, «Ayuda» (en
// ayudas.js), «Ampliar», el botón de enviar y, debajo, el recordatorio de que Faro es una IA y puede equivocarse, con
// el aviso completo de privacidad desplegable.
//
// Cada paso la usa a su manera con un «modo»: en la ocupación, lo que se escribe es la respuesta a «¿A qué te dedicas?»
// al motor local; en las tareas, lo que la persona hace de más. El estado de la barra dice su etiqueta, su texto
// de ejemplo, su límite de caracteres y qué se hace con el
// texto al enviarlo.
//
// Cuando lo que cabe se agota (el relato llegó a MAX_LETRAS_MENSAJE caracteres), la barra queda llena: lo dice en su contador,
// deja de enviar, conserva lo escrito y el paso que la usa ofrece por dónde seguir. Nunca se queda admitiendo cero
// letras, que borraría el borrador sin decir nada.
//
// Teclado: Enter envía y Mayúsculas + Enter salta de línea. Con la escritura ampliada, para textos largos, Enter salta
// de línea y Control (o Comando) + Enter envía; Escape la reduce. Mientras se compone un carácter con un método de
// entrada (acentos, alfabetos asiáticos), Enter confirma el carácter y no envía.
//
// El recorrido se procesa en el dispositivo; el estado de conexión no cambia el transporte ni descarta el texto.

import { porId } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { MAX_RELATO as MAX_LETRAS_MENSAJE } from '../protocolo-web.js';
import { traducible } from '../textos.js';
import { EVENTO_PENSANDO, faroEstaPensando } from './conversacion.js';
import { formatearNumero } from './formato.js';
import { anunciar, enfocar, hayPeticionEnCurso } from './pagina.js';

/** @import { Parte } from '../textos.js' */

/**
 * Igual que el maxlength de #mensaje en recorrido.html y que el límite del relato en el motor (MAX_RELATO,
 * pruebas/web-recorrido-interfaz/compositor.test.ts).
 */
export { MAX_RELATO as MAX_LETRAS_MENSAJE } from '../protocolo-web.js';

/** Lo menos que puede quedar libre para que se pueda escribir algo: con menos, la barra está llena. */
const MINIMO_QUE_CABE = 1;
/** El contador solo aparece a partir de esta parte del límite (el 90 %): antes solo distrae. */
const AVISAR_DESDE = 0.9;
/** Líneas hasta las que crece el campo antes de desplazarse por dentro: normal y con la escritura ampliada. */
const LINEAS_MAXIMAS = 6;
const LINEAS_MAXIMAS_AMPLIADO = 14;
/** Cómo se envía con la escritura ampliada: Comando en los Mac, iPhone y iPad; Control en los demás. */
// @ts-expect-error `userAgentData` (User-Agent Client Hints) aún no está en los tipos del DOM; donde falta, `platform`.
const TECLA_DE_ENVIO_AMPLIADO = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform ?? navigator.platform)
  ? '⌘'
  : 'Ctrl';

/**
 * Lo que hace la barra en cada paso (cambiarModo): su etiqueta y su texto de ejemplo, traducibles; su límite de
 * caracteres (MAX_LETRAS_MENSAJE si no se da) y qué se hace con el texto enviado.
 * @typedef {{ etiqueta: Parte, marcador: Parte, limite?: number, alEnviar: (texto: string) => void }} ConfiguracionDeLaBarra
 */

/**
 * Lo que se hace con el texto enviado en el paso actual (lo fija cada paso con cambiarModo).
 * @type {(texto: string) => void}
 */
let alEnviarEnEsteModo = () => {};

/** El campo de la barra y si la escritura está ampliada: recorrido.html los tiene siempre. */
function campo() {
  return porId('mensaje', HTMLTextAreaElement);
}
function estaAmpliado() {
  return porId('compositor').dataset.ampliado === 'true';
}

/**
 * Con `limite` letras libres ya no cabe nada: la barra está llena. Es un estado propio, no un campo que admite cero
 * letras: la barra lo dice, no borra lo escrito y el paso que la usa ofrece por dónde seguir.
 * @param {number} limite @returns {boolean}
 */
function barraLlena(limite) {
  return limite < MINIMO_QUE_CABE;
}

/** La barra está llena ahora mismo. */
function estaLlena() {
  return porId('compositor').dataset.lleno === 'true';
}

/**
 * Crece con el texto hasta LINEAS_MAXIMAS (o LINEAS_MAXIMAS_AMPLIADO); por CSSOM, que la política de contenidos
 * permite.
 */
function ajustarAltura() {
  const elemento = campo();
  // Vacío, mide una línea (la del CSS): el texto de ejemplo no debe estirar la barra.
  if (!elemento.value) {
    elemento.style.height = '';
    elemento.classList.remove('rc-desborda');
    return;
  }
  const estilo = getComputedStyle(elemento);
  const relleno = Number.parseFloat(estilo.paddingTop) + Number.parseFloat(estilo.paddingBottom);
  const lineas = estaAmpliado() ? LINEAS_MAXIMAS_AMPLIADO : LINEAS_MAXIMAS;
  const maxima = Number.parseFloat(estilo.lineHeight) * lineas + relleno;
  elemento.style.height = 'auto';
  elemento.style.height = `${Math.min(elemento.scrollHeight, maxima)}px`;
  elemento.classList.toggle('rc-desborda', elemento.scrollHeight > maxima);
}

/** El contador dice cuánto queda solo cuando falta poco, y siempre con el mismo límite que el campo. */
function actualizarContador() {
  const limite = campo().maxLength;
  const escritas = campo().value.length;
  /** @type {Parte} */
  let aviso = '';
  if (estaLlena()) {
    aviso = traducible('recorrido.compositor.maximo', { maximo: formatearNumero(MAX_LETRAS_MENSAJE) });
  } else if (escritas >= limite * AVISAR_DESDE) {
    aviso = traducible('recorrido.compositor.contador', {
      escritas: formatearNumero(escritas),
      limite: formatearNumero(limite),
    });
  }
  escribir(porId('contador-mensaje'), aviso);
}

/** Cada cambio del texto ajusta la altura y el contador. */
function alEscribir() {
  ajustarAltura();
  actualizarContador();
}

/**
 * Envía lo escrito al modo actual. Mientras Faro responde, no envía nada y el texto se queda en el campo.
 * @param {SubmitEvent} evento
 */
function enviar(evento) {
  evento.preventDefault();
  // Llena, la barra no envía: lo que se quiera contar no cabría, y el paso ya ha dicho por dónde seguir.
  if (estaLlena()) {
    return;
  }
  const texto = campo().value.trim();
  if (!texto) {
    enfocarCompositor();
    return;
  }
  if (hayPeticionEnCurso()) {
    return;
  }
  // Mientras Faro piensa, tampoco: lo escrito se queda en el campo y se dice por qué no sale.
  if (faroEstaPensando()) {
    anunciar(traducible('recorrido.pensamiento.barra'));
    return;
  }
  campo().value = '';
  alEscribir();
  alEnviarEnEsteModo(texto);
}

/** Cómo se envía: «Enter para enviar» o, con la escritura ampliada, la tecla que lo hace. @returns {Parte} */
function teclasDeEnvio() {
  return estaAmpliado()
    ? traducible('recorrido.compositor.enter-ampliado', { tecla: TECLA_DE_ENVIO_AMPLIADO })
    : traducible('recorrido.compositor.enter');
}

/**
 * Mientras Faro piensa, la barra no envía: el botón se ve bloqueado (aria-disabled, para que el foco se quede donde
 * está) y su nombre y la línea de las teclas dicen «Faro está pensando…». Lo escrito se queda. Al aparecer la
 * respuesta, todo vuelve (conversacion.js avisa con EVENTO_PENSANDO).
 */
function aplicarPensando() {
  const pensando = faroEstaPensando();
  const formulario = porId('compositor');
  if (pensando === (formulario.dataset.pensando === 'true')) {
    return;
  }
  formulario.dataset.pensando = String(pensando);
  // El botón de enviar de recorrido.html es un <button>.
  /** @type {HTMLButtonElement | null} */
  const boton = formulario.querySelector('.rc-enviar');
  if (boton) {
    const nombre = pensando ? 'recorrido.pensamiento.barra' : 'recorrido.compositor.enviar';
    escribirAtributo(boton, 'aria-label', traducible(nombre));
    if (pensando) {
      boton.setAttribute('aria-disabled', 'true');
    } else {
      boton.removeAttribute('aria-disabled');
    }
  }
  escribir(porId('rc-teclas'), pensando ? traducible('recorrido.pensamiento.barra') : teclasDeEnvio());
}

/**
 * Amplía o reduce la escritura: más alto el campo, y Enter salta de línea en lugar de enviar. El botón dice lo que
 * hará («Ampliar» o «Reducir») y el foco vuelve al campo, donde se estaba escribiendo.
 * @param {boolean} activo
 */
function ampliar(activo) {
  porId('compositor').dataset.ampliado = String(activo);
  escribir(
    porId('ampliar-texto'),
    traducible(activo ? 'recorrido.compositor.reducir' : 'recorrido.compositor.ampliar'),
  );
  if (!faroEstaPensando()) {
    escribir(porId('rc-teclas'), teclasDeEnvio());
  }
  campo().enterKeyHint = activo ? 'enter' : 'send';
  ajustarAltura();
  campo().focus({ preventScroll: true });
}

/**
 * Envía el formulario como su botón de enviar: requestSubmit o, donde no lo hay (Safari 15), un evento submit.
 * @param {HTMLFormElement} formulario
 */
function enviarFormulario(formulario) {
  if (typeof formulario.requestSubmit === 'function') {
    formulario.requestSubmit();
  } else {
    formulario.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
}

/**
 * Escape reduce la escritura ampliada; Enter envía según el modo (la cabecera lo explica).
 * @param {KeyboardEvent} evento
 */
function alPulsarTecla(evento) {
  if (evento.key === 'Escape' && estaAmpliado()) {
    evento.preventDefault();
    ampliar(false);
    return;
  }
  if (evento.key !== 'Enter' || evento.shiftKey || evento.isComposing) {
    return;
  }
  // Con la escritura ampliada, Enter solo es un salto de línea; se envía con Control o Comando.
  if (estaAmpliado() && !evento.ctrlKey && !evento.metaKey) {
    return;
  }
  evento.preventDefault();
  enviarFormulario(porId('compositor', HTMLFormElement));
}

/**
 * Abre o cierra el aviso completo de privacidad, que flota sobre la barra. Al cerrarlo con su botón o con Escape, el
 * foco vuelve al botón que lo abrió; si se cierra porque la persona pulsa en otro sitio, el foco se queda donde pulsó.
 * @param {boolean} abrir si se abre
 * @param {{ devolverFoco?: boolean }} [opciones]
 */
function alternarPrivacidad(abrir, { devolverFoco = true } = {}) {
  const aviso = porId('aviso-privacidad');
  const boton = porId('abrir-privacidad');
  aviso.hidden = !abrir;
  boton.setAttribute('aria-expanded', String(abrir));
  if (abrir) {
    enfocar(porId('t-privacidad'));
  } else if (devolverFoco) {
    boton.focus({ preventScroll: true });
  }
}

/**
 * Un clic fuera del aviso de privacidad (y de su botón) lo cierra: no debe quedarse tapando la conversación.
 * @param {MouseEvent} evento
 */
function cerrarPrivacidadAlPulsarFuera(evento) {
  const aviso = porId('aviso-privacidad');
  const destino = evento.target;
  if (
    !(destino instanceof Node) ||
    aviso.hidden ||
    aviso.contains(destino) ||
    porId('abrir-privacidad').contains(destino)
  ) {
    return;
  }
  alternarPrivacidad(false, { devolverFoco: false });
}

/**
 * Cambia lo que hace la barra: `etiqueta` (su nombre accesible) y `marcador` (el texto de ejemplo), los dos
 * traducibles; `limite` (máximo de caracteres, MAX_LETRAS_MENSAJE si no se da) y `alEnviar(texto)`. Lo que hubiera escrito se
 * conserva si cabe.
 * @param {ConfiguracionDeLaBarra} configuracion
 */
export function cambiarModo({ etiqueta, marcador, limite = MAX_LETRAS_MENSAJE, alEnviar }) {
  alEnviarEnEsteModo = alEnviar;
  escribir(porId('etiqueta-mensaje'), etiqueta);
  escribirAtributo(campo(), 'placeholder', marcador);
  const llena = barraLlena(limite);
  porId('compositor').dataset.lleno = String(llena);
  // Llena, el campo queda de solo lectura con lo que hubiera escrito: nunca un campo de cero letras que lo borre.
  campo().readOnly = llena;
  campo().maxLength = llena ? MAX_LETRAS_MENSAJE : limite;
  if (!llena) {
    campo().value = prefijoDelCampo(campo().value, limite);
  }
  alEscribir();
}

/**
 * El límite del campo cuenta unidades UTF16, sin elipsis. Si la frontera parte un carácter válido, conserva el
 * prefijo anterior al par: ni el borrador recuperado ni un cambio de paso deben fabricar un sustituto aislado.
 * @param {string} texto @param {number} limite @returns {string}
 */
function prefijoDelCampo(texto, limite) {
  const partido = /[\uD800-\uDBFF]/.test(texto.charAt(limite - 1)) && /[\uDC00-\uDFFF]/.test(texto.charAt(limite));
  return texto.slice(0, partido ? limite - 1 : limite);
}

/**
 * Deja exactamente `texto` en el campo (recortado a lo que cabe).
 * @param {string} texto
 */
function fijarTexto(texto) {
  campo().value = prefijoDelCampo(texto, campo().maxLength);
  alEscribir();
}

/**
 * Devuelve a la barra `texto`, lo que se envió y no se pudo enviar, sin pisar lo que la persona haya escrito mientras
 * esperaba: con la barra vacía, vuelve tal cual; si no, va delante de lo nuevo, que es el orden en que se escribió. Si
 * no caben los dos, se queda lo nuevo: lo anterior sigue a la vista en la conversación, como mensaje de la persona.
 * @param {string} texto
 */
export function ponerTexto(texto) {
  const escrito = campo().value.trim();
  if (!escrito) {
    fijarTexto(texto);
    return;
  }
  const juntos = `${texto} ${escrito}`;
  if (juntos.length <= campo().maxLength) {
    fijarTexto(juntos);
  }
}

/**
 * Lo que hay escrito en la barra y todavía no se ha enviado.
 * @returns {string}
 */
export function textoEnLaBarra() {
  return campo().value;
}

/**
 * Vacía la barra: al borrar el recorrido no queda nada escrito.
 *
 */
export function vaciarBarra() {
  fijarTexto('');
}

/**
 * Añade `texto` a lo ya escrito, sin borrar nada ni enviarlo, y deja el cursor al final para seguir escribiendo.
 * @param {string} texto
 */
export function anadirAlBorrador(texto) {
  if (estaLlena()) {
    return;
  }
  const escrito = campo().value.trimEnd();
  fijarTexto(escrito ? `${escrito} ${texto}` : texto);
  const final = campo().value.length;
  campo().focus({ preventScroll: true });
  campo().setSelectionRange(final, final);
}

/**
 * Lleva el foco al campo: es lo que toca cada vez que Faro pide a la persona que escriba. Si la barra estaba escondida
 * porque tocaba elegir, vuelve a verse. Sin desplazar nada: la barra queda al pie de la conversación, y lo que Faro
 * acaba de decir no debe moverse.
 *
 */
export function enfocarCompositor() {
  mostrarCompositor(true);
  campo().focus({ preventScroll: true });
}

/**
 * La barra se esconde cuando no hay nada que escribir: en el informe y mientras toca elegir (una tarjeta o las
 * respuestas rápidas del motor), para que lo que hay que tocar ocupe su sitio. Vuelve con enfocarCompositor.
 * @param {boolean} visible
 */
export function mostrarCompositor(visible) {
  porId('compositor').hidden = !visible;
}

/**
 * Enseña la barra (sin JavaScript está oculta) y conecta el envío, el teclado, «Ampliar» y el aviso de privacidad.
 *
 */
export function iniciarCompositor() {
  porId('compositor').hidden = false;
  porId('compositor').addEventListener('submit', enviar);
  document.addEventListener(EVENTO_PENSANDO, aplicarPensando);
  campo().addEventListener('input', alEscribir);
  campo().addEventListener('keydown', alPulsarTecla);
  porId('abrir-privacidad').addEventListener('click', () =>
    alternarPrivacidad(porId('aviso-privacidad').hidden === true),
  );
  porId('cerrar-privacidad').addEventListener('click', () => alternarPrivacidad(false));
  porId('aviso-privacidad').addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') {
      alternarPrivacidad(false);
    }
  });
  document.addEventListener('click', cerrarPrivacidadAlPulsarFuera);
  porId('ampliar').addEventListener('click', () => ampliar(!estaAmpliado()));
  alEscribir();
}
