// El paso de ocupación con el motor del dispositivo. La persona contesta a «¿A qué te dedicas?» y Faro pregunta y
// propone con su propia IA (buscador, vectores, clasificador, fusión calibrada y motor de preguntas:
// motores/ocupaciones/src/recorrido), sin que lo escrito salga del dispositivo. Este módulo da las piezas que usa
// paso-ocupacion.js: la petición al motor (con los reintentos de la primera carga, espera-del-motor.js), sus preguntas
// como mensajes de Faro con respuestas rápidas debajo, sus propuestas como tarjetas que se eligen dentro del mensaje (en
// la conversación, sin tarjeta aparte) y las clasificaciones con que lo que decide el motor entra en la máquina de la
// ocupación (flujo-ocupacion.js), que ya sabe confirmar un grupo, abrir una pregunta, explorar la clasificación oficial
// y pasar a las tareas.
//
// La conversación se resuelve con el motor del dispositivo; no selecciona ni consulta un proveedor externo.
//
// El pensamiento de Faro: empieza cuando se pide el paso al motor (empezarAPensar, conversacion.js) y, sobre cada
// pregunta o propuesta, en cuanto el motor responde, se pliega en «Cómo lo he pensado» con sus pasos cortos
// (crearPensamientoEnCurso) y deja ver la pregunta o la propuesta. Solo cuenta el trabajo que ha hecho de verdad,
// con la lectura que devuelve el paso (motores/ocupaciones/src/recorrido/pantalla/servicio.ts, Lectura): si ha
// corregido palabras y si tenía listas la búsqueda por significado y el clasificador. No dice ninguna duración: la
// del motor es de décimas de segundo.

import { crear } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { inicioDelTramo, MEDIDAS, medirTramo } from '../marcas-de-tiempo.js';
import { conVersiones, traducible } from '../textos.js';
import { nombreAccesible, tituloDoble, tituloEnUnaFrase, tituloParaVer } from '../titulo-breve.js';
import { vistaDePregunta } from './contrato-preguntas.js';
import { crearPensamientoEnCurso, empezarAPensar } from './conversacion.js';
import { pedirMientrasSePrepara } from './espera-del-motor.js';
import { pedir } from './motor.js';
import { alCopiarseElPaquete, anotarReintento, terminarLaPreparacion } from './preparacion.js';
import { textoDelMotor } from './traduccion-api.js';

/** @import { Idioma, Parte } from '../textos.js' */
/** @import { Clasificacion, GrupoClasificado } from './traduccion-api.js' */

/** Alternativas que se enseñan bajo una propuesta. */
const ALTERNATIVAS_VISIBLES = 2;
/** Los pasos del pensamiento antes de su conclusión, como mucho (5 en total). */
const PASOS_ANTES_DE_CONCLUIR = 4;
/** La nota de una propuesta hecha con menos información de la habitual (comparacionReducida). */
const COMPARACION_REDUCIDA = traducible('recorrido.local.comparacion-reducida');

/**
 * La petición vigente al motor: el pensamiento que empezó al pedirla y, cuando responde, lo que el motor ha leído del
 * texto. Cada pedirPasoLocal pone aquí la suya al pedir, así que una petición vieja (soltada o sustituida por otra)
 * solo escribe en su propio registro y ya no toca ni la lectura ni el pensamiento de la nueva. Lo cuentan las
 * preguntas y propuestas (pensamientoDelPaso).
 * @typedef {{ lugar?: string, sectores?: string[], correcciones?: { de: string, a: string }[],
 *   conVectores?: boolean, conClasificador?: boolean }} Lectura
 * @typedef {{ lectura: Lectura | null, pensamiento: HTMLElement }} PasoPedido
 * @type {PasoPedido | null}
 */
let ultimoPaso = null;

/**
 * Un título del motor, en castellano y en catalán.
 * @typedef {{ es: string, ca?: string }} Versiones
 */
/**
 * Una hipótesis del motor: el grupo, su título y, si la hay, la ocupación ESCO.
 * @typedef {{ grupo: string, tituloGrupo: Versiones, ocupacion?: { esco: string, titulo: Versiones } }} Hipotesis
 */
/**
 * Una propuesta del motor: la ocupación más parecida y sus alternativas. Con `local`, la decide la pantalla: «Sí» o una
 * alternativa llevan al resultado y «No», a explorar.
 * @typedef {{ tipo: 'propuesta', id: string, local?: boolean, mejor: Hipotesis,
 *   opciones: { id: string, texto: string }[], alternativas: { id: string, hipotesis: Hipotesis }[] }} Propuesta
 */

