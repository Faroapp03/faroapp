import { crear } from '../../dom.js';
import { nombreDelDia } from '../../fechas.js';
import { duracionDeEstudio } from './duracion-de-estudio.js';
import { duracionPublicada, etiquetaDeIdioma, tituloDelCurso } from './ficha-oferta.js';
import { objetivosDeOpcion } from './metadatos.js';
import { ritmoGeneralHpLife } from './sincronia-proveedor.js';
import { fechaDelPlan, fechaOficial, fechaOficialEnFrase } from './textos-documento.js';
import { horaConZonaValida } from './vista-agenda.js';

export { vistaAgendaInicial } from './vista-agenda.js';

/** @import { PlanElegido, OpcionPlan } from './contrato.js' */
/** @typedef {NonNullable<ReturnType<typeof import('./agenda.js').crearAgenda>['cronograma']>} Cronograma */
/** @type {Record<'es'|'ca', Record<string, string>>} */
const AVISOS = {
  es: {
    'horario-por-confirmar': 'Confirma horarios con el proveedor.',
    'duracion-por-confirmar': 'Consulta la duración y el programa con el proveedor.',
    'sesion-por-confirmar': 'Confirma la fecha de la sesión.',
    'incorporacion-por-confirmar': 'Consulta si aún puedes incorporarte.',
    'sesion-fuera-disponibilidad': 'Hay sesiones fuera de tu disponibilidad.',
    'sesion-supera-disponibilidad': 'Alguna sesión supera el tiempo disponible.',
    'capacidad-insuficiente': 'El tiempo disponible no cubre la duración antes del cierre publicado.',
    'limite-de-planificacion': 'La duración supera el horizonte calculado; continúa el plan después.',
    'conflicto-sesiones': 'Hay sesiones oficiales que coinciden.',
    'limites-horarios-parciales': 'El horario de acceso es parcial; confirma las horas disponibles.',
    'capacidad-por-confirmar': 'La capacidad queda por confirmar por los horarios incompletos.',
  },
  ca: {
    'horario-por-confirmar': 'Confirma els horaris amb el proveïdor.',
    'duracion-por-confirmar': 'Consulta la durada i el programa amb el proveïdor.',
    'sesion-por-confirmar': 'Confirma la data de la sessió.',
    'incorporacion-por-confirmar': 'Consulta si encara t’hi pots incorporar.',
    'sesion-fuera-disponibilidad': 'Hi ha sessions fora de la teva disponibilitat.',
    'sesion-supera-disponibilidad': 'Alguna sessió supera el temps disponible.',
    'capacidad-insuficiente': 'El temps disponible no cobreix la durada abans del tancament publicat.',
    'limite-de-planificacion': 'La durada supera l’horitzó calculat; continua el pla després.',
    'conflicto-sesiones': 'Hi ha sessions oficials que coincideixen.',
    'limites-horarios-parciales': 'L’horari d’accés és parcial; confirma les hores disponibles.',
    'capacidad-por-confirmar': 'La capacitat queda per confirmar pels horaris incomplets.',
  },
};
/** @param {string|null} a @param {string|null} b */
function compararFechas(a, b) {
  if (!a || !b) {
    return (a ?? '').localeCompare(b ?? '');
  }
  if (horaConZonaValida(a) && horaConZonaValida(b)) {
    return Date.parse(a) - Date.parse(b);
  }
  return a.localeCompare(b);
}
/** @param {PlanElegido} plan @param {Cronograma['sesiones']} oficial */
function finRangoOficial(plan, oficial) {
  const ultima = oficial.at(-1);
  if (!ultima?.inicio) {
    return '';
  }
  const finales = oficial.flatMap((s) => (s.fin && horaConZonaValida(s.fin) ? [s.fin] : [])).sort(compararFechas);
  const extremo = ultima.fin && horaConZonaValida(ultima.fin) ? finales.at(-1) : null;
  const rotulo = plan.idioma === 'ca' ? 'l’última sessió comença' : 'la última sesión empieza';
  return extremo
    ? fechaOficial(extremo, plan.idioma)
    : `${rotulo} ${fechaOficialEnFrase(ultima.inicio, plan.idioma, 'el')}`;
}
/** @param {PlanElegido} plan @param {Cronograma} agenda @param {Cronograma['cursos'][number]} curso */
function rangoOficial(plan, agenda, curso) {
  const todas = agenda.sesiones.filter((s) => s.indice === curso.indice);
  const oficial = todas
    .filter((s) => s.inicio && horaConZonaValida(s.inicio))
    .sort((a, b) => compararFechas(a.inicio, b.inicio));
  const primera = oficial[0]?.inicio;
  if (!primera) {
    return null;
  }
  const ca = plan.idioma === 'ca';
  const completa = ca ? 'Sessions publicades' : 'Sesiones publicadas';
  const parcial = ca ? 'Sessions amb hora publicada' : 'Sesiones con hora publicada';
  const etiqueta = oficial.length === todas.length ? completa : parcial;
  const sesiones = ca ? ['sessió', 'sessions'] : ['sesión', 'sesiones'];
  const numero = `${oficial.length} ${sesiones[oficial.length === 1 ? 0 : 1]}`;
  return `${etiqueta}: ${fechaOficial(primera, plan.idioma)} – ${finRangoOficial(plan, oficial)} (${numero})`;
}
/** @param {PlanElegido} plan @param {Cronograma} agenda @param {Cronograma['cursos'][number]} curso */
function rangoCurso(plan, agenda, curso) {
  const ca = plan.idioma === 'ca';
  const oficial = rangoOficial(plan, agenda, curso);
  if (oficial) {
    return oficial;
  }
  if (!curso.inicioPrevisto) {
    return ca ? 'Dates per confirmar amb el proveïdor' : 'Fechas por confirmar con el proveedor';
  }
  const inicio = `${ca ? 'Comences' : 'Empiezas'} ${fechaOficialEnFrase(curso.inicioPrevisto, plan.idioma, 'el')}`;
  return curso.finPrevisto
    ? `${inicio} · ${ca ? 'final previst' : 'fin previsto'}: ${fechaDelPlan(curso.finPrevisto, plan.idioma)}`
    : inicio;
}
/** @param {PlanElegido} plan @param {Cronograma['cursos'][number]} curso */
function duracionCurso(plan, curso) {
  return duracionPublicada(curso.horasPublicadas, plan.idioma) ?? '';
}
/** @param {OpcionPlan} opcion @param {PlanElegido['idioma']} idioma @returns {HTMLElement[]} */
function objetivoPublicado(opcion, idioma) {
  const objetivo = opcion.aprendizaje?.aprendizaje?.contenido_observado ? objetivosDeOpcion(opcion)[0] : null;
  if (!objetivo) {
    return [
      crear('p', {
        className: 'pe-nota',
        textContent:
          idioma === 'ca'
            ? 'Consulta els objectius a la fitxa oficial del curs.'
            : 'Consulta los objetivos en la ficha oficial del curso.',
      }),
    ];
  }
  const nodo = crear('p', { className: 'pe-objetivo-publicado', textContent: objetivo });
  const idiomaFicha = opcion.aprendizaje?.idioma_ficha;
  if (idiomaFicha) {
    nodo.lang = idiomaFicha;
  }
  return [
    crear('p', { className: 'pe-nota', textContent: idioma === 'ca' ? 'Objectiu publicat' : 'Objetivo publicado' }),
    nodo,
  ];
}
/** @param {PlanElegido} plan @param {Cronograma} agenda */
function lineasCursos(plan, agenda) {
  const filas = crear('div', { className: 'pe-lineas-tiempo' });
  for (const curso of agenda.cursos) {
    const opcion = plan.elecciones[curso.indice];
    if (!opcion) {
      throw new TypeError('Curso del cronograma no válido');
    }
    const rango = rangoCurso(plan, agenda, curso);
    const dedicacion = duracionCurso(plan, curso);
    const idioma = etiquetaDeIdioma(opcion, plan.idioma);
    filas.append(
      crear(
        'div',
        { className: `pe-linea-curso pe-linea-${curso.indice}` },
        crear('span', { className: 'pe-numero-curso', textContent: String(curso.indice + 1).padStart(2, '0') }),
        crear(
          'div',
          {},
          crear('strong', {}, tituloDelCurso(opcion)),
          crear('p', { textContent: [idioma, rango, dedicacion].filter(Boolean).join(' · ') }),
          ...(ritmoGeneralHpLife(opcion)
            ? [
                crear('p', {
                  className: 'pe-nota',
                  textContent:
                    plan.idioma === 'ca'
                      ? 'Al teu ritme · Condició general del proveïdor'
                      : 'A tu ritmo · Condición general del proveedor',
                }),
              ]
            : []),
          ...objetivoPublicado(opcion, plan.idioma),
        ),
      ),
    );
  }
  return filas;
}
/** @param {PlanElegido} plan @param {Cronograma} agenda */
function organizacion(plan, agenda) {
  const ca = plan.idioma === 'ca';
  const pasos = ca
    ? [
        'Prepara l’accés i la matrícula amb cada proveïdor.',
        'El primer dia d’estudi de cada curs, obre el programa i comença pel primer apartat; si hi ha horaris oficials, segueix-los.',
        'Els dies següents, continua on ho vas deixar i ajusta el pla al teu ritme.',
      ]
    : [
        'Prepara el acceso y la matrícula con cada proveedor.',
        'El primer día de estudio de cada curso, abre el programa y empieza por el primer apartado; si hay horarios oficiales, síguelos.',
        'Los días siguientes, continúa donde lo dejaste y ajusta el plan a tu ritmo.',
      ];
  const seccion = crear(
    'section',
    { className: 'pe-organizacion' },
    crear('h4', { textContent: ca ? 'Per començar' : 'Para empezar' }),
    crear('ol', {}, ...pasos.map((paso) => crear('li', { textContent: paso }))),
  );
  const mensajes = avisosConContexto(plan, agenda);
  if (mensajes.length) {
    seccion.append(
      crear(
        'div',
        { className: 'pe-calendario-alerta' },
        crear('strong', { textContent: ca ? 'Revisa abans de començar' : 'Revisa antes de empezar' }),
        crear('ul', {}, ...mensajes.map((mensaje) => crear('li', { textContent: mensaje }))),
      ),
    );
  }
  return seccion;
}
/** @param {PlanElegido} plan @param {Cronograma['alertas'][number]} alerta */
function textoDeHorario(plan, alerta) {
  const ca = plan.idioma === 'ca';
  const sincronia = typeof alerta.indice === 'number' ? plan.elecciones[alerta.indice]?.oferta.hechos.sincronia : null;
  if (sincronia?.motivo === 'declaraciones_contradictorias') {
    return ca
      ? 'Hi ha informació contradictòria sobre l’horari; consulta el proveïdor.'
      : 'Hay información contradictoria sobre el horario; consulta al proveedor.';
  }
  if (sincronia?.motivo === 'no_interpretable') {
    return ca
      ? 'No s’ha pogut interpretar l’horari; consulta el proveïdor.'
      : 'No se ha podido interpretar el horario; consulta al proveedor.';
  }
  if (sincronia?.motivo !== 'conocido' || sincronia.valor === null) {
    return ca ? 'Comprova si hi ha sessions programades.' : 'Comprueba si hay sesiones programadas.';
  }
  return ca ? 'Confirma els horaris amb el proveïdor.' : 'Confirma horarios con el proveedor.';
}
/** @param {PlanElegido} plan @param {Cronograma['alertas'][number]} alerta */
function textoDeAlerta(plan, alerta) {
  if (alerta.tipo === 'horario-por-confirmar') {
    return textoDeHorario(plan, alerta);
  }
  return (
    AVISOS[plan.idioma][alerta.tipo] ??
    (plan.idioma === 'ca' ? 'Consulta les condicions amb el proveïdor.' : 'Consulta las condiciones con el proveedor.')
  );
}
/** @param {PlanElegido} plan @param {Cronograma} agenda */
function avisosDeCadaFecha(plan, agenda) {
  /** @type {Map<string, {texto:string,fecha:string,indices:number[]}>} */
  const grupos = new Map();
  for (const alerta of agenda.alertas) {
    if (alerta.tipo === 'duracion-por-confirmar') {
      continue;
    }
    const texto = textoDeAlerta(plan, alerta);
    const fecha = alerta.fecha ? fechaDelPlan(alerta.fecha.slice(0, 10), plan.idioma) : '';
    const clave = JSON.stringify([texto, fecha]);
    /** @type {{texto:string,fecha:string,indices:number[]}} */
    const grupo = grupos.get(clave) ?? { texto, fecha, indices: [] };
    if (typeof alerta.indice === 'number' && !grupo.indices.includes(alerta.indice)) {
      grupo.indices.push(alerta.indice);
    }
    grupos.set(clave, grupo);
  }
  return grupos.values();
}
/** @param {PlanElegido} plan @param {Cronograma} agenda */
function avisosConContexto(plan, agenda) {
  /** @type {Map<string, {texto:string,cursos:string,fechas:string[]}>} */
  const avisos = new Map();
  for (const { texto, fecha, indices } of avisosDeCadaFecha(plan, agenda)) {
    const nombres = indices.map((indice) => plan.elecciones[indice]?.oferta.titulo_programa).filter(Boolean);
    const cursos = nombres.join(plan.idioma === 'ca' ? ' i ' : ' y ');
    const clave = JSON.stringify([texto, cursos, Boolean(fecha)]);
    const aviso = avisos.get(clave) ?? { texto, cursos, fechas: [] };
    if (fecha) {
      aviso.fechas.push(fecha);
    }
    avisos.set(clave, aviso);
  }
  return [...avisos.values()].map(
    ({ texto, cursos, fechas }) =>
      `${cursos ? `${cursos}: ` : ''}${fechas.length ? `${fechas.join(', ')} · ` : ''}${texto}`,
  );
}
/** @param {PlanElegido} plan @param {Cronograma} agenda */
export function vistaCronograma(plan, agenda) {
  const ca = plan.idioma === 'ca';
  const nodo = crear(
    'section',
    { className: 'pe-calendario' },
    crear('h3', { textContent: ca ? 'El teu calendari' : 'Tu calendario' }),
  );
  const dias = agenda.disponibilidad.dias.map((dia) => nombreDelDia(dia, plan.idioma)).join(', ');
  nodo.append(
    crear('p', {
      className: 'pe-calendario-resumen',
      textContent: `${ca ? 'Disponibilitat en hora de Barcelona' : 'Disponibilidad en hora de Barcelona'}: ${dias} · ${duracionDeEstudio(agenda.disponibilidad.minutosPorDia)} ${ca ? 'al dia' : 'al día'} · ${duracionDeEstudio(agenda.disponibilidad.minutosPorDia * agenda.disponibilidad.dias.length)} ${ca ? 'per setmana' : 'por semana'}`,
    }),
  );
  nodo.append(lineasCursos(plan, agenda));
  nodo.append(
    crear('p', {
      className: 'pe-nota',
      textContent: ca
        ? 'Els dies d’estudi són una proposta de Faro segons la teva disponibilitat; les sessions publicades les fixa cada proveïdor.'
        : 'Los días de estudio son una propuesta de Faro según tu disponibilidad; las sesiones publicadas las fija cada proveedor.',
    }),
  );
  nodo.append(organizacion(plan, agenda));
  return nodo;
}
