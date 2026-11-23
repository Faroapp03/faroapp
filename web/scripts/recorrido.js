// Recorrido de Faro en conversación: ocupación (con el relato libre si la persona lo prefiere) → tareas → informe.
// El contenido del recorrido vive en la memoria de esta página: no se guarda en los almacenes del navegador ni en el
// servidor.
// Este archivo solo arranca las piezas y resuelve lo que cruza los pasos: volver atrás, borrarlo todo, empezar una
// conversación nueva y no perderla al salir de la página, que lo borraría todo: con algo que perder, el navegador
// pregunta antes de cerrarla o recargarla, y los enlaces a otras páginas de Faro se abren en otra pestaña
// (recorrido/enlaces-de-salida.js). Cada paso (paso-*.js) y sus piezas comunes están en scripts/recorrido/, y todas las
// llamadas a la API, en scripts/recorrido/api.js (cómo viajan y qué significa cada fallo, en api/). Qué hace cada
// módulo, en scripts/recorrido/README.md.
//
// Arranca después de sitio.js (la primera importación): sus textos ya tienen su diccionario. El código de un resultado
// pasado desde otro dispositivo ya ha salido de la dirección: recorrido.html carga antes otro-dispositivo/fragmento.js.
// Sin diccionario disponible no arranca la conversación: enseña el aviso fijo de la página para volver a cargarla.
// Todo lo que el recorrido puede necesitar más tarde (el paso 4 y el diccionario del otro idioma) lo trae en cuanto la
// página termina de cargar: una página con un recorrido a medias no puede pedir nada después, porque entretanto podría
// haberse activado una versión nueva de Faro y llegaría de ella (scripts/instalacion.js, «Versión nueva»). Si aun así
// el paso 4 no está cuando se pide el informe, se pide entonces; si no llega, Faro lo dice y se puede volver a pedir.

import './sitio.js';
import './compatibilidad.js';
import { cargarDiccionario } from '../idiomas/cargar.js';
import { escucharBorrado } from './aviso-de-borrado.js';
import { porId, pulsaFuera } from './dom.js';
import { escribir } from './idioma.js';
import { hayMensajeDeLaPersona } from './marcas-del-recorrido.js';
import { codigoRecibido, tomarCodigoDelFragmento } from './otro-dispositivo/fragmento.js';
import { llevarLaOpcionEnfocadaALaVista, seguirAlturaVisible } from './recorrido/altura-visible.js';
import { cancelarPeticiones, senalDeCancelacion } from './recorrido/api/transporte.js';
import { iniciarAyudas } from './recorrido/ayudas.js';
import { enfocarCompositor, iniciarCompositor, textoEnLaBarra, vaciarBarra } from './recorrido/compositor.js';
import { decirFaro, vaciarConversacion } from './recorrido/conversacion.js';
import { olvidarTraducciones } from './recorrido/datos-traducidos.js';
import { abrirFueraSinPerderLaConversacion } from './recorrido/enlaces-de-salida.js';
import { hayAlgoQuePerder, reiniciarEstado } from './recorrido/estado.js';
import { iniciarGuia } from './recorrido/guia.js';
import { completarDatosEnIdioma, iniciarIdiomaDeLosDatos } from './recorrido/idioma-de-los-datos.js';
import { olvidarLlamadas } from './recorrido/memoria-llamadas.js';
import { PASO_OCUPACION, PASO_TAREAS } from './recorrido/navegacion.js';
import { mostrarError, soltarEspera } from './recorrido/pagina.js';
import { empezarConversacion, iniciarPasoOcupacion, volverEnOcupacion } from './recorrido/paso-ocupacion.js';
import { iniciarPasoTareas, volverATareas } from './recorrido/paso-tareas.js';
import { hayDiccionario, IDIOMAS, idiomaActual, traducible } from './textos.js';
import { versionCambiada } from './version.js';

/** @import { Traducible } from './textos.js' */

/** Contenedores que se vacían al borrar el recorrido: lo que se pintó con lo que contó la persona. */
const CONTENEDORES_DEL_RECORRIDO = Object.freeze([
  'form-ocupacion',
  'avisos-tareas',
  'bloques-oficiales',
  'lista-tareas',
  'informe',
]);
/**
 * Qué hace «Volver» según el paso al que vuelve (data-volver): en la ocupación, a la fase anterior (también desde las
 * tareas); desde el informe, a las tareas.
 * @type {Record<number, () => void>}
 */
const VOLVER_A = { [PASO_OCUPACION]: volverEnOcupacion, [PASO_TAREAS]: volverATareas };
/**
 * Lo que dice el diálogo en cada caso: su título, su explicación y su botón de confirmar. El mismo diálogo sirve para
 * «Nueva conversación», que explica el borrado antes de confirmarlo.
 * @typedef {{ titulo: string, texto: string, confirmar: string }} TextosDelDialogo
 */
