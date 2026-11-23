// La persona de la entidad lee las fechas en hora de Cataluña y en forma relativa; la hora universal (UTC) solo se
// enseña en el detalle técnico, que es donde se coteja con los registros del servidor.
import {
  conArticulo,
  fechaCorta,
  fechaNumerica,
  horaEnFrase,
  horaEscrita,
  partesEnZona,
  ZONA_BARCELONA,
} from '../scripts/fechas.js';
import { idiomaActual, texto } from '../scripts/textos.js';

const DIA_MS = 86_400_000;
const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @typedef {import('../scripts/fechas.js').PartesFecha} PartesFecha */

/** @param {number|string|Date} entrada @returns {number} */
function instanteDe(entrada) {
  const instante = typeof entrada === 'string' ? Date.parse(entrada) : Number(entrada);
  // Un número fuera del rango de Date no es una fecha: se trata como no representable, no como un error.
  return Number.isNaN(new Date(instante).getTime()) ? Number.NaN : instante;
}
/** Cataluña tiene la hora de Barcelona. @param {number} instante @returns {PartesFecha} */
function partesEnCataluna(instante) {
  return partesEnZona(instante, ZONA_BARCELONA);
}
/** Días de calendario entre dos fechas locales; no depende de que el día tenga 23, 24 o 25 horas.
 * @param {Pick<PartesFecha,'anio'|'mes'|'dia'>} desde @param {Pick<PartesFecha,'anio'|'mes'|'dia'>} hasta */
function diasDeCalendario(desde, hasta) {
  return Math.round(
    (Date.UTC(hasta.anio, hasta.mes - 1, hasta.dia) - Date.UTC(desde.anio, desde.mes - 1, desde.dia)) / DIA_MS,
  );
}
/** El día dentro de la frase relativa, con su nombre y su artículo: «el 11 nov. 2026», «l’1 de des. del 2026».
 * @param {Pick<PartesFecha,'anio'|'mes'|'dia'>} partes */
function elDia(partes) {
  const idioma = idiomaActual() === 'ca' ? 'ca' : 'es';
  return conArticulo(fechaCorta(partes, idioma), partes.dia, idioma, 'el');
}
/** «A la 1:10» en singular y «a las 6:10» en plural, como se dice en castellano y en catalán; en una frase, la hora va
 * sin cero delante.
 * @param {PartesFecha} partes */
function horaLegible(partes) {
  const clave = partes.hora === 1 ? 'panel.fecha.a-la' : 'panel.fecha.a-las';
  return texto(clave, { hora: horaEnFrase(partes) });
}
/** @param {number} dias @param {string} prefijo @param {Record<string,string|number>} valores */
function relativo(dias, prefijo, valores) {
  if (dias === 0) {
    return texto(`${prefijo}.hoy`, valores);
  }
  if (dias === -1) {
    return texto(`${prefijo}.ayer`, valores);
  }
  if (dias === 1) {
    return texto(`${prefijo}.manana`, valores);
  }
  return dias < 0
    ? texto(`${prefijo}.pasado`, { ...valores, dias: -dias })
    : texto(`${prefijo}.futuro`, { ...valores, dias });
}

/** Instante en hora de Cataluña y en forma relativa a `ahora`: «hoy a las 6:10», «hace 3 días, el 11/11/2026…».
 * @param {number|string|Date} entrada @param {number} [ahora] */
export function fechaPanel(entrada, ahora = Date.now()) {
  const instante = instanteDe(entrada);
  if (!Number.isFinite(instante) || !Number.isFinite(ahora)) {
    return texto('panel.fecha-no-representable');
  }
  const partes = partesEnCataluna(instante);
  const dias = diasDeCalendario(partesEnCataluna(ahora), partes);
  return relativo(dias, 'panel.fecha', { hora: horaLegible(partes), fecha: elDia(partes) });
}
/** Año, mes y día de un AAAA-MM-DD que exista en el calendario; un 30 de febrero no se normaliza a marzo.
 * @param {string} dia */
function partesDelDia(dia) {
  const [, anio, mes, numero] = DIA_ISO.exec(dia) ?? [];
  if (!anio) {
    return null;
  }
  const partes = { anio: Number(anio), mes: Number(mes), dia: Number(numero) };
  const fecha = new Date(Date.UTC(partes.anio, partes.mes - 1, partes.dia));
  const existe = fecha.getUTCFullYear() === partes.anio && fecha.getUTCMonth() === partes.mes - 1;
  return existe && fecha.getUTCDate() === partes.dia ? partes : null;
}
/** Un día que el servidor agrupa en UTC, sin forma relativa: «hoy» en Cataluña puede ser otro día UTC.
 * @param {string} dia */
export function diaUtc(dia) {
  const partes = partesDelDia(dia);
  return partes ? fechaNumerica(partes) : texto('panel.fecha-no-representable');
}
/** Un día de calendario (AAAA-MM-DD) frente al día de hoy en Cataluña; no se le aplica zona porque no tiene hora.
 * @param {string} dia @param {number} [ahora] */
export function diaPanel(dia, ahora = Date.now()) {
  const partes = partesDelDia(dia);
  if (!partes || !Number.isFinite(ahora)) {
    return texto('panel.fecha-no-representable');
  }
  const dias = diasDeCalendario(partesEnCataluna(ahora), partes);
  return relativo(dias, 'panel.dia', { fecha: elDia(partes) });
}
/** Para el detalle técnico: la fecha en hora de Cataluña y, entre paréntesis, el registro tal como lo guarda el
 * servidor (en UTC y sin redondear), para poder cotejarlo con la evidencia.
 * @param {number|string|Date} entrada @param {number} [ahora] */
export function fechaConUtc(entrada, ahora = Date.now()) {
  const instante = instanteDe(entrada);
  if (!Number.isFinite(instante)) {
    return texto('panel.fecha-no-representable');
  }
  const registro = typeof entrada === 'string' ? entrada : new Date(instante).toISOString();
  return `${fechaPanel(instante, ahora)} (${texto('panel.fecha.utc', { fecha: registro })})`;
}
/** Fecha de un detalle técnico, con el registro original al lado para cotejarlo. Un día sin hora no se pasa por zona:
 * se dice en forma relativa y con el día registrado.
 * @param {string|number|null|undefined} valor @param {string} [ausente] Clave del texto que se muestra sin fecha.
 * @param {number} [ahora] */
export function fechaTecnica(valor, ausente = 'panel.sin-registro', ahora = Date.now()) {
  if (valor === null || valor === undefined) {
    return texto(ausente);
  }
  if (typeof valor === 'string' && DIA_ISO.test(valor)) {
    return `${diaPanel(valor, ahora)} (${texto('panel.fecha.registro-dia', { fecha: valor })})`;
  }
  return fechaConUtc(valor, ahora);
}
/** Fecha y hora absolutas en hora de Cataluña («20/11/2026 10:00»), para lo que se guarda y se relee otro día.
 * @param {number|string|Date} entrada */
export function fechaAbsoluta(entrada) {
  const instante = instanteDe(entrada);
  if (!Number.isFinite(instante)) {
    return texto('panel.fecha-no-representable');
  }
  const partes = partesEnCataluna(instante);
  return `${fechaNumerica(partes)} ${horaEscrita(partes)}`;
}
