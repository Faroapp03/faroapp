// Encuesta en el panel: cuatro operaciones del servidor y lectores cerrados. Los códigos recién creados se
// devuelven a quien los pidió y no se guardan en el estado del cliente, para que ninguna otra vista ni copia los vea.

import { objetoAdministrativo, respuestaAdministrativaInvalida } from './contrato-comun.js';
import { leerSesionActiva } from './contratos.js';
import { EXITO } from './estados-http-panel.js';

/** @typedef {import('./cliente.js').Privado} Privado */
/** @typedef {import('./cliente.js').Trabajo} Trabajo */
/** @typedef {'participante'|'profesional'} TipoEncuesta */
/** @typedef {Readonly<{id:string,numero:number,tipo:TipoEncuesta,nombre:string|null,emitidos:number,consumidos:number,sinUsar:number}>} LoteEncuesta */
/** @typedef {Readonly<{respuestas:number,suma:number}>} EscalaPregunta */
/** @typedef {Readonly<{criterio:'proporcion',favorables:number,base:number,fueraDeLaBase:number,objetivo:number}>|Readonly<{criterio:'media',objetivo:number}>} MetaPregunta */
/** @typedef {Readonly<{denominador:number,valores:Readonly<Record<string,number>>,escala:EscalaPregunta|null,meta:MetaPregunta|null}>} RecuentoPregunta */
/** @typedef {Readonly<{respuestas:number,preguntas:Readonly<Record<string,RecuentoPregunta>>}>} RecuentoTipo */
/** @typedef {Readonly<{emitidos:number,consumidos:number,sinUsar:number}>} TotalTipo */
/** @typedef {Readonly<{numero:number,nombre:string,inicio:string|null,cierre:string|null,abierta:boolean,invitaciones:number,respuestas:number}>} RondaEncuesta */
/** @typedef {Readonly<{version:3,ronda:RondaEncuesta,rondas:readonly RondaEncuesta[],cuestionario:string,abierta:boolean,lotes:readonly LoteEncuesta[],totales:Readonly<Record<TipoEncuesta,TotalTipo>>,recuentos:Readonly<Record<TipoEncuesta,RecuentoTipo>>|null}>} ResultadosEncuesta */
/** @typedef {Readonly<{codigo:string,enlaceRelativo:string}>} CodigoEncuesta */

const ESCALA = Object.freeze(['1', '2', '3', '4', '5']);
/** El cuestionario cuyos resultados sabe leer el panel (src/encuesta/cuestionario.ts). */
export const CUESTIONARIO_ENCUESTA = 'faro-piloto-2';
/** Preguntas y valores de cada tipo, en el orden en que se presentan y se exportan (el del contrato del servidor). */
export const PREGUNTAS_ENCUESTA = Object.freeze({
  participante: Object.freeze({
    informe: Object.freeze(['visto', 'sin_ver']),
    ocupacion: Object.freeze(['si', 'en_parte', 'no']),
    comprension: ESCALA,
    formacion: Object.freeze([...ESCALA, 'sin_ver']),
    dificultad: Object.freeze([
      'describir_trabajo',
      'elegir_tareas',
      'entender_informe',
      'encontrar_formacion',
      'nada',
    ]),
  }),
  profesional: Object.freeze({
    ayudaOrientacion: ESCALA,
    explicarCambio: ESCALA,
    encajeFormacion: ESCALA,
    fiabilidad: ESCALA,
    mejora: Object.freeze([
      'explicacion_informe',
      'ocupacion',
      'datos_fuentes',
      'formacion',
      'uso_sesion',
      'accesibilidad',
      'nada',
    ]),
  }),
});
export const TIPOS_ENCUESTA = /** @type {const} */ (['participante', 'profesional']);
export const MINIMO_LOTE = 3;
export const MAXIMO_LOTE = 200;
export const MAXIMO_NOMBRE = 60;
const MAXIMO_LOTES = 50;
const MAXIMO_RONDAS = 20;
/** La versión de los resultados que sabe leer el panel: la 3 es la primera con rondas. */
const VERSION_RESULTADOS = 3;
const CLAVES_RESULTADOS = Object.freeze([
  'version',
  'ronda',
  'rondas',
  'cuestionario',
  'abierta',
  'lotes',
  'totales',
  'recuentos',
]);
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const INCORRECTO = 400;
const CONFLICTO = 409;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENLACES = Object.freeze({ participante: '/inicio.html#invitacion=', profesional: '/encuesta.html#codigo=' });
// El mismo formato que genera el servidor (src/encuesta/codigos.ts): prefijo del tipo y siete grupos de Crockford.
const CODIGO = /^(PART|PROF)(-[0-9A-HJKMNP-TV-Z]{4}){7}$/;
const PREFIJOS = Object.freeze({ participante: 'PART', profesional: 'PROF' });

