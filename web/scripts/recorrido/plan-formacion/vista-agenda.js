import { TEXTOS_FORMACION as CA } from '../../../idiomas/ca/formacion.js';
import { TEXTOS_FORMACION as ES } from '../../../idiomas/es/formacion.js';
import { crear } from '../../dom.js';
import { diaDeAgenda, fechaIso, partesDelDia, partesEnZona, ZONA_BARCELONA } from '../../fechas.js';
import { duracionDeEstudio } from './duracion-de-estudio.js';
import { tituloDelCurso } from './ficha-oferta.js';
import { fechaDelPlan, fechaOficial, fechaOficialEnFrase } from './textos-documento.js';

/** @import { PlanElegido } from './contrato.js' */
/** @typedef {NonNullable<ReturnType<typeof import('./agenda.js').crearAgenda>['cronograma']>} Cronograma */
const MS_DIA = 86_400_000;
const DIAS_INICIALES = 7;
/**
 * La agenda cabe en su hoja por construcción, sea cual sea el plan: tiene un tope de filas. Una fila es lo que ocupa
 * impresa una fecha con bloques de estudio, 22 px, porque la fecha y su tiempo van en una sola línea. Con los textos
 * más largos, la segunda hoja mide 859 px sin ninguna fecha (con sus dos notas fijas) y el área útil de la página es de
 * 1.039 px: siete filas suman 154 px y dejan la hoja en 1.013 px, con 26 px de margen para lo que cada motor mide de
 * más. Con siete filas, un plan que estudia todos los días enseña sus siete primeros días enteros. Lo que no cabe está
 * entero en el calendario que se descarga, y la nota de recorte lo dice.
 */
const FILAS_DE_LA_AGENDA = 7;
/** Una sesión oficial escribe su inicio y su fin con fecha y hora: en la columna de su curso ocupa tres líneas, unos
 * 57 px. Cuenta tres filas (66 px). */
const FILAS_DE_SESION_OFICIAL = 3;
/** La nota de las sesiones sin hora publicada ocupa unos 47 px con su separación: cuenta dos filas (44 px), y los
 * 3 px de más caben en el margen de la hoja. */
const FILAS_DE_LA_NOTA_SIN_HORA = 2;
/** La nota de las fechas que no caben ocupa unos 62 px con dos líneas y 77 con tres, cuando dice cuándo empiezan los
 * cursos que no se ven: cuenta tres filas (66 px), y lo que pasa de ellas cabe en el margen de la hoja. */
const FILAS_DE_LA_NOTA_DE_RECORTE = 3;
/** @typedef {{orden:string,diaMadrid:string,indice:number,oficial:boolean,fecha:string,tiempo:string,minutos:number}} FilaInicial */
/** @param {string|null} fecha @returns {boolean} */
export function horaConZonaValida(fecha) {
  return Boolean(
    fecha &&
      !fecha.endsWith('-00:00') &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(fecha) &&
      Number.isFinite(Date.parse(fecha)),
  );
}
/** @param {string} instante */
function diaEnMadrid(instante) {
  return fechaIso(partesEnZona(instante, ZONA_BARCELONA));
}
/** @param {PlanElegido} plan @param {string|null} fecha */
function sesionFutura(plan, fecha) {
  if (!fecha || !horaConZonaValida(fecha) || !Number.isFinite(Date.parse(plan.confirmadoEl))) {
    return false;
  }
  return diaEnMadrid(fecha) >= plan.preferencias.inicio && Date.parse(fecha) >= Date.parse(plan.confirmadoEl);
}
/** @param {PlanElegido} plan @param {Cronograma} agenda @returns {FilaInicial[]} */
function filasOficiales(plan, agenda) {
  const filas = [];
  const ca = plan.idioma === 'ca';
  for (const sesion of agenda.sesiones) {
    if (!sesionFutura(plan, sesion.inicio)) {
      continue;
    }
    if (!sesion.inicio) {
      continue;
    }
    const sinFin = ca ? 'fi per confirmar' : 'fin por confirmar';
    const tiempo = sesion.fin ? `${ca ? 'fins a' : 'hasta'} ${fechaOficial(sesion.fin, plan.idioma)}` : sinFin;
    filas.push({
      orden: sesion.inicio,
      diaMadrid: diaEnMadrid(sesion.inicio),
      indice: sesion.indice,
      oficial: true,
      fecha: fechaOficial(sesion.inicio, plan.idioma),
      tiempo,
      minutos: 0,
    });
  }
  return filas;
}
/** Todas las fechas del plan, de estudio y oficiales, en orden de fecha y de curso.
 * @param {PlanElegido} plan @param {Cronograma} agenda @returns {FilaInicial[]} */
