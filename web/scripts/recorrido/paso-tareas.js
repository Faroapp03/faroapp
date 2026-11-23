// Paso 3 · Las tareas, en una tarjeta bajo la conversación. Primero, las tareas oficiales del grupo de la persona
// (/api/grupos/:isco), para marcar las que hace; si hay grupo secundario, las suyas debajo, en «También hago…».
// Después, «¿Haces algo más?»: cada texto se conserva como un literal tras el filtro de datos personales, sin
// inferir tareas, referencias ni notas. La persona puede elegir una referencia oficial y cuánto tiempo dedica.
// Cada tarea oficial cuenta una sola vez (estado.js). Si vuelve atrás mientras se procesa el texto, lo escrito
// vuelve a la barra cuando regresa a las tareas.
// Al pie, junto a «Confirmar», lo que falta: marcar alguna tarea o el tiempo de cuántas. «Confirmar» pide el informe
// (paso-informe.js) y, mientras se prepara, queda como «✓ Confirmado».

import { crear, porId } from '../dom.js';
import { escribir } from '../idioma.js';
import { MAX_TAREAS_INFORME } from '../protocolo-web.js';
import { traducible } from '../textos.js';
import { tituloDoble } from '../titulo-breve.js';
import { cambiarModo, enfocarCompositor, mostrarCompositor, ponerTexto } from './compositor.js';
import {
  crearPensamientoEnCurso,
  decirAvisos,
  decirFaro,
  decirPersona,
  empezarAPensar,
  hayAvisoDeAyuda,
  llevarALaVista,
} from './conversacion.js';
import { datoOficial } from './datos-traducidos.js';
import { estado, MIN_LETRAS_TAREA, nuevaTarea, ocupacionElegida, oficialesDe, oficialesDeLosGrupos } from './estado.js';
import { crearFilaDeTarea, MAX_LETRAS_TAREA, nombreEnCastellano } from './fila-tarea.js';
import { contarLetras, formatearNumero } from './formato.js';
import { completarDatosEnIdioma } from './idioma-de-los-datos.js';
import { crearListaOficial, idDeCasilla } from './lista-oficial.js';
import { irA, PASO_TAREAS } from './navegacion.js';
import {
  anunciar,
  avisarDelFallo,
  enEspera,
  enfocar,
  hayPeticionEnCurso,
  mostrarError,
  pintarAvisos,
} from './pagina.js';
import { tareasDeLoQueEscribe } from './tareas-libres.js';
import { IDIOMA_DEL_MOTOR } from './traduccion-api.js';

/** @import { Parte, Traducible } from '../textos.js' */
/** @import { Tarea, TareaOficialDelGrupo } from './estado.js' */
/** @import { GruposCargados } from './grupos-elegidos.js' */
/** @import { Aviso, FichaDeGrupo, TareaOficial } from './traduccion-api.js' */

/** Con menos tareas, el informe es muy limitado y Faro lo avisa (sin bloquear). */
const TAREAS_SUFICIENTES = 3;
/**
 * Las cantidades pequeñas se dicen en letra (recorrido.tareas.cuantas.0 a .2: «una sola tarea»); las demás, en cifra.
 * No depende de TAREAS_SUFICIENTES.
 */
const MAXIMO_EN_LETRA = 2;
/** Lo que dice Faro mientras lee lo escrito en «¿Haces algo más?». */
const LEYENDO = traducible('recorrido.espera.leyendo-tareas');

/** Cuántas tareas, dicho para la persona. @param {number} numero @returns {Traducible} */
function cuantasTareas(numero) {
  return numero <= MAXIMO_EN_LETRA
    ? traducible(`recorrido.tareas.cuantas.${numero}`)
    : traducible('recorrido.tareas.cuantas', { numero: formatearNumero(numero) });
}
/** Las tareas que la persona ha contado con sus palabras (no las marcadas en la lista oficial). */
function tareasLibres() {
  return estado.tareas.filter((tarea) => !tarea.marcada);
}
/** Si los grupos elegidos tienen alguna tarea oficial. */
function hayTareasOficiales() {
  return oficialesDeLosGrupos().length > 0;
}
/**
 * Con tareas oficiales que marcar, en este paso se elige: la barra de escribir se esconde y la tarjeta ocupa su sitio,
 * con sus botones al pie; «Añadir otra tarea» la vuelve a abrir (pedirTareaNueva). Sin ellas, lo principal es escribir
 * y la barra se queda.
 */