/** @param {unknown} valor */
function natural(valor) {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0) {
    return respuestaAdministrativaInvalida();
  }
  return valor;
}
/** @param {unknown} valor @returns {TipoEncuesta} */
function tipo(valor) {
  return valor === 'participante' || valor === 'profesional' ? valor : respuestaAdministrativaInvalida();
}
// La misma regla que el servidor: controles (también tabuladores y saltos), formato, sustitutos, uso privado, sin
// asignar, separadores de línea y párrafo, y los rellenos que se ven vacíos (U+115F, U+1160, U+3164, U+FFA0, U+2800).
const NO_ADMITIDOS_EN_NOMBRE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]/u;
// Al menos una letra, cifra, puntuación o símbolo: un nombre de solo espacios o marcas combinantes no se ve.
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;
/** El nombre de la entidad: bien formado, de 1 a 60 puntos de código, sin espacios en los extremos, sin caracteres no
 * admitidos y con algo visible. El servidor admite además `null` (lote sin nombre); la pantalla exige el nombre.
 * @param {unknown} valor */
export function nombreDeEntidadValido(valor) {
  if (typeof valor !== 'string' || !valor.isWellFormed()) {
    return false;
  }
  const longitud = [...valor].length;
  return (
    longitud >= 1 &&
    longitud <= MAXIMO_NOMBRE &&
    valor === valor.trim() &&
    !NO_ADMITIDOS_EN_NOMBRE.test(valor) &&
    VISIBLE.test(valor)
  );
}
/** @param {unknown} entrada @returns {LoteEncuesta} */
function leerLote(entrada) {
  const d = objetoAdministrativo(entrada, ['id', 'numero', 'tipo', 'nombre', 'emitidos', 'consumidos', 'sinUsar']);
  const emitidos = natural(d.emitidos);
  const consumidos = natural(d.consumidos);
  const sinUsar = natural(d.sinUsar);
  if (
    typeof d.id !== 'string' ||
    !UUID.test(d.id) ||
    natural(d.numero) < 1 ||
    (d.nombre !== null && !nombreDeEntidadValido(d.nombre)) ||
    consumidos + sinUsar > emitidos
  ) {
    return respuestaAdministrativaInvalida();
  }
  return Object.freeze({
    id: d.id,
    numero: /** @type {number} */ (d.numero),
    tipo: tipo(d.tipo),
    nombre: /** @type {string|null} */ (d.nombre),
    emitidos,
    consumidos,
    sinUsar,
  });
}
/** Las respuestas de la escala y la suma de sus puntos, o null si la pregunta no tiene escala.
 * @param {unknown} entrada @param {number} denominador @returns {EscalaPregunta|null} */
function leerEscala(entrada, denominador) {
  if (entrada === null) {
    return null;
  }
  const d = objetoAdministrativo(entrada, ['respuestas', 'suma']);
  const respuestas = natural(d.respuestas);
  const suma = natural(d.suma);
  if (respuestas > denominador || suma > respuestas * ESCALA.length) {
    return respuestaAdministrativaInvalida();
  }
  return Object.freeze({ respuestas, suma });
}
/** La meta de la pregunta tal como la calcula el servidor: el panel no decide qué cuenta ni sobre qué base.
 * @param {unknown} entrada @param {number} denominador @returns {MetaPregunta|null} */
