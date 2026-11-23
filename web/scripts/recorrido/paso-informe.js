// El informe se calcula con los datos y referencias confirmados. Una tarea literal sin referencia se conserva sin
// nota: no se pide una estimación generativa. Las firmas rechazadas se retiran selectivamente y el informe se vuelve
// a pedir sin inventar ni renovar su estimación. El HTML solo se inserta por el contrato de confianza existente.

import { htmlDeConfianza } from '../confianza.js';
import { crear, porId } from '../dom.js';
import { alCambiarIdioma, escribir } from '../idioma.js';
import { prepararInforme, retirarInforme } from '../informe.js';
import { ofrecerPasar, resultadoDelRecorrido, retirarPasar } from '../otro-dispositivo/dialogo.js';
import { CodigoNoValido, codificar, enlaceConCodigo } from '../otro-dispositivo/formato.js';
import { informeDelCodigo } from '../otro-dispositivo/recibir.js';
import { CAMPO_FIRMAS_NO_VALIDAS, CAMPO_TAREAS_NO_ADMITIDAS } from '../protocolo-web.js';
import { idiomaActual, traducible } from '../textos.js';
import { tituloDoble } from '../titulo-breve.js';
import { avisosDeModeracion, ErrorFaro, esCancelacion } from './api/errores.js';
import { senalDeCancelacion } from './api/transporte.js';
import { informeEnHtml } from './api.js';
import {
  crearCarpeta,
  crearFraseDelAgente,
  crearPensamiento,
  crearTarjetaDeLaHoja,
  crearTarjetaDelAgente,
  marcarAgente,
  olvidarAgentes,
} from './carpeta.js';
import { mostrarCompositor } from './compositor.js';
import {
  AVISO_DE_AYUDA,
  actualizarEspera,
  avisoYaDicho,
  decirAvisos,
  decirFaro,
  decirPersona,
  empezarAPensar,
  llevarALaVista,
  mostrarEspera,
  ofrecerSugerencias,
  quitarEspera,
} from './conversacion.js';
import { datoEn, datoOficial } from './datos-traducidos.js';
import { pintarDocumentoDeLaHoja } from './documento-hoja.js';
import { hojasDelInforme, mostrarDocumentoDelInforme } from './documento-informe.js';
import { prepararEntregaFinal } from './entrega-final.js';
import { explicacionesDeLasSinEstimacion, numerosEnLaLista } from './explicaciones-sin-estimacion.js';

export { explicacionesDeLasSinEstimacion } from './explicaciones-sin-estimacion.js';

import { anotarFallo, estado, ocupacionElegida, olvidarEstimacion } from './estado.js';
import { ORIGENES } from './flujo-ocupacion.js';
import { fechaLocalDeHoy } from './formato.js';
import { marcarPasoEnLaGuia } from './guia.js';
import { empezarHojaDeRuta } from './hoja-de-ruta.js';
import { irA, PASO_INFORME, PASO_TAREAS } from './navegacion.js';
import { avisarDelFallo, enEspera, enfocar, hayPeticionEnCurso } from './pagina.js';
import { marcarConfirmadas, pintarTareas } from './paso-tareas.js';
import {
  obtenerAcreditaciones,
  olvidarAcreditacion,
  registrarAcreditacion,
} from './plan-formacion/registro-acreditacion.js';
import { salidasTrasElFallo } from './reparar.js';
import { tareasListas } from './revision.js';
import { hechoSinAporteInferido, idiomaDeLasRespuestas } from './traduccion-api.js';

/** @import { Idioma, Parte } from '../textos.js' */
/** @import { Sugerencia } from './conversacion.js' */
/** @import { Tarea } from './estado.js' */
/** @import { Aviso, EntradaDelInforme } from './traduccion-api.js' */
/** @import { TareaEntrada } from '../../../src/dominio/tipos-entrada.ts' */

/**
 * El primer código de los fallos del propio motor al preparar el informe (500 y siguientes: un fallo interno, un
 * resultado que no ha podido dar o su plazo), que no vienen de lo que se le ha pedido.
 */
const PRIMER_FALLO_DEL_MOTOR = 500;
/** El aviso de datos personales quitados: el informe lo trae también por lo que ya se avisó al escribirlo. */
const AVISO_DE_DATOS = 'datos-personales';
/** Lo que dice Faro mientras prepara el informe y las respuestas rápidas del paso. */
const PREPARANDO = traducible('recorrido.espera.informe');
const SOLO_OFICIALES = traducible('recorrido.informe.solo-oficiales');
const REINTENTAR = traducible('recorrido.reintentar');
/** El paso del pensamiento de la entrega mientras el informe se prepara. */
const PREPARANDO_LA_ENTREGA = traducible('recorrido.agente.entregando');
const VOLVER_A_LAS_TAREAS = Object.freeze({
  texto: traducible('recorrido.informe.volver-tareas'),
  volver: PASO_TAREAS,
});

