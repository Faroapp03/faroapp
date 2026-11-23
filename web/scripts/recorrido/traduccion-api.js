// Traducción entre las respuestas de ocupaciones y el estado del recorrido. La clasificación del motor local puede
// confirmar, preguntar o explorar (ocupacion-local.js). /api/grupos entrega fichas, tareas oficiales y jerarquía.
// Las respuestas de error se leen en api/errores.js.
//
// El cuerpo de /api/informe incluye el grupo ISCO-08, la ocupación ESCO y el grupo secundario cuando existen, la
// palabra de la persona, el idioma, la fecha y las tareas. minimizar.js limpia el texto antes del transporte.
// Los datos oficiales conservan su campo original y su traducción disponible en campos separados. Este módulo
// entrega esas parejas a datos-traducidos.js y marca cada texto del motor con el idioma en que llega.
// No realiza solicitudes de red ni modifica el DOM.

import { camposDe, listaDe, textoDe } from '../json.js';
import { MAX_OCUPACION_PERSONA as MAX_LETRAS_OCUPACION_PERSONA } from '../protocolo-web.js';
import { enIdioma, idiomaActual } from '../textos.js';
import { MOTIVOS_DE_FALLO } from './api/errores.js';
import { ORIGENES } from './flujo-ocupacion.js';
import { recortarEnPalabras } from './formato.js';

/** @import { Idioma, LiteralEnIdioma, Traducible } from '../textos.js' */
/** @import { Ocupacion, Tarea } from './estado.js' */
/** @import { TareaEntrada } from '../../../src/dominio/tipos-entrada.ts' */

/**
 * El idioma de los datos oficiales (títulos de CIUO-08 y ESCO, tareas de la OIT) y del motor si no se le pide otro.
 * @type {Idioma}
 */
export const IDIOMA_DEL_MOTOR = 'es';

/** Solo los grupos de 4 cifras tienen ficha (/api/grupos/:isco): su título, sus tareas y sus ocupaciones. */
const GRUPO_CON_FICHA = /^\d{4}$/;

/** Separa, en el origen de un dato, la lectura que lo trae (`grupo` o `hijos`) de su código (origenDeGrupo). */
const SEPARADOR_DE_ORIGEN = ':';

/**
 * La palabra con la que la persona nombra su trabajo viaja al informe con 60 caracteres como mucho: el máximo de
 * `ocupacionPersona` en el motor (MAX_OCUPACION_PERSONA, src/comun/protocolo-web.ts). La prueba focal
 * pruebas/web-recorrido-modelo/traduccion-api.test.ts comprueba el límite y la conservación del cuerpo.
 */
export { MAX_OCUPACION_PERSONA as MAX_LETRAS_OCUPACION_PERSONA } from '../protocolo-web.js';

/**
 * Lo que lee el recorrido de las respuestas (la forma de cada una, en la cabecera). `JsonDeLaApi` es un valor tal como
 * llega, sin comprobar, y `CuerpoDeLaApi`, el cuerpo de una respuesta, del que solo se sabe que es un objeto
 * (api/transporte.js lo comprueba). Cada campo se lee como unknown y se convierte o comprueba donde se usa; un
 * elemento de una lista que no es un objeto se lee como uno sin campos. En una pregunta, `opciones` null es una
 * pregunta abierta e `idioma`, el de su texto; una pregunta de la propia pantalla lleva su texto traducible, que
 * sigue el idioma de la página. `corto` y `texto_es` de una tarea oficial son null si la OIT solo la
 * publica en inglés. La `traduccion` de un dato es null si aún no la tiene y undefined si la respuesta no la trae.
 * @typedef {unknown} JsonDeLaApi
 * @typedef {Readonly<Record<string, unknown>>} CuerpoDeLaApi
 * @typedef {{ sinTareasOit: boolean, referenciasSubgrupo: boolean, sinReferencias: boolean }} MarcasDelGrupo
 * @typedef {{ esco: string, titulo: string }} OcupacionEsco
 * @typedef {MarcasDelGrupo & {
 *   isco08: string, titulo: string, cita: string, ocupaciones: OcupacionEsco[] }} GrupoClasificado
 * @typedef {{ texto: string, isco08: string[] }} OpcionDePregunta
 * @typedef {{ texto: string | Traducible, opciones: OpcionDePregunta[] | null, idioma: Idioma }} Pregunta
 * @typedef {{ esco: string | null, titulo: string, isco08: string, tituloIsco: string }} Candidata
 * @typedef {{ id: string, corto: string | null, texto_es: string | null, texto_en: string, nota: number }} TareaOficial
 *   `nota`, la nota publicada de la OIT: un número finito (leerFichaDeGrupo deja fuera la tarea que no la trae)
 * @typedef {{ tipo: string, texto: string }} Aviso
 * @typedef {MarcasDelGrupo & {
 *   isco08: string, titulo: string, tareas: TareaOficial[], ocupaciones: OcupacionEsco[] }} FichaDeGrupo
 * @typedef {{ codigo: string, titulo: string, ocupaciones: number }} GrupoHijo
 * @typedef {{ castellano: string, traduccion: string | null | undefined, origen: string | null }} ParDeTraduccion
 */