/**
 * Pide un paso al motor del dispositivo, con los reintentos y el límite de su primera preparación
 * (espera-del-motor.js). Avisa una vez con `alPreparar`: con el primer reintento o, antes, en cuanto el service worker
 * cuenta que está copiando el paquete (la petición espera a que acabe). Con la primera respuesta, la preparación ha
 * terminado (preparacion.js). Si los datos no se han podido preparar o el motor no arranca, falla con un ErrorFaro que
 * quien pide cuenta, con «Volver a intentarlo»; si el motor no es el de esta versión, sin él (motor.js). Con `senal`
 * cancelada (la persona sale del paso), deja de reintentar y falla como una cancelación, sin que Faro diga nada.
 * @param {Record<string, unknown>} cuerpo
 * @param {{ alPreparar?: () => void, esperar?: (ms: number, senal: AbortSignal) => Promise<unknown>,
 *   senal?: AbortSignal }} [opciones]
 * @returns {Promise<Record<string, unknown>>}
 * @throws {ErrorFaro} Si los datos del motor no se han podido preparar o el motor no arranca.
 */
export async function pedirPasoLocal(cuerpo, { alPreparar = () => {}, esperar, senal } = {}) {
  /** @type {PasoPedido} */
  const paso = { lectura: null, pensamiento: empezarAPensar(traducible('recorrido.pensamiento.paso.analizar')) };
  ultimoPaso = paso;
  let avisado = false;
  // Solo avisa de la preparación la petición vigente: la nota de una vieja retiraría la espera de la nueva.
  const avisar = () => {
    if (!avisado && ultimoPaso === paso) {
      avisado = true;
      alPreparar();
    }
  };
  const dejarDeEsperar = alCopiarseElPaquete(avisar);
  const inicio = inicioDelTramo();
  const alReintentar = () => {
    avisar();
    anotarReintento();
  };
  try {
    const { respuesta, intentos } = await pedirMientrasSePrepara('paso', cuerpo, {
      alReintentar,
      ...(esperar ? { esperar } : {}),
      ...(senal ? { senal } : {}),
    });
    apuntarPaso(respuesta, paso);
    terminarLaPreparacion();
    await cargarTitulosDeLaPregunta(respuesta);
    medirTramo(MEDIDAS.paso, inicio, { intentos });
    return respuesta;
  } finally {
    dejarDeEsperar();
  }
}

/**
 * Apunta en el registro de su petición la lectura del paso que acaba de dar el motor (null, si no la trae).
 * @param {Record<string, unknown>} respuesta @param {PasoPedido} paso
 */
function apuntarPaso(respuesta, paso) {
  paso.lectura = typeof respuesta?.lectura === 'object' ? /** @type {Lectura | null} */ (respuesta.lectura) : null;
}

// ---------- La forma breve de las opciones que son trabajos ----------
//
// En las preguntas cuyas opciones son trabajos, el motor nombra cada opción con los títulos de ESCO de una o dos
// ocupaciones, cada una con sus dos formas enteras unidas por «o» y juntas por otra «o»
// (motores/ocupaciones/src/recorrido/preguntas/motor.ts, preguntaDeArea y preguntaDeOcupacionEnIdioma; ocupaciones.ts,
// tituloEnGenero): «Empleado de oficina o empleada de oficina o empleado de mostrador de oficina postal o…». El id de
// la opción dice de qué grupo (o grupos, «4110+4120») o de qué ocupación ESCO es. Con él, la pantalla pide al motor del
// dispositivo los títulos de las ocupaciones de esos grupos (la operación «resultado», la misma ficha que da el
// resultado) y busca las ocupaciones cuyos títulos, escritos como los escribe el motor, dan exactamente el texto de la
// opción. Solo entonces la opción se ve con la forma breve de cada título, como la propuesta (titulo-breve.js), y su
// nombre completo sigue accesible. Si no coincide letra a letra, la opción se queda como la escribe el motor: nunca se
// parte el texto por sus «o».

/** Un grupo de 4 cifras de la CIUO-08, el único con ocupaciones de ESCO. */
const GRUPO_CON_OCUPACIONES = /^\d{4}$/;
/** Lo que junta varios grupos en una opción (motores/ocupaciones/src/recorrido/preguntas/preguntas.ts, JUNTOS). */
const JUNTOS = '+';
/** Lo que separa el grupo del resto en un código ESCO de Faro («4110.1»). */
const PUNTO_ESCO = '.';
/** Cómo junta el motor las formas y los títulos de una opción. */
const O = ' o ';
/** Los títulos con que el motor nombra una opción, como mucho (motor.ts, TITULOS_POR_OPCION). */
const TITULOS_POR_OPCION = 2;
/** Los grupos que se piden para una pregunta, como mucho: sus opciones son 5 y alguna junta grupos. */
const MAX_GRUPOS_POR_PREGUNTA = 10;