function barraSegunLoQueToca() {
  mostrarCompositor(!hayTareasOficiales());
}
/**
 * Los valores de plantilla (`{ titulo }`) con el título de un grupo elegido, para los mensajes de Faro.
 * @param {FichaDeGrupo} grupo
 */
function valoresDeTitulo(grupo) {
  return { titulo: datoOficial(grupo.titulo) };
}
/**
 * Los valores de plantilla (`{ titulo }`) con el nombre de la ocupación elegida: el de su ocupación ESCO o, si no eligió
 * ninguna, el de su grupo.
 */
function valoresDeTituloDeLaOcupacion() {
  return { titulo: datoOficial(ocupacionElegida().titulo, tituloDoble) };
}

/**
 * El texto de una tarea oficial marcada: el más completo en castellano que haya, o el oficial en inglés.
 * @param {TareaOficial} tareaOficial @returns {string}
 */
function textoDeTareaOficial(tareaOficial) {
  return nombreEnCastellano(tareaOficial) ?? tareaOficial.texto_en;
}

// ---------- Avisos ----------

/** Si ninguna de sus tareas coincide con las oficiales y no ha marcado ninguna, el grupo quizá no es el suyo. */
function avisoDeOcupacion() {
  const libres = tareasLibres();
  const algunaCoincide = estado.tareas.some((tarea) => tarea.marcada || tarea.propuesta || tarea.oficial);
  if (!hayTareasOficiales() || !libres.length || algunaCoincide) {
    return [];
  }
  const texto = traducible('recorrido.tareas.aviso-ocupacion', valoresDeTituloDeLaOcupacion());
  return [{ tipo: 'ocupacion', texto }];
}

/** Qué aviso dar con pocas tareas: con alguna, que el informe será limitado; sin ninguna, que falta la primera. */
function claveDePocasTareas() {
  const conOficiales = hayTareasOficiales();
  // Sin ninguna tarea no hay informe que limitar: se pide la primera en lugar de hablar de «ninguna tarea».
  if (!estado.tareas.length) {
    return conOficiales ? 'recorrido.tareas.ninguna-donde' : 'recorrido.tareas.ninguna-escribe';
  }
  return conOficiales ? 'recorrido.tareas.limitado-donde' : 'recorrido.tareas.limitado';
}

/** El aviso de pocas tareas, o ninguno si ya hay bastantes. */
function avisoDePocasTareas() {
  if (estado.tareas.length >= TAREAS_SUFICIENTES) {
    return [];
  }
  const texto = traducible(claveDePocasTareas(), { cuantas: cuantasTareas(estado.tareas.length) });
  return [{ tipo: 'pocas', texto }];
}

/** Si cabe otra tarea en el informe (MAX_TAREAS_INFORME). Solo lo pregunta: no dice nada. @returns {boolean} */
function hayHuecoParaOtraTarea() {
  return estado.tareas.length < MAX_TAREAS_INFORME;
}

/** Faro dice que no cabe otra tarea en el informe. @returns {void} */
function avisarLimiteDeTareas() {
  mostrarError(traducible('recorrido.tareas.maximo', { numero: formatearNumero(MAX_TAREAS_INFORME) }));
}

// ---------- Lo que falta y «Confirmar» ----------

/** Lo que falta para confirmar, o que está todo listo. @returns {Traducible} */
function loQueFalta() {
  const { tareas } = estado;
  if (!tareas.length) {
    return traducible(hayTareasOficiales() ? 'recorrido.tareas.falta.marca' : 'recorrido.tareas.falta.escribe');
  }
  const sinTiempo = tareas.filter((tarea) => !tarea.tiempo).length;
  if (sinTiempo) {
    return sinTiempo === 1
      ? traducible('recorrido.tareas.falta.tiempo-una')
      : traducible('recorrido.tareas.falta.tiempo', { numero: formatearNumero(sinTiempo) });
  }
  return tareas.length === 1
    ? traducible('recorrido.tareas.falta.lista-una')
    : traducible('recorrido.tareas.falta.listas', { numero: formatearNumero(tareas.length) });
}

/** Escribe al pie de la tarjeta lo que falta para confirmar (si la página tiene ese pie). */
function pintarLoQueFalta() {
  const falta = document.getElementById('falta-tareas');
  if (falta) {
    escribir(falta, loQueFalta());
  }
}

/**
 * «Confirmar» pasa a «✓ Confirmado» mientras se prepara el informe, y vuelve a «Confirmar» si no sale o al volver a
 * las tareas. Sigue siendo el botón de envío: si se pulsa otra vez, no hace nada mientras Faro trabaja.
 * @param {boolean} confirmadas @returns {void}
 */