/**
 * Una clasificación tal como la usa la máquina de la ocupación (flujo-ocupacion.js): lo que decide el motor local
 * (ocupacion-local.js), y el idioma en que se pidió.
 * @typedef {Object} Clasificacion
 * @property {Idioma} idioma
 * @property {Aviso[]} avisos
 * @property {string} decision 'confirmar', 'preguntar' o 'explorar'
 * @property {GrupoClasificado[]} grupos
 * @property {Pregunta | null} pregunta
 * @property {Candidata[]} candidatas
 */
/**
 * Lo que se envía con la ocupación en el cuerpo de /api/informe; lo que confirma la
 * persona para su informe (`EntradaDelInforme`) y el cuerpo entero del informe; y si el cuerpo lleva el idioma.
 * @typedef {{ isco08: string, ocupacionEsco?: string, isco08Secundario?: string }} CuerpoDeOcupacion
 * @typedef {{ ocupacion: Ocupacion, fecha: string, tareas: TareaEntrada[], sinIa?: boolean }} EntradaDelInforme
 * @typedef {{ ocupacionPersona?: string, grupoPropuestoPorIa?: boolean, sinIa?: boolean, fecha: string,
 *   tareas: TareaEntrada[] }} DatosDelInforme
 * @typedef {CuerpoDeOcupacion & DatosDelInforme} CuerpoDelInforme
 * @typedef {{ idioma?: Idioma }} OpcionesDeIdioma
 */

/** Un texto leído, o null si no lo es. @param {unknown} valor @returns {string | null} */
function textoONulo(valor) {
  return typeof valor === 'string' ? valor : null;
}

/**
 * Las marcas de un grupo: `sinTareasOit` si la OIT no publica tareas con nota para él; `referenciasSubgrupo` si, sin
 * tareas propias, Faro estima con las de su subgrupo de 3 cifras (con un margen provisional); `sinReferencias` si no
 * tiene ninguna tarea oficial con que estimar, y sus tareas sin tarea oficial quedarán sin nota.
 * @param {CuerpoDeLaApi} grupo @returns {MarcasDelGrupo}
 */
function leerMarcas(grupo) {
  return {
    sinTareasOit: Boolean(grupo.sinTareasOit),
    referenciasSubgrupo: Boolean(grupo.referenciasSubgrupo),
    sinReferencias: Boolean(grupo.sinReferencias),
  };
}

/**
 * Una ocupación ESCO: su código y su título (con las formas masculina y femenina juntas, como viene de ESCO).
 * @param {JsonDeLaApi} leida @returns {OcupacionEsco}
 */
function leerOcupacion(leida) {
  const ocupacion = camposDe(leida);
  return { esco: textoDe(ocupacion.esco), titulo: textoDe(ocupacion.titulo) };
}

/**
 * Una tarea oficial de la OIT tal como la usan las listas de tareas (fila-tarea.js), o null si no trae su nota como
 * un número finito: una tarea sin nota no se puede enseñar ni contar, y una nota mal formada no llega a la persona.
 * @param {JsonDeLaApi} leida @returns {TareaOficial | null}
 */
