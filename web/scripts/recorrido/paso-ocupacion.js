// La ocupación se reconoce en el dispositivo, con el motor local de Faro (ocupacion-local.js), y la persona decide.
// Este módulo presenta las fases de flujo-ocupacion.js, las preguntas y las propuestas del motor. Los fallos conservan
// la posibilidad de reintentar o explorar la clasificación oficial, salvo si el motor del dispositivo no es el de esta
// versión: entonces solo queda «Tus datos», donde se arregla. Si la moderación para lo escrito, se muestran
// sus avisos, incluido el del 024 cuando corresponde, antes de permitir otra respuesta.
// La conversación conserva lo escrito al volver y evita solicitudes duplicadas durante una petición.

import { crear, porId } from '../dom.js';
import { escribir } from '../idioma.js';
import { traducible } from '../textos.js';
import { tituloDoble } from '../titulo-breve.js';
import { sePuedeReintentar } from './api/errores.js';
import { senalDeCancelacion } from './api/transporte.js';
import { fichaDeGrupo, gruposHijos } from './api.js';
import { cambiarModo, enfocarCompositor, MAX_LETRAS_MENSAJE, mostrarCompositor } from './compositor.js';
import { decirAvisos, decirFaro, decirPersona, llevarALaVista, ofrecerSugerencias } from './conversacion.js';
import { cuerpoLocal } from './cuerpo-local.js';
import { datoOficial } from './datos-traducidos.js';
import { estado } from './estado.js';
import * as flujoLocal from './flujo-local.js';
import { avanzar, estadoInicial, FASES, MOTIVOS_DE_FASE, SEPARADOR_DE_RESPUESTAS } from './flujo-ocupacion.js';
import { contarLetras } from './formato.js';
import { cargarGruposElegidos } from './grupos-elegidos.js';
import { completarDatosEnIdioma } from './idioma-de-los-datos.js';
import { mensajeDeFase } from './mensajes-ocupacion.js';
import { irA, PASO_OCUPACION, PASO_RELATO } from './navegacion.js';
import {
  clasificacionAclarar,
  clasificacionConfirmada,
  clasificacionSinGrupo,
  esAviso,
  grupoPorDescribir,
  pedirPasoLocal,
  preguntaEnElChat,
  propuestaEnElChat,
  respuestaDeCortesia,
} from './ocupacion-local.js';
import { avisarDelFallo, enEspera, enfocar, hayPeticionEnCurso, mostrarErrorDe } from './pagina.js';
import { empezarConLasTareas, mostrarPasoTareas } from './paso-tareas.js';
import { mostrarLaPreparacion } from './preparacion.js';
import { salidasTrasElFallo } from './reparar.js';
import { saludar } from './saludo.js';
import { crearConfirmacion, ocupacionMarcada } from './tarjeta-confirmar.js';
import { crearExploracion } from './tarjeta-explorar.js';
import { idiomaDeLasRespuestas } from './traduccion-api.js';

/** @import { Parte, Traducible } from '../textos.js' */
/** @import { Evento, Fase, Grupo } from './flujo-ocupacion.js' */
/** @import { Aviso } from './traduccion-api.js' */
/** @import { Propuesta } from './ocupacion-local.js' */

/**
 * Con menos letras no hay nada que clasificar y no se envía el texto al motor local.
 */
const MIN_LETRAS_RESPUESTA = 2;
/** Mensajes de espera de las operaciones locales. */
const PENSANDO = traducible('recorrido.espera.pensando');
const BUSCANDO_GRUPO = traducible('recorrido.espera.buscando-grupo');
const BUSCANDO_CLASIFICACION = traducible('recorrido.espera.buscando-clasificacion');
const PREPARANDO_TAREAS = traducible('recorrido.espera.preparando-tareas');
/** Lo que dice la persona al pulsar los botones de la ocupación, y lo que ofrece Faro cuando algo falla. */
const REINTENTAR = traducible('recorrido.reintentar');
const OTRA_COSA = traducible('recorrido.ocupacion.otra-cosa');
const NINGUNA_BUSCAR = traducible('recorrido.ocupacion.ninguna-buscar');
const CONTAR_CON_PALABRAS = traducible('recorrido.explorar.contar');
const BUSCAR_EN_LA_CLASIFICACION = traducible('recorrido.explorar.buscar');
/** Lo que dice Faro con el motor del dispositivo. */
const PREPARANDO_FARO = traducible('recorrido.local.preparando');
const NO_TE_HE_ENTENDIDO = traducible('recorrido.local.aclarar.titulo');
const NINGUNA_DE_ESTAS = traducible('recorrido.ocupacion.ninguna-entendido');
const LO_CUENTO = traducible('recorrido.local.lo-cuento.boton');
const LO_TENGO_EN_CUENTA = traducible('recorrido.local.lo-cuento.anadido');
/** El aspecto de las respuestas rápidas que no responden con un sí o un no: las neutras, «Volver» y las salidas. */
const SUGERENCIA_SECUNDARIA = 'rc-sugerencia-secundaria';
/** «Ninguna, buscar en la clasificación» bajo una pregunta del motor del dispositivo. */
const SALIDA_LOCAL = Object.freeze({ texto: NINGUNA_BUSCAR, accion: buscarDesdeLocal, clase: SUGERENCIA_SECUNDARIA });
/** «Lo cuento con mis palabras»: abre la barra de escribir sin retirar las demás respuestas (escribirLoMio). */
const ESCRIBIR_LOCAL = Object.freeze({
  texto: LO_CUENTO,
  accion: escribirLoMio,
  clase: SUGERENCIA_SECUNDARIA,
  conservar: true,
});
/**
 * «Mi ocupación: Conductores de autobús», lo que dice la persona al elegir una ocupación ESCO.
 * @param {string} titulo @returns {Traducible}
 */