/**
 * Las ocupaciones ESCO de cada grupo, con su título en los dos idiomas, tal como las da el motor del dispositivo.
 * @typedef {{ esco: string, titulo: Versiones }} OcupacionConTitulo
 * @type {Map<string, OcupacionConTitulo[]>}
 */
const ocupacionesDeGrupo = new Map();

/**
 * Los grupos de 4 cifras de los que habla una pregunta de trabajos, por los ids de sus opciones.
 * @param {{ tipo?: string, opciones?: { id: string }[] }} pregunta @returns {string[]}
 */
function gruposDeLaPregunta(pregunta) {
  const ids = (pregunta.opciones ?? []).map((opcion) => String(opcion.id));
  const grupos =
    pregunta.tipo === 'ocupacion'
      ? ids.map((id) => id.split(PUNTO_ESCO)[0] ?? '')
      : ids.flatMap((id) => id.split(JUNTOS));
  return [...new Set(grupos.filter((grupo) => GRUPO_CON_OCUPACIONES.test(grupo)))].slice(0, MAX_GRUPOS_POR_PREGUNTA);
}

/**
 * Las ocupaciones de un grupo con sus títulos, pedidas una vez al motor del dispositivo. Un fallo no se cuenta: sin
 * ellas, las opciones se ven como las escribe el motor, y se vuelven a pedir en la pregunta siguiente.
 * @param {string} grupo @returns {Promise<void>}
 */
async function cargarOcupacionesDe(grupo) {
  if (ocupacionesDeGrupo.has(grupo)) {
    return;
  }
  try {
    const ficha = await pedir('resultado', { grupo, texto: '' });
    const lista = Array.isArray(ficha.ocupacionesDelGrupo) ? ficha.ocupacionesDelGrupo : [];
    ocupacionesDeGrupo.set(
      grupo,
      lista.filter((o) => typeof o?.esco === 'string' && typeof o?.titulo?.es === 'string' && o.titulo.es.length > 0),
    );
  } catch {
    // Sin la ficha, la opción se queda como la escribe el motor.
  }
}

/**
 * Si el paso es una pregunta de trabajos, pide antes de pintarla los títulos de las ocupaciones de sus grupos. Nunca
 * falla ni cambia la respuesta del motor.
 * @param {Record<string, unknown>} respuesta @returns {Promise<void>}
 */
async function cargarTitulosDeLaPregunta(respuesta) {
  const paso = /** @type {{ tipo?: string, pregunta?: { tipo?: string, opciones?: { id: string }[] } } | undefined} */ (
    respuesta?.paso
  );
  const pregunta = paso?.tipo === 'pregunta' ? paso.pregunta : undefined;
  if (!pregunta || !PREGUNTAS_DE_TRABAJOS.has(pregunta.tipo ?? '')) {
    return;
  }
  await Promise.all(gruposDeLaPregunta(pregunta).map(cargarOcupacionesDe));
}

/** @param {string} texto @param {Idioma} idioma */
function conMayusculaInicial(texto, idioma) {
  return texto.charAt(0).toLocaleUpperCase(idioma) + texto.slice(1);
}

/** @param {string} texto @param {Idioma} idioma */
function conMinusculaInicial(texto, idioma) {
  return texto.charAt(0).toLocaleLowerCase(idioma) + texto.slice(1);
}

/** El título de una ocupación en `idioma`, como lo guarda el motor (sin el catalán, el castellano). */
function version(/** @type {OcupacionConTitulo} */ o, /** @type {Idioma} */ idioma) {
  return idioma === 'ca' ? o.titulo.ca || o.titulo.es : o.titulo.es;
}

/**
 * Un título de ESCO como lo escribe el motor en una opción sin género conocido: sus dos formas unidas por «o»
 * (ocupaciones.ts, tituloEnGenero, sin género).
 * @param {string} titulo
 */
function comoLoEscribeElMotor(titulo) {
  const [masculino = titulo, femenino] = titulo.split('/');
  return femenino ? `${masculino.trim()}${O}${femenino.trim()}` : titulo;
}

/**
 * Las ocupaciones (una o dos) cuyos títulos, escritos y juntados como los escribe el motor, dan `resto`; null si
 * ninguna combinación da el texto letra a letra.
 * @param {string} resto @param {OcupacionConTitulo[]} candidatas @param {Idioma} idioma @param {number} quedan
 * @returns {OcupacionConTitulo[] | null}
 */