export function marcarConfirmadas(confirmadas) {
  const boton = document.getElementById('confirmar-tareas');
  const marca = document.getElementById('confirmar-marca');
  const rotulo = document.getElementById('confirmar-rotulo');
  if (!(boton && marca && rotulo)) {
    return;
  }
  boton.toggleAttribute('data-confirmado', confirmadas);
  marca.hidden = !confirmadas;
  escribir(rotulo, traducible(confirmadas ? 'recorrido.tareas.confirmado' : 'recorrido.tareas.confirmar'));
}

// ---------- Tareas oficiales para marcar ----------

/**
 * Marca o desmarca una tarea oficial. El foco se queda en su casilla; si se marca, debajo se pregunta el tiempo.
 * @param {TareaOficialDelGrupo} tareaOficial @param {boolean} marcada
 */
function marcarOficial(tareaOficial, marcada) {
  const llena = marcada && !hayHuecoParaOtraTarea();
  if (llena && !hayPeticionEnCurso()) {
    avisarLimiteDeTareas();
  }
  const puede = !hayPeticionEnCurso() && !llena;
  if (puede && marcada) {
    const tarea = nuevaTarea(textoDeTareaOficial(tareaOficial), tareaOficial.id);
    tarea.marcada = true;
    estado.tareas.push(tarea);
  } else if (puede) {
    estado.tareas = estado.tareas.filter((tarea) => !(tarea.marcada && tarea.oficial === tareaOficial.id));
  }
  // Se repinta también cuando no se puede (otra petición en curso o lista llena): así la casilla vuelve a su estado.
  pintarTareas();
  enfocar(document.getElementById(idDeCasilla(tareaOficial)));
  if (puede) {
    anunciar(traducible(marcada ? 'recorrido.tareas.marcada' : 'recorrido.tareas.desmarcada'));
  }
}

/**
 * Un valor por cada tarea que tiene su tarea oficial, indexado por el id de esa tarea oficial.
 * @template Valor
 * @param {Tarea[]} tareas @param {(tarea: Tarea) => Valor} valorDe @returns {Map<string, Valor>}
 */
function porTareaOficial(tareas, valorDe) {
  /** @type {Map<string, Valor>} */
  const porId = new Map();
  for (const tarea of tareas) {
    if (tarea.oficial) {
      porId.set(tarea.oficial, valorDe(tarea));
    }
  }
  return porId;
}

/** Las tareas oficiales para marcar: las del grupo principal y, en «También hago…», las del secundario. */
function pintarBloquesOficiales() {
  const { principal, secundario } = estado.grupos;
  const comunes = {
    marcadas: porTareaOficial(
      estado.tareas.filter((tarea) => tarea.marcada),
      (tarea) => tarea,
    ),
    usadas: porTareaOficial(tareasLibres(), (tarea) => tarea.texto),
    conGrupo: Boolean(secundario?.tareas.length),
    alMarcar: marcarOficial,
  };
  const bloques = [];
  if (principal?.tareas.length) {
    const leyenda = traducible('recorrido.tareas.oficiales-de', valoresDeTitulo(principal));
    const explicacion = traducible('recorrido.tareas.oficiales-explicacion');
    bloques.push(crearListaOficial({ titulo: leyenda, explicacion, tareas: oficialesDe(principal), ...comunes }));
  }
  if (secundario?.tareas.length) {
    const leyenda = traducible('recorrido.tareas.tambien-hago');
    const explicacion = traducible('recorrido.tareas.oficiales-secundario', valoresDeTitulo(secundario));
    bloques.push(crearListaOficial({ titulo: leyenda, explicacion, tareas: oficialesDe(secundario), ...comunes }));
  }
  porId('bloques-oficiales').replaceChildren(...bloques);
}

// ---------- Tareas contadas con sus palabras ----------

/**
 * Quitar una tarea deja el foco en la que ocupa ahora su lugar (o en la barra, si no queda ninguna).
 * @param {Tarea} tarea @param {number} orden
 */
function quitarTarea(tarea, orden) {
  estado.tareas = estado.tareas.filter((otra) => otra !== tarea);
  pintarTareas();
  anunciar(traducible('recorrido.tareas.quitada', { numero: formatearNumero(orden) }));
  const posicion = Math.min(orden, tareasLibres().length);
  // El campo de texto de la fila que pinta crearFilaDeTarea (fila-tarea.js), que es siempre un <input>.
  /** @type {HTMLInputElement | null} */
  const siguiente = document.querySelector(`#lista-tareas li:nth-child(${posicion}) input[type="text"]`);
  if (siguiente) {
    enfocar(siguiente);
  } else {
    enfocarCompositor();
  }
}