function miOcupacion(titulo) {
  return traducible('recorrido.persona.mi-ocupacion', { titulo: datoOficial(titulo, tituloDoble) });
}
/**
 * La fase en curso de la ocupación. Solo la cambian `cambiar`, con los eventos de la máquina, y empezarConversacion.
 */
let flujo = estadoInicial();
/** La última respuesta escrita, para «Volver a intentarlo» si la clasificación falla (la guarda responder). */
let ultimaRespuesta = '';
/** Lo que hace «Continuar» en la tarjeta de la fase en curso; lo fija mostrarTarjeta. */
let alContinuar = () => {};
/**
 * El diálogo con el motor del dispositivo (el estado de recorrido/flujo-local.js): lo escrito y las respuestas dadas.
 * Mientras dura, la máquina de la ocupación está en «clasificando»; lo que decide el motor la hace avanzar.
 */
let local = flujoLocal.estadoInicial();
/** La pregunta o propuesta presentada; solo se compara al añadir un relato con «Lo cuento». */
let huellaLocal = '';

/** Si se está en mitad de las preguntas del motor del dispositivo, con alguna respuesta que deshacer. */
function enPreguntasLocales() {
  return flujo.fase === FASES.CLASIFICANDO && local.respuestas.length > 0;
}

/** La tarjeta de la ocupación y el botón de enviar de la barra, que recorrido.html tiene siempre. */
function formulario() {
  return porId('form-ocupacion');
}
function botonDeLaBarra() {
  return porId('compositor').querySelector('[type=submit]');
}

/**
 * Aplica un evento a la máquina. Devuelve false si la fase no lo admite: entonces no hay nada que pintar ni pedir.
 * @param {Evento} evento
 */
function cambiar(evento) {
  const siguiente = avanzar(flujo, evento);
  if (siguiente === flujo) {
    return false;
  }
  flujo = siguiente;
  return true;
}

/** La barra de escritura, para contestar a Faro. En una pregunta abierta, la respuesta se suma a lo ya dicho. */
function modoRespuesta() {
  const suma = flujo.fase === FASES.RESPONDIENDO;
  cambiarModo({
    etiqueta: traducible('recorrido.compositor.ocupacion.etiqueta'),
    marcador: traducible(suma ? 'recorrido.compositor.respuesta.marcador' : 'recorrido.saludo.pregunta'),
    limite: suma ? MAX_LETRAS_MENSAJE - flujo.texto.length - SEPARADOR_DE_RESPUESTAS.length : MAX_LETRAS_MENSAJE,
    alEnviar: responder,
  });
}

/**
 * Cómo se presenta cada fase (presentarFase).
 * @type {Readonly<Partial<Record<Fase, () => void | boolean | Promise<void | boolean>>>>}
 */
const PRESENTAR = Object.freeze({
  [FASES.ESPERANDO]: presentarEscritura,
  [FASES.RESPONDIENDO]: presentarEscritura,
  [FASES.CONFIRMANDO]: presentarConfirmacion,
  [FASES.EXPLORANDO]: presentarExploracion,
  [FASES.RELATANDO]: presentarEscritura,
  [FASES.ELEGIDA]: presentarEleccion,
});

/** El control desde el que la persona ha pedido algo, para dejar ocupado su formulario mientras se espera. */
function botonQuePide() {
  return document.activeElement?.closest('form') ? document.activeElement : botonDeLaBarra();
}

