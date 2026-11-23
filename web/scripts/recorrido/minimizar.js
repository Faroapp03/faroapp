// El filtro compartido de datos personales reconocidos se aplica en el dispositivo. La misma regla de
// src/seguridad/privacidad.ts protege las peticiones locales y los literales de tareas antes de conservarlos.
// Si no se puede cargar o una ruta con cuerpo no declara sus campos, no se procesa el texto.

import { camposDe } from '../json.js';
import { MAX_LETRAS_OCUPACION_PERSONA } from './traduccion-api.js';

/** @import { CuerpoDeLaApi } from './traduccion-api.js' */

/**
 * Los tres módulos de la limpieza del motor empaquetado, cada uno con su dirección fija escrita entera (nada se compone
 * con datos). Van en constantes y no como texto dentro de import() porque esos archivos los genera
 * la construcción (empaquetarMotor):
 * con un texto, la comprobación de tipos los buscaría y fallaría sin ellos, o los leería
 * con ellos. El motor del dispositivo usa la misma carga por dirección fija (motor-local/worker.js).
 */
const PRIVACIDAD = new URL('../../motor/src/seguridad/privacidad.js', import.meta.url).href;
const AVISOS = new URL('../../motor/src/seguridad/avisos.js', import.meta.url).href;
const LIMITES = new URL('../../motor/src/seguridad/limites.js', import.meta.url).href;

/**
 * Lo que se usa de la limpieza del motor empaquetado (motor/src/seguridad/ de la web construida), con los tipos de su
 * fuente (src/seguridad/privacidad.ts, avisos.ts y limites.ts). Esos archivos los genera la construcción y no
 * existen para la comprobación de tipos: lo que se importa llega sin tipo y se comprueba al cargarlo (limpiadorDe).
 * @typedef {{ texto: string, eliminados: number }} Limpieza
 * @typedef {{ limpiar: (texto: string) => Limpieza, avisoEs: string, avisoCa: string, maxTarea: number }} Limpiador
 */
/** @typedef {Record<string, unknown>} Cuerpo */
/** @typedef {(texto: unknown, maximo: number) => unknown} Limpiar */
/** @typedef {(cuerpo: Cuerpo, limpiar: Limpiar) => void} Campo */

/**
 * La carga de la limpieza en curso o ya hecha: la empieza cargarLimpieza y la suelta olvidarLaCarga si falla, para que
 * el siguiente envío la reintente.
 * @type {Promise<Limpiador | null> | null}
 */
let carga = null;

/**
 * La limpieza del motor compilado, cargada al primer envío; null si no se ha podido cargar.
 * @returns {Promise<Limpiador | null>}
 */
function cargarLimpieza() {
  carga ??= importarLimpieza().catch(olvidarLaCarga);
  return carga;
}

/** Un fallo de carga no se guarda: el siguiente envío la vuelve a intentar. @returns {null} */
function olvidarLaCarga() {
  carga = null;
  return null;
}

/** La limpieza cargada no tiene la forma que espera la web: no se usa, y el texto de la persona no llega al motor. */
class LimpiezaDistinta extends Error {
  /** @param {string} pieza lo que falta o no tiene su tipo */
  constructor(pieza) {
    super(`La limpieza del motor compilado no trae ${pieza} con su tipo`);
    this.name = 'LimpiezaDistinta';
  }
}

/** Una petición con cuerpo a una ruta que no está en la lista del filtro no se hace: no se sabe qué textos lleva. */
export class RutaSinFiltro extends Error {
  /** @param {string} ruta la ruta pedida, sin su consulta */
  constructor(ruta) {
    super(`La ruta ${ruta} lleva cuerpo y no está en la lista del filtro de datos personales: no sale`);
    this.name = 'RutaSinFiltro';
  }
}

/** Un máximo de letras: un entero positivo. @param {unknown} valor @returns {valor is number} */
function esMaximo(valor) {
  return Number.isSafeInteger(valor) && Number(valor) > 0;
}

/**
 * La limpieza que usa la web, comprobada pieza a pieza en lo importado (que llega sin tipo): una función de limpiar,
 * los dos avisos como texto y el máximo de una tarea como entero positivo.
 * @param {Record<string, unknown>} privacidad @param {Record<string, unknown>} avisos
 * @param {Record<string, unknown>} limites @returns {Limpiador}
 * @throws {LimpiezaDistinta} si a lo importado le falta una pieza o no tiene su tipo
 */