function ocupacionesQueDan(resto, candidatas, idioma, quedan) {
  for (const o of candidatas) {
    const escrito = comoLoEscribeElMotor(version(o, idioma));
    if (escrito === resto) {
      return [o];
    }
    if (quedan > 1 && resto.startsWith(`${escrito}${O}`)) {
      const siguen = ocupacionesQueDan(resto.slice(escrito.length + O.length), candidatas, idioma, quedan - 1);
      if (siguen) {
        return [o, ...siguen];
      }
    }
  }
  return null;
}

/**
 * La forma breve de una opción de trabajos: lo que se ve (la forma breve de cada título, juntas por «o»), el nombre
 * accesible (lo que se ve y, entre paréntesis, el nombre entero) y el nombre entero. null si la opción no se puede
 * reconocer o no se acorta.
 * @param {{ tipo?: string }} pregunta @param {{ id: string, texto: string }} opcion @param {Idioma} idioma
 * @returns {{ ver: Parte, nombre: string, entero: string } | null}
 */
function opcionBreve(pregunta, opcion, idioma) {
  const porOcupacion = pregunta.tipo === 'ocupacion';
  const grupos = porOcupacion ? [opcion.id.split(PUNTO_ESCO)[0] ?? ''] : opcion.id.split(JUNTOS);
  const candidatas = grupos
    .flatMap((grupo) => ocupacionesDeGrupo.get(grupo) ?? [])
    .filter((o) => !porOcupacion || o.esco === opcion.id);
  if (!candidatas.length || !opcion.texto) {
    return null;
  }
  const resto = conMinusculaInicial(opcion.texto, idioma);
  const halladas =
    ocupacionesQueDan(resto, candidatas, idioma, porOcupacion ? 1 : TITULOS_POR_OPCION) ??
    ocupacionesQueDan(opcion.texto, candidatas, idioma, porOcupacion ? 1 : TITULOS_POR_OPCION);
  if (!halladas) {
    return null;
  }
  const visto = halladas
    .map((o, i) => (i === 0 ? tituloParaVer(version(o, idioma), idioma) : tituloEnUnaFrase(version(o, idioma), idioma)))
    .join(O);
  if (visto === opcion.texto) {
    return null;
  }
  return {
    ver: textoDelMotor(visto, idioma),
    nombre: `${visto} (${conMinusculaInicial(opcion.texto, idioma)})`,
    entero: conMayusculaInicial(opcion.texto, idioma),
  };
}

/** @param {unknown} valor @returns {valor is { tipo: string, texto: string }} */
export function esAviso(valor) {
  return typeof valor === 'object' && valor !== null && 'tipo' in valor && typeof valor.tipo === 'string';
}

/**
 * Un título del motor en el idioma de la página, que se reescribe al cambiarlo; `forma` le da forma (titulo-breve.js).
 * @param {Versiones} v @param {((version: string, idioma: Idioma) => string) | null} [forma] @returns {Parte}
 */
function dato(v, forma = null) {
  return conVersiones({ es: v.es, ca: v.ca || v.es }, forma);
}

/**
 * Lo que se propone de una hipótesis: la ocupación o, sin ella, el grupo. La ocupación de ESCO va con mayúscula inicial
 * y sus dos formas enteras («Camarero / camarera»), como la escribe el resto de la conversación, que un lector de
 * pantalla lee tal cual.
 * @param {Hipotesis} h @returns {Parte}
 */
function tituloDe(h) {
  return h.ocupacion ? dato(h.ocupacion.titulo, tituloDoble) : dato(h.tituloGrupo);
}

/** Las preguntas cuyas opciones son trabajos: en ellas cabe «Ninguna, buscar en la clasificación oficial». */
const PREGUNTAS_DE_TRABAJOS = new Set(['grupo', 'area', 'ocupacion']);

/**
 * Una pregunta del motor para la conversación: lo que dice Faro y una respuesta rápida por opción, con «No lo sé»
 * marcada como neutra. `conSalida` dice si sus opciones son trabajos, y entonces cabe
 * «Ninguna, buscar en la clasificación».
 * Si sus opciones son trabajos y se reconocen sus ocupaciones (opcionBreve), cada una lleva `breve`: cómo se ve, con
 * la forma breve de sus títulos, su nombre accesible y su nombre entero. Lo que dice la persona al elegirla
 * (`dicho`) sigue siendo el texto del motor, entero, como el resto de la conversación.
 * El enunciado lleva delante el pensamiento de Faro, si el motor ha dado su lectura.
 * @param {{ id: string, tipo?: string, texto: string, opciones: { id: string, texto?: string }[] }} pregunta
 * @param {Idioma} idioma
 * @returns {{ enunciado: (Parte | Node)[], opciones: { id: string, dicho: Parte, neutra: boolean,
 *   breve: { ver: Parte, nombre: string, entero: string } | null }[], conSalida: boolean }}
 */