function filasDelPlan(plan, agenda) {
  const slots = agenda.semanas.flatMap((semana) => semana.slots);
  /** @type {FilaInicial[]} */
  const filas = slots.map((slot) => ({
    orden: slot.fecha,
    diaMadrid: slot.fecha,
    indice: slot.indice,
    oficial: false,
    fecha: fechaDelPlan(slot.fecha, plan.idioma),
    tiempo: duracionDeEstudio(slot.minutos),
    minutos: slot.minutos,
  }));
  filas.push(...filasOficiales(plan, agenda));
  filas.sort((a, b) => {
    const dia = a.diaMadrid.localeCompare(b.diaMadrid);
    if (dia) {
      return dia;
    }
    if (a.oficial && b.oficial) {
      return Date.parse(a.orden) - Date.parse(b.orden) || a.indice - b.indice;
    }
    return Number(a.oficial) - Number(b.oficial) || a.indice - b.indice;
  });
  return filas;
}
/** Los primeros días de cada curso, de estudio y oficiales por separado. @param {FilaInicial[]} filas */
function filasIniciales(filas) {
  return filas.filter((fila) => {
    const primero = filas.find((f) => f.indice === fila.indice && f.oficial === fila.oficial)?.diaMadrid;
    return (
      primero &&
      new Date(`${fila.diaMadrid}T12:00:00Z`).getTime() <
        new Date(`${primero}T12:00:00Z`).getTime() + DIAS_INICIALES * MS_DIA
    );
  });
}
/** @param {PlanElegido} plan @param {FilaInicial[]} filas @param {string} dia */
function filaDia(plan, filas, dia) {
  const partes = partesDelDia(dia);
  const etiqueta = diaDeAgenda(partes, plan.idioma);
  const delDia = filas.filter((fila) => fila.diaMadrid === dia);
  const total = delDia.reduce((suma, fila) => suma + fila.minutos, 0);
  const capacidad = plan.disponibilidad?.dias.includes(partes.diaSemana) ? plan.disponibilidad.minutosPorDia : 0;
  const encabezado = crear(
    'th',
    { scope: 'row' },
    crear('span', { textContent: etiqueta }),
    crear('small', {
      className: 'pe-capacidad-dia',
      textContent: `${duracionDeEstudio(total)} / ${duracionDeEstudio(capacidad)}`,
    }),
  );
  return crear('tr', {}, encabezado, ...[0, 1].map((indice) => celdaCurso(plan, delDia, indice)));
}
/** @param {PlanElegido} plan @param {FilaInicial[]} filas @param {number} indice */
function celdaCurso(plan, filas, indice) {
  return crear(
    'td',
    {},
    ...filas
      .filter((fila) => fila.indice === indice)
      .map((fila) =>
        crear('span', {
          className: `pe-bloque-agenda pe-bloque-${indice}${fila.oficial ? ' pe-bloque-oficial' : ''}`,
          textContent: fila.oficial
            ? `${plan.idioma === 'ca' ? 'Sessió oficial' : 'Sesión oficial'} · ${fila.fecha} · ${fila.tiempo}`
            : fila.tiempo,
        }),
      ),
  );
}
/** Cada fecha aparece una sola vez; las celdas conservan el origen y el tiempo de cada reserva.
 * @param {PlanElegido} plan @param {FilaInicial[]} primeras */
function tablaInicial(plan, primeras) {
  const ca = plan.idioma === 'ca';
  const dias = [...new Set(primeras.map((fila) => fila.diaMadrid))];
  return crear(
    'table',
    { className: 'pe-tabla-agenda' },
    crear(
      'thead',
      {},
      crear(
        'tr',
        {},
        crear('th', { scope: 'col', textContent: ca ? 'Data' : 'Fecha' }),
        ...plan.elecciones.map((_, indice) =>
          crear('th', {
            scope: 'col',
            textContent: `${ca ? 'Curs' : 'Curso'} ${indice + 1}`,
          }),
        ),
      ),
    ),
    crear('tbody', {}, ...dias.map((dia) => filaDia(plan, primeras, dia))),
  );
}
/** Lo que ocupa una fecha: su celda más alta, con cada sesión oficial por lo que mide. @param {FilaInicial[]} delDia */
function filasDeLaFecha(delDia) {
  const celdas = [0, 1].map((indice) =>
    delDia
      .filter((fila) => fila.indice === indice)
      .reduce((suma, fila) => suma + (fila.oficial ? FILAS_DE_SESION_OFICIAL : 1), 0),
  );
  return Math.max(1, ...celdas);
}
/** Las fechas que caben en `disponibles` filas, en su orden y sin saltarse ninguna.
 * @param {string[]} dias @param {FilaInicial[]} filas @param {number} disponibles */
