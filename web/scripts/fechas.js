// Generado desde src/comun/fechas.js; no editar esta copia.
// Las fechas, las horas y los nombres de idiomas que Faro escribe, en la web y en el informe, iguales en cualquier
// navegador y en Node. Cada motor trae sus propios nombres de meses, de días y de idiomas y sus propios patrones (en
// catalán, WebKit escribe «25 oct. 2026» donde Chromium escribe «25 d’oct. del 2026»), así que del navegador solo se
// toman números: año, mes, día, hora y minuto en la zona pedida. Los nombres, las preposiciones, los artículos y el
// orden salen de las tablas de este módulo, en castellano y en catalán.

/** @typedef {'es'|'ca'} IdiomaFecha */
/**
 * Un instante leído en una zona: el mes va de 1 a 12 y el día de la semana, de 1 (lunes) a 7 (domingo).
 * @typedef {Readonly<{anio:number,mes:number,dia:number,hora:number,minuto:number,segundo:number,diaSemana:number}>} PartesFecha
 */

/** La zona en la que Faro enseña los instantes: la hora de Barcelona. */
export const ZONA_BARCELONA = 'Europe/Madrid';

const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DIAS_SEMANA = 7;
const CIFRAS_DEL_ANIO = 4;
const MEDIODIA = 12;
const LA_UNA = 1;
/** Las vocales (y la hache muda) ante las que el catalán apostrofa la preposición: «d’abril», «d’oct.». */
const APOSTROFA = /^[aeiouàèéíòóúh]/u;

/** Los meses y los días de la semana, abreviados (con su punto, como pide la norma) y completos, por idioma. */
const NOMBRES = /* @__PURE__ */ Object.freeze({
  es: /* @__PURE__ */ Object.freeze({
    mesCorto: ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'],
    mes: [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ],
    diaCorto: ['lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.', 'dom.'],
    dia: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
  }),
  ca: /* @__PURE__ */ Object.freeze({
    mesCorto: ['gen.', 'febr.', 'març', 'abr.', 'maig', 'juny', 'jul.', 'ag.', 'set.', 'oct.', 'nov.', 'des.'],
    mes: [
      'gener',
      'febrer',
      'març',
      'abril',
      'maig',
      'juny',
      'juliol',
      'agost',
      'setembre',
      'octubre',
      'novembre',
      'desembre',
    ],
    diaCorto: ['dl.', 'dt.', 'dc.', 'dj.', 'dv.', 'ds.', 'dg.'],
    dia: ['dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge'],
  }),
});

/** Los doce meses con su nombre completo, en el idioma pedido. @param {IdiomaFecha} idioma @returns {readonly string[]} */
export function nombresDeLosMeses(idioma) {
  return Object.freeze([...NOMBRES[idioma].mes]);
}

/** El nombre completo de un día de la semana, de 1 (lunes) a 7 (domingo). @param {number} dia @param {IdiomaFecha} idioma */
export function nombreDelDia(dia, idioma) {
  return String(NOMBRES[idioma].dia[dia - 1]);
}

/** «hasta» un mes en catalán, con la contracción y el apóstrofo: «al juny», «a l’abril». @param {string} nombre */
export function alMesCatalan(nombre) {
  return APOSTROFA.test(nombre) ? `a l’${nombre}` : `al ${nombre}`;
}

/** Los lectores de números por zona: crear uno cuesta más que usarlo. @type {Map<string, Intl.DateTimeFormat>} */
const LECTORES = new Map();