export function preguntaEnElChat(pregunta, idioma) {
  const vista = vistaDePregunta(/** @type {never} */ (pregunta), idioma);
  const deTrabajos = PREGUNTAS_DE_TRABAJOS.has(pregunta.tipo ?? '');
  const delMotor = new Map(pregunta.opciones.map((opcion) => [opcion.id, opcion.texto ?? '']));
  return {
    enunciado: [
      ...pensamientoDelPaso(traducible('recorrido.pensamiento.paso.preguntar')),
      textoDelMotor(vista.texto, idioma),
    ],
    opciones: vista.opciones.map((opcion) => ({
      id: opcion.id,
      dicho: textoDelMotor(opcion.texto, idioma),
      neutra: opcion.neutra,
      breve:
        deTrabajos && !opcion.neutra
          ? opcionBreve(pregunta, { id: opcion.id, texto: delMotor.get(opcion.id) ?? '' }, idioma)
          : null,
    })),
    conSalida: deTrabajos,
  };
}

/**
 * Un elemento que se ve pero no se lee: lo dice ya el texto para lectores de pantalla.
 * @param {HTMLElement} elemento
 */
function soloVisible(elemento) {
  elemento.setAttribute('aria-hidden', 'true');
  return elemento;
}

/**
 * El nombre completo de una ocupación si su forma breve lo acorta («Empleado/a administrativo/a» deja fuera
 * «Empleado administrativo / empleada administrativa»); si no, nada, y su línea no se ve (:empty).
 * @param {string} version @param {Idioma} idioma
 */
function enteroSiSeAcorta(version, idioma) {
  const entero = tituloDoble(version, idioma);
  return tituloParaVer(version, idioma) === entero ? '' : entero;
}

/**
 * El pensamiento de Faro sobre el último paso del motor, con lo que ha hecho de verdad, en pasos cortos: ha leído lo
 * que le cuentan (y corregido sus palabras, si lo ha hecho), lo ha comparado con las ocupaciones oficiales por palabras
 * y, según lo que tuviera cargado el motor, por significado (la tabla de vectores) y con el clasificador, y
 * `conclusion` (prepara una pregunta o verifica las más parecidas). Sin la lectura del paso, nada.
 * @param {Parte} conclusion @returns {Node[]}
 */
function pensamientoDelPaso(conclusion) {
  // Sin petición todavía, nada: ni lectura ni pensamiento (null, como espera crearPensamientoEnCurso).
  const { lectura, pensamiento } = ultimoPaso ?? { lectura: null, pensamiento: null };
  if (!lectura) {
    return [];
  }
  /** @type {Parte[]} */
  const pasos = [traducible('recorrido.pensamiento.paso.analizar')];
  if (lectura.correcciones?.length) {
    pasos.push(traducible('recorrido.pensamiento.paso.corregir'));
  }
  pasos.push(traducible('recorrido.pensamiento.paso.comparar'));
  if (lectura.conVectores) {
    pasos.push(traducible('recorrido.pensamiento.paso.significado'));
  }
  if (lectura.conClasificador) {
    pasos.push(traducible('recorrido.pensamiento.paso.clasificador'));
  }
  // Como mucho 5 pasos con la conclusión: si sobra uno, se calla la corrección, que es lo menos importante.
  if (pasos.length > PASOS_ANTES_DE_CONCLUIR && lectura.correcciones?.length) {
    pasos.splice(1, 1);
  }
  return [crearPensamientoEnCurso([...pasos, conclusion], { empezado: pensamiento })];
}

/**
 * Si el último paso se ha dado sin la búsqueda por significado o sin el clasificador, porque no han cargado a tiempo
 * o han fallado (src/plataforma/navegador/motor.ts, cargarLosExtras): su propuesta sale de menos información y la
 * persona debe saberlo para revisarla, no solo por el paso que falta en «Cómo lo he pensado». Una lectura que no dice
 * nada de ellos no es una carga fallida.
 * @returns {boolean}
 */
function comparacionReducida() {
  const lectura = ultimoPaso?.lectura;
  return lectura?.conVectores === false || lectura?.conClasificador === false;
}

// ---------- La propuesta: tarjetas que se eligen ----------
//
// La ocupación más parecida y las otras posibles son tarjetas iguales que se eligen pulsándolas (casillas de radio
// de un
// mismo grupo, con su leyenda: el teclado las recorre con las flechas y el lector de pantalla dice cuál está elegida).
// La más parecida lleva su marca y sale elegida; «Continuar» confirma la elegida. Debajo, pocas salidas: «Se parece a…,
// pero no es exactamente esa» (sobre la más parecida, que es la que el motor sabe afinar) y «Ninguna es la mía», que
// abre las otras: más preguntas, contarlo con sus palabras o buscar en la clasificación oficial. El motor recibe lo de
// siempre: «si», «parecida», «no» o el id de la alternativa.