function fechasQueCaben(dias, filas, disponibles) {
  const caben = [];
  let ocupadas = 0;
  for (const dia of dias) {
    ocupadas += filasDeLaFecha(filas.filter((fila) => fila.diaMadrid === dia));
    if (ocupadas > disponibles) {
      break;
    }
    caben.push(dia);
  }
  return caben;
}
/** Las fechas que se ven: todas las primeras si caben; si no, las que caben junto a la nota que dice dónde están las
 * demás. @param {FilaInicial[]} primeras @param {boolean} dudosas */
function fechasVisibles(primeras, dudosas) {
  const dias = [...new Set(primeras.map((fila) => fila.diaMadrid))];
  const disponibles = FILAS_DE_LA_AGENDA - (dudosas ? FILAS_DE_LA_NOTA_SIN_HORA : 0);
  const todas = fechasQueCaben(dias, primeras, disponibles);
  if (todas.length === dias.length) {
    return { dias, recortada: false };
  }
  return { dias: fechasQueCaben(dias, primeras, disponibles - FILAS_DE_LA_NOTA_DE_RECORTE), recortada: true };
}
/** La nota que abre la agenda: qué fechas recoge y cómo se leen. */
const NOTA_DE_LA_AGENDA = {
  es: {
    entera: 'Los primeros siete días de cada curso.',
    recortada: 'Las primeras fechas de tus cursos.',
    lectura:
      'Junto a cada fecha ves el tiempo que te propones dedicar y el que tienes disponible. Las sesiones oficiales se indican aparte.',
  },
  ca: {
    entera: 'Els primers set dies de cada curs.',
    recortada: 'Les primeres dates dels teus cursos.',
    lectura:
      'Al costat de cada data veus el temps que et proposes dedicar-hi i el que tens disponible. Les sessions oficials s’indiquen a part.',
  },
};
/** @param {boolean} recortada @param {PlanElegido['idioma']} idioma */
function notaDeLaAgenda(recortada, idioma) {
  const nota = NOTA_DE_LA_AGENDA[idioma];
  return crear('p', {
    className: 'pe-nota',
    textContent: `${recortada ? nota.recortada : nota.entera} ${nota.lectura}`,
  });
}
/** Las frases de la nota de las fechas que no caben, en cada idioma. */
const TEXTOS_DEL_RECORTE = {
  es: {
    vistas: (/** @type {number} */ n) =>
      n === 1 ? 'Aquí ves la primera fecha.' : `Aquí ves las ${n} primeras fechas.`,
    inicio: (/** @type {number} */ curso, /** @type {string} */ fecha) => `El curso ${curso} empieza ${fecha}.`,
    otras: (/** @type {number} */ n) => (n === 1 ? 'La otra fecha está' : `Las otras ${n} fechas están`),
    todas: (/** @type {number} */ n) => (n === 1 ? 'Tu fecha está' : `Tus ${n} fechas están`),
    donde: `en el calendario que puedes guardar con «${ES['formacion.calendario.boton']}» desde tu plan en pantalla.`,
  },
  ca: {
    vistas: (/** @type {number} */ n) =>
      n === 1 ? 'Aquí veus la primera data.' : `Aquí veus les ${n} primeres dates.`,
    inicio: (/** @type {number} */ curso, /** @type {string} */ fecha) => `El curs ${curso} comença ${fecha}.`,
    otras: (/** @type {number} */ n) => (n === 1 ? 'L’altra data és' : `Les altres ${n} dates són`),
    todas: (/** @type {number} */ n) => (n === 1 ? 'La teva data és' : `Les teves ${n} dates són`),
    donde: `al calendari que pots desar amb «${CA['formacion.calendario.boton']}» des del teu pla en pantalla.`,
  },
};
/** Cuándo empieza cada curso que no tiene ninguna fecha entre las que se ven.
 * @param {PlanElegido} plan @param {FilaInicial[]} filas @param {string[]} dias */