/**
 * El idioma en que el motor escribió el informe que está a la vista, o null si todavía no hay ninguno. Lo fija
 * pintarInformeDelMotor y lo suelta olvidarInforme.
 * @type {Idioma | null}
 */
let idiomaDelInforme = null;

/**
 * Lo que trae el informe: su HTML, y los avisos con que llega, escritos en su idioma.
 * @typedef {{ html: string, avisos: Aviso[], informe?: unknown }} InformeDelMotor
 */

/**
 * Faro dice los avisos del informe o de su rechazo, escritos en `idioma`. Los de las estimaciones ya los dijo el paso de
 * las tareas. El de los datos personales, solo si Faro no lo ha dicho ya en la conversación: el informe vuelve a
 * limpiar lo que se limpió al escribirlo, y repetirlo sería un reproche sin motivo.
 * @param {Aviso[]} delInforme @param {Idioma} idioma
 */
function decirLosAvisos(delInforme, idioma) {
  decirAvisos(
    delInforme.filter((aviso) => !(aviso.tipo === AVISO_DE_DATOS && avisoYaDicho(AVISO_DE_DATOS))),
    idioma,
  );
}

/**
 * Cambia el texto de la espera mientras se prepara el informe, salvo si se prepara en segundo plano: entonces la espera
 * que se ve es de otra cosa (una pregunta de la hoja de ruta) y el avance lo dice la tarjeta del agente.
 * @param {Parte} parte
 */
function avanzar(parte) {
  if (!informeEnCurso) {
    actualizarEspera(parte);
  }
}

/**
 * El texto de la tarea con que se estima: sin los espacios de los extremos. Una estimación vale para este texto
 * (`estimadaPara`, `sinEstimacion.para`).
 * @param {Tarea} tarea @returns {string}
 */
function textoParaEstimar(tarea) {
  return tarea.texto.trim();
}

/**
 * Conserva las tareas sin referencia y sin estimación como información insuficiente, sin pedir inferencia.
 * @param {Tarea[]} tareas
 */
function anotarTareasSinNota(tareas) {
  const motivo = estado.grupos.principal?.sinReferencias ? 'sinReferencias' : 'sinEstimacionAcreditada';
  for (const tarea of tareas) {
    anotarFallo(tarea, textoParaEstimar(tarea), motivo);
  }
}

/**
 * Si es una tarea sin tarea oficial que no tiene estimación (ni intento fallido que no se repite) para su texto actual.
 * @param {Tarea} tarea @returns {boolean}
 */
function pendiente(tarea) {
  return !tarea.oficial && tarea.estimadaPara !== textoParaEstimar(tarea);
}

/**
 * Si la tarea se quedó sin estimación para su texto actual, con su motivo.
 * @param {Tarea} tarea @returns {boolean}
 */
function sinEstimacion(tarea) {
  return !tarea.oficial && !tarea.estimacion && tarea.sinEstimacion?.para === textoParaEstimar(tarea);
}

/**
 * Las tareas sin nota que «Ver mi informe» debe marcar como información insuficiente.
 * @returns {Tarea[]}
 */
export function pendientesDeEstimar() {
  return estado.tareas.filter(pendiente);
}

/**
 * Las tareas que se quedaron sin estimación para su texto actual: el informe las marca como información insuficiente.
 * @returns {Tarea[]}
 */
export function tareasSinEstimacion() {
  return estado.tareas.filter(sinEstimacion);
}

/**
 * El identificador de una tarea en el cuerpo de /api/informe.
 * @param {Tarea} tarea @returns {string}
 */
function idEnElInforme(tarea) {
  return `t${tarea.id}`;
}

/**
 * Una tarea tal como la recibe /api/informe: con su tarea oficial, con su estimación o sin ninguna de las dos. Una
 * tarea oficial marcada se nombra con su texto oficial en el idioma del informe (su traducción de Faro, si la hay);
 * las demás, con lo que escribió la persona. El informe solo se pide con todas las tareas listas (revision.js), así
 * que una tarea sin tiempo aquí es un error del programa.
 * @param {Tarea} tarea @param {Idioma} idioma @returns {TareaEntrada}
 */
function tareaParaElInforme(tarea, idioma) {
  const { tiempo } = tarea;
  if (!tiempo) {
    throw new Error(`La tarea ${tarea.id} va al informe sin su tiempo`);
  }
  const texto = tarea.marcada ? datoEn(tarea.texto, idioma) : tarea.texto;
  const base = { id: idEnElInforme(tarea), texto: texto.trim(), tiempo };
  if (tarea.oficial) {
    return { ...base, referencia: { tareaOit: tarea.oficial, relacion: 'propia' } };
  }
  if (tarea.estimacion) {
    return { ...base, estimacion: tarea.estimacion };
  }
  return base;
}

/**
 * Lo que recibe /api/informe: la ocupación, la fecha de hoy, las tareas, nombradas en el idioma del informe, y si se
 * carece de aportes inferidos, según su procedencia.
 * @param {Idioma} idioma @returns {EntradaDelInforme}
 */