function leerTareaOficial(leida) {
  const tarea = camposDe(leida);
  const { nota } = tarea;
  if (typeof nota !== 'number' || !Number.isFinite(nota)) {
    return null;
  }
  return {
    id: textoDe(tarea.id),
    corto: textoONulo(tarea.corto),
    texto_es: textoONulo(tarea.texto_es),
    texto_en: textoDe(tarea.texto_en),
    nota,
  };
}

/**
 * Los avisos que acompañan a una respuesta (datos personales quitados, un texto que no parece un trabajo…).
 * @param {JsonDeLaApi} avisos @returns {Aviso[]}
 */
export function leerAvisos(avisos) {
  return listaDe(avisos)
    .map(camposDe)
    .map((aviso) => ({ tipo: textoDe(aviso.tipo), texto: textoDe(aviso.texto) }))
    .filter((aviso) => aviso.texto);
}

/**
 * El idioma en que responden el motor y la API (el informe, las lecturas de /api/grupos): el de la página, que es el
 * que se les pide.
 * @returns {Idioma}
 */
export function idiomaDeLasRespuestas() {
  return idiomaActual();
}

/**
 * Un texto escrito por el motor (una pregunta, un aviso), marcado con el idioma en que llega.
 * @param {string} literal @param {string} [idioma] @returns {LiteralEnIdioma}
 */
export function textoDelMotor(literal, idioma = idiomaDeLasRespuestas()) {
  return enIdioma(literal, idioma);
}

/**
 * El cuerpo con el idioma en que tiene que responder el motor: el de la página, si `opciones` no dice otro.
 * @template {object} Cuerpo
 * @param {Cuerpo} cuerpo @param {OpcionesDeIdioma} [opciones] @returns {Cuerpo & { idioma: Idioma }}
 */
function conIdioma(cuerpo, { idioma = idiomaActual() } = {}) {
  return { ...cuerpo, idioma };
}

/**
 * La ficha de un grupo (/api/grupos/:isco): título, tareas oficiales con su nota, ocupaciones ESCO y marcas.
 * @param {JsonDeLaApi} datos @returns {FichaDeGrupo}
 */
export function leerFichaDeGrupo(datos) {
  const ficha = camposDe(datos);
  return {
    isco08: textoDe(ficha.isco08),
    titulo: textoDe(ficha.titulo),
    tareas: listaDe(ficha.tareas)
      .map(leerTareaOficial)
      .filter((tarea) => tarea !== null),
    ocupaciones: listaDe(ficha.ocupaciones).map(leerOcupacion),
    ...leerMarcas(ficha),
  };
}

/**
 * Los grupos hijos en la jerarquía oficial (/api/grupos?padre=…), con cuántas ocupaciones tiene cada uno. En el
 * recorrido, el código de un nivel de la jerarquía se llama `codigo`: puede tener de 1 a 4 cifras.
 * @param {JsonDeLaApi} datos @returns {GrupoHijo[]}
 */
export function leerGruposHijos(datos) {
  return listaDe(camposDe(datos).hijos)
    .map(camposDe)
    .map((hijo) => ({
      codigo: textoDe(hijo.isco08),
      titulo: textoDe(hijo.titulo),
      ocupaciones: Number(hijo.ocupaciones) || 0,
    }))
    .filter((hijo) => hijo.codigo && hijo.titulo);
}

// ---------- Las lecturas en otro idioma y sus traducciones ----------

/**
 * Una lectura de /api/grupos en `idioma`: en el de los datos, la de siempre (y la respuesta, byte a byte, la de
 * siempre); en otro, con `idioma=`, que trae al lado de cada dato su traducción de Faro.
 * @param {string} ruta @param {string} idioma @returns {string}
 */
export function rutaEnIdioma(ruta, idioma) {
  if (idioma === IDIOMA_DEL_MOTOR) {
    return ruta;
  }
  return `${ruta}${ruta.includes('?') ? '&' : '?'}idioma=${encodeURIComponent(idioma)}`;
}

