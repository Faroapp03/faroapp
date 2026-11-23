// Vuelve a contrastar las ofertas también después de elegir acreditación.

import { preguntarAcreditacion } from '../plan-formacion/preguntar-acreditacion.js';
import { inicioDeAgendaVigente } from './agenda.js';
import { seleccionarEnElDispositivo } from './cliente.js';
import { eleccionesVigentes } from './crear-plan.js';

/** @import { SeleccionFormacion, PreferenciasSeleccion } from '../../../../src/seleccion-formacion/contrato.ts' */
/** @import { AcreditacionPlan, IdiomaPlan } from '../plan-formacion/contrato.js' */
/** @typedef {{inicial:SeleccionFormacion,preferencias:PreferenciasSeleccion,disponibilidad:{inicio:string},ia:string|null,digital:string|null,idioma:IdiomaPlan,signal:AbortSignal,vigente:()=>boolean,obtener:(signal:AbortSignal)=>Promise<AcreditacionPlan[]>,cerrar:()=>void,fechaPasada:()=>void,actualizada:(s:SeleccionFormacion)=>void}} Contexto */
/** @param {SeleccionFormacion} anterior @param {SeleccionFormacion} actual @param {Contexto} c */
function validar(anterior, actual, c) {
  if (!c.vigente()) {
    return null;
  }
  if (!inicioDeAgendaVigente(c.disponibilidad, actual.calculado_el)) {
    c.fechaPasada();
    return null;
  }
  const elecciones = eleccionesVigentes(anterior, actual, c.ia, c.digital);
  if (!elecciones) {
    c.actualizada(actual);
  }
  return elecciones;
}
/** @param {Contexto} c */
export async function confirmarSeleccion(c) {
  const actual = await seleccionarEnElDispositivo(c.preferencias, c.signal);
  if (!validar(c.inicial, actual, c)) {
    return null;
  }
  const opciones = await c.obtener(c.signal);
  if (!c.vigente()) {
    return null;
  }
  c.cerrar();
  const acreditacion = await preguntarAcreditacion(opciones, c.idioma, c.signal, c.vigente);
  if (!c.vigente()) {
    return null;
  }
  const final = opciones.length ? await seleccionarEnElDispositivo(c.preferencias, c.signal) : actual;
  const elecciones = validar(actual, final, c);
  return elecciones ? { final, elecciones, acreditacion } : null;
}
