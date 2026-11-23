import {
  conArticulo,
  fechaCorta,
  fechaCortaConHora,
  partesDelDia,
  partesEnZona,
  partesUtc,
  ZONA_BARCELONA,
} from '../../fechas.js';

/** Textos propios de la agenda. Los títulos y hechos de los proveedores conservan su lengua original. */
const ES = {
  acreditacion: 'Acreditar tu experiencia',
  acreditacionOcupacion: 'Relacionado con tu ocupación',
  acreditacionGrupo: 'Relacionado con tu grupo de ocupaciones',
  acreditacionPaso: 'Siguiente paso: consulta requisitos y solicita orientación. La agencia evalúa las competencias.',
  acreditacionNorma: 'Norma del certificado',
  objetivo: 'Tu objetivo',
  nivel: 'Nivel en IA',
  nivelDigital: 'Nivel digital',
  inicial: 'Inicial',
  intermedio: 'Intermedio',
  avanzado: 'Avanzado',
  idiomas: 'Idiomas',
  modalidad: 'Modalidad',
  cualquiera: 'Sin preferencia',
  'en-linea': 'En línea',
  presencial: 'Presencial',
  inicio: 'Inicio propuesto',
  noConsta: 'No consta',
  certificadoGeneral: 'Gratuito según condiciones generales del proveedor',
  certificadoFicha: 'Gratuito según la ficha publicada',
  certificadoMaterial: 'Gratuito según el material observado',
  condicionesGenerales: 'según condiciones generales del proveedor',
  materialObservado: 'según el material observado',
  comprobado: 'Comprobado',
  alcance: 'Elegir un curso no garantiza la admisión ni el certificado. Inscríbete con el proveedor.',
  hoja: 'Hoja',
  de: 'de',
};
const CA = {
  acreditacion: 'Acreditar la teva experiència',
  acreditacionOcupacion: 'Relacionat amb la teva ocupació',
  acreditacionGrupo: 'Relacionat amb el teu grup d’ocupacions',
  acreditacionPaso: 'Pas següent: consulta els requisits i demana orientació. L’agència avalua les competències.',
  acreditacionNorma: 'Norma del certificat',
  objetivo: 'El teu objectiu',
  nivel: 'Nivell en IA',
  nivelDigital: 'Nivell digital',
  inicial: 'Inicial',
  intermedio: 'Intermedi',
  avanzado: 'Avançat',
  idiomas: 'Idiomes',
  modalidad: 'Modalitat',
  cualquiera: 'Sense preferència',
  'en-linea': 'En línia',
  presencial: 'Presencial',
  inicio: 'Inici proposat',
  noConsta: 'No consta',
  certificadoGeneral: 'Gratuït segons les condicions generals del proveïdor',
  certificadoFicha: 'Gratuït segons la fitxa publicada',
  certificadoMaterial: 'Gratuït segons el material observat',
  condicionesGenerales: 'segons les condicions generals del proveïdor',
  materialObservado: 'segons el material observat',
  comprobado: 'Comprovat',
  alcance: 'Triar un curs no garanteix l’admissió ni el certificat. Inscriu-te amb el proveïdor.',
  hoja: 'Full',
  de: 'de',
};
/** @param {'es'|'ca'} idioma @param {keyof typeof ES} clave */
export function textoDocumento(idioma, clave) {
  return (idioma === 'ca' ? CA : ES)[clave];
}
/** Un día civil (AAAA-MM-DD) tal cual, o el día UTC de un instante. @param {string} fecha @param {'es'|'ca'} idioma */
export function fechaDelPlan(fecha, idioma) {
  return fechaCorta(fecha.length === 10 ? partesDelDia(fecha) : partesUtc(fecha), idioma);
}

/** Un instante con zona explícita, en el formato único del documento y en hora de Barcelona.
 * @param {string} instante @param {'es'|'ca'} idioma @param {{conHora?: boolean}} [opciones] */
export function fechaEnBarcelona(instante, idioma, { conHora = false } = {}) {
  const partes = partesEnZona(instante, ZONA_BARCELONA);
  return conHora ? fechaCortaConHora(partes, idioma) : fechaCorta(partes, idioma);
}

/** Una fecha oficial con hora y huso: la hora escrita (HH:MM) y el huso (Z, +HH:MM o -00:00 si no se conoce). */
const HORA_OFICIAL = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u;
/** -00:00 dice que el huso no se conoce. */
const HUSO_DESCONOCIDO = '-00:00';

/** Una hora con zona declarada se pasa a la de Barcelona; sin zona (-00:00) se conserva la hora escrita y se dice que
 * falta el huso, porque convertirla sería inventarlo.
 * @param {string} fecha @param {'es'|'ca'} idioma */
export function fechaOficial(fecha, idioma) {
  const hora = HORA_OFICIAL.exec(fecha);
  if (!hora) {
    return fechaDelPlan(fecha.slice(0, 10), idioma);
  }
  if (hora[2] === HUSO_DESCONOCIDO) {
    const dia = fechaDelPlan(fecha.slice(0, 10), idioma);
    return `${dia}, ${hora[1]} (${idioma === 'ca' ? 'fus horari per confirmar' : 'huso horario por confirmar'})`;
  }
  return fechaEnBarcelona(fecha, idioma, { conHora: true });
}

/** El día del mes que escribe fechaOficial: el de Barcelona si la hora trae huso, y si no, el escrito. @param {string} fecha */
function diaDeLaFechaOficial(fecha) {
  const huso = HORA_OFICIAL.exec(fecha)?.[2];
  return huso && huso !== HUSO_DESCONOCIDO
    ? partesEnZona(fecha, ZONA_BARCELONA).dia
    : partesDelDia(fecha.slice(0, 10)).dia;
}

/** fechaOficial dentro de una frase, con su artículo: «el 25 oct. 2026», «l’1 d’oct. del 2026».
 * @param {string} fecha @param {'es'|'ca'} idioma @param {'el'|'al'|'hasta'|'desde'|'de'} forma */
export function fechaOficialEnFrase(fecha, idioma, forma) {
  return conArticulo(fechaOficial(fecha, idioma), diaDeLaFechaOficial(fecha), idioma, forma);
}