/**
 * El origen de un dato es la lectura de /api/grupos que lo trae y que se puede volver a pedir en otro idioma: la
 * ficha de un grupo (`grupo:7512`) o los hijos de un nivel de la clasificación (`hijos:75`; la raíz es `hijos:`).
 * @param {string} isco08 @returns {string | null} null si el código no es de un grupo con ficha
 */
export function origenDeGrupo(isco08) {
  return GRUPO_CON_FICHA.test(isco08) ? `grupo${SEPARADOR_DE_ORIGEN}${isco08}` : null;
}
/** El origen de los hijos de un nivel de la clasificación (`hijos:75`). @param {string} padre @returns {string} */
function origenDeHijos(padre) {
  return `hijos${SEPARADOR_DE_ORIGEN}${padre}`;
}

/**
 * Un origen por partes: { tipo: 'grupo' | 'hijos', codigo }.
 * @param {string} origen @returns {{ tipo: string, codigo: string }}
 */
export function leerOrigen(origen) {
  // split con un separador no vacío siempre devuelve al menos una cadena, también para el origen vacío.
  const [tipo, codigo = ''] = /** @type {[string, ...string[]]} */ (origen.split(SEPARADOR_DE_ORIGEN));
  return { tipo, codigo };
}

/**
 * La traducción de `campo` en `idioma` (`titulo_ca`): un texto, null si no la tiene o undefined si no la trae. En el
 * idioma de los datos no hay traducción que leer: undefined, también donde el campo del dato se llama como lo haría
 * su traducción (`texto_es`, el texto oficial en castellano).
 * @param {JsonDeLaApi} objeto @param {string} campo @param {string} idioma @returns {string | null | undefined}
 */
function traduccionDe(objeto, campo, idioma) {
  if (idioma === IDIOMA_DEL_MOTOR) {
    return undefined;
  }
  const traduccion = camposDe(objeto)[`${campo}_${idioma}`];
  if (typeof traduccion === 'string') {
    return traduccion;
  }
  return traduccion === null ? null : undefined;
}

/**
 * Un dato oficial con su traducción y la lectura de la que sale (datos-traducidos.js, apuntarTraducciones).
 * @param {unknown} castellano @param {string | null | undefined} traduccion @param {string | null} origen
 * @returns {ParDeTraduccion}
 */
function par(castellano, traduccion, origen) {
  return { castellano: textoDe(castellano), traduccion, origen };
}

/**
 * Los títulos de unas ocupaciones ESCO, con su traducción.
 * @param {JsonDeLaApi} ocupaciones @param {string | null} origen @param {string} idioma @returns {ParDeTraduccion[]}
 */
function titulosDe(ocupaciones, origen, idioma) {
  return listaDe(ocupaciones).map((ocupacion) =>
    par(camposDe(ocupacion).titulo, traduccionDe(ocupacion, 'titulo', idioma), origen),
  );
}

/**
 * Los datos oficiales de una ficha de grupo (/api/grupos/:isco): su título, sus tareas y sus ocupaciones ESCO.
 * @param {JsonDeLaApi} datos @param {string} idioma @returns {ParDeTraduccion[]}
 */
export function traduccionesDeFicha(datos, idioma) {
  const ficha = camposDe(datos);
  const origen = origenDeGrupo(textoDe(ficha.isco08));
  const deTareas = listaDe(ficha.tareas).flatMap((leida) => {
    const tarea = camposDe(leida);
    return [
      par(tarea.corto, traduccionDe(tarea, 'corto', idioma), origen),
      par(tarea.texto_es, traduccionDe(tarea, 'texto', idioma), origen),
    ];
  });
  const titulo = par(ficha.titulo, traduccionDe(ficha, 'titulo', idioma), origen);
  return [titulo, ...deTareas, ...titulosDe(ficha.ocupaciones, origen, idioma)];
}

/**
 * Los títulos de un nivel de la clasificación (/api/grupos?padre=…): el del padre y los de sus hijos.
 * @param {JsonDeLaApi} datos @param {string} padre @param {string} idioma @returns {ParDeTraduccion[]}
 */