function leerMeta(entrada, denominador) {
  if (entrada === null) {
    return null;
  }
  const criterio =
    entrada && typeof entrada === 'object' ? /** @type {{criterio?:unknown}} */ (entrada).criterio : null;
  if (criterio === 'media') {
    const d = objetoAdministrativo(entrada, ['criterio', 'objetivo']);
    return Object.freeze({ criterio, objetivo: natural(d.objetivo) });
  }
  const d = objetoAdministrativo(entrada, ['criterio', 'favorables', 'base', 'fueraDeLaBase', 'objetivo']);
  const favorables = natural(d.favorables);
  const base = natural(d.base);
  const fueraDeLaBase = natural(d.fueraDeLaBase);
  if (d.criterio !== 'proporcion' || favorables > base || base + fueraDeLaBase !== denominador) {
    return respuestaAdministrativaInvalida();
  }
  return Object.freeze({ criterio: 'proporcion', favorables, base, fueraDeLaBase, objetivo: natural(d.objetivo) });
}
/** @param {unknown} entrada @param {readonly string[]} valores @returns {RecuentoPregunta} */
function leerRecuentoPregunta(entrada, valores) {
  const p = objetoAdministrativo(entrada, ['denominador', 'valores', 'escala', 'meta']);
  const v = objetoAdministrativo(p.valores, [...valores]);
  const cuentas = Object.fromEntries(valores.map((valor) => [valor, natural(v[valor])]));
  const denominador = natural(p.denominador);
  if (Object.values(cuentas).reduce((a, b) => a + b, 0) !== denominador) {
    return respuestaAdministrativaInvalida();
  }
  return Object.freeze({
    denominador,
    valores: Object.freeze(cuentas),
    escala: leerEscala(p.escala, denominador),
    meta: leerMeta(p.meta, denominador),
  });
}
/** @param {unknown} entrada @param {TipoEncuesta} clase @returns {RecuentoTipo} */
function leerRecuentoTipo(entrada, clase) {
  const d = objetoAdministrativo(entrada, ['respuestas', 'preguntas']);
  const preguntas = PREGUNTAS_ENCUESTA[clase];
  const dadas = objetoAdministrativo(d.preguntas, Object.keys(preguntas));
  /** @type {Record<string,RecuentoPregunta>} */
  const leidas = {};
  for (const [pregunta, valores] of Object.entries(preguntas)) {
    leidas[pregunta] = leerRecuentoPregunta(dadas[pregunta], valores);
  }
  return Object.freeze({ respuestas: natural(d.respuestas), preguntas: Object.freeze(leidas) });
}
/** Una ronda: abierta sin cierre, y sus respuestas nunca más que sus invitaciones. @param {unknown} entrada
 * @returns {RondaEncuesta} */
function leerRonda(entrada) {
  const d = objetoAdministrativo(entrada, [
    'numero',
    'nombre',
    'inicio',
    'cierre',
    'abierta',
    'invitaciones',
    'respuestas',
  ]);
  const dia = (/** @type {unknown} */ valor) => valor === null || (typeof valor === 'string' && DIA.test(valor));
  const invitaciones = natural(d.invitaciones);
  const respuestas = natural(d.respuestas);
  if (
    natural(d.numero) < 1 ||
    !nombreDeEntidadValido(d.nombre) ||
    !dia(d.inicio) ||
    !dia(d.cierre) ||
    typeof d.abierta !== 'boolean' ||
    (d.abierta && d.cierre !== null) ||
    respuestas > invitaciones
  ) {
    return respuestaAdministrativaInvalida();
  }
  return Object.freeze({
    numero: /** @type {number} */ (d.numero),
    nombre: /** @type {string} */ (d.nombre),
    inicio: /** @type {string|null} */ (d.inicio),
    cierre: /** @type {string|null} */ (d.cierre),
    abierta: d.abierta,
    invitaciones,
    respuestas,
  });
}
/** Las rondas en orden y, si hay una abierta, es la última; la de los resultados es una de ellas.
 * @param {unknown} lista @param {RondaEncuesta} ronda */
function leerRondas(lista, ronda) {
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAXIMO_RONDAS) {
    return respuestaAdministrativaInvalida();
  }
  const rondas = lista.map(leerRonda);
  const enOrden = rondas.every((r, i) => i === 0 || r.numero > (rondas[i - 1]?.numero ?? 0));
  const abiertaAlFinal = rondas.every((r, i) => !r.abierta || i === rondas.length - 1);
  if (!enOrden || !abiertaAlFinal || !rondas.some((r) => JSON.stringify(r) === JSON.stringify(ronda))) {
    return respuestaAdministrativaInvalida();
  }
  return Object.freeze(rondas);
}
/** @param {unknown} entrada @returns {TotalTipo} */
function leerTotal(entrada) {
  const d = objetoAdministrativo(entrada, ['emitidos', 'consumidos', 'sinUsar']);
  return Object.freeze({
    emitidos: natural(d.emitidos),
    consumidos: natural(d.consumidos),
    sinUsar: natural(d.sinUsar),
  });
}
/** Lector cerrado de los resultados; con la encuesta abierta no puede traer recuentos. @param {unknown} entrada
 * @returns {ResultadosEncuesta} */