/**
 * Tras elegir la tarea oficial de una tarea, la tarjeta entera vuelve a pintarse, porque cambia lo que se puede marcar
 * y elegir en las demás; el foco vuelve al control en que estaba.
 */
function repintarConservandoElFoco() {
  const { id } = document.activeElement ?? {};
  pintarTareas();
  if (id) {
    enfocar(document.getElementById(id));
  }
}

/** Las tareas contadas con sus palabras, una fila cada una; sin ninguna tarea ni oficiales, lo dice. */
function pintarTareasLibres() {
  const comunes = {
    oficiales: oficialesDeLosGrupos(),
    conGrupo: Boolean(estado.grupos.secundario?.tareas.length),
    sinReferencias: Boolean(estado.grupos.principal?.sinReferencias),
    alElegirOficial: repintarConservandoElFoco,
  };
  const filas = tareasLibres().map((tarea, i) =>
    crearFilaDeTarea(tarea, i + 1, { ...comunes, alQuitar: () => quitarTarea(tarea, i + 1) }),
  );
  if (!estado.tareas.length && !hayTareasOficiales()) {
    filas.push(escribir(crear('li', { className: 'rc-vacio' }), traducible('recorrido.tareas.vacio')));
  }
  porId('lista-tareas').replaceChildren(...filas);
}

/**
 * Pinta la tarjeta entera con el estado actual: ocupación, avisos, tareas oficiales y tareas propias.
 * @returns {void}
 */
export function pintarTareas() {
  const como = estado.ocupacion ? traducible('recorrido.tareas.como', valoresDeTituloDeLaOcupacion()) : '';
  escribir(porId('ocupacion-elegida'), como);
  const avisos = [...avisoDeOcupacion(), ...avisoDePocasTareas()];
  pintarAvisos(porId('avisos-tareas'), avisos);
  porId('revisar-ocupacion').hidden = !avisos.some((aviso) => aviso.tipo === 'ocupacion');
  pintarBloquesOficiales();
  pintarTareasLibres();
  pintarLoQueFalta();
}

/**
 * Lo siguiente que falta en las tareas recién añadidas es su tiempo: el foco va al de la primera.
 * @param {Tarea} tarea
 */
function enfocarTiempoDe(tarea) {
  const radio = document.querySelector(`[data-tarea="${CSS.escape(String(tarea.id))}"] input[type='radio']`);
  enfocar(radio instanceof HTMLElement ? radio : null);
}

/**
 * Lo que Faro dice tras añadir las tareas: cuáles ha entendido y qué falta.
 * @param {Tarea[]} tareas
 */
function contarAnadidas(tareas) {
  const nombradas = tareas.map((tarea) => `«${tarea.texto}»`).join(', ');
  const clave = tareas.length === 1 ? 'recorrido.tareas.anadida' : 'recorrido.tareas.anadidas';
  decirFaro([traducible(clave, { tareas: nombradas })]);
}

/**
 * La moderación ha visto riesgo de autolesión en lo escrito, o no ha salido ninguna tarea: Faro dice los avisos (el del
 * 024 en el idioma de la página) y la lista se queda como estaba. Lo escrito no se convierte en una tarea.
 * @param {Aviso[]} avisos
 */
function noAnadirNada(avisos) {
  // Los avisos se interpretan en el idioma del motor.
  decirAvisos(avisos, IDIOMA_DEL_MOTOR);
  enfocarCompositor();
}

/**
 * «¿Haces algo más?»: lo escrito en la barra se convierte en tareas. Mientras Faro lo lee, el recorrido está ocupado:
 * ni Enter ni «Ver mi informe» hacen nada, así que nada se duplica. Si falla, lo escrito vuelve a la barra; si la
 * persona vuelve atrás mientras tanto, se guarda y vuelve a la barra cuando regrese a las tareas (modoTarea): en otro
 * paso se enviaría como otra cosa.
 * @param {string} texto
 */