/**
 * Espera a la API con el mensaje fijo de Faro. Si falla, Faro lo cuenta y ofrece volver a intentarlo.
 * @template Resultado @param {() => Promise<Resultado>} trabajo @param {Parte} aviso
 * @param {() => void} [reintentar]
 */
function cargar(trabajo, aviso, reintentar = presentarFase) {
  return enEspera({
    boton: botonQuePide(),
    aviso,
    trabajo,
    alFallar: (error) => {
      avisarDelFallo(error);
      enfocar(ofrecerSugerencias(salidasTrasElFallo(error, [{ texto: REINTENTAR, accion: reintentar }])));
    },
  });
}

/**
 * Un grupo con su título y sus ocupaciones: si la clasificación no los trae, de su ficha.
 * @param {Grupo} grupo @param {() => void} [reintentar] @returns {Promise<Grupo | undefined>}
 */
async function completarGrupo(grupo, reintentar) {
  if (grupo.titulo && grupo.ocupaciones) {
    return grupo;
  }
  const ficha = await cargar(() => fichaDeGrupo(grupo.isco08), BUSCANDO_GRUPO, reintentar);
  if (!ficha) {
    return undefined;
  }
  const { titulo, ocupaciones, sinTareasOit, referenciasSubgrupo, sinReferencias } = ficha;
  const marcas = { sinTareasOit, referenciasSubgrupo, sinReferencias };
  return { ...grupo, titulo: grupo.titulo || titulo, ocupaciones, ...marcas };
}

/**
 * Pinta la tarjeta con `nodos` y sus acciones: «Volver» si hay adónde y «Continuar» si hay que elegir y enviar.
 * @param {{ nodos: HTMLElement[], alContinuar?: (() => void) | null }} tarjeta
 */
function mostrarTarjeta({ nodos, alContinuar: continuar = null }) {
  // En la tarjeta se elige: la barra de escribir se esconde y la tarjeta ocupa su sitio. Si la persona prefiere
  // contarlo con sus palabras, la tarjeta lo ofrece y la barra vuelve (presentarEscritura).
  mostrarCompositor(false);
  alContinuar = continuar ?? (() => {});
  const volver = escribir(
    crear('button', { type: 'button', className: 'rc-boton-secundario' }),
    traducible('recorrido.volver'),
  );
  volver.dataset.volver = String(PASO_OCUPACION);
  const acciones = crear('div', { className: 'rc-acciones' });
  if (flujo.historial.length || enPreguntasLocales()) {
    acciones.append(volver);
  }
  if (continuar) {
    const boton = crear('button', { type: 'submit', className: 'rc-boton-principal' });
    acciones.append(escribir(boton, traducible('recorrido.continuar')));
  }
  formulario().replaceChildren(...nodos, acciones);
}

/**
 * Faro presenta la fase: su mensaje queda arriba, a la vista, y el foco va al primer control nuevo. `grupo` es el
 * grupo que se confirma, ya completo.
 * @param {HTMLElement} foco @param {Grupo} [grupo]
 */
function presentar(foco, grupo = flujo.grupo ?? undefined) {
  llevarALaVista(decirFaro(mensajeDeFase(flujo, grupo)), 'start');
  enfocar(foco);
}

/**
 * Aplica la acción de un botón: la persona la dice en la conversación y Faro presenta la fase siguiente.
 * @param {Evento} evento @param {Parte} dicho
 */
function accion(evento, dicho) {
  if (hayPeticionEnCurso() || !cambiar(evento)) {
    return;
  }
  decirPersona(dicho);
  // Sin esperar: presentarFase cuenta en la conversación cualquier fallo de lo que pide.
  void presentarFase();
}

/**
 * «Continuar» con la ocupación marcada; sin ninguna, Faro recuerda las salidas.
 * @param {Grupo} grupo
 */
function continuarConLaOcupacion(grupo) {
  const esco = ocupacionMarcada(formulario());
  if (!esco) {
    // Una casilla de las ocupaciones o el filtro (tarjeta-confirmar.js): los dos son un <input>.
    /** @type {HTMLInputElement | null} */
    const campo = formulario().querySelector('.rc-opcion:not([hidden]) input, #filtro-ocupaciones');
    mostrarErrorDe(campo, traducible('recorrido.ocupacion.elige-o-ninguna'));
    return enfocar(campo);
  }
  const titulo = grupo.ocupaciones?.find((ocupacion) => ocupacion.esco === esco)?.titulo ?? '';
  accion({ tipo: 'elegirOcupacion', esco }, miOcupacion(titulo));
}