export function leerResultadosEncuesta(entrada) {
  const d = objetoAdministrativo(entrada, [...CLAVES_RESULTADOS]);
  if (
    d.version !== VERSION_RESULTADOS ||
    d.cuestionario !== CUESTIONARIO_ENCUESTA ||
    typeof d.abierta !== 'boolean' ||
    !Array.isArray(d.lotes) ||
    d.lotes.length > MAXIMO_LOTES
  ) {
    return respuestaAdministrativaInvalida();
  }
  const lotes = d.lotes.map(leerLote);
  if (lotes.some((lote, i) => i > 0 && lote.numero <= (lotes[i - 1]?.numero ?? 0))) {
    return respuestaAdministrativaInvalida();
  }
  const totales = objetoAdministrativo(d.totales, [...TIPOS_ENCUESTA]);
  if (d.abierta ? d.recuentos !== null : d.recuentos === null) {
    return respuestaAdministrativaInvalida();
  }
  const recuentos = d.recuentos === null ? null : objetoAdministrativo(d.recuentos, [...TIPOS_ENCUESTA]);
  const ronda = leerRonda(d.ronda);
  if (ronda.abierta !== d.abierta) {
    return respuestaAdministrativaInvalida();
  }
  return Object.freeze({
    version: VERSION_RESULTADOS,
    ronda,
    rondas: leerRondas(d.rondas, ronda),
    cuestionario: CUESTIONARIO_ENCUESTA,
    abierta: d.abierta,
    lotes: Object.freeze(lotes),
    totales: Object.freeze({
      participante: leerTotal(totales.participante),
      profesional: leerTotal(totales.profesional),
    }),
    recuentos: recuentos
      ? Object.freeze({
          participante: leerRecuentoTipo(recuentos.participante, 'participante'),
          profesional: leerRecuentoTipo(recuentos.profesional, 'profesional'),
        })
      : null,
  });
}
/** @param {unknown} entrada @param {LoteEncuesta} lote @returns {readonly CodigoEncuesta[]} */
function leerCodigos(entrada, lote) {
  if (!Array.isArray(entrada) || entrada.length !== lote.emitidos) {
    return respuestaAdministrativaInvalida();
  }
  const vistos = new Set();
  return Object.freeze(
    entrada.map((item) => {
      const d = objetoAdministrativo(item, ['codigo', 'enlaceRelativo']);
      if (
        typeof d.codigo !== 'string' ||
        !CODIGO.test(d.codigo) ||
        !d.codigo.startsWith(`${PREFIJOS[lote.tipo]}-`) ||
        vistos.has(d.codigo) ||
        d.enlaceRelativo !== `${ENLACES[lote.tipo]}${d.codigo}`
      ) {
        return respuestaAdministrativaInvalida();
      }
      vistos.add(d.codigo);
      return Object.freeze({ codigo: d.codigo, enlaceRelativo: d.enlaceRelativo });
    }),
  );
}
/** @param {unknown} cuerpo @param {{tipo:TipoEncuesta,cantidad:number,nombre:string}} pedido */
function leerLoteCreado(cuerpo, pedido) {
  const d = objetoAdministrativo(cuerpo, ['estado', 'sesion', 'lote', 'codigos']);
  const lote = leerLote(d.lote);
  if (
    d.estado !== 'activa' ||
    lote.tipo !== pedido.tipo ||
    lote.emitidos !== pedido.cantidad ||
    lote.nombre !== pedido.nombre ||
    lote.consumidos !== 0 ||
    lote.sinUsar !== lote.emitidos
  ) {
    return respuestaAdministrativaInvalida();
  }
  return { sesion: leerSesionActiva(d.sesion), lote, codigos: leerCodigos(d.codigos, lote) };
}
/** @param {unknown} cuerpo */
function leerLectura(cuerpo) {
  const d = objetoAdministrativo(cuerpo, ['estado', 'sesion', 'encuesta']);
  if (d.estado !== 'activa') {
    return respuestaAdministrativaInvalida();
  }
  return { sesion: leerSesionActiva(d.sesion), encuesta: leerResultadosEncuesta(d.encuesta) };
}

/** Errores propios de la encuesta: la sesión sigue igual y la vista explica qué ha pasado y qué hacer.
 * «cuestionario_anterior»: la instalación guarda respuestas de un cuestionario anterior y no abre la encuesta.
 * «ronda_abierta»: no se abre otra ronda mientras haya una abierta; «limite_rondas»: ya están todas las que caben.
 * @typedef {'lote_demasiado_pequeno'|'encuesta_cerrada'|'limite_lotes'|'cuestionario_anterior'|'ronda_abierta'|'limite_rondas'} ErrorEncuesta */