function entradaDelInforme(idioma) {
  const tareas = estado.tareas.map((tarea) => tareaParaElInforme(tarea, idioma));
  const ocupacion = ocupacionElegida();
  const sinIa = hechoSinAporteInferido(ocupacion, estado.tareas);
  return { ocupacion, fecha: fechaLocalDeHoy(), tareas, ...(sinIa ? { sinIa } : {}) };
}

/**
 * Las tareas que nombra `campo` en el cuerpo de un error de /api/informe; si el error no lo trae, ninguna. El campo
 * solo lo escribe la respuesta que lo usa (el 400 de las firmas, el 422 de la moderación).
 * @param {unknown} error @param {string} campo @returns {Tarea[]}
 */
function tareasDelError(error, campo) {
  const ids = error instanceof ErrorFaro ? error.datos[campo] : null;
  if (!Array.isArray(ids)) {
    return [];
  }
  return estado.tareas.filter((tarea) => ids.includes(idEnElInforme(tarea)));
}

/**
 * Las tareas cuya estimación el motor ya no acepta, según su 400 (vacío si el fallo es otro).
 * @param {unknown} error @returns {Tarea[]}
 */
function tareasConFirmaNoValida(error) {
  return tareasDelError(error, CAMPO_FIRMAS_NO_VALIDAS);
}

/**
 * Las tareas que la moderación no admite en el informe, según su 422 (vacío si el fallo es otro).
 * @param {unknown} error @returns {Tarea[]}
 */
export function tareasNoAdmitidas(error) {
  return tareasDelError(error, CAMPO_TAREAS_NO_ADMITIDAS);
}

/**
 * El HTML del informe de lo que hay en el recorrido, escrito en `idioma`.
 * @param {Idioma} idioma @returns {ReturnType<typeof informeEnHtml>}
 */
function pedirElHtml(idioma) {
  return informeEnHtml(entradaDelInforme(idioma), idioma);
}

/**
 * Pide el HTML del informe. Si alguna firma ya no vale, retira esas estimaciones (una sola vez) y lo pide otra
 * vez sin las estimaciones rechazadas, conservando el resto de la entrada.
 * @param {Idioma} idioma @returns {Promise<InformeDelMotor>}
 */
async function pedirElHtmlRenovandoFirmas(idioma) {
  try {
    return await pedirElHtml(idioma);
  } catch (error) {
    const caducadas = tareasConFirmaNoValida(error);
    if (!caducadas.length) {
      throw error;
    }
    for (const tarea of caducadas) {
      olvidarEstimacion(tarea);
    }
    anotarTareasSinNota(caducadas);
    avanzar(PREPARANDO);
    return pedirElHtml(idioma);
  }
}

/**
 * Marca sin nota las tareas pendientes y pide el informe al motor, actualizando el mensaje de espera si existe, sin
 * pintar el informe final. Devuelve su HTML y sus avisos (`avisos` del resultado), que dice quien lo llama. Lo usa
 * informeDelAgente; las pruebas lo llaman directamente (pruebas/web-recorrido-integral/informe.test.ts).
 * @param {Idioma} idioma @param {() => Tarea[]} porEstimar
 * @returns {Promise<InformeDelMotor>}
 */
export async function htmlDelInforme(idioma, porEstimar) {
  anotarTareasSinNota(porEstimar());
  avanzar(PREPARANDO);
  return pedirElHtmlRenovandoFirmas(idioma);
}

/**
 * El informe lo escribió el motor en el idioma en que se pidió y no se traduce al cambiar el de la página: volver a
 * pedirlo es lo que lo escribe en el nuevo. Mientras los dos idiomas no coincidan, una nota lo dice, sobre el informe.
 */
function marcarIdiomaDelInforme() {
  porId('nota-idioma-informe').hidden = !idiomaDelInforme || idiomaDelInforme === idiomaActual();
}

/**
 * Único punto donde la web inserta HTML: el informe que pinta el motor (src/presentacion/informe-breve.ts),
 * que escapa todo texto de la persona y de las fuentes antes de devolverlo. Cualquier otro contenido va con
 * textContent. Las medidas de cada informe llegan como atributos data-* y las aplica informe.js. El informe se
 * marca con el idioma en que lo escribió el motor, que no cambia al cambiar el de la página.
 * @param {HTMLElement} contenedor @param {{ html: string, idioma: Idioma }} informe @param {() => void} alBorrar
 */
function pintarInformeDelMotor(contenedor, { html, idioma }, alBorrar) {
  contenedor.innerHTML = htmlDeConfianza(html);
  contenedor.lang = idioma;
  idiomaDelInforme = idioma;
  marcarIdiomaDelInforme();
  prepararInforme(contenedor, { alBorrar });
}

