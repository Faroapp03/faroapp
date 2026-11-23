/** Traduce preferencias validadas al contrato del plan, sin inventar respuestas. */
import { REFERENCIA } from '../../catalogo-cursos/referencia.js';
/** @import { Etapa, PreferenciasSeleccion } from '../../../../src/seleccion-formacion/contrato.ts' */
/** @import { PreferenciasPlan } from '../plan-formacion/contrato.js' */
/** @param {string} valor @returns {valor is Etapa} */
export function esEtapa(valor) {
  return valor === 'inicial' || valor === 'intermedio' || valor === 'avanzado';
}
/** @param {string} valor @returns {valor is PreferenciasSeleccion['modalidad']} */
export function esModalidad(valor) {
  return valor === 'cualquiera' || valor === 'en-linea' || valor === 'presencial';
}
/** @param {PreferenciasSeleccion} preferencias @param {Etapa|null} nivelDigital @param {string} inicio @returns {PreferenciasPlan} */
export function preferenciasDelPlan(preferencias, nivelDigital, inicio) {
  if (
    !nivelDigital ||
    !esEtapa(nivelDigital) ||
    !esEtapa(preferencias.etapa) ||
    !esModalidad(preferencias.modalidad) ||
    (preferencias.aceptaRegistro !== null && typeof preferencias.aceptaRegistro !== 'boolean')
  ) {
    throw new TypeError('Las preferencias de formación no son válidas');
  }
  return {
    nivel: preferencias.etapa,
    nivelDigital,
    idiomas: [...preferencias.idiomas],
    modalidad: preferencias.modalidad,
    aceptaRegistro: preferencias.aceptaRegistro,
    inicio,
  };
}

/** @import { SeleccionFormacion, OpcionPlan } from '../../../../src/seleccion-formacion/contrato.ts' */
/** @import { PlanElegido, IdiomaPlan } from '../plan-formacion/contrato.js' */
/** @param {{actual: SeleccionFormacion, ia: OpcionPlan|null, digital: OpcionPlan|null, preferencias: PreferenciasSeleccion, nivelDigital: Etapa|null, disponibilidad: {dias:number[],minutosPorDia:number,inicio:string}, objetivo:string, idioma: IdiomaPlan, perfil:string|null}} datos @returns {PlanElegido} */
export function crearPlanValidado(datos) {
  const { actual, ia, digital, preferencias, nivelDigital, disponibilidad, objetivo, idioma, perfil } = datos;
  if (
    (ia && ia.bloque !== 'ia') ||
    (digital && digital.bloque !== 'digital') ||
    (ia && digital && ia.oferta.unidad.id === digital.oferta.unidad.id)
  ) {
    throw new TypeError('El plan de formación no es válido');
  }
  return {
    version: 1,
    elecciones: [ia, digital].filter((opcion) => opcion !== null),
    confirmadoEl: actual.calculado_el,
    fuente: { ruta: REFERENCIA.ruta, sha256: REFERENCIA.sha256, revision: REFERENCIA.revision },
    requisitosConfirmados: [...preferencias.requisitosConfirmados],
    disponibilidad: { dias: [...disponibilidad.dias], minutosPorDia: disponibilidad.minutosPorDia },
    preferencias: preferenciasDelPlan(preferencias, nivelDigital, disponibilidad.inicio),
    objetivo,
    idioma,
    perfil,
  };
}

/** @param {PreferenciasSeleccion} preferencias */
export function valorDelRegistro(preferencias) {
  if (preferencias.aceptaRegistro === null) {
    return '';
  }
  return preferencias.aceptaRegistro ? 'si' : 'no';
}
