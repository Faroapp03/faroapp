/** Calendario estándar (iCalendar, RFC 5545) con las sesiones del plan. Se compone en el navegador y se descarga
 * como archivo: no pasa por ningún servidor. Los días de estudio propios no tienen hora (la persona solo dio días y
 * minutos), así que van como eventos de día completo; las sesiones publicadas con zona declarada van con su hora en
 * la zona de Madrid. Una sesión sin zona no se exporta: fijarle una hora sería inventarla. */
import { TEXTOS_FORMACION as CA } from '../../../idiomas/ca/formacion.js';
import { TEXTOS_FORMACION as ES } from '../../../idiomas/es/formacion.js';
import { crear } from '../../dom.js';
import { fechaIso, partesEnZona, ZONA_BARCELONA } from '../../fechas.js';
import { duracionDeEstudio } from './duracion-de-estudio.js';
import { horaConZonaValida } from './vista-agenda.js';

/** @import { PlanElegido } from './contrato.js' */
/** @typedef {NonNullable<ReturnType<typeof import('./agenda.js').crearAgenda>['cronograma']>} Cronograma */
const ZONA = ZONA_BARCELONA;
const OCTETOS_POR_LINEA = 75;
const DIA_MS = 86_400_000;
const MARGEN_DE_DESCARGA_MS = 60_000;
// Reglas vigentes de la hora oficial peninsular: CET en invierno y CEST del último domingo de marzo al de octubre.
const ZONA_MADRID = [
  'BEGIN:VTIMEZONE',
  `TZID:${ZONA}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];
/** @param {string} texto */
function escapar(texto) {
  return texto.replace(/[\\;,]/gu, (c) => `\\${c}`).replace(/\r\n|\r|\n/gu, '\\n');
}
/** Pliega cada línea a 75 octetos sin partir un carácter, como pide la norma.
 * @param {string} linea */
function plegar(linea) {
  const codificador = new TextEncoder();
  const partes = [];
  let actual = '';
  let octetos = 0;
  for (const caracter of linea) {
    const tamano = codificador.encode(caracter).length;
    const limite = partes.length === 0 ? OCTETOS_POR_LINEA : OCTETOS_POR_LINEA - 1;
    if (octetos + tamano > limite) {
      partes.push(actual);
      actual = '';
      octetos = 0;
    }
    actual += caracter;
    octetos += tamano;
  }
  partes.push(actual);
  return partes.join('\r\n ');
}
/** @param {string} instante */
function utc(instante) {
  return new Date(instante)
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');
}
/** @param {string} instante */
function horaEnMadrid(instante) {
  const partes = partesEnZona(instante, ZONA);
  const [hora, minuto, segundo] = [partes.hora, partes.minuto, partes.segundo].map((n) => String(n).padStart(2, '0'));
  return `${fechaIso(partes).replace(/-/gu, '')}T${hora}${minuto}${segundo}`;
}
/** @param {string} dia AAAA-MM-DD */
function diaCompleto(dia) {
  const siguiente = new Date(Date.parse(`${dia}T12:00:00Z`) + DIA_MS).toISOString().slice(0, 10);
  return [`DTSTART;VALUE=DATE:${dia.replace(/-/gu, '')}`, `DTEND;VALUE=DATE:${siguiente.replace(/-/gu, '')}`];
}
/** Una sesión se exporta si su inicio tiene zona, no es anterior a la confirmación y, si tiene fin, acaba después.
 * @param {{inicio:string|null,fin:string|null}} sesion @param {number} desde */
function sesionExportable(sesion, desde) {
  if (!sesion.inicio || !horaConZonaValida(sesion.inicio) || Date.parse(sesion.inicio) < desde) {
    return false;
  }
  return !sesion.fin || !horaConZonaValida(sesion.fin) || Date.parse(sesion.fin) > Date.parse(sesion.inicio);
}
/** Cada evento: el día de estudio o la sesión, con el curso, su ficha oficial y la nota de quién lo fija. Un día de
 * estudio es una propuesta de Faro y queda libre en la agenda; una sesión la publica el proveedor y ocupa su hora.
 * @param {PlanElegido} plan @param {Cronograma} cronograma @returns {string[][]} */
function eventosDelPlan(plan, cronograma) {
  const d = plan.idioma === 'ca' ? CA : ES;
  const sello = utc(plan.confirmadoEl);
  /** @type {string[][]} */
  const eventos = [];
  /** @param {number} indice @param {string[]} cuerpo @param {{resumen:string,nota:string,ocupa:boolean}} tipo */
  const evento = (indice, cuerpo, { resumen, nota, ocupa }) => {
    const opcion = plan.elecciones[indice];
    if (!opcion) {
      throw new TypeError('Curso del calendario no válido');
    }
    eventos.push([
      'BEGIN:VEVENT',
      `UID:faro-${sello}-${eventos.length + 1}@faroapp.org`,
      `DTSTAMP:${sello}`,
      ...cuerpo,
      `SUMMARY:${escapar(`${resumen} · ${opcion.oferta.titulo_programa}`)}`,
      `URL:${new URL(opcion.oferta.url).href}`,
      `DESCRIPTION:${escapar(`${nota}\n${d['formacion.calendario.ficha']}: ${opcion.oferta.url}`)}`,
      `TRANSP:${ocupa ? 'OPAQUE' : 'TRANSPARENT'}`,
      'END:VEVENT',
    ]);
  };
  for (const reserva of cronograma.semanas.flatMap((semana) => semana.slots)) {
    const resumen = `${d['formacion.calendario.estudio']} (${duracionDeEstudio(reserva.minutos)})`;
    evento(reserva.indice, diaCompleto(reserva.fecha), { resumen, nota: d['formacion.calendario.nota'], ocupa: false });
  }
  const desde = Date.parse(plan.confirmadoEl);
  const sesion = {
    resumen: d['formacion.calendario.sesion'],
    nota: d['formacion.calendario.nota-sesion'],
    ocupa: true,
  };
  for (const publicada of cronograma.sesiones.filter((s) => sesionExportable(s, desde))) {
    const fin =
      publicada.fin && horaConZonaValida(publicada.fin) ? [`DTEND;TZID=${ZONA}:${horaEnMadrid(publicada.fin)}`] : [];
    evento(publicada.indice, [`DTSTART;TZID=${ZONA}:${horaEnMadrid(publicada.inicio ?? '')}`, ...fin], sesion);
  }
  return eventos;
}
/** @param {PlanElegido} plan @param {Cronograma} cronograma @returns {string} */
export function calendarioDelPlan(plan, cronograma) {
  const eventos = eventosDelPlan(plan, cronograma);
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Faro//Plan de formacion//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...ZONA_MADRID,
    ...eventos.flat(),
    'END:VCALENDAR',
  ];
  return `${lineas.map(plegar).join('\r\n')}\r\n`;
}
/** Botón de pantalla que descarga el calendario; no se imprime.
 * @param {PlanElegido} plan @param {Cronograma} cronograma */
export function botonDelCalendario(plan, cronograma) {
  const d = plan.idioma === 'ca' ? CA : ES;
  const boton = crear('button', {
    type: 'button',
    className: 'rc-boton-secundario pe-calendario-ics',
    textContent: d['formacion.calendario.boton'],
  });
  boton.addEventListener('click', () => {
    const archivo = new Blob([calendarioDelPlan(plan, cronograma)], { type: 'text/calendar;charset=utf-8' });
    const direccion = URL.createObjectURL(archivo);
    const enlace = crear('a', { href: direccion, download: 'faro-plan-de-formacion.ics' });
    enlace.click();
    // Algunos navegadores (Safari en iOS) leen el archivo después del clic: se libera tras un margen o al salir.
    let liberado = false;
    const liberar = () => {
      if (!liberado) {
        liberado = true;
        URL.revokeObjectURL(direccion);
      }
    };
    setTimeout(liberar, MARGEN_DE_DESCARGA_MS);
    window.addEventListener('pagehide', liberar, { once: true });
  });
  return crear(
    'div',
    { className: 'pe-calendario-exportar' },
    crear('p', { className: 'pe-nota', textContent: d['formacion.calendario.ayuda'] }),
    boton,
  );
}