/**
 * El informe borrado ya no está a la vista: su nota del idioma tampoco, ni el documento de la hoja de ruta, y sus
 * escuchas se retiran (la lectura en voz alta calla en el acto).
 * @returns {void}
 */
export function olvidarInforme() {
  olvidarAcreditacion();
  retirarInforme();
  // El documento de la hoja de ruta vive a su lado (documento-hoja.js): se borra con él.
  document.getElementById('hoja-de-ruta')?.replaceChildren();
  const vista = document.getElementById('paso-4');
  if (vista) {
    delete vista.dataset.vista;
  }
  idiomaDelInforme = null;
  marcarIdiomaDelInforme();
  retirarPasar();
}

/**
 * Las hojas del informe se piden con media="print" (recorrido.html), que no bloquea el pintado del recorrido, y entran
 * aquí, todas a la vez: mientras el motor prepara el informe, el navegador acaba de traerlas, así que no se espera
 * nada.
 */
function vestirElInforme() {
  for (const hoja of document.querySelectorAll('link[data-hoja-informe]')) {
    if (hoja instanceof HTMLLinkElement) {
      hoja.media = 'all';
    }
  }
}

/**
 * La moderación no admite en el informe alguna tarea que escribió la persona: Faro dice cuál, por su número y sin
 * citarla, y ofrece quitarla y pedir el informe sin ella, o volver a las tareas para escribirla de otra manera. Sus
 * avisos (el del 024, si lo trae) ya los ha dicho quien llama.
 * @param {Tarea[]} tareas @param {() => void} volverAPedirlo
 */
function contarNoAdmitidas(tareas, volverAPedirlo) {
  const una = tareas.length === 1;
  const clave = una ? 'recorrido.informe.no-admitida' : 'recorrido.informe.no-admitidas';
  decirFaro(traducible(clave, { numeros: numerosEnLaLista(tareas) }));
  const quitar = traducible(una ? 'recorrido.informe.quitar-una' : 'recorrido.informe.quitar-varias');
  const quitarYPedir = () => {
    decirPersona(quitar);
    estado.tareas = estado.tareas.filter((tarea) => !tareas.includes(tarea));
    pintarTareas();
    volverAPedirlo();
  };
  enfocar(ofrecerSugerencias([{ texto: quitar, accion: quitarYPedir }, VOLVER_A_LAS_TAREAS]));
}

/**
 * Si el motor no ha podido preparar el informe completo por un fallo suyo, no por lo que se le ha pedido: el informe de
 * las tareas oficiales no necesita IA y se prepara por otro camino (informeSoloConLasOficiales).
 * @param {unknown} error @returns {boolean}
 */
function esFalloDelMotor(error) {
  return error instanceof ErrorFaro && typeof error.codigo === 'number' && error.codigo >= PRIMER_FALLO_DEL_MOTOR;
}

/**
 * Un fallo al preparar el informe: Faro lo cuenta y deja una salida. Si la moderación no admite alguna tarea, cuál y
 * qué hacer con ella (contarNoAdmitidas); con el aviso del 024 y sin tareas que nombrar, volver a las tareas, sin
 * ofrecer repetir lo mismo; si ha fallado el motor, volver a intentarlo o prepararlo solo con las tareas oficiales, sin IA;
 * si no, «Volver a intentarlo», igual que en los pasos 1 y 2, para que un corte de red no deje el paso 4 en nada. Los
 * avisos del rechazo ya los ha dicho quien llama.
 * @param {unknown} error @param {() => void} volverAPedirlo @param {() => void} alBorrar
 */
function contarFallo(error, volverAPedirlo, alBorrar) {
  const noAdmitidas = tareasNoAdmitidas(error);
  if (noAdmitidas.length) {
    contarNoAdmitidas(noAdmitidas, volverAPedirlo);
  } else if (avisosDeModeracion(error).some((aviso) => aviso.tipo === AVISO_DE_AYUDA)) {
    ofrecerSugerencias([VOLVER_A_LAS_TAREAS]);
  } else if (esFalloDelMotor(error)) {
    decirFaro(traducible('recorrido.informe.fallo-al-prepararlo'));
    ofrecerSugerencias([
      { texto: REINTENTAR, accion: volverAPedirlo },
      { texto: SOLO_OFICIALES, accion: () => void informeSoloConLasOficiales(alBorrar) },
    ]);
  } else {
    avisarDelFallo(error);
    ofrecerSugerencias(salidasTrasElFallo(error, [{ texto: REINTENTAR, accion: volverAPedirlo }]));
  }
}

/**
 * El informe preparado por el motor de este dispositivo, sin IA y sin que salga nada: el mismo camino que un resultado
 * pasado desde otro dispositivo (otro-dispositivo/recibir.js). Incluye las tareas con referencia oficial, también
 * las contadas con palabras y enlazadas; se reconstruyen con su texto oficial. Las que no tienen referencia quedan
 * fuera, y Faro lo dice.
 * @param {() => void} alBorrar
 */