/** Los errores de conflicto que el panel explica con su propia frase. */
const CONFLICTOS = Object.freeze([
  'encuesta_cerrada',
  'limite_lotes',
  'cuestionario_anterior',
  'ronda_abierta',
  'limite_rondas',
]);
/** @param {{estado:number,cuerpo:unknown}} respuesta @returns {ErrorEncuesta|null} */
export function errorDeEncuesta(respuesta) {
  const cuerpo = respuesta.cuerpo;
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return null;
  }
  const d = /** @type {Record<string,unknown>} */ (cuerpo);
  const claves = Object.keys(d).sort().join(',');
  if (respuesta.estado === INCORRECTO && claves === 'error,minimo' && d.error === 'lote_demasiado_pequeno') {
    return d.minimo === MINIMO_LOTE ? 'lote_demasiado_pequeno' : null;
  }
  if (respuesta.estado === CONFLICTO && claves === 'error' && CONFLICTOS.includes(/** @type {string} */ (d.error))) {
    return /** @type {ErrorEncuesta} */ (d.error);
  }
  return null;
}
/** @typedef {{ejecutar:(p:Privado,o:'encuesta',f:(t:Trabajo)=>Promise<void>)=>Promise<import('./cliente.js').EstadoClientePanel>, enviar:(p:Privado,t:Trabajo,pedido:{ruta:string,cuerpo:object,token:string})=>Promise<{estado:number,cuerpo:unknown}>, vigente:(p:Privado,t:Trabajo)=>boolean, rechazar:(r:{estado:number,cuerpo:unknown})=>never, activar:(p:Privado,d:{controles:import('./cliente.js').DocumentoControles,sesion:import('./cliente.js').SesionPanelActiva},c:boolean)=>void}} Ayudas */
/** Un fallo (también «lote demasiado pequeño», «encuesta cerrada» o «límite de lotes») llega como aviso del panel y
 * la operación devuelve `null`; crear un lote es una mutación y una respuesta perdida nunca se reenvía.
 * @param {Privado} privado @param {Ayudas} ayudas */
export function crearOperacionesEncuesta(privado, ayudas) {
  /** @template T @param {'resultados'|'cerrar'|'crear-lote'|'abrir-ronda'} operacion @param {object} cuerpo
   * @param {(cuerpo:unknown)=>{sesion:import('./cliente.js').SesionPanelActiva}&T} leer
   * @returns {Promise<T|{error:ErrorEncuesta}|null>} */
  async function solicitar(operacion, cuerpo, leer) {
    const anterior = privado.estado;
    if (anterior.estado !== 'activa' || !privado.token || privado.trabajo) {
      return null;
    }
    /** @type {T|{error:ErrorEncuesta}|null} */
    let resultado = null;
    await ayudas.ejecutar(privado, 'encuesta', async (trabajo) => {
      trabajo.mutacion = operacion !== 'resultados';
      const respuesta = await ayudas.enviar(privado, trabajo, {
        ruta: `encuesta/${operacion}`,
        cuerpo,
        token: privado.token,
      });
      if (!ayudas.vigente(privado, trabajo)) {
        return;
      }
      const error = errorDeEncuesta(respuesta);
      if (error && privado.sesion) {
        // El servidor rechaza sin cambiar nada: la sesión confirmada sigue vigente y el panel queda libre.
        ayudas.activar(privado, { controles: anterior.controles, sesion: privado.sesion }, anterior.conflicto);
        resultado = { error };
        return;
      }
      if (respuesta.estado !== EXITO) {
        ayudas.rechazar(respuesta);
      }
      const leido = leer(respuesta.cuerpo);
      ayudas.activar(privado, { controles: anterior.controles, sesion: leido.sesion }, anterior.conflicto);
      resultado = leido;
    });
    return resultado;
  }
  return {
    /** Los resultados de la ronda con ese número, o los de la última. */
    consultarEncuesta: (/** @type {number|null} */ ronda = null) =>
      solicitar('resultados', ronda === null ? {} : { ronda }, leerLectura),
    cerrarEncuesta: () => solicitar('cerrar', {}, leerLectura),
    abrirRondaEncuesta: (/** @type {string} */ nombre) => solicitar('abrir-ronda', { nombre }, leerLectura),
    crearLoteEncuesta: (/** @type {{tipo:TipoEncuesta,cantidad:number,nombre:string}} */ pedido) =>
      solicitar('crear-lote', { tipo: pedido.tipo, cantidad: pedido.cantidad, nombre: pedido.nombre }, (c) =>
        leerLoteCreado(c, pedido),
      ),
  };
}