/** @param {string} zona */
function lectorDeZona(zona) {
  let lector = LECTORES.get(zona);
  if (!lector) {
    // Solo campos numéricos, en cifras latinas y con horas de 0 a 23: de aquí no sale ningún nombre ni patrón.
    lector = new Intl.DateTimeFormat('en-GB', {
      timeZone: zona,
      numberingSystem: 'latn',
      calendar: 'gregory',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    LECTORES.set(zona, lector);
  }
  return lector;
}

/**
 * El mediodía UTC de una fecha civil. Date.UTC lleva los años 0 a 99 al siglo XX; setUTCFullYear no.
 * @param {number} anio @param {number} mes @param {number} dia
 */
function mediodiaUtc(anio, mes, dia) {
  const fecha = new Date(0);
  fecha.setUTCFullYear(anio, mes - 1, dia);
  return fecha.setUTCHours(MEDIODIA);
}

/** El día de la semana de una fecha civil, por aritmética UTC. @param {number} anio @param {number} mes @param {number} dia */
function diaDeLaSemana(anio, mes, dia) {
  return new Date(mediodiaUtc(anio, mes, dia)).getUTCDay() || DIAS_SEMANA;
}

/** Los números leídos, con su día de la semana. @param {Omit<PartesFecha, 'diaSemana'>} leidas @returns {PartesFecha} */
function partes(leidas) {
  return Object.freeze({ ...leidas, diaSemana: diaDeLaSemana(leidas.anio, leidas.mes, leidas.dia) });
}

/** @param {number|string|Date} entrada */
function instanteValido(entrada) {
  const instante = entrada instanceof Date ? entrada.getTime() : new Date(entrada).getTime();
  if (!Number.isFinite(instante)) {
    throw new TypeError('La fecha no es válida');
  }
  return instante;
}

/**
 * Un instante leído en una zona horaria (por defecto, la de Barcelona).
 * @param {number|string|Date} entrada @param {string} [zona] @returns {PartesFecha}
 */
export function partesEnZona(entrada, zona = ZONA_BARCELONA) {
  const leidas = lectorDeZona(zona).formatToParts(instanteValido(entrada));
  const campo = (/** @type {Intl.DateTimeFormatPartTypes} */ tipo) =>
    Number(leidas.find((parte) => parte.type === tipo)?.value);
  return partes({
    anio: campo('year'),
    mes: campo('month'),
    dia: campo('day'),
    hora: campo('hour'),
    minuto: campo('minute'),
    segundo: campo('second'),
  });
}

/** Un instante en la hora del dispositivo de quien lee la página. @param {number|string|Date} entrada @returns {PartesFecha} */
export function partesLocales(entrada) {
  const fecha = new Date(instanteValido(entrada));
  return partes({
    anio: fecha.getFullYear(),
    mes: fecha.getMonth() + 1,
    dia: fecha.getDate(),
    hora: fecha.getHours(),
    minuto: fecha.getMinutes(),
    segundo: fecha.getSeconds(),
  });
}

/** Un instante en hora universal (UTC), sin pasar por zona. @param {number|string|Date} entrada @returns {PartesFecha} */
export function partesUtc(entrada) {
  const fecha = new Date(instanteValido(entrada));
  return partes({
    anio: fecha.getUTCFullYear(),
    mes: fecha.getUTCMonth() + 1,
    dia: fecha.getUTCDate(),
    hora: fecha.getUTCHours(),
    minuto: fecha.getUTCMinutes(),
    segundo: fecha.getUTCSeconds(),
  });
}

/** Una fecha civil AAAA-MM-DD que exista en el calendario; un 30 de febrero no se normaliza a marzo. @param {string} dia @returns {PartesFecha} */
export function partesDelDia(dia) {
  const [, anio, mes, numero] = DIA_ISO.exec(dia) ?? [];
  const leidas = anio ? partesUtc(mediodiaUtc(Number(anio), Number(mes), Number(numero))) : null;
  if (!leidas || leidas.anio !== Number(anio) || leidas.mes !== Number(mes) || leidas.dia !== Number(numero)) {
    throw new TypeError('La fecha no es válida');
  }
  return leidas;
}

/** @param {number} valor */
const dosCifras = (valor) => String(valor).padStart(2, '0');

/** El día en la forma AAAA-MM-DD, la que se compara y se guarda. @param {PartesFecha} p */
export function fechaIso(p) {
  return `${String(p.anio).padStart(CIFRAS_DEL_ANIO, '0')}-${dosCifras(p.mes)}-${dosCifras(p.dia)}`;
}

/** La hora con dos cifras y de 0 a 23: «09:05». @param {PartesFecha} p */
export function horaEscrita(p) {
  return `${dosCifras(p.hora)}:${dosCifras(p.minuto)}`;
}

/** «05/01/2026», el día en cifras. @param {Pick<PartesFecha, 'anio'|'mes'|'dia'>} p */
export function fechaNumerica(p) {
  return `${dosCifras(p.dia)}/${dosCifras(p.mes)}/${p.anio}`;
}

/** «05/01/2026, 09:05», el día en cifras y la hora. @param {PartesFecha} p */
export function fechaNumericaConHora(p) {
  return `${fechaNumerica(p)}, ${horaEscrita(p)}`;
}

/** En catalán, «de» ante consonante y «d’» ante vocal: «de nov.», «d’oct.». @param {string} nombre */
function deCatalan(nombre) {
  return APOSTROFA.test(nombre) ? `d’${nombre}` : `de ${nombre}`;
}

/** El día y el mes: «25 oct.» y «25 d’oct.»; con `completo`, «25 de octubre» y «25 d’octubre».
 * @param {Pick<PartesFecha, 'anio'|'mes'|'dia'>} p @param {IdiomaFecha} idioma @param {boolean} completo */
function diaYMes(p, idioma, completo) {
  const nombre = String(NOMBRES[idioma][completo ? 'mes' : 'mesCorto'][p.mes - 1]);
  if (idioma === 'ca') {
    return `${p.dia} ${deCatalan(nombre)}`;
  }
  return completo ? `${p.dia} de ${nombre}` : `${p.dia} ${nombre}`;
}

/** El día y el mes completos, sin el año, para el comienzo de un intervalo: «1 de enero», «1 de gener», «12 d’abril».
 * @param {Pick<PartesFecha, 'anio'|'mes'|'dia'>} p @param {IdiomaFecha} idioma */
export function diaYMesEnFrase(p, idioma) {
  return diaYMes(p, idioma, true);
}

/** El año tras el mes: «2026» tras un mes abreviado en castellano, «de 2026» tras uno completo y «del 2026» en catalán.
 * @param {Pick<PartesFecha, 'anio'|'mes'|'dia'>} p @param {IdiomaFecha} idioma @param {boolean} completo */
function anioTrasElMes(p, idioma, completo) {
  if (idioma === 'ca') {
    return `del ${p.anio}`;
  }
  return completo ? `de ${p.anio}` : String(p.anio);
}

/** «25 oct. 2026» y «25 d’oct. del 2026». @param {Pick<PartesFecha, 'anio'|'mes'|'dia'>} p @param {IdiomaFecha} idioma */
export function fechaCorta(p, idioma) {
  return `${diaYMes(p, idioma, false)} ${anioTrasElMes(p, idioma, false)}`;
}

/** «31 dic. 2026, 23:59» y «31 de des. del 2026, 23:59». @param {PartesFecha} p @param {IdiomaFecha} idioma */
export function fechaCortaConHora(p, idioma) {
  return `${fechaCorta(p, idioma)}, ${horaEscrita(p)}`;
}

/** «mié., 25 nov.» y «dc., 25 de nov.», para las filas de una agenda. @param {PartesFecha} p @param {IdiomaFecha} idioma */
export function diaDeAgenda(p, idioma) {
  return `${NOMBRES[idioma].diaCorto[p.diaSemana - 1]}, ${diaYMes(p, idioma, false)}`;
}

/** «25 de noviembre de 2026» y «25 de novembre del 2026». @param {PartesFecha} p @param {IdiomaFecha} idioma */
export function fechaLarga(p, idioma) {
  return `${diaYMes(p, idioma, true)} ${anioTrasElMes(p, idioma, true)}`;
}

/** «miércoles, 25 de noviembre de 2026» y «dimecres, 25 de novembre del 2026». @param {PartesFecha} p @param {IdiomaFecha} idioma */
export function fechaCompleta(p, idioma) {
  return `${NOMBRES[idioma].dia[p.diaSemana - 1]}, ${fechaLarga(p, idioma)}`;
}

/** El mes dentro de una frase: «agosto de 2026»; en catalán, con su artículo, «l’agost del 2026» y «el juny del 2026».
 * @param {PartesFecha} p @param {IdiomaFecha} idioma */
export function mesYAnioEnFrase(p, idioma) {
  const nombre = NOMBRES[idioma].mes[p.mes - 1];
  if (idioma === 'es') {
    return mesYAnio(p, idioma);
  }
  return `${APOSTROFA.test(String(nombre)) ? 'l’' : 'el '}${mesYAnio(p, idioma)}`;
}

/** «noviembre de 2026» y «novembre del 2026», el rótulo de un mes. @param {PartesFecha} p @param {IdiomaFecha} idioma */
export function mesYAnio(p, idioma) {
  return `${NOMBRES[idioma].mes[p.mes - 1]} ${anioTrasElMes(p, idioma, true)}`;
}

/**
 * «25 de noviembre de 2026 a las 9:05» y «25 de novembre del 2026, a les 9:05»; a la una, «a la 1:05» en los dos
 * idiomas, como se dice.
 * @param {PartesFecha} p @param {IdiomaFecha} idioma
 */
export function fechaLargaConHora(p, idioma) {
  return `${fechaLarga(p, idioma)}${idioma === 'ca' ? ',' : ''} ${aLaHora(p, idioma)}`;
}

/** La hora dentro de una frase, sin cero delante: «6:10», «0:30». En cifras y tablas va horaEscrita («06:10»).
 * @param {PartesFecha} p */
export function horaEnFrase(p) {
  return `${p.hora}:${dosCifras(p.minuto)}`;
}

/** «a las 6:10» y «a les 6:10»; a la una, «a la 1:05» en los dos idiomas. @param {PartesFecha} p @param {IdiomaFecha} idioma */
export function aLaHora(p, idioma) {
  if (p.hora === LA_UNA) {
    return `a la ${horaEnFrase(p)}`;
  }
  return `${idioma === 'ca' ? 'a les' : 'a las'} ${horaEnFrase(p)}`;
}

/** Días ante los que el catalán apostrofa el artículo: se leen «u» y «onze» («l’1», «l’11»). */
const EL_U = 1;
const L_ONZE = 11;
const DIAS_CON_APOSTROFO = /* @__PURE__ */ Object.freeze([EL_U, L_ONZE]);

/**
 * Una fecha ya escrita con el artículo y la preposición que le tocan en una frase. `forma` dice cuál: «el» («el 25»),
 * «al» («al 25», «a l’1»), «hasta» («hasta el 25», «fins al 25»), «desde» («desde el 25», «des del 25») o «de» («del 25»). En catalán, ante
 * el 1 y el 11 el artículo se apostrofa: «l’1 d’oct.», «fins a l’1 de des.», «des de l’11 de nov.», «de l’1».
 * @param {string} texto La fecha escrita. @param {number} dia Su día del mes. @param {IdiomaFecha} idioma
 * @param {'el'|'al'|'hasta'|'desde'|'de'} forma
 */
export function conArticulo(texto, dia, idioma, forma) {
  if (idioma === 'es') {
    return `${{ el: 'el', al: 'al', hasta: 'hasta el', desde: 'desde el', de: 'del' }[forma]} ${texto}`;
  }
  const apostrofo = DIAS_CON_APOSTROFO.includes(dia);
  const ante = apostrofo
    ? { el: 'l’', al: 'a l’', hasta: 'fins a l’', desde: 'des de l’', de: 'de l’' }
    : { el: 'el ', al: 'al ', hasta: 'fins al ', desde: 'des del ', de: 'del ' };
  return `${ante[forma]}${texto}`;
}

/** Un código de idioma BCP 47: dos o tres letras y, si las hay, sus subetiquetas («en», «zh-Hant», «es-419»). */
const CODIGO_DE_IDIOMA = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu;

/**
 * Los nombres de los idiomas en que se publican cursos, en castellano y en catalán y en minúscula, como en una frase.
 * No se piden a Intl.DisplayNames: cada navegador trae los suyos («español» o «castellano», según el motor).
 */
const NOMBRES_DE_IDIOMAS = /* @__PURE__ */ Object.freeze({
  es: /* @__PURE__ */ Object.freeze({
    es: 'castellano',
    ca: 'catalán',
    en: 'inglés',
    fr: 'francés',
    de: 'alemán',
    it: 'italiano',
    pt: 'portugués',
    gl: 'gallego',
    eu: 'euskera',
    oc: 'occitano',
  }),
  ca: /* @__PURE__ */ Object.freeze({
    es: 'castellà',
    ca: 'català',
    en: 'anglès',
    fr: 'francès',
    de: 'alemany',
    it: 'italià',
    pt: 'portuguès',
    gl: 'gallec',
    eu: 'basc',
    oc: 'occità',
  }),
});

/**
 * El nombre de un idioma (código BCP 47) en castellano o en catalán: «castellano», «anglès». Una variante regional
 * («en-GB») se nombra por su idioma; un código que no está en la tabla se escribe en mayúsculas, y un texto que no es
 * un código, como viene.
 * @param {string} codigo @param {IdiomaFecha} idioma
 */
export function nombreDelIdioma(codigo, idioma) {
  /** @type {Readonly<Record<string, string>>} */
  const nombres = NOMBRES_DE_IDIOMAS[idioma];
  if (!CODIGO_DE_IDIOMA.test(codigo)) {
    // Un texto del proveedor que no es un código («Francés», «Multilingüe») se escribe como viene.
    return codigo;
  }
  const base = codigo.toLowerCase().split('-')[0] ?? '';
  return Object.hasOwn(nombres, base) ? String(nombres[base]) : codigo.toUpperCase();
}