async function informeSoloConLasOficiales(alBorrar) {
  const signal = senalDeCancelacion();
  const idioma = idiomaDeLasRespuestas();
  // Reunir el resultado, prepararlo o pintarlo puede fallar: Faro lo dice en la conversación, con «Volver a
  // intentarlo» (o «Reparar Faro» si la copia del motor no es la de esta versión), y la tarjeta del agente también
  // (nada queda en silencio). Por eso el resultado se reúne dentro de la espera, que cuenta sus fallos.
  /** @param {unknown} error */
  const fallar = (error) => {
    marcarAgente('fallo');
    avisarDelFallo(error);
    ofrecerSugerencias(
      salidasTrasElFallo(error, [{ texto: REINTENTAR, accion: () => void informeSoloConLasOficiales(alBorrar) }]),
    );
  };
  const preparado = await enEspera({
    boton: null,
    aviso: PREPARANDO,
    trabajo: async () => {
      const resultado = resultadoDeEsteRecorrido(idioma);
      return {
        resultado,
        informe: await informeDelCodigo(codificar(resultado), { signal, relojDelDispositivo: true }),
      };
    },
    alFallar: fallar,
  });
  if (signal.aborted || !preparado) {
    return;
  }
  const { resultado, informe } = preparado;
  try {
    pintarInformeDelMotor(porId('informe'), { html: informe.html, idioma }, alBorrar);
  } catch (error) {
    fallar(error);
    return;
  }
  ofrecerPasar(resultado);
  marcarAgente('hecho', hojasDelInforme());
  informeEnMarcha = Promise.resolve(true);
  const clave = resultado.sinViajar
    ? 'recorrido.informe.hecho-sin-las-tuyas'
    : 'recorrido.informe.hecho-solo-oficiales';
  decirFaro(traducible(clave), { tipo: 'nota' });
  // Entrega el informe recibido y la hoja de formación en una carpeta.
  await entregar(cursosDeLaEntrega, alBorrar);
}

/**
 * El informe que prepara el agente en segundo plano: su promesa (true si ha llegado), su último fallo y si hay uno en
 * curso. Solo hay uno a la vez; las peticiones de la hoja de ruta siguen mientras tanto (no usa enEspera, que bloquea
 * la conversación).
 * @type {Promise<boolean> | null}
 */
let informeEnMarcha = null;
/** @type {unknown} */
let falloDelInforme;
let informeEnCurso = false;
/** Los cursos de la hoja confirmada con que se entregó la carpeta por última vez; null sin hoja. @type {number | null} */
let cursosDeLaEntrega = null;
/** Si alguien espera ya al informe para entregarlo (entregar): entonces es él quien cuenta un fallo. */
let esperandoEntrega = false;

/**
 * El informe del agente ha fallado (al prepararlo o al pintarlo) mientras la persona sigue con la hoja de ruta: Faro
 * lo dice en el momento, con «Volver a intentarlo» dentro del mensaje, para no quitarle las respuestas rápidas de la
 * pregunta que tiene delante. Si ya se está entregando, lo cuenta entregar (contarFallo).
 * @param {() => void} alBorrar
 */
function contarFalloDelAgente(alBorrar) {
  if (esperandoEntrega) {
    return;
  }
  const boton = escribir(crear('button', { type: 'button', className: 'rc-boton-secundario' }), REINTENTAR);
  boton.addEventListener('click', () => {
    if (informeEnCurso) {
      return;
    }
    boton.disabled = true;
    void encargarInforme(alBorrar);
  });
  decirFaro([traducible('recorrido.agente.fallo-nota'), boton], { tipo: 'error' });
}

/**
 * Prepara el informe en segundo plano, marcando las tareas de `porEstimar()` sin nota: no pinta nada en el chat. Al
 * llegar, lo deja pintado en #informe (escondido hasta que la persona pulse «Leer») y la tarjeta del agente dice
 * «Terminado · N hojas»; si falla, lo apunta para contarlo al entregar y la tarjeta lo dice. Los avisos que traiga
 * los dice Faro en el momento. Devuelve si ha llegado.
 * @param {() => void} alBorrar @param {() => Tarea[]} [porEstimar] @returns {Promise<boolean>}
 */