/**
 * La ocupación ESCO que ya había elegido la persona en este grupo, si vuelve a confirmarlo desde las tareas: sale
 * marcada, para seguir igual sin volver a buscarla. La primera vez no se marca ninguna.
 * @param {Grupo} grupo @returns {string | null}
 */
function elegidaAlVolver(grupo) {
  return flujo.motivo === MOTIVOS_DE_FASE.VOLVER && estado.ocupacion?.isco08 === grupo.isco08
    ? estado.ocupacion.esco
    : null;
}

/** «¿Te dedicas a esto?»: completa el grupo (y el secundario) si hace falta y pinta su tarjeta. */
async function presentarConfirmacion() {
  if (!flujo.grupo) {
    return;
  }
  const grupo = await completarGrupo(flujo.grupo);
  const secundario = flujo.secundario ? ((await completarGrupo(flujo.secundario)) ?? null) : null;
  if (!grupo || (flujo.secundario && !secundario)) {
    return;
  }
  irA(PASO_OCUPACION);
  modoRespuesta();
  const confirmacion = crearConfirmacion({
    grupo,
    secundario,
    elegida: elegidaAlVolver(grupo),
    alSoloGrupo: (dicho) => accion({ tipo: 'soloGrupo' }, dicho),
    alOtraCosa: () => accion({ tipo: 'otraCosa' }, OTRA_COSA),
  });
  const continuar = confirmacion.conOcupaciones ? () => continuarConLaOcupacion(grupo) : null;
  mostrarTarjeta({ nodos: confirmacion.nodos, alContinuar: continuar });
  presentar(confirmacion.foco, grupo);
}

/**
 * Devuelve si se ha podido presentar: sin la clasificación oficial, Faro ya ha contado el fallo y su salida. Es el
 * único presentador que lo dice; los demás no devuelven nada, tampoco cuando fallan (presentarFase).
 * @returns {Promise<boolean>}
 */
async function presentarExploracion() {
  const hijos = await cargar(() => gruposHijos(flujo.padre), BUSCANDO_CLASIFICACION);
  if (!hijos) {
    return false;
  }
  irA(PASO_OCUPACION);
  modoRespuesta();
  const exploracion = crearExploracion({
    padre: flujo.padre,
    tituloPadre: flujo.tituloPadre,
    hijos,
    alAbrir: ({ codigo, titulo }) => accion({ tipo: 'abrirGrupo', codigo, titulo }, datoOficial(titulo)),
    alContar: () => accion({ tipo: 'contarConPalabras' }, CONTAR_CON_PALABRAS),
  });
  mostrarTarjeta({ nodos: exploracion.nodos });
  presentar(exploracion.foco);
  return true;
}

/** Faro espera que la persona escriba: tras «No, es otra cosa» o una pregunta abierta. La tarjeta no se ve. */
function presentarEscritura() {
  irA(PASO_RELATO);
  modoRespuesta();
  decirFaro(mensajeDeFase(flujo));
  enfocarCompositor();
}

/**
 * La ocupación está elegida: se cargan sus grupos y se pasa a las tareas. El pensamiento de las tareas empieza con la
 * carga, dentro de su espera, y las tareas salen en cuanto llegan.
 */
async function presentarEleccion() {
  const { eleccion, palabra } = flujo;
  if (!eleccion) {
    return;
  }
  /** @type {HTMLElement | null} */
  let empezado = null;
  const cargados = await cargar(() => {
    empezado = empezarConLasTareas();
    return cargarGruposElegidos(eleccion, palabra);
  }, PREPARANDO_TAREAS);
  if (cargados) {
    mostrarPasoTareas(cargados, { empezado });
  }
}

/**
 * Pide al presentador de la fase que la pinte y completa las traducciones oficiales. Devuelve false solo si ese
 * presentador devuelve false (actualmente, exploración); true no garantiza que las demás fases hayan pintado.
 * @returns {Promise<boolean>}
 */
async function presentarFase() {
  const presentada = await PRESENTAR[flujo.fase]?.();
  // Sin esperar: pide las traducciones oficiales que falten y reescribe la página al llegar.
  void completarDatosEnIdioma();
  return presentada !== false;
}

/** Pasa a explorar la clasificación oficial, diciéndolo la persona con el rótulo del botón. @returns {void} */
function explorarLaClasificacion() {
  accion({ tipo: 'explorar' }, BUSCAR_EN_LA_CLASIFICACION);
}

/**
 * La clasificación ha fallado: Faro lo cuenta y ofrece buscar en la clasificación oficial y, si puede salir bien,
 * reintentar (o lo que quede si el motor no es el de esta versión: salidasTrasElFallo).
 * @param {unknown} error @param {() => void} reintentar
 */