async function anadirTareasLibres(texto) {
  decirPersona(texto);
  if (contarLetras(texto) < MIN_LETRAS_TAREA) {
    decirFaro(traducible('recorrido.tareas.mas-detalle'));
    enfocarCompositor();
    return;
  }
  if (!hayHuecoParaOtraTarea()) {
    avisarLimiteDeTareas();
    enfocarCompositor();
    return;
  }
  estado.textoSinLeer = texto;
  const resultado = await enEspera({
    boton: porId('compositor').querySelector('[type=submit]'),
    aviso: LEYENDO,
    trabajo: () => tareasDeLoQueEscribe(texto, MAX_TAREAS_INFORME - estado.tareas.length),
    alFallar: (error) => {
      estado.textoSinLeer = null;
      avisarDelFallo(error);
      ponerTexto(texto);
    },
  });
  if (!resultado) {
    return;
  }
  estado.textoSinLeer = null;
  const primera = resultado.tareas[0];
  if (hayAvisoDeAyuda(resultado.avisos) || primera === undefined) {
    return noAnadirNada(resultado.avisos);
  }
  estado.tareas.push(...resultado.tareas);
  barraSegunLoQueToca();
  pintarTareas();
  // Los avisos se interpretan en el idioma del motor.
  decirAvisos(resultado.avisos, IDIOMA_DEL_MOTOR);
  contarAnadidas(resultado.tareas);
  enfocarTiempoDe(primera);
}

/**
 * «Añadir otra tarea» de la tarjeta: vuelve la barra de escribir, Faro pregunta cuál y el foco va a la barra. La barra
 * aparece antes del mensaje, para que este quede a la vista.
 */
function pedirTareaNueva() {
  if (hayPeticionEnCurso()) {
    return;
  }
  mostrarCompositor(true);
  decirFaro(traducible('recorrido.tareas.que-mas'));
  enfocarCompositor();
}

/** La barra, para escribir tareas; con lo que no se llegó a leer si la persona volvió atrás mientras Faro lo leía. */
function modoTarea() {
  cambiarModo({
    etiqueta: traducible('recorrido.tareas.algo-mas'),
    marcador: traducible('recorrido.compositor.tarea.marcador'),
    limite: MAX_LETRAS_TAREA,
    alEnviar: anadirTareasLibres,
  });
  if (!estado.textoSinLeer) {
    return;
  }
  ponerTexto(estado.textoSinLeer);
  estado.textoSinLeer = null;
}

// ---------- Entrar en el paso ----------

/**
 * Lo que Faro dice de las tareas que ya había contado la persona al volver a esta tarjeta con otra ocupación: si alguna
 * tiene ya su tarea oficial, que puede cambiarla; si no, puede elegirla o conservar el texto sin nota.
 */
function apuntadas() {
  const libres = tareasLibres();
  if (!libres.length) {
    return [];
  }
  const algunaEmparejada = libres.some((tarea) => tarea.oficial);
  return [traducible(algunaEmparejada ? 'recorrido.tareas.apuntado' : 'recorrido.tareas.apuntado-sin-oficial')];
}

/**
 * Las tareas oficiales marcadas que se han retirado al cambiar a un grupo que no las tiene, si las hay: nada se quita
 * sin decirlo.
 * @param {GruposCargados['retiradas']} retiradas
 */
function retiradasAlCambiar({ cuantas, de }) {
  if (!cuantas) {
    return [];
  }
  const valores = { numero: formatearNumero(cuantas), titulo: datoOficial(de, tituloDoble) };
  return [traducible(cuantas === 1 ? 'recorrido.tareas.retirada' : 'recorrido.tareas.retiradas', valores)];
}

/**
 * Lo que dice Faro al enseñar la tarjeta, según haya tareas oficiales, grupo secundario, tareas ya contadas o
 * tareas marcadas que se han retirado al cambiar de ocupación.
 * @param {GruposCargados['retiradas']} retiradas @returns {Parte[]}
 */
function presentacion(retiradas) {
  const { principal, secundario } = estado.grupos;
  if (!principal) {
    throw new Error('Las tareas se presentan sin la ficha del grupo principal');
  }
  const partes = retiradasAlCambiar(retiradas);
  if (!principal.tareas.length) {
    const estimacion = traducible('recorrido.tareas.no-estimara');
    partes.push(traducible('recorrido.tareas.sin-oficiales', valoresDeTitulo(principal)));
    return [...partes, traducible('recorrido.tareas.cuentame', { estimacion })];
  }
  partes.push(traducible('recorrido.tareas.estas-son', valoresDeTitulo(principal)));
  if (secundario?.tareas.length) {
    partes.push(traducible('recorrido.tareas.debajo', valoresDeTitulo(secundario)));
  }
  return [...partes, ...apuntadas(), traducible('recorrido.tareas.algo-mas-abajo')];
}