async function informeDelAgente(alBorrar, porEstimar = pendientesDeEstimar) {
  const signal = senalDeCancelacion();
  vestirElInforme();
  const idioma = idiomaDeLasRespuestas();
  const ocupacion = estado.ocupacion;
  olvidarAcreditacion();
  informeEnCurso = true;
  marcarAgente('trabajando');
  try {
    const informe = await htmlDelInforme(idioma, porEstimar);
    if (signal.aborted) {
      return false;
    }
    pintarInformeDelMotor(porId('informe'), { html: informe.html, idioma }, alBorrar);
    registrarAcreditacion(informe.informe, ocupacion, idioma);
    ofrecerPasarElRecorrido(idioma);
    decirLosAvisos(informe.avisos, idioma);
    marcarConfirmadas(true);
    falloDelInforme = undefined;
    marcarAgente('hecho', hojasDelInforme());
    return true;
  } catch (error) {
    if (signal.aborted || esCancelacion(error)) {
      return false;
    }
    if (!(error instanceof ErrorFaro)) {
      console.error(error);
    }
    // Prepararlo o pintarlo (un HTML que no admite el filtro de confianza) ha fallado: las tareas vuelven a poder
    // confirmarse y Faro lo dice, nunca en silencio.
    falloDelInforme = error;
    marcarConfirmadas(false);
    decirLosAvisos(avisosDeModeracion(error), idioma);
    marcarAgente('fallo');
    contarFalloDelAgente(alBorrar);
    return false;
  } finally {
    informeEnCurso = false;
  }
}

/**
 * Lo que dice Faro al encargar el informe, con su tarjeta debajo: que lo prepara un agente de IA de Faro. La frase y
 * la tarjeta cambian juntas (carpeta.js): si el informe ya está listo, las dos lo dicen.
 */
function decirQueSePreparaElInforme() {
  decirFaro([crearFraseDelAgente(), crearTarjetaDelAgente()]);
}

/**
 * Encarga el informe al agente (informeDelAgente) y apunta su promesa, para entregarlo cuando toque.
 * @param {() => void} alBorrar @param {() => Tarea[]} [porEstimar] @returns {Promise<boolean>}
 */
function encargarInforme(alBorrar, porEstimar) {
  informeEnMarcha = informeDelAgente(alBorrar, porEstimar);
  return informeEnMarcha;
}

/**
 * Lo que dice el pensamiento al entregar, con el estado real del informe: si ya estaba listo cuando la persona llegó
 * aquí (en el dispositivo tarda menos de un segundo) o si Faro lo está preparando todavía.
 * @param {boolean} yaEstabaListo
 */
function pasosDeLaEntrega(yaEstabaListo) {
  return [{ texto: yaEstabaListo ? traducible('recorrido.agente.ya-estaba-listo') : PREPARANDO_LA_ENTREGA }];
}

/**
 * Entrega lo hecho: espera al agente si aún trabaja, y «Tu carpeta», con el informe y, si la persona ha confirmado su
 * hoja de ruta (`cursos`), la tarjeta de la hoja. Si el informe ha fallado, Faro lo cuenta con su salida (contarFallo).
 * Las tareas que se quedaron sin estimación se dicen aquí, con «Volver a las tareas».
 * @param {number | null} cursos @param {() => void} alBorrar
 */
async function entregar(cursos, alBorrar) {
  const signal = senalDeCancelacion();
  cursosDeLaEntrega = cursos;
  esperandoEntrega = true;
  const yaEstabaListo = !informeEnCurso;
  // Si el informe aún se prepara, el pensamiento empieza con su espera y se termina en cuanto llega, sin ningún reloj.
  /** @type {HTMLElement | null} */
  let empezado = null;
  if (informeEnCurso) {
    mostrarEspera(traducible('recorrido.espera.terminando-informe'));
    empezado = empezarAPensar(PREPARANDO_LA_ENTREGA);
  }
  const listo = await (informeEnMarcha ?? Promise.resolve(false));
  esperandoEntrega = false;
  // Si la persona lo ha borrado mientras tanto, esta entrega ya no es de la conversación: no se dice nada.
  if (signal.aborted) {
    return;
  }
  quitarEspera();
  if (!listo) {
    const volverAPedirlo = () => void encargarYEntregar(alBorrar, pendientesDeEstimar);
    contarFallo(falloDelInforme, volverAPedirlo, alBorrar);
    return;
  }
  decirFaro(crearPensamiento(pasosDeLaEntrega(yaEstabaListo), { empezado }));
  const ocupacion = estado.ocupacion ? datoOficial(ocupacionElegida().titulo, tituloDoble) : null;
  const alPrepararHoja = () => abrirLaHoja(alBorrar, traducible('recorrido.hoja.preparar'));
  const hojaLista = cursos !== null && documentoDeLaHojaListo();
  const carpeta = crearCarpeta({ ocupacion, cursos, hojaLista, alPrepararHoja });
  const aqui = cursos === null ? 'recorrido.carpeta.aqui-informe' : 'recorrido.carpeta.aqui-dos';
  const mensaje = decirFaro([traducible(aqui), carpeta]);
  const sinEstimar = tareasSinEstimacion();
  for (const parte of explicacionesDeLasSinEstimacion(sinEstimar)) {
    decirFaro(parte, { tipo: 'nota' });
  }
  /** @type {Sugerencia[]} */
  const reintentoDeLaHoja = [];
  if (cursos !== null && !hojaLista) {
    decirFaro(traducible('recorrido.hoja-doc.fallo'), { tipo: 'error' });
    reintentoDeLaHoja.push({ texto: REINTENTAR, accion: () => reintentarLaHoja(ocupacion, cursos) });
  } else if (cursos !== null) {
    decirFaro(traducible('recorrido.carpeta.justo-arriba'));
  }
  ofrecerSugerencias([...reintentoDeLaHoja, VOLVER_A_LAS_TAREAS]);
  llevarALaVista(mensaje, 'start');
  prepararEntregaFinal({ mensaje, carpeta, signal, cursos, hojaLista, sinEstimar });
}