function contarFalloAlClasificar(error, reintentar) {
  avisarDelFallo(error);
  const opcionDeReintento = sePuedeReintentar(error) ? [{ texto: REINTENTAR, accion: reintentar }] : [];
  const buscar = { texto: BUSCAR_EN_LA_CLASIFICACION, accion: explorarLaClasificacion };
  enfocar(ofrecerSugerencias(salidasTrasElFallo(error, [...opcionDeReintento, buscar])));
}

/**
 * La moderación ha parado lo escrito: Faro dice sus avisos y no lo vuelve a enviar. La persona puede escribir otra cosa
 * o buscar su ocupación en la clasificación oficial, que no usa IA: si la moderación se equivocara con un trabajo
 * legítimo, tampoco se queda sin seguir.
 * @param {Aviso[]} avisos
 */
function contarParada(avisos) {
  decirAvisos(avisos, idiomaDeLasRespuestas());
  ofrecerSugerencias([{ texto: BUSCAR_EN_LA_CLASIFICACION, accion: explorarLaClasificacion }]);
  enfocarCompositor();
}

/**
 * Lo que la persona escribe en la barra es su respuesta: se clasifica (si dice algo).
 * @param {string} texto
 */
async function responder(texto) {
  decirPersona(texto);
  if (contarLetras(texto) < MIN_LETRAS_RESPUESTA) {
    decirFaro(traducible('recorrido.ocupacion.cuentame-mas'));
    return enfocarCompositor();
  }
  ultimaRespuesta = texto;
  if (flujo.fase === FASES.CLASIFICANDO) {
    // Escribir en mitad de las preguntas del motor es «Lo cuento con mis palabras»: se suma a lo dicho y se conservan
    // las respuestas (recorrido/flujo-local.js, anadirTexto).
    const antes = huellaLocal;
    local = flujoLocal.anadirTexto(local, texto);
    decirFaro(LO_TENGO_EN_CUENTA);
    await pasoLocal(antes);
    return;
  }
  if (cambiar({ tipo: 'responder', texto })) {
    await conversarEnLocal();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Con el motor del dispositivo (ocupacion-local.js)

/**
 * Lo escrito pasa al motor del dispositivo: si contesta a la aclaración («¿Me cuentas qué haces en un día normal?»), se
 * suma a lo de antes; si no, empieza de nuevo con lo escrito.
 */
function conversarEnLocal() {
  huellaLocal = '';
  local =
    flujo.desde?.fase === FASES.RESPONDIENDO
      ? flujoLocal.aclarar(local, ultimaRespuesta)
      : flujoLocal.empezar(local, flujo.texto);
  return pasoLocal();
}

/**
 * Pide el paso al motor del dispositivo y presenta lo que decida, si la conversación sigue en el mismo punto.
 * @param {string} [antes] La huella anterior, solo si la persona ha usado «Lo cuento».
 */
async function pasoLocal(antes) {
  retirarTarjetas();
  const enviado = flujo;
  const localEnviado = local;
  /** @type {unknown[]} */
  const fallos = [];
  const respuesta = await enEspera({
    boton: botonQuePide(),
    aviso: PENSANDO,
    trabajo: () =>
      pedirPasoLocal(cuerpoLocal(local, idiomaDeLasRespuestas()), {
        alPreparar: () => mostrarLaPreparacion(decirFaro(PREPARANDO_FARO, { tipo: 'nota' })),
        // Al volver atrás o borrarlo todo (cancelarPeticiones), los reintentos se detienen.
        senal: senalDeCancelacion(),
      }),
    alFallar: (error) => {
      fallos.push(error);
    },
  });
  if (flujo !== enviado || local !== localEnviado) {
    return;
  }
  if (!respuesta) {
    cambiar({ tipo: 'fallo' });
    const faseTrasFallo = flujo;
    if (fallos.length) {
      contarFalloAlClasificar(fallos[0], () => {
        if (flujo === faseTrasFallo && local === localEnviado && !hayPeticionEnCurso()) {
          flujo = enviado;
          void pasoLocal(antes);
        }
      });
    }
    return;
  }
  seguirConElMotor(/** @type {RespuestaDelMotor} */ (/** @type {unknown} */ (respuesta)), antes);
}

/**
 * Lo que responde el motor del dispositivo: su lectura del texto, el paso, y una parada si la moderación lo ha parado.
 * @typedef {{ lectura: { cortesia?: string[], sinComprension: boolean }, paso: PasoDelMotor, parada?: unknown }} RespuestaDelMotor
 * @typedef {flujoLocal.PasoVisto} PasoDelMotor
 */

/**
 * Una parada de la moderación se cuenta a la persona; si no, recorrido/flujo-local.js decide adónde lleva el
 * paso (cortesía, aclarar, explorar, pregunta, propuesta o decisión), sin repetir un relato que no aporta cambios.
 * @param {RespuestaDelMotor} respuesta
 * @param {string} [antes]
 */
function seguirConElMotor(respuesta, antes) {
  if (esAviso(respuesta.parada)) {
    cambiar({ tipo: 'fallo' });
    return contarParada([respuesta.parada]);
  }
  const huella = flujoLocal.huellaDelPaso(respuesta);
  const sinCambios = antes !== undefined && antes !== '' && antes === huella;
  const ir = flujoLocal.destinoDelPaso(local, respuesta, { sinCambios });
  local = ir.estado;
  huellaLocal = ir.destino === 'pregunta' || ir.destino === 'confirmar' ? huella : '';
  if (ir.aviso) {
    decirFaro(traducible(ir.aviso), { tipo: 'nota' });
  }
  return DESTINOS_LOCALES[ir.destino]?.(respuesta);
}

/**
 * Cómo se presenta cada destino del motor del dispositivo en la conversación.
 * @type {Readonly<Record<string, (respuesta: RespuestaDelMotor) => unknown>>}
 */
const DESTINOS_LOCALES = Object.freeze({
  cortesia: ({ lectura }) => responderCortesiaLocal(lectura.cortesia ?? []),
  aclarar: () => pedirAclaracion(),
  guiado: () => explorarDesdeLocal(),
  familias: () => explorarDesdeLocal(),
  pregunta: ({ paso }) => presentarPreguntaLocal(/** @type {never} */ (paso)),
  confirmar: ({ paso }) => presentarPropuestaLocal(/** @type {never} */ (paso)),
  decidida: ({ paso }) => decidirLocal(/** @type {never} */ (paso)),
});

/**
 * Solo un saludo, un «gracias» o una pregunta sobre Faro: Faro responde y la persona vuelve a escribir desde donde
 * estaba (la máquina vuelve a la fase de antes de enviar).
 * @param {readonly string[]} tipos
 */
function responderCortesiaLocal(tipos) {
  cambiar({ tipo: 'fallo' });
  decirFaro(respuestaDeCortesia(tipos));
  enfocarCompositor();
}

/** El motor no ha entendido el texto: Faro lo dice y pregunta por un día normal (pregunta abierta de la máquina). */
function pedirAclaracion() {
  decirFaro(NO_TE_HE_ENTENDIDO, { tipo: 'nota' });
  if (cambiar({ tipo: 'clasificado', clasificacion: clasificacionAclarar(idiomaDeLasRespuestas()) })) {
    void presentarFase();
  }
}

/** El motor no ha dado con la ocupación, o la persona lo ha pedido: se explora la clasificación oficial. */
function explorarDesdeLocal() {
  if (cambiar({ tipo: 'clasificado', clasificacion: clasificacionSinGrupo(idiomaDeLasRespuestas()) })) {
    void presentarFase();
  }
}

/** «Ninguna, buscar en la clasificación» bajo una pregunta o una propuesta del motor. */
function buscarDesdeLocal() {
  if (!hayPeticionEnCurso()) {
    retirarTarjetas();
    decirPersona(NINGUNA_BUSCAR);
    explorarDesdeLocal();
  }
}

/**
 * Las preguntas y propuestas del motor van en la conversación, sin la tarjeta del paso: la guía marca «Tu ocupación» y
 * la tarjeta se oculta. Toca elegir, así que la barra de escribir se esconde y las respuestas quedan al pie; vuelve con
 * «Lo cuento con mis palabras» (escribirLoMio).
 */
function enElChat() {
  irA(PASO_OCUPACION);
  porId('tarjeta-ocupacion').hidden = true;
  modoRespuesta();
  mostrarCompositor(false);
}

/**
 * «Lo cuento con mis palabras» bajo una pregunta o una propuesta del motor: vuelve la barra de escribir, con las
 * respuestas rápidas (o las tarjetas de la propuesta) aún a la vista encima. Lo escrito se suma a lo ya dicho y el motor lo recalcula todo conservando
 * las respuestas (responder; recorrido/flujo-local.js, anadirTexto).
 */
function escribirLoMio() {
  cambiarModo({
    etiqueta: traducible('recorrido.local.lo-cuento.etiqueta'),
    marcador: traducible('recorrido.local.lo-cuento.ejemplo'),
    limite: flujoLocal.MAX_LETRAS,
    alEnviar: responder,
  });
  enfocarCompositor();
  llevarALaVista(porId('sugerencias'));
}

/**
 * «Volver» como respuesta rápida, si hay una respuesta al motor que deshacer.
 * @returns {import('./conversacion.js').Sugerencia[]}
 */
function volverLocal() {
  return local.respuestas.length
    ? [{ texto: traducible('recorrido.volver'), volver: PASO_OCUPACION, clase: SUGERENCIA_SECUNDARIA }]
    : [];
}

/**
 * Las respuestas rápidas bajo el mensaje de Faro, con «Volver» al final si hay una respuesta que deshacer. El mensaje
 * se lee desde arriba, con sus respuestas debajo, al pie de la conversación, y el foco va a la primera, que devuelve.
 * @param {Element} mensaje
 * @param {import('./conversacion.js').Sugerencia[]} respuestas
 * @returns {HTMLButtonElement | undefined}
 */
function ofrecerRespuestas(mensaje, respuestas) {
  const primera = ofrecerSugerencias([...respuestas, ...volverLocal()]);
  llevarALaVista(mensaje, 'start');
  enfocar(primera);
  return primera;
}

/**
 * Los controles de la última propuesta (sus tarjetas, «Continuar» y sus salidas). Valen mientras la propuesta está
 * abierta: en cuanto la persona responde, de una forma u otra, quedan desactivados en la conversación.
 * @type {(HTMLInputElement | HTMLButtonElement)[]}
 */
let tarjetasVigentes = [];

/**
 * Desactiva los controles de la última propuesta. Con `conMarca`, la tarjeta elegida queda marcada (se ha confirmado
 * una ocupación o se afina la más parecida); sin ella, ninguna, porque la persona no ha elegido ninguna.
 * @param {boolean} [conMarca]
 */
function retirarTarjetas(conMarca = false) {
  for (const control of tarjetasVigentes) {
    control.disabled = true;
    if (!conMarca && control.type === 'radio') {
      /** @type {HTMLInputElement} */ (control).checked = false;
    }
  }
  tarjetasVigentes = [];
}

/**
 * Una pregunta del motor: Faro la dice y debajo van sus opciones como respuestas rápidas; si las opciones son trabajos,
 * también «Ninguna, buscar en la clasificación oficial».
 * @param {{ pregunta: { id: string, tipo?: string, texto: string, opciones: { id: string }[] } }} paso
 */
function presentarPreguntaLocal({ pregunta }) {
  const enChat = preguntaEnElChat(pregunta, idiomaDeLasRespuestas());
  enElChat();
  const mensaje = decirFaro(enChat.enunciado);
  // Una opción de trabajos se ve con la forma breve de sus títulos; su nombre entero queda en el nombre accesible y
  // en el title, y es lo que dice la persona al elegirla.
  const opciones = enChat.opciones.map(({ id, dicho, neutra, breve }) => ({
    texto: breve?.ver ?? dicho,
    accion: () => responderLocal(pregunta.id, id, dicho),
    ...(neutra ? { clase: SUGERENCIA_SECUNDARIA } : {}),
    ...(breve ? { nombre: breve.nombre, titulo: breve.entero } : {}),
  }));
  ofrecerRespuestas(mensaje, [...opciones, ESCRIBIR_LOCAL, ...(enChat.conSalida ? [SALIDA_LOCAL] : [])]);
}

/**
 * Una respuesta a una pregunta (o a una propuesta) del motor: la persona la dice y el motor da el paso siguiente.
 * @param {string} pregunta @param {string} opcion @param {Parte} dicho
 */
function responderLocal(pregunta, opcion, dicho) {
  if (hayPeticionEnCurso()) {
    return;
  }
  decirPersona(dicho);
  local = flujoLocal.responder(local, pregunta, opcion);
  void pasoLocal();
}

/**
 * Una propuesta del motor: Faro dice qué hacer y, en el mismo mensaje, enseña la más parecida y las alternativas como
 * tarjetas que se eligen, con «Continuar» y las salidas (ocupacion-local.js, propuestaEnElChat). Debajo, como
 * respuesta rápida, solo «Volver» si hay una respuesta que deshacer. El foco va a la tarjeta elegida.
 * @param {Propuesta} paso
 */
function presentarPropuestaLocal(paso) {
  const enChat = propuestaEnElChat(paso, {
    responder: (id, dicho) => responderPropuestaLocal(paso, id, dicho),
    contar: escribirLoMio,
    buscar: buscarDesdeLocal,
  });
  enElChat();
  const mensaje = decirFaro(enChat.partes);
  tarjetasVigentes = enChat.controles;
  ofrecerSugerencias(volverLocal());
  llevarALaVista(mensaje, 'start');
  enfocar(enChat.foco);
}

/**
 * Lo que hace cada opción de la propuesta. Con el motor, la respuesta se le manda y él decide; si la propuesta es de la
 * pantalla (`local`), «Sí» o una alternativa deciden y «No» lleva a explorar.
 * @param {Propuesta} paso @param {string} id @param {Parte} dicho
 */
function responderPropuestaLocal(paso, id, dicho) {
  if (hayPeticionEnCurso()) {
    return;
  }
  // La elegida queda marcada salvo con «Ninguna es la mía: hazme más preguntas».
  retirarTarjetas(id !== 'no');
  if (paso.local) {
    decirPersona(dicho);
    return decidirEnLaPantalla(paso, id);
  }
  if (id === 'no') {
    decirPersona(dicho);
    decirFaro(NINGUNA_DE_ESTAS);
    local = flujoLocal.responder(local, paso.id, id);
    return pasoLocal();
  }
  return responderLocal(paso.id, id, dicho);
}

/** La propuesta de la pantalla: la alternativa elegida o la propuesta; «No», a explorar. @param {Propuesta} paso @param {string} id */
function decidirEnLaPantalla(paso, id) {
  if (id === 'no') {
    return explorarDesdeLocal();
  }
  const alternativa = paso.alternativas.find((a) => a.id === id);
  const elegida = alternativa?.hipotesis ?? paso.mejor;
  return decidirLocal({ grupo: elegida.grupo, ...(elegida.ocupacion ? { esco: elegida.ocupacion.esco } : {}) });
}

/**
 * El motor (o la persona en la propuesta de la pantalla) ha decidido el grupo: se completa con su ficha y entra en la
 * máquina como un grupo que propuso la IA. Con la ocupación ESCO, queda elegida y se pasa a las tareas; sin ella, Faro
 * la pregunta con la tarjeta de confirmar de siempre.
 * @param {{ grupo: string, esco?: string }} decision
 */
async function decidirLocal({ grupo: isco08, esco }) {
  const enviado = flujo;
  const grupo = await completarGrupo(grupoPorDescribir(isco08), () => {
    if (flujo === enviado && !hayPeticionEnCurso()) {
      void decidirLocal({ grupo: isco08, ...(esco ? { esco } : {}) });
    }
  });
  if (!grupo || flujo !== enviado) {
    return;
  }
  const confirmada = clasificacionConfirmada(/** @type {never} */ (grupo), idiomaDeLasRespuestas());
  if (!cambiar({ tipo: 'clasificado', clasificacion: confirmada })) {
    return;
  }
  if (esco && grupo.ocupaciones?.some((ocupacion) => ocupacion.esco === esco)) {
    cambiar({ tipo: 'elegirOcupacion', esco });
  }
  await presentarFase();
}

/**
 * «Volver» dentro de la ocupación (o desde las tareas): la fase anterior, con lo que ya se sabía. Las peticiones en
 * curso ya las ha cancelado recorrido.js.
 * @returns {void}
 */
export function volverEnOcupacion() {
  // En mitad de las preguntas del motor del dispositivo, «Volver» deshace la última respuesta (recorrido/flujo-local.js).
  if (enPreguntasLocales()) {
    local = flujoLocal.deshacer(local);
    void pasoLocal();
    return;
  }
  // Sin esperar: presentarFase cuenta en la conversación cualquier fallo de lo que pide.
  if (cambiar({ tipo: 'volver' })) {
    void presentarFase();
  } else {
    enfocarCompositor();
  }
}

/**
 * Empieza (o vuelve a empezar) la conversación: la máquina desde el principio, el paso 1 y el saludo de Faro.
 * @param {{ borrado?: boolean, motivo?: Traducible }} [opciones] @returns {void}
 */
export function empezarConversacion({ borrado = false, motivo } = {}) {
  flujo = estadoInicial();
  local = flujoLocal.estadoInicial();
  huellaLocal = '';
  retirarTarjetas();
  ultimaRespuesta = '';
  irA(PASO_RELATO);
  modoRespuesta();
  saludar({ borrado, ...(motivo ? { motivo } : {}) });
}

/**
 * Conecta «Continuar» de la tarjeta de la ocupación.
 * @returns {void}
 */
export function iniciarPasoOcupacion() {
  formulario().addEventListener('submit', (evento) => {
    evento.preventDefault();
    if (!hayPeticionEnCurso()) {
      alContinuar();
    }
  });
}