function limpiadorDe(privacidad, avisos, limites) {
  const { limpiarDatosPersonales: limpiar } = privacidad;
  const { AVISO_DATOS: avisoEs, AVISO_DATOS_CA: avisoCa } = avisos;
  const { MAX_TAREA: maxTarea } = limites;
  if (typeof limpiar !== 'function') {
    throw new LimpiezaDistinta('limpiarDatosPersonales');
  }
  if (typeof avisoEs !== 'string' || typeof avisoCa !== 'string') {
    throw new LimpiezaDistinta('AVISO_DATOS y AVISO_DATOS_CA');
  }
  if (!esMaximo(maxTarea)) {
    throw new LimpiezaDistinta('MAX_TAREA');
  }
  // Comprobado que es una función, su firma es la de la fuente (privacidad.ts), que no se puede leer aquí.
  return { limpiar: /** @type {Limpiador['limpiar']} */ (limpiar), avisoEs, avisoCa, maxTarea };
}

/**
 * Importa los tres módulos de la limpieza del motor compilado y los comprueba.
 * @returns {Promise<Limpiador>}
 * @throws {LimpiezaDistinta} si lo importado no tiene la forma que espera la web
 */
async function importarLimpieza() {
  const [privacidad, avisos, limites] = await Promise.all([import(PRIVACIDAD), import(AVISOS), import(LIMITES)]);
  return limpiadorDe(privacidad, avisos, limites);
}

/** Un texto del cuerpo. @param {string} nombre @param {number} maximo @returns {Campo} */
function texto(nombre, maximo) {
  return (cuerpo, limpiar) => {
    cuerpo[nombre] = limpiar(cuerpo[nombre], maximo);
  };
}
/**
 * El campo `clave` de cada objeto de una lista.
 * @param {string} nombre @param {string} clave @param {number} maximo @returns {Campo}
 */
function textoDeCadaUno(nombre, clave, maximo) {
  return (cuerpo, limpiar) => {
    const lista = cuerpo[nombre];
    if (!Array.isArray(lista)) {
      return;
    }
    cuerpo[nombre] = lista.map((objeto) =>
      objeto && typeof objeto === 'object' ? { ...objeto, [clave]: limpiar(objeto[clave], maximo) } : objeto,
    );
  };
}

/**
 * Los textos de la persona que lleva cada ruta factual con cuerpo, con el máximo de cada uno.
 * @param {Pick<Limpiador, 'maxTarea'>} limites @returns {Record<string, Campo[]>}
 */
function textosPorRuta({ maxTarea }) {
  return {
    '/informe': [textoDeCadaUno('tareas', 'texto', maxTarea), texto('ocupacionPersona', MAX_LETRAS_OCUPACION_PERSONA)],
  };
}

/** La ruta sin su consulta (`/informe?formato=html` → `/informe`). @param {string} ruta @returns {string} */
function sinConsulta(ruta) {
  const consulta = ruta.indexOf('?');
  return consulta < 0 ? ruta : ruta.slice(0, consulta);
}

/** Las rutas que el filtro conoce: solo ellas salen con cuerpo. Solo cuentan las claves, no los máximos. */
const RUTAS_FILTRADAS = new Set(Object.keys(textosPorRuta({ maxTarea: 0 })));

/**
 * Si una petición con cuerpo a `ruta` (con su consulta o sin ella) puede hacerse: solo si el filtro sabe qué textos
 * de la persona lleva.
 * @param {string} ruta @returns {boolean}
 */
export function rutaFiltrada(ruta) {
  return RUTAS_FILTRADAS.has(sinConsulta(ruta));
}

/** Rangos de las dos unidades que forman un carácter fuera del plano básico de Unicode. */
const SUSTITUTO_ALTO = { desde: 0xd800, hasta: 0xdbff };
const SUSTITUTO_BAJO = { desde: 0xdc00, hasta: 0xdfff };

/** El máximo sigue contando UTF-16, sin partir un par válido al expandirse una marca. @param {string} texto @param {number} maximo */
function prefijoLimpio(texto, maximo) {
  const ultima = texto.charCodeAt(maximo - 1);
  const siguiente = texto.charCodeAt(maximo);
  const partido =
    ultima >= SUSTITUTO_ALTO.desde &&
    ultima <= SUSTITUTO_ALTO.hasta &&
    siguiente >= SUSTITUTO_BAJO.desde &&
    siguiente <= SUSTITUTO_BAJO.hasta;
  return texto.slice(0, partido ? maximo - 1 : maximo);
}