/**
 * Pinta el documento de la hoja de ruta confirmada (documento-hoja.js) y dice si ha salido. Un fallo no se calla:
 * quien llama lo cuenta en el chat con «Volver a intentarlo»; la pista técnica va a la consola.
 * @returns {boolean}
 */
function documentoDeLaHojaListo() {
  try {
    pintarDocumentoDeLaHoja();
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/**
 * «Volver a intentarlo» con el documento de la hoja de ruta: si sale, Faro entrega su tarjeta, con «Leer» y «Guardar en
 * PDF o imprimir»; si vuelve a fallar, lo dice otra vez con la misma salida.
 * @param {Parte | null} ocupacion @param {number} cursos
 */
function reintentarLaHoja(ocupacion, cursos) {
  decirPersona(REINTENTAR);
  if (!documentoDeLaHojaListo()) {
    decirFaro(traducible('recorrido.hoja-doc.fallo'), { tipo: 'error' });
    ofrecerSugerencias([{ texto: REINTENTAR, accion: () => reintentarLaHoja(ocupacion, cursos) }, VOLVER_A_LAS_TAREAS]);
    return;
  }
  const mensaje = decirFaro([traducible('recorrido.hoja-doc.lista'), crearTarjetaDeLaHoja(cursos, true)]);
  ofrecerSugerencias([VOLVER_A_LAS_TAREAS]);
  llevarALaVista(mensaje, 'start');
}

/**
 * Vuelve a encargar el informe con las tareas indicadas y, si llega,
 * lo entrega en una carpeta nueva.
 * @param {() => void} alBorrar @param {() => Tarea[]} porEstimar
 */
async function encargarYEntregar(alBorrar, porEstimar) {
  if (informeEnCurso) {
    return;
  }
  // Un informe nuevo: las tarjetas de antes se quedan como estaban (con su fallo) y la nueva nace preparándose.
  olvidarAgentes();
  decirQueSePreparaElInforme();
  esperandoEntrega = true;
  // Se encarga sin esperarlo: la entrega lo espera con su pensamiento, que empieza ya, con la preparación.
  void encargarInforme(alBorrar, porEstimar);
  await entregar(cursosDeLaEntrega, alBorrar);
}

/**
 * Empieza la hoja de ruta; al acabar (confirmada o «Ahora no»), entrega la carpeta.
 * @param {() => void} alBorrar @param {Parte} dicho
 */
function abrirLaHoja(alBorrar, dicho) {
  empezarHojaDeRuta({
    dicho,
    alAcabar: (cursos) => void entregar(cursos, alBorrar),
    obtenerAcreditaciones: (signal) => obtenerAcreditaciones(informeEnMarcha, signal),
  });
}

/**
 * Con el informe a la vista, se puede pasar a otro dispositivo (otro-dispositivo/dialogo.js).
 * @param {Idioma} idioma
 */
function ofrecerPasarElRecorrido(idioma) {
  ofrecerPasar(resultadoDeEsteRecorrido(idioma));
}

/**
 * El resultado de este recorrido, el que se pasa a otro dispositivo: los grupos y la ocupación ESCO (de dónde salió el
 * grupo lo dice `propuestoPorIa`) y las tareas oficiales con su tiempo.
 * @param {Idioma} idioma
 */
function resultadoDeEsteRecorrido(idioma) {
  const ocupacion = ocupacionElegida();
  const { tareas } = estado;
  const sinIa = hechoSinAporteInferido(ocupacion, tareas);
  const propuestoPorIa = ocupacion.origen === ORIGENES.IA;
  const { isco08, esco, isco08Secundario } = ocupacion;
  const opciones = { idioma, fecha: fechaLocalDeHoy(), sinIa, propuestoPorIa };
  return resultadoDelRecorrido({ isco08, esco, isco08Secundario }, tareas, opciones);
}

/**
 * El resultado que llega de otro dispositivo (#pasar=…, otro-dispositivo/recibir.js): el motor de este dispositivo lo
 * comprueba y rehace el informe, que se pinta como cualquier otro. Faro dice de dónde viene y, si la persona contó
 * tareas con sus palabras, que esas no viajan. Un código que no vale lo dice Faro en una línea, y nada más cambia. Si el
 * motor del dispositivo no se puede usar (su copia no es la de esta versión, o la instalación no coincide), Faro lo dice
 * con su explicación y lo que ofrece (salidasTrasElFallo: «Reparar Faro», o nada en una primera visita); al terminar
 * la reparación, la página se vuelve a abrir con el mismo resultado (recargarConElResultado).
 * @param {string} codigo @param {{ alBorrar: () => void, signal?: AbortSignal }} opciones
 * @returns {Promise<void>}
 */
export async function abrirResultadoRecibido(codigo, { alBorrar, signal = senalDeCancelacion() }) {
  vestirElInforme();
  try {
    const { html, resultado } = await informeDelCodigo(codigo, { signal });
    if (signal.aborted) {
      return;
    }
    document.body.dataset.conversacion = 'empezada';
    alCambiarIdioma(marcarIdiomaDelInforme);
    pintarInformeDelMotor(porId('informe'), { html, idioma: resultado.idioma }, alBorrar);
    irA(PASO_INFORME);
    const mensaje = decirFaro(traducible('recorrido.pasar.recibido'));
    mostrarDocumentoDelInforme(mensaje, null);
    if (resultado.sinViajar) {
      decirFaro(traducible('recorrido.pasar.sin-viajar'), { tipo: 'nota' });
    }
    ofrecerPasar(resultado);
    llevarALaVista(mensaje, 'start');
  } catch (error) {
    if (signal.aborted || esCancelacion(error)) {
      return;
    }
    if (error instanceof ErrorFaro) {
      avisarDelFallo(error);
      enfocar(ofrecerSugerencias(salidasTrasElFallo(error, [], { recargar: () => recargarConElResultado(codigo) })));
      return;
    }
    if (!(error instanceof CodigoNoValido)) {
      console.error(error);
    }
    const clave = error instanceof CodigoNoValido ? 'recorrido.pasar.no-valido' : 'recorrido.pasar.fallo';
    decirFaro(traducible(clave), { tipo: 'nota' });
  }
}

/**
 * Recarga la página con el resultado recibido otra vez en su enlace (enlaceConCodigo), para que se vuelva a abrir solo
 * al terminar la reparación de la copia. El código no se guarda en ningún sitio: vuelve a la dirección solo para esta
 * recarga, sin otra entrada en el historial (replaceState), y al cargar sale otra vez de la barra (fragmento.js).
 * @param {string} codigo
 */
function recargarConElResultado(codigo) {
  history.replaceState(history.state, '', enlaceConCodigo(location.href, codigo));
  location.reload();
}

/**
 * Confirma las tareas y encarga el informe a un agente, en segundo plano: el
 * pensamiento de Faro, la tarjeta del agente y la pregunta de si avanzan con la hoja de ruta mientras tanto («Sí» o
 * «Ahora no, solo el informe»). El informe no se pinta en el chat: se entrega en «Tu carpeta». Lo llama recorrido.js
 * al enviar «Ver mi informe». `alBorrar` es lo que hace «Borrar el informe y lo escrito» del informe pintado.
 * Devuelve cuando el informe ha llegado o ha fallado.
 * @param {SubmitEvent} evento @param {{ alBorrar: () => void }} opciones
 * @returns {Promise<void>}
 */
export async function verMiInforme(evento, { alBorrar }) {
  evento.preventDefault();
  if (hayPeticionEnCurso() || informeEnCurso || !tareasListas()) {
    return;
  }
  alCambiarIdioma(marcarIdiomaDelInforme);
  decirPersona(traducible('recorrido.informe.pedir'));
  marcarConfirmadas(true);
  // Las tareas ya están confirmadas: su tarjeta se esconde y la conversación sigue con respuestas rápidas.
  const tarjeta = document.getElementById('tarjeta-tareas');
  if (tarjeta) {
    tarjeta.hidden = true;
  }
  mostrarCompositor(false);
  olvidarAgentes();
  cursosDeLaEntrega = null;
  esperandoEntrega = false;
  decirFaro(
    crearPensamiento([
      { texto: traducible('recorrido.agente.encargando') },
      { texto: traducible('recorrido.agente.paralelo') },
    ]),
  );
  decirQueSePreparaElInforme();
  // Con la tarjeta del agente, la guía y la pastilla pasan al paso 4; la vista del informe (#paso-4) solo la abre
  // «Leer» (documento-informe.js).
  document.body.dataset.informe = 'oculto';
  marcarPasoEnLaGuia({ paso: PASO_INFORME, nombre: traducible('recorrido.paso.4.nombre'), total: PASO_INFORME });
  const enMarcha = encargarInforme(alBorrar);
  decirFaro(traducible('recorrido.agente.avanzamos'));
  ofrecerSugerencias([
    {
      texto: traducible('recorrido.agente.si'),
      accion: () => abrirLaHoja(alBorrar, traducible('recorrido.agente.si')),
    },
    {
      texto: traducible('recorrido.agente.solo-informe'),
      clase: 'rc-sugerencia-secundaria',
      accion: () => {
        decirPersona(traducible('recorrido.agente.solo-informe'));
        void entregar(null, alBorrar);
      },
    },
  ]);
  await enMarcha;
}