/** @type {Readonly<Record<'nueva', TextosDelDialogo>>} */
const TEXTOS_DEL_DIALOGO = Object.freeze({
  nueva: { titulo: 'recorrido.nueva.titulo', texto: 'recorrido.nueva.texto', confirmar: 'recorrido.nueva.borrar' },
});

/**
 * El módulo del paso 4 (scripts/recorrido/paso-informe.js).
 * @typedef {typeof import('./recorrido/paso-informe.js')} PasoDelInforme
 */

/**
 * El paso 4, ya cargado: su módulo (scripts/recorrido/paso-informe.js) y el de la interacción del informe no hacen
 * falta para empezar; se traen en cuanto la página termina de cargar.
 * @type {PasoDelInforme | null}
 */
let paso4 = null;
/** Los intentos fallidos de traer el paso 4: el navegador recuerda el fallo, así que cada intento lleva su marca. */
let fallosDelPaso4 = 0;
/**
 * Lo que hace «Empezar de nuevo» en el diálogo abierto: borrar el recorrido.
 * Lo fija abrirDialogoNueva cada vez que abre el diálogo y lo usa su cierre (prepararDialogoNueva).
 * @type {() => void}
 */
let alEmpezarDeNuevo = borrarTodo;

/**
 * Pide el módulo del paso 4; tras un fallo, con otra marca (#reintento-N), que no llega al servidor ni a la copia.
 * Solo se calcula el fragmento: el módulo es siempre el mismo, escrito en el código. El fragmento hace falta porque
 * el navegador recuerda el fallo de una importación por su dirección exacta y no la vuelve a intentar.
 * @returns {Promise<PasoDelInforme>}
 */
function importarPaso4() {
  if (!fallosDelPaso4) {
    return import('./recorrido/paso-informe.js');
  }
  return import(`./recorrido/paso-informe.js#reintento-${fallosDelPaso4}`);
}

/**
 * El paso 4: el que ya está o, si falta, el que se trae ahora. Antes de pedirlo se consulta versionCambiada: si detecta
 * otro service worker desde que se abrió la página, se devuelve null, igual que si la importación falla.
 * @returns {Promise<PasoDelInforme | null>}
 */
async function cargarPaso4() {
  if (paso4) {
    return paso4;
  }
  if (versionCambiada()) {
    return null;
  }
  try {
    paso4 = await importarPaso4();
  } catch (error) {
    fallosDelPaso4 += 1;
    console.warn('Faro no ha podido traer el paso 4 del recorrido.', error);
  }
  return paso4;
}

/** Faro dice por qué no puede preparar el informe; lo que lleva hecho la persona sigue en la página. */
function avisarPaso4QueFalta() {
  const clave = versionCambiada() ? 'recorrido.informe.version-nueva' : 'recorrido.informe.sin-paso';
  mostrarError(traducible(clave));
}

/**
 * «Ver mi informe»: se detiene el envío del formulario aquí y el resto lo lleva el paso 4.
 * @param {SubmitEvent} evento El envío del formulario de las tareas.
 */
async function verMiInforme(evento) {
  evento.preventDefault();
  const signal = senalDeCancelacion();
  const modulo = await cargarPaso4();
  if (signal.aborted) {
    return;
  }
  if (!modulo) {
    avisarPaso4QueFalta();
    return;
  }
  await modulo.verMiInforme(evento, { alBorrar: borrarTodo });
}

/**
 * Trae, sin prisa y en cuanto la página ha terminado de cargar, lo que el recorrido puede necesitar después: el paso 4
 * y el diccionario del otro idioma. Si algo no llega, no pasa nada: se vuelve a pedir cuando haga falta.
 */
function traerLoQueFalta() {
  // Sin await: cargarPaso4 no falla (un fallo lo apunta y devuelve null) y quien necesite el paso 4 lo vuelve a pedir.
  void cargarPaso4();
  for (const idioma of IDIOMAS) {
    cargarDiccionario(idioma).catch(() => {
      // Sin red, se vuelve a pedir al cambiar de idioma.
    });
  }
}

/** Cancela lo que se estaba esperando y deja la página libre para lo siguiente. */
function dejarDeEsperar() {
  cancelarPeticiones();
  soltarEspera();
}

/**
 * Los botones «Volver» llevan en data-volver el paso al que vuelven. Volver cancela lo que se estaba esperando.
 * @param {MouseEvent} evento El clic en cualquier parte de la página.
 */