/** Para dar a cada propuesta sus propios ids y el `name` de sus casillas: las de propuestas anteriores no se tocan. */
let propuestasPintadas = 0;

/**
 * Lo que hace cada salida de la propuesta: `responder(id, dicho)` manda al motor la respuesta `id` («si», «parecida»,
 * «no» o el de una alternativa) y la persona dice `dicho`; `contar` abre la barra de escribir; `buscar`, la
 * clasificación oficial. Lo conecta paso-ocupacion.js.
 * @typedef {{ responder: (id: string, dicho: Parte) => void, contar: () => void, buscar: () => void }} AccionesDePropuesta
 */

/** Lo que dice la persona al confirmar una ocupación (o un tipo de trabajo) propuesta. @param {Hipotesis} h */
function dichoAlElegir(h) {
  return traducible(h.ocupacion ? 'recorrido.persona.mi-ocupacion' : 'recorrido.ocupacion.dicho-grupo', {
    titulo: tituloDe(h),
  });
}

/** El título que se ve de una hipótesis: la ocupación en su forma breve o, sin ella, el grupo. @param {Hipotesis} h */
function tituloVisto(h) {
  return h.ocupacion ? dato(h.ocupacion.titulo, tituloParaVer) : dato(h.tituloGrupo);
}

/**
 * Una ocupación propuesta como tarjeta que se elige: su casilla de radio (que se llama con el título y sus dos formas
 * enteras, nombreAccesible) y, a la vista, el título en su forma breve, su nombre completo si la forma breve lo acorta
 * y, en segundo plano, su código ESCO y su tipo de trabajo oficial, que son su descripción. La más parecida lleva su
 * marca, también en la descripción, y sale elegida.
 * @param {Hipotesis} h @param {{ valor: string, nombre: string, clave: string, principal: boolean }} datos
 * @returns {{ opcion: HTMLLabelElement, casilla: HTMLInputElement }}
 */
function tarjetaDeOcupacion(h, { valor, nombre, clave, principal }) {
  const casilla = crear('input', { type: 'radio', name: nombre, value: valor, checked: principal });
  casilla.className = 'rc-eleccion-casilla';
  escribirAtributo(
    casilla,
    'aria-label',
    h.ocupacion ? dato(h.ocupacion.titulo, nombreAccesible) : dato(h.tituloGrupo),
  );
  const visto = soloVisible(escribir(crear('strong', { className: 'rc-eleccion-titulo' }), tituloVisto(h)));
  const detalle = crear('small', { className: 'rc-eleccion-detalle', id: `${clave}-detalle` });
  /** @type {Node[]} */
  const cuerpo = [];
  if (principal) {
    cuerpo.push(
      escribir(
        crear('span', { className: 'rc-sugerida', id: `${clave}-marca` }),
        traducible('recorrido.ocupacion.la-mas-parecida'),
      ),
    );
  }
  cuerpo.push(visto);
  if (h.ocupacion) {
    escribirAtributo(visto, 'title', dato(h.ocupacion.titulo, tituloDoble));
    cuerpo.push(
      soloVisible(
        escribir(crear('small', { className: 'rc-eleccion-entero' }), dato(h.ocupacion.titulo, enteroSiSeAcorta)),
      ),
    );
    detalle.append(crear('span', { className: 'rc-codigo', textContent: `ESCO ${h.ocupacion.esco}` }));
  }
  const grupo = traducible('recorrido.local.grupo-oficial', { grupo: dato(h.tituloGrupo), codigo: h.grupo });
  detalle.append(escribir(crear('span'), grupo));
  cuerpo.push(detalle);
  casilla.setAttribute('aria-describedby', principal ? `${clave}-marca ${clave}-detalle` : `${clave}-detalle`);
  const marca = soloVisible(crear('span', { className: 'rc-eleccion-marca' }));
  const opcion = crear(
    'label',
    { className: 'rc-eleccion-opcion' },
    casilla,
    crear('span', { className: 'rc-eleccion-cuerpo' }, ...cuerpo),
    marca,
  );
  return { opcion, casilla };
}

/** Un botón de la propuesta. @param {string} clase @param {Parte} rotulo @param {() => void} alPulsar */
function botonDePropuesta(clase, rotulo, alPulsar) {
  const boton = escribir(crear('button', { type: 'button', className: clase }), rotulo);
  boton.addEventListener('click', alPulsar);
  return boton;
}