/** El primer paso del pensamiento de las tareas: traer las tareas oficiales de la ocupación. */
const BUSCAR_LAS_TAREAS = traducible('recorrido.pensamiento.paso.tareas-buscar');

/**
 * Lo que ha hecho Faro para presentar las tareas, en pasos cortos: traer las tareas oficiales de la ocupación, sumar las
 * del grupo cercano si las hay y reunirlas con su número real.
 * @returns {Parte[]}
 */
function pasosDeLasTareas() {
  /** @type {Parte[]} */
  const pasos = [BUSCAR_LAS_TAREAS];
  if (estado.grupos.secundario?.tareas.length) {
    pasos.push(traducible('recorrido.pensamiento.paso.tareas-cercana'));
  }
  const oficiales = oficialesDeLosGrupos().length;
  if (oficiales) {
    pasos.push(traducible('recorrido.pensamiento.paso.tareas-reunir', { numero: formatearNumero(oficiales) }));
  }
  return pasos;
}

/**
 * Faro presenta la tarjeta; el foco va a lo primero que hay que hacer: marcar, elegir un tiempo o escribir. La barra se
 * esconde antes de desplazar si toca elegir, para que la tarjeta se coloque con el sitio que tendrá.
 * @param {HTMLElement} mensaje
 */
function presentarTarjeta(mensaje) {
  barraSegunLoQueToca();
  llevarALaVista(mensaje, 'start');
  const pendiente = estado.tareas.find((tarea) => !tarea.tiempo);
  if (pendiente) {
    return enfocarTiempoDe(pendiente);
  }
  // Las casillas que pinta crearListaOficial (lista-oficial.js), que son siempre un <input>.
  /** @type {HTMLInputElement | null} */
  const primeraCasilla = porId('bloques-oficiales').querySelector('input[type="checkbox"]:not(:disabled)');
  if (primeraCasilla) {
    return enfocar(primeraCasilla);
  }
  enfocarCompositor();
}

/**
 * El pensamiento de las tareas empieza a la vez que la carga de sus grupos (paso-ocupacion.js), dentro de su espera.
 * @returns {HTMLElement}
 */
export function empezarConLasTareas() {
  return empezarAPensar(BUSCAR_LAS_TAREAS);
}

/**
 * Entra en el paso 3 con los grupos ya cargados y las tareas propias emparejadas. `cargados` dice qué tareas
 * marcadas se han retirado al cargarlos (grupos-elegidos.js). `empezado` es el pensamiento que empezó con esa carga
 * (empezarConLasTareas): se termina con los pasos que faltan y la tarjeta se ve en cuanto está puesta.
 * @param {GruposCargados} cargados @param {{ empezado?: HTMLElement | null }} [opciones] @returns {void}
 */
export function mostrarPasoTareas({ retiradas }, { empezado = null } = {}) {
  irA(PASO_TAREAS);
  marcarConfirmadas(false);
  modoTarea();
  pintarTareas();
  // El pensamiento que empezó con la carga se termina aquí; la tarjeta se coloca y se enfoca otra vez cuando aparece.
  /** @type {HTMLElement | null} */
  let mensaje = null;
  const pensamiento = crearPensamientoEnCurso(pasosDeLasTareas(), {
    alAparecer: () => mensaje && presentarTarjeta(mensaje),
    empezado,
  });
  mensaje = decirFaro([pensamiento, ...presentacion(retiradas)]);
  presentarTarjeta(mensaje);
  // Sin esperar: pide sin IA las traducciones que falten, cuyos fallos no se cuentan, y reescribe la página al llegar.
  void completarDatosEnIdioma();
}

/**
 * «Volver a mis tareas» desde el informe: la misma tarjeta, con todo lo que había.
 * @returns {void}
 */
export function volverATareas() {
  irA(PASO_TAREAS);
  marcarConfirmadas(false);
  modoTarea();
  pintarTareas();
  presentarTarjeta(decirFaro(traducible('recorrido.tareas.aqui-tienes')));
}

/**
 * Conecta «Añadir otra tarea» de la tarjeta de tareas y, al elegir un tiempo, lo que falta al pie.
 * @returns {void}
 */
export function iniciarPasoTareas() {
  porId('boton-anadir').addEventListener('click', pedirTareaNueva);
  // El radio ya ha guardado el tiempo en su tarea (fila-tarea.js) cuando el cambio llega al formulario.
  document.getElementById('form-tareas')?.addEventListener('change', pintarLoQueFalta);
}