function volver({ target }) {
  const boton = target instanceof Element ? target.closest('[data-volver]') : null;
  if (!(boton instanceof HTMLElement)) {
    return;
  }
  dejarDeEsperar();
  VOLVER_A[Number(boton.dataset.volver)]?.();
}

/**
 * «Borrar el informe y lo escrito» y «Nueva conversación»: cancela lo pendiente, olvida el recorrido y la conversación,
 * y Faro vuelve a saludar. Con `motivo` (lo borró otra pestaña), Faro lo dice en lugar de «He borrado…», antes del
 * saludo y una sola vez.
 * @param {Traducible} [motivo] Por qué se borra, si no lo pidió la persona en esta pestaña.
 */
function borrarTodo(motivo) {
  dejarDeEsperar();
  olvidarLlamadas();
  olvidarTraducciones();
  // Sin datos apuntados no pide nada: solo esconde la marca de traducción. Sin await: no rechaza (un fallo se apunta en
  // la consola) y el borrado no espera a la red.
  void completarDatosEnIdioma();
  reiniciarEstado();
  paso4?.olvidarInforme();
  vaciarConversacion();
  for (const id of CONTENEDORES_DEL_RECORRIDO) {
    porId(id).replaceChildren();
  }
  document.getElementById('aviso-emparejar')?.remove();
  vaciarBarra();
  window.scrollTo(0, 0);
  // Faro dice que lo ha borrado en su primer mensaje, que ya se anuncia: no hace falta otro aviso.
  empezarConversacion({ borrado: true, ...(motivo ? { motivo } : {}) });
  enfocarCompositor();
}

/**
 * Si volver a empezar o salir de la página perdería algo: lo hablado, lo elegido o lo escrito sin enviar (estado.js). Es
 * la única respuesta del recorrido: la usan el aviso al salir, los enlaces que sacan de la página y el borrado.
 */
function hayAlgoQueSePerderia() {
  // El informe recibido marca la conversación sin inventar tareas ni un mensaje de la persona.
  return (
    document.body.dataset.conversacion === 'empezada' ||
    hayAlgoQuePerder({ haHablado: hayMensajeDeLaPersona(), escrito: textoEnLaBarra() })
  );
}

/**
 * Recargar o cerrar la página pierde el recorrido: no se guarda nada. Si hay algo que perder (lo que se ha hablado, lo
 * elegido o lo escrito sin enviar, estado.js), se solicita al navegador que pregunte antes de salir, en cualquier
 * paso. El navegador decide si muestra el aviso y con qué texto.
 * @param {BeforeUnloadEvent} evento
 */
function avisarAlSalir(evento) {
  // Si la persona ya confirmó que recarga para actualizar Faro (scripts/instalacion.js), la página lo marca
  // con data-actualizando y no se le pregunta dos veces.
  if ('actualizando' in document.documentElement.dataset) {
    return;
  }
  if (!hayAlgoQueSePerderia()) {
    return;
  }
  evento.preventDefault();
  // Los navegadores que no hacen caso de preventDefault preguntan si returnValue trae algo.
  evento.returnValue = '';
}

/**
 * «Nueva conversación» (en la guía y en la cabecera): si la persona ha hablado, lo confirma antes en un diálogo; si no,
 * el foco va a la barra de escritura y lo escrito sin enviar se conserva (solo cuenta lo hablado, no hayAlgoQueSePerderia).
 * @param {MouseEvent} evento El clic en cualquier parte de la página.
 */
function pedirNuevaConversacion({ target }) {
  if (!(target instanceof Element) || !target.closest('[data-nueva-conversacion]')) {
    return;
  }
  if (!hayMensajeDeLaPersona()) {
    enfocarCompositor();
    return;
  }
  abrirDialogoNueva(borrarTodo);
}

/**
 * Abre el diálogo de «Nueva conversación» con lo que dice `caso`; si la persona confirma, `accion`.
 * @param {() => void} accion Lo que se hace si la persona confirma.
 * @param {keyof typeof TEXTOS_DEL_DIALOGO} [caso] Qué dice el diálogo de nueva conversación.
 */
function abrirDialogoNueva(accion, caso = 'nueva') {
  alEmpezarDeNuevo = accion;
  const { titulo, texto, confirmar } = TEXTOS_DEL_DIALOGO[caso];
  escribir(porId('t-dialogo-nueva'), traducible(titulo));
  escribir(porId('texto-dialogo-nueva'), traducible(texto));
  escribir(porId('confirmar-dialogo-nueva'), traducible(confirmar));
  const dialogo = porId('dialogo-nueva', HTMLDialogElement);
  dialogo.returnValue = '';
  dialogo.showModal();
}

