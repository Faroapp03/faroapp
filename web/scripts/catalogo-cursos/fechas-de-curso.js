/**
 * Las fechas que publica cada curso, escritas como las diría una persona: «del 1 de enero al 31 de diciembre de 2026»,
 * «12 de enero de 2026, de 10:00 a 12:00». Solo cambia cómo se leen: el dato publicado no se toca, y lo que se ordena,
 * se filtra o se lleva al calendario sigue usando el valor exacto. Un instante con huso se lee en la hora de Barcelona,
 * igual en cualquier navegador y en cualquier zona del dispositivo; una hora sin huso se enseña tal como la escribió
 * el proveedor y se dice que su huso está por confirmar, porque convertirla sería inventar su zona.
 */
import {
  conArticulo,
  diaYMesEnFrase,
  fechaLarga,
  fechaLargaConHora,
  horaEnFrase,
  partesDelDia,
  partesEnZona,
} from '../fechas.js';

/** @import { IdiomaFecha, PartesFecha } from '../fechas.js' */
/** @typedef {Readonly<{partes: PartesFecha, conHora: boolean, husoConocido: boolean}>} FechaLeida */

/** La forma de las fechas que acepta el catálogo: un día, o un día con hora y, si lo publica, su huso. */
const FECHA_PUBLICADA = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/u;
/** -00:00 dice que el proveedor no conoce el huso. */
const HUSO_DESCONOCIDO = '-00:00';
/** Lo que se añade a una hora cuyo huso no publicó el proveedor. */
const HUSO_POR_CONFIRMAR = Object.freeze({ es: 'huso horario por confirmar', ca: 'fus horari per confirmar' });
const LA_UNA = 1;
const ULTIMA_HORA = 23;
const ULTIMO_MINUTO = 59;
const LAS_ONCE = 11;
/** Las horas que en catalán se leen con vocal («una», «onze») apostrofan la preposición: «d’11:00». */
const HORAS_CON_APOSTROFO = Object.freeze([LA_UNA, LAS_ONCE]);

/** Las 00:00 y las 23:59 solo dicen dónde empieza y dónde acaba un día; no son la hora de una sesión.
 * @param {PartesFecha} p */
function delimitaElDia(p) {
  return (p.hora === 0 && p.minuto === 0) || (p.hora === ULTIMA_HORA && p.minuto === ULTIMO_MINUTO);
}

/** Una fecha publicada, en la hora de Barcelona si trae huso. @param {string} valor @returns {FechaLeida} */
export function leerFechaPublicada(valor) {
  const leida = FECHA_PUBLICADA.exec(valor);
  const dia = leida?.[1];
  if (!leida || !dia) {
    throw new TypeError('La fecha publicada no es válida');
  }
  const [, , hora, minuto, segundo = '00', huso] = leida;
  if (hora === undefined || minuto === undefined) {
    return Object.freeze({ partes: partesDelDia(dia), conHora: false, husoConocido: true });
  }
  const husoConocido = Boolean(huso) && huso !== HUSO_DESCONOCIDO;
  const partes = husoConocido
    ? partesEnZona(`${dia}T${hora}:${minuto}:${segundo}${huso}`)
    : Object.freeze({ ...partesDelDia(dia), hora: Number(hora), minuto: Number(minuto), segundo: Number(segundo) });
  return Object.freeze({ partes, conHora: !delimitaElDia(partes), husoConocido });
}

/** Si alguna hora escrita no trae huso, se dice al final: «… de 10:00 a 12:00 (huso horario por confirmar)».
 * @param {string} texto @param {readonly FechaLeida[]} fechas @param {IdiomaFecha} idioma */
function conAvisoDeHuso(texto, fechas, idioma) {
  return fechas.some((f) => f.conHora && !f.husoConocido) ? `${texto} (${HUSO_POR_CONFIRMAR[idioma]})` : texto;
}

/** @param {FechaLeida} fecha @param {IdiomaFecha} idioma */
function escrita(fecha, idioma) {
  return fecha.conHora ? fechaLargaConHora(fecha.partes, idioma) : fechaLarga(fecha.partes, idioma);
}

/** Una fecha sola: «12 de enero de 2026» o, si su hora es real, «12 de enero de 2026 a las 10:00».
 * @param {string} valor @param {IdiomaFecha} idioma */
export function fechaDeCurso(valor, idioma) {
  const fecha = leerFechaPublicada(valor);
  return conAvisoDeHuso(escrita(fecha, idioma), [fecha], idioma);
}

/** Solo el día, en la hora de Barcelona: «18 de noviembre de 2026». @param {string} valor @param {IdiomaFecha} idioma */
export function diaDeCurso(valor, idioma) {
  return fechaLarga(leerFechaPublicada(valor).partes, idioma);
}

/** @typedef {'el'|'al'|'hasta'|'desde'|'de'} FormaEnFrase */

/** fechaDeCurso dentro de una frase, con su artículo: «hasta el 31 de diciembre de 2026», «fins a l’1 d’octubre del
 * 2026». @param {string} valor @param {IdiomaFecha} idioma @param {FormaEnFrase} forma */