/**
 * El cuerpo con los textos de la persona limpios, y cuántos datos se han quitado. No cambia el cuerpo recibido.
 * @param {Limpiador} limpiador @param {string} ruta @param {Cuerpo} cuerpo
 * @returns {{ cuerpo: Cuerpo, eliminados: number }}
 * @throws {RutaSinFiltro} si la ruta no está en la lista del filtro
 */
export function limpiarCuerpo(limpiador, ruta, cuerpo) {
  const campos = textosPorRuta(limpiador)[sinConsulta(ruta)];
  if (!campos) {
    throw new RutaSinFiltro(sinConsulta(ruta));
  }
  let eliminados = 0;
  /** @type {Limpiar} */
  const limpiar = (valor, maximo) => {
    if (typeof valor !== 'string') {
      return valor;
    }
    const hecho = limpiador.limpiar(valor);
    eliminados += hecho.eliminados;
    return hecho.eliminados ? prefijoLimpio(hecho.texto, maximo) : valor;
  };
  const resultado = { ...cuerpo };
  for (const campo of campos) {
    campo(resultado, limpiar);
  }
  return { cuerpo: resultado, eliminados };
}

/**
 * La respuesta con el aviso de datos eliminados si se quitó algo aquí y el motor, que ya no lo ha visto, no lo trae:
 * la persona recibe el aviso una sola vez, se haya detectado aquí o en el motor.
 * @param {Limpiador} limpiador @param {unknown} datos @param {number} eliminados @param {unknown} idioma
 * @returns {unknown}
 */
export function conAvisoDeDatos(limpiador, datos, eliminados, idioma) {
  if (!eliminados || !datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return datos;
  }
  const respuesta = camposDe(datos);
  /** @type {readonly unknown[]} */
  const avisos = Array.isArray(respuesta.avisos) ? respuesta.avisos : [];
  if (avisos.some((aviso) => camposDe(aviso).tipo === 'datos-personales')) {
    return datos;
  }
  const texto = idioma === 'ca' ? limpiador.avisoCa : limpiador.avisoEs;
  /** @type {Record<string, unknown>} */
  const conAviso = { ...respuesta, avisos: [...avisos, { tipo: 'datos-personales', texto }] };
  if (typeof respuesta.datosEliminados === 'number') {
    conAviso.datosEliminados = respuesta.datosEliminados + eliminados;
  }
  return conAviso;
}

/**
 * Lo que recibe el motor del dispositivo en una petición de `ruta`: el cuerpo sin datos personales y cómo completar su
 * respuesta con el aviso. Sin cuerpo (un GET), la petición llega y vuelve igual. Si la limpieza no se ha podido
 * cargar, null: esa petición no se hace.
 * @param {string} ruta @param {Cuerpo | undefined} cuerpo
 * @returns {Promise<{ cuerpo: Cuerpo | undefined, conAviso: (datos: CuerpoDeLaApi) => CuerpoDeLaApi } | null>}
 * @throws {RutaSinFiltro} si lleva cuerpo y la ruta no está en la lista del filtro
 */
export async function minimizarParaEnviar(ruta, cuerpo) {
  const igual = { cuerpo, conAviso: (/** @type {CuerpoDeLaApi} */ datos) => datos };
  if (cuerpo === undefined) {
    return igual;
  }
  if (!rutaFiltrada(ruta)) {
    throw new RutaSinFiltro(sinConsulta(ruta));
  }
  const limpiador = await cargarLimpieza();
  if (!limpiador) {
    return null;
  }
  const limpio = limpiarCuerpo(limpiador, ruta, cuerpo);
  return {
    cuerpo: limpio.cuerpo,
    // Un objeto vuelve como objeto, con el aviso o sin él: camposDe solo lo devuelve con su tipo.
    conAviso: (datos) => camposDe(conAvisoDeDatos(limpiador, datos, limpio.eliminados, cuerpo.idioma)),
  };
}

/**
 * Un literal de tarea con la misma limpieza y el mismo límite que el contrato local. No separa tareas ni infiere
 * una referencia oficial. Si el filtro no está disponible, no se conserva el texto sin revisar.
 * @param {string} texto @param {AbortSignal} signal @returns {Promise<{ texto: string, avisos: import('./traduccion-api.js').Aviso[] } | null>}
 */
export async function limpiarTareaLocal(texto, signal) {
  const limpiador = await cargarLimpieza();
  if (!limpiador) {
    return null;
  }
  signal.throwIfAborted();
  const limpio = limpiador.limpiar(texto);
  return {
    texto: prefijoLimpio(limpio.texto, limpiador.maxTarea),
    avisos: limpio.eliminados ? [{ tipo: 'datos-personales', texto: limpiador.avisoEs }] : [],
  };
}