function iniciosQueNoSeVen(plan, filas, dias) {
  const textos = TEXTOS_DEL_RECORTE[plan.idioma];
  return plan.elecciones.flatMap((_, indice) => {
    const primera = filas.find((fila) => fila.indice === indice);
    if (!primera || filas.some((fila) => fila.indice === indice && dias.includes(fila.diaMadrid))) {
      return [];
    }
    return [textos.inicio(indice + 1, fechaOficialEnFrase(primera.orden, plan.idioma, 'el'))];
  });
}
/** La nota de las fechas que no caben: cuántas se ven, cuándo empieza el curso que no se ve y dónde están las demás,
 * que son todas las del plan menos las que se ven. @param {PlanElegido} plan @param {FilaInicial[]} filas
 * @param {string[]} dias */
function notaDeLoQueNoCabe(plan, filas, dias) {
  const textos = TEXTOS_DEL_RECORTE[plan.idioma];
  const vistas = dias.length;
  const faltan = new Set(filas.map((fila) => fila.diaMadrid)).size - vistas;
  const frases = [
    ...(vistas ? [textos.vistas(vistas)] : []),
    ...iniciosQueNoSeVen(plan, filas, dias),
    `${vistas ? textos.otras(faltan) : textos.todas(faltan)} ${textos.donde}`,
  ];
  return crear('p', { className: 'pe-nota pe-agenda-recortada', textContent: frases.join(' ') });
}
/** @param {PlanElegido} plan @param {Cronograma} agenda */
export function vistaAgendaInicial(plan, agenda) {
  const ca = plan.idioma === 'ca';
  const filas = filasDelPlan(plan, agenda);
  const primeras = filasIniciales(filas);
  const dudosas = agenda.sesiones.some((sesion) => !horaConZonaValida(sesion.inicio));
  const { dias, recortada } = fechasVisibles(primeras, dudosas);
  const seccion = crear(
    'section',
    { className: 'pe-arranque' },
    crear('h3', { textContent: ca ? 'Les teves primeres sessions' : 'Tus primeras sesiones' }),
    notaDeLaAgenda(recortada, plan.idioma),
  );
  if (dudosas) {
    seccion.append(
      crear('p', {
        className: 'pe-nota',
        textContent: ca
          ? 'Confirma amb el proveïdor les sessions que no tenen hora publicada.'
          : 'Confirma con el proveedor las sesiones que no tienen hora publicada.',
      }),
    );
  }
  if (!primeras.length) {
    seccion.append(
      crear('p', {
        textContent: ca ? 'Consulta el calendari amb el proveïdor.' : 'Consulta el calendario con el proveedor.',
      }),
    );
    return seccion;
  }
  const visibles = primeras.filter((fila) => dias.includes(fila.diaMadrid));
  agregarAgenda(seccion, plan, agenda, [
    ...(visibles.length ? [tablaInicial(plan, visibles)] : []),
    ...(recortada ? [notaDeLoQueNoCabe(plan, filas, dias)] : []),
  ]);
  return seccion;
}

/** La leyenda, la tabla de las fechas que se ven con la nota de las que no caben al final y la nota provisional.
 * @param {HTMLElement} seccion @param {PlanElegido} plan @param {Cronograma} agenda @param {HTMLElement[]} tabla */
function agregarAgenda(seccion, plan, agenda, tabla) {
  const ca = plan.idioma === 'ca';
  seccion.append(
    crear(
      'div',
      { className: 'pe-leyenda-agenda' },
      ...plan.elecciones.map((opcion, indice) =>
        crear('p', { className: `pe-leyenda-${indice}` }, `${indice + 1} · `, tituloDelCurso(opcion)),
      ),
    ),
    ...tabla,
  );
  if (agenda.cursos.some((curso) => curso.horasPublicadas === null || curso.provisional)) {
    seccion.append(
      crear('p', {
        className: 'pe-nota',
        textContent: ca
          ? 'Aquesta agenda cobreix el començament. Ajusta-la quan consultis el programa i la durada.'
          : 'Esta agenda cubre el comienzo. Ajústala cuando consultes el programa y la duración.',
      }),
    );
  }
}