export function traduccionesDeHijos(datos, padre, idioma) {
  const origen = origenDeHijos(padre);
  const nivel = camposDe(datos);
  return [nivel.padre, ...listaDe(nivel.hijos)]
    .filter(Boolean)
    .map((grupo) => par(camposDe(grupo).titulo, traduccionDe(grupo, 'titulo', idioma), origen));
}

// ---------- Los cuerpos que llevan la ocupación ----------

/**
 * El grupo principal y, si la hay, su ocupación ESCO para el cuerpo del informe.
 * @param {Pick<Ocupacion, 'isco08' | 'esco'>} ocupacion @returns {CuerpoDeOcupacion}
 */
export function cuerpoDeOcupacionPrincipal({ isco08, esco }) {
  return esco ? { isco08, ocupacionEsco: esco } : { isco08 };
}

/**
 * La ocupación tal como la recibe /api/informe: el grupo siempre; la ocupación ESCO y el grupo
 * secundario, solo si los hay.
 * @param {Pick<Ocupacion, 'isco08' | 'esco' | 'isco08Secundario'>} ocupacion @returns {CuerpoDeOcupacion}
 */
export function cuerpoDeOcupacion(ocupacion) {
  const cuerpo = cuerpoDeOcupacionPrincipal(ocupacion);
  if (ocupacion.isco08Secundario) {
    cuerpo.isco08Secundario = ocupacion.isco08Secundario;
  }
  return cuerpo;
}

/**
 * Si el informe carece de aportes inferidos: el grupo no fue propuesto por el motor, no hay estimaciones y cada
 * tarea es una referencia marcada o un literal cuyo motivo acredita esa ausencia. El campo público `sinIa`
 * conserva su significado de procedencia; no expresa si la IA local está cargada.
 * @param {Pick<Ocupacion, 'origen'>} ocupacion @param {Tarea[]} tareas @returns {boolean}
 */
export function hechoSinAporteInferido(ocupacion, tareas) {
  if (ocupacion.origen === ORIGENES.IA) {
    return false;
  }
  /** @param {Tarea} tarea */
  const sinAporteInferido = (tarea) => {
    if (tarea.estimacion) {
      return false;
    }
    if (tarea.marcada) {
      return true;
    }
    const motivo = tarea.sinEstimacion?.motivo;
    return !tarea.oficial && motivo !== undefined && MOTIVOS_DE_FALLO[motivo].sinAporteInferido;
  };
  return tareas.every(sinAporteInferido);
}

/**
 * El cuerpo de /api/informe. `ocupacion` es { isco08, esco, isco08Secundario, palabra, origen }. La palabra de la
 * persona solo se recorta al máximo que admite la API, sin partir palabras (la cita del informe no acaba en «…y a
 * veces ay»), y la limpia la API. `grupoPropuestoPorIa` va solo cuando el grupo lo propuso el motor local; `sinIa`,
 * solo si se acredita la ausencia de aportes inferidos (hechoSinAporteInferido); e `idioma`, el de la página si `opciones` no dice
 * otro (conIdioma).
 * @param {EntradaDelInforme} entrada @param {OpcionesDeIdioma} [opciones]
 * @returns {CuerpoDelInforme & { idioma: Idioma }}
 */
export function cuerpoDelInforme({ ocupacion, fecha, tareas, sinIa }, opciones) {
  /** @type {Omit<CuerpoDelInforme, 'fecha' | 'tareas'>} */
  const cuerpo = cuerpoDeOcupacion(ocupacion);
  const palabra = recortarEnPalabras(textoDe(ocupacion.palabra).trim(), MAX_LETRAS_OCUPACION_PERSONA);
  if (palabra) {
    cuerpo.ocupacionPersona = palabra;
  }
  if (ocupacion.origen === ORIGENES.IA) {
    cuerpo.grupoPropuestoPorIa = true;
  }
  if (sinIa) {
    cuerpo.sinIa = true;
  }
  return conIdioma({ ...cuerpo, fecha, tareas }, opciones);
}