/**
 * «Ninguna es la mía» y lo que abre: más preguntas (solo si responde el motor; en la propuesta de la pantalla, «No»
 * lleva a la clasificación, que ya está), contarlo con sus palabras o buscar en la clasificación oficial. El botón dice
 * si está abierto (aria-expanded) y qué abre (aria-controls).
 * @param {Propuesta} paso @param {string} clave @param {AccionesDePropuesta} acciones
 * @returns {{ nodos: HTMLElement[], controles: HTMLButtonElement[] }}
 */
function ningunaEsLaMia(paso, clave, acciones) {
  const conMasPreguntas = !paso.local && paso.opciones.some((opcion) => opcion.id === 'no');
  const salidas = [
    ...(conMasPreguntas
      ? [
          botonDePropuesta('rc-eleccion-salida', traducible('recorrido.ocupacion.mas-preguntas'), () =>
            acciones.responder('no', traducible('recorrido.ocupacion.dicho-ninguna')),
          ),
        ]
      : []),
    botonDePropuesta('rc-eleccion-salida', traducible('recorrido.ocupacion.contar'), acciones.contar),
    botonDePropuesta('rc-eleccion-salida', traducible('recorrido.ocupacion.buscar'), acciones.buscar),
  ];
  const panel = crear(
    'div',
    { className: 'rc-eleccion-ninguna', id: `${clave}-ninguna` },
    escribir(crear('p', { className: 'rc-eleccion-pregunta' }), traducible('recorrido.ocupacion.como-seguir')),
    crear('div', { className: 'rc-eleccion-salidas' }, ...salidas),
  );
  panel.hidden = true;
  const abrir = botonDePropuesta('rc-eleccion-enlace', traducible('recorrido.ocupacion.ninguna'), () => {
    panel.hidden = !panel.hidden;
    abrir.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) {
      panel.scrollIntoView({ block: 'nearest' });
    }
  });
  abrir.setAttribute('aria-expanded', 'false');
  abrir.setAttribute('aria-controls', panel.id);
  return { nodos: [abrir, panel], controles: [abrir, ...salidas] };
}

/**
 * La elección de la propuesta: las tarjetas, «Continuar» y las salidas. Devuelve el bloque, su primer control (la
 * casilla elegida) y todos sus controles, para retirarlos en cuanto la persona responde.
 * @param {Propuesta} paso @param {{ id: string, hipotesis: Hipotesis }[]} alternativas
 * @param {AccionesDePropuesta} acciones
 * @returns {{ bloque: HTMLElement, foco: HTMLInputElement, controles: (HTMLInputElement | HTMLButtonElement)[] }}
 */
function eleccionDePropuesta(paso, alternativas, acciones) {
  propuestasPintadas += 1;
  const nombre = `rc-propuesta-${propuestasPintadas}`;
  const principal = { id: 'si', hipotesis: paso.mejor };
  const posibles = [principal, ...alternativas];
  const tarjetas = posibles.map(({ id, hipotesis }, indice) =>
    tarjetaDeOcupacion(hipotesis, { valor: id, nombre, clave: `${nombre}-${indice}`, principal: indice === 0 }),
  );
  const laPrincipal = /** @type {HTMLInputElement} */ (tarjetas[0]?.casilla);
  const casillas = tarjetas.map(({ casilla }) => casilla);
  const grupo = crear(
    'fieldset',
    { className: 'rc-eleccion' },
    escribir(crear('legend', { className: 'solo-lectores' }), traducible('recorrido.ocupacion.leyenda')),
    crear('div', { className: 'rc-eleccion-opciones' }, ...tarjetas.map(({ opcion }) => opcion)),
  );
  const continuar = botonDePropuesta('rc-boton-principal', traducible('recorrido.continuar'), () => {
    const elegida = posibles[casillas.findIndex((casilla) => casilla.checked)] ?? principal;
    acciones.responder(elegida.id, dichoAlElegir(elegida.hipotesis));
  });
  const parecida = paso.opciones.some((opcion) => opcion.id === 'parecida')
    ? [
        botonDePropuesta(
          'rc-eleccion-enlace',
          traducible('recorrido.ocupacion.parecida', { titulo: tituloVisto(paso.mejor) }),
          () =>
            acciones.responder(
              'parecida',
              traducible('recorrido.ocupacion.dicho-parecida', { titulo: tituloDe(paso.mejor) }),
            ),
        ),
      ]
    : [];
  const ninguna = ningunaEsLaMia(paso, nombre, acciones);
  const bloque = crear(
    'div',
    { className: 'rc-eleccion-bloque' },
    grupo,
    crear('div', { className: 'rc-eleccion-acciones' }, continuar),
    crear('div', { className: 'rc-eleccion-otras' }, ...parecida, ...ninguna.nodos),
  );
  return { bloque, foco: laPrincipal, controles: [...casillas, continuar, ...parecida, ...ninguna.controles] };
}