export function fechaDeCursoEnFrase(valor, idioma, forma) {
  return conArticulo(fechaDeCurso(valor, idioma), leerFechaPublicada(valor).partes.dia, idioma, forma);
}

/** diaDeCurso dentro de una frase: «el 18 de noviembre de 2026», «l’1 d’octubre del 2026».
 * @param {string} valor @param {IdiomaFecha} idioma @param {FormaEnFrase} forma */
export function diaDeCursoEnFrase(valor, idioma, forma) {
  return conArticulo(diaDeCurso(valor, idioma), leerFechaPublicada(valor).partes.dia, idioma, forma);
}

/** @param {PartesFecha} a @param {PartesFecha} b */
function mismoDia(a, b) {
  return a.anio === b.anio && a.mes === b.mes && a.dia === b.dia;
}

/** «de 10:00 a 12:00»; en catalán, «d’11:00 a 13:00». @param {PartesFecha} desde @param {PartesFecha} hasta
 * @param {IdiomaFecha} idioma */
function deHoraAHora(desde, hasta, idioma) {
  const de = idioma === 'ca' && HORAS_CON_APOSTROFO.includes(desde.hora) ? 'd’' : 'de ';
  return `${de}${horaEnFrase(desde)} a ${horaEnFrase(hasta)}`;
}

/** «hasta las 12:00» y «fins a les 12:00»; a la una, «hasta la 1:00» y «fins a la 1:00».
 * @param {PartesFecha} p @param {IdiomaFecha} idioma */
function hastaLaHora(p, idioma) {
  const articulo = p.hora === LA_UNA ? 'la' : { es: 'las', ca: 'les' }[idioma];
  return `${idioma === 'ca' ? 'fins a' : 'hasta'} ${articulo} ${horaEnFrase(p)}`;
}

/** Un periodo que empieza y acaba el mismo día. @param {FechaLeida} desde @param {FechaLeida} hasta
 * @param {IdiomaFecha} idioma */
function periodoDeUnDia(desde, hasta, idioma) {
  const dia = fechaLarga(desde.partes, idioma);
  const misma = horaEnFrase(desde.partes) === horaEnFrase(hasta.partes);
  if (desde.conHora && hasta.conHora && !misma) {
    return `${dia}, ${deHoraAHora(desde.partes, hasta.partes, idioma)}`;
  }
  if (!desde.conHora && hasta.conHora) {
    return `${dia}, ${hastaLaHora(hasta.partes, idioma)}`;
  }
  return escrita(desde, idioma);
}

/**
 * Días completos: «del 1 al 30 de noviembre de 2026», «del 1 de enero al 31 de diciembre de 2026» y, si cambia el
 * año, «del 1 de diciembre de 2025 al 31 de enero de 2026»; en catalán, «de l’1 de gener al 31 de desembre del 2026».
 * @param {PartesFecha} desde @param {PartesFecha} hasta @param {IdiomaFecha} idioma
 */
function intervaloDeDias(desde, hasta, idioma) {
  let primero = String(desde.dia);
  if (desde.anio !== hasta.anio) {
    primero = fechaLarga(desde, idioma);
  } else if (desde.mes !== hasta.mes) {
    primero = diaYMesEnFrase(desde, idioma);
  }
  return `${conArticulo(primero, desde.dia, idioma, 'de')} ${conArticulo(fechaLarga(hasta, idioma), hasta.dia, idioma, 'al')}`;
}

/**
 * Un periodo con sus dos extremos, en minúscula para ir tras una etiqueta («Acceso al aula: del 1 de enero…»). Un solo
 * día se dice una vez; varios días con horas reales llevan cada hora junto a su día.
 * @param {string} inicio @param {string} fin @param {IdiomaFecha} idioma
 */
export function periodoDeCurso(inicio, fin, idioma) {
  const desde = leerFechaPublicada(inicio);
  const hasta = leerFechaPublicada(fin);
  return conAvisoDeHuso(periodoEscrito(desde, hasta, idioma), [desde, hasta], idioma);
}

/** @param {FechaLeida} desde @param {FechaLeida} hasta @param {IdiomaFecha} idioma */
function periodoEscrito(desde, hasta, idioma) {
  if (mismoDia(desde.partes, hasta.partes)) {
    return periodoDeUnDia(desde, hasta, idioma);
  }
  if (desde.conHora || hasta.conHora) {
    const de = conArticulo(escrita(desde, idioma), desde.partes.dia, idioma, 'de');
    return `${de} ${conArticulo(escrita(hasta, idioma), hasta.partes.dia, idioma, 'al')}`;
  }
  return intervaloDeDias(desde.partes, hasta.partes, idioma);
}

/** El mismo texto con la primera letra en mayúscula, para cuando va solo: «Del 1 al 30 de noviembre de 2026».
 * @param {string} texto */
export function conMayuscula(texto) {
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
}
