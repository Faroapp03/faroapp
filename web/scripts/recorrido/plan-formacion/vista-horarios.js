import { cifraHasta } from '../../cifras.js';
import { crear } from '../../dom.js';
import { evaluarHorarios } from './compatibilidad-horarios.js';
import { fechaOficial, fechaOficialEnFrase } from './textos-documento.js';

/** @import { PlanElegido } from './contrato.js' */
/** @import { OpcionPlan } from '../../../../src/seleccion-formacion/contrato.ts' */
/** @typedef {ReturnType<typeof evaluarHorarios>} Horarios */
const TEXTOS = {
  es: {
    conflicto: 'Hay que ajustar la agenda',
    normal: 'Horarios de los cursos',
    incompleto:
      'Faltan horarios publicados para comprobar coincidencias. Las fechas de estudio son una propuesta personal.',
    iniciado:
      'Una convocatoria ya ha empezado. Su incorporación queda pendiente; el plan no da por hecho que puedas entrar a mitad del curso.',
    compatible:
      'No hay coincidencias entre las sesiones publicadas. Los cursos a tu ritmo no imponen una hora de clase.',
  },
  ca: {
    conflicto: 'Cal ajustar l’agenda',
    normal: 'Horaris dels cursos',
    incompleto: 'Falten horaris publicats per comprovar coincidències. Les dates d’estudi són una proposta personal.',
    iniciado:
      'Una convocatòria ja ha començat. La incorporació queda pendent; el pla no dona per fet que hi puguis entrar a mig curs.',
    compatible:
      'No hi ha coincidències entre les sessions publicades. Els cursos al teu ritme no imposen una hora de classe.',
  },
};
/** @param {PlanElegido} plan @param {Horarios} horarios */
function coincidencia(plan, horarios) {
  const primero = horarios.conflictos[0];
  if (!primero) {
    return null;
  }
  const fecha = `${fechaOficial(primero.inicio, plan.idioma)} – ${fechaOficial(primero.fin, plan.idioma)}`;
  return plan.idioma === 'ca'
    ? `Les classes coincideixen (${fecha}). Consulta amb els proveïdors com pots seguir els cursos.`
    : `Las clases coinciden (${fecha}). Consulta con los proveedores cómo puedes seguir los cursos.`;
}
/** @param {PlanElegido} plan @param {Horarios} horarios */
function cargaPublicada(plan, horarios) {
  const mayor = [...horarios.semanasLectivas].sort((a, b) => b.horas - a.horas)[0];
  if (!mayor) {
    return null;
  }
  const horas = cifraHasta(mayor.horas, 1);
  const semana = fechaOficialEnFrase(mayor.inicio, plan.idioma, 'de');
  return plan.idioma === 'ca'
    ? `La setmana amb més sessions publicades, la ${semana}, suma ${horas} h de classe. El temps de pràctica va a part.`
    : `La semana con más sesiones publicadas, la ${semana}, suma ${horas} h de clase. El tiempo de práctica va aparte.`;
}
/** @param {PlanElegido} plan @param {Horarios} [horarios] */
export function resumenHorarios(plan, horarios = evaluarHorarios(plan)) {
  const t = TEXTOS[plan.idioma];
  const textos = [coincidencia(plan, horarios), cargaPublicada(plan, horarios)].filter((texto) => texto !== null);
  if (horarios.incorporacionPendiente.length) {
    textos.push(t.iniciado);
  }
  if (horarios.horariosIncompletos.length) {
    textos.push(t.incompleto);
  }
  if (!textos.length) {
    textos.push(t.compatible);
  }
  return textos;
}
/** Los cruces reales no se convierten en una agenda viable. @param {PlanElegido} plan */
export function avisoDeHorarios(plan) {
  const horarios = evaluarHorarios(plan);
  const conflicto = horarios.estado === 'conflicto';
  const titulo = TEXTOS[plan.idioma][conflicto ? 'conflicto' : 'normal'];
  const nodo = crear(
    'section',
    { className: 'rc-plan-horarios', role: 'status' },
    crear('h4', { textContent: titulo }),
    ...resumenHorarios(plan, horarios).map((texto) => crear('p', { textContent: texto })),
  );
  nodo.dataset.estado = horarios.estado;
  return { nodo, conflicto };
}

/** @param {import('../../../../src/seleccion-formacion/contrato.ts').SeleccionFormacion} seleccion
 * @param {(ia:OpcionPlan,digital:OpcionPlan)=>PlanElegido} formar */
export function avisoParaEleccion(seleccion, formar) {
  return (/** @type {string} */ ia, /** @type {string} */ digital) => {
    const primera = seleccion.opciones.ia.find((o) => o.oferta.unidad.id === ia);
    const segunda = seleccion.opciones.digital.find((o) => o.oferta.unidad.id === digital);
    if (!primera || !segunda) {
      throw new TypeError('La selección de cursos ha cambiado');
    }
    return avisoDeHorarios(formar(primera, segunda)).nodo;
  };
}