/**
 * Una propuesta del motor para la conversación: el mensaje de Faro (su pensamiento, una frase que dice qué hacer, la
 * nota de una comparación con menos información si la ha habido y las tarjetas para elegir, con «Continuar» y las
 * salidas). `acciones` es lo que hace cada salida (paso-ocupacion.js).
 * Devuelve las partes del mensaje, el control que recibe el foco y los controles que se retiran al responder.
 * @param {Propuesta} paso @param {AccionesDePropuesta} acciones
 * @returns {{ partes: (Parte | Node)[], foco: HTMLInputElement, controles: (HTMLInputElement | HTMLButtonElement)[] }}
 */
export function propuestaEnElChat(paso, acciones) {
  const alternativas = paso.alternativas.slice(0, ALTERNATIVAS_VISIBLES);
  const eleccion = eleccionDePropuesta(paso, alternativas, acciones);
  /** @type {(Parte | Node)[]} */
  const partes = [
    ...pensamientoDelPaso(
      alternativas.length
        ? traducible('recorrido.pensamiento.paso.ordenar', { numero: String(alternativas.length + 1) })
        : traducible('recorrido.pensamiento.paso.elegir'),
    ),
    traducible(alternativas.length ? 'recorrido.ocupacion.propuesta-varias' : 'recorrido.ocupacion.propuesta-una'),
    ...(comparacionReducida() ? [COMPARACION_REDUCIDA] : []),
    eleccion.bloque,
  ];
  return { partes, foco: eleccion.foco, controles: eleccion.controles };
}

/**
 * Un grupo del que solo se sabe el código: paso-ocupacion.js pide su ficha (título y ocupaciones) antes de confirmarlo.
 * @param {string} isco08
 */
export function grupoPorDescribir(isco08) {
  return {
    isco08,
    titulo: '',
    cita: '',
    ocupaciones: null,
    sinTareasOit: false,
    referenciasSubgrupo: false,
    sinReferencias: false,
  };
}

/**
 * La decisión del motor con la forma que recibe la máquina de la ocupación.
 * @param {Idioma} idioma @param {Partial<Clasificacion>} decision @returns {Clasificacion}
 */
function clasificacion(idioma, decision) {
  return { idioma, avisos: [], decision: 'explorar', grupos: [], pregunta: null, candidatas: [], ...decision };
}

/** El motor ha decidido el grupo (ya completo): se confirma. @param {GrupoClasificado} grupo @param {Idioma} idioma */
export function clasificacionConfirmada(grupo, idioma) {
  return clasificacion(idioma, { decision: 'confirmar', grupos: [grupo] });
}

/** El motor no ha dado con la ocupación: se explora la clasificación oficial. @param {Idioma} idioma */
export function clasificacionSinGrupo(idioma) {
  return clasificacion(idioma, {});
}

/**
 * El motor no ha entendido el texto: Faro pide que cuente un día normal, con una pregunta abierta de la máquina (lo
 * que se escriba se suma a lo de antes). La pregunta se guarda traducible, para que siga el idioma de la página.
 * @param {Idioma} idioma
 */
export function clasificacionAclarar(idioma) {
  const texto = traducible('recorrido.local.aclarar.texto');
  return clasificacion(idioma, { decision: 'preguntar', pregunta: { texto, opciones: null, idioma } });
}

/**
 * La respuesta a cada clase de cortesía (motores/ocupaciones/src/recorrido/pantalla/cortesia.ts), de la más concreta a
 * la más general, siempre con las mismas frases fijas.
 */
const RESPUESTA_DE_CORTESIA = Object.freeze({
  sobre_faro: 'recorrido.local.cortesia.sobre-faro',
  despedida: 'recorrido.local.cortesia.despedida',
  gracias: 'recorrido.local.cortesia.gracias',
  como_estas: 'recorrido.local.cortesia.como-estas',
  saludo: 'recorrido.local.cortesia.saludo',
});

/** Lo que responde Faro a un saludo, un «gracias» o una pregunta sobre Faro. @param {readonly string[]} tipos */
export function respuestaDeCortesia(tipos) {
  const tipo = /** @type {keyof typeof RESPUESTA_DE_CORTESIA} */ (
    Object.keys(RESPUESTA_DE_CORTESIA).find((x) => tipos.includes(x)) ?? 'saludo'
  );
  return traducible(RESPUESTA_DE_CORTESIA[tipo]);
}