/** El diálogo de «Nueva conversación»: actúa solo si se confirma; cerrarlo de cualquier otra forma no borra nada. */
function prepararDialogoNueva() {
  const dialogo = porId('dialogo-nueva', HTMLDialogElement);
  dialogo.addEventListener('click', (evento) => {
    if (pulsaFuera(dialogo, evento)) {
      dialogo.close();
    }
  });
  dialogo.addEventListener('close', () => {
    if (dialogo.returnValue === 'borrar') {
      alEmpezarDeNuevo();
    }
  });
}

/**
 * «Borrar todo» en otra pestaña (aviso-de-borrado.js): si aquí había algo, este recorrido se olvida también y Faro lo
 * dice en una línea. Si no queda ningún contenido, no se añade otro aviso.
 */
function alBorrarEnOtraPestana() {
  // También puede estar llegando un informe transferido a una página todavía vacía.
  dejarDeEsperar();
  if (!hayAlgoQueSePerderia()) {
    return;
  }
  borrarTodo(traducible('recorrido.borrado-en-otra-pestana'));
}

/**
 * Un resultado pasado desde otro dispositivo (#pasar=…): su código ya no está en la barra ni en el historial
 * (otro-dispositivo/fragmento.js, al cargar la página). El paso 4 lo comprueba y rehace el informe.
 * @param {string} codigo El código del resultado, ya fuera de la dirección.
 */
async function abrirResultadoRecibido(codigo) {
  const signal = senalDeCancelacion();
  const modulo = await cargarPaso4();
  if (signal.aborted) {
    return;
  }
  if (modulo) {
    await modulo.abrirResultadoRecibido(codigo, { alBorrar: borrarTodo, signal });
  } else {
    avisarPaso4QueFalta();
  }
}

/**
 * El enlace de otro dispositivo abierto en esta misma pestaña, con la página ya cargada: solo cambia el fragmento. Su
 * código sale de la barra igual; si hay un recorrido que se perdería, Faro dice cómo abrirlo en vez de mezclarlo.
 */
function alCambiarElFragmento() {
  const codigo = tomarCodigoDelFragmento();
  if (typeof codigo !== 'string') {
    return;
  }
  if (hayAlgoQueSePerderia()) {
    decirFaro(traducible('recorrido.pasar.en-curso'), { tipo: 'nota' });
  } else {
    // Sin await: lo pinta el paso 4 cuando llega, y si no llega, Faro lo dice (avisarPaso4QueFalta).
    void abrirResultadoRecibido(codigo);
  }
}

/**
 * Arranca el recorrido: el aviso al salir, los enlaces de salida, «Volver», «Nueva conversación», la guía, la
 * barra y los pasos.
 * @param {string | null} codigoDeOtroDispositivo El código de un resultado pasado desde otro dispositivo, si la página
 *   se abrió con uno.
 */
function iniciarRecorrido(codigoDeOtroDispositivo) {
  window.addEventListener('beforeunload', avisarAlSalir);
  abrirFueraSinPerderLaConversacion(hayAlgoQueSePerderia);
  window.addEventListener('hashchange', alCambiarElFragmento);
  document.addEventListener('click', volver);
  document.addEventListener('click', pedirNuevaConversacion);
  prepararDialogoNueva();
  escucharBorrado(alBorrarEnOtraPestana);
  seguirAlturaVisible();
  llevarLaOpcionEnfocadaALaVista();
  iniciarGuia();
  iniciarCompositor();
  iniciarAyudas();
  iniciarPasoOcupacion();
  iniciarPasoTareas();
  porId('form-tareas').addEventListener('submit', verMiInforme);
  iniciarIdiomaDeLosDatos();
  empezarConversacion();
  // Sin await, como al cambiar el fragmento: el recorrido arranca entero mientras llega el paso 4.
  if (typeof codigoDeOtroDispositivo === 'string') {
    void abrirResultadoRecibido(codigoDeOtroDispositivo);
  }
  if (document.readyState === 'complete') {
    traerLoQueFalta();
  } else {
    window.addEventListener('load', traerLoQueFalta, { once: true });
  }
}

// Sin ningún diccionario (no ha llegado ni el del idioma elegido ni el castellano), Faro no tiene con qué hablar: en
// lugar de una conversación sin textos, el aviso fijo de recorrido.html, en castellano, con la manera de recargar. Se
// copia en la alerta, que estaba vacía, para que el lector de pantalla lo anuncie.
if (hayDiccionario(idiomaActual())) {
  iniciarRecorrido(codigoRecibido);
} else {
  porId('rc-sin-textos').append(porId('rc-sin-textos-aviso', HTMLTemplateElement).content.cloneNode(true));
}
