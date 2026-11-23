/** Lo que no consta de una oferta no la descarta: se propone igualmente y se dice qué falta por confirmar. */
import type { OfertaCatalogo } from '../catalogo-cursos/contrato.ts';
import type { IdiomaConOrigen } from '../catalogo-cursos/proyeccion-listado.ts';
import type { DatoPorConfirmar, PreferenciasSeleccion } from './contrato.ts';
import { idiomaPorConfirmar } from './idioma-del-plan.ts';

/** Solo descarta un registro que consta como exigido cuando la persona ha dicho que no quiere crear una cuenta. */
export function registroNoAceptado(oferta: OfertaCatalogo, aceptaRegistro: PreferenciasSeleccion['aceptaRegistro']) {
  const registro = oferta.hechos.requiere_registro_previo;
  return registro.motivo === 'conocido' && registro.valor === true && aceptaRegistro === false;
}

/** La modalidad que el curso publica, o null si la fuente no la dice. */
function modalidadPublicada(oferta: OfertaCatalogo): string | null {
  const modalidad = oferta.hechos.modalidad;
  return modalidad.motivo === 'conocido' && typeof modalidad.valor === 'string' ? modalidad.valor : null;
}

/** Solo descarta una modalidad publicada que contradice la que pide la persona; una mixta no sirve a quien pide una. */
export function modalidadNoCoincide(oferta: OfertaCatalogo, pedida: PreferenciasSeleccion['modalidad']) {
  const publicada = modalidadPublicada(oferta);
  return pedida !== 'cualquiera' && publicada !== null && publicada !== pedida;
}

/** Quien no ha pedido una modalidad no tiene nada que confirmar: la ficha ya dice que no consta. */
function modalidadPorConfirmar(oferta: OfertaCatalogo, pedida: PreferenciasSeleccion['modalidad']): boolean {
  return pedida !== 'cualquiera' && modalidadPublicada(oferta) === null;
}

function registroPorConfirmar(oferta: OfertaCatalogo): boolean {
  const registro = oferta.hechos.requiere_registro_previo;
  return registro.motivo !== 'conocido' || typeof registro.valor !== 'boolean';
}

/** Los datos que la fuente no publica, siempre en el mismo orden para que la hoja los diga igual. */
export function datosPorConfirmar(
  oferta: OfertaCatalogo,
  idioma: IdiomaConOrigen,
  modalidadPedida: PreferenciasSeleccion['modalidad'],
): readonly DatoPorConfirmar[] {
  const datos: DatoPorConfirmar[] = [];
  if (registroPorConfirmar(oferta)) {
    datos.push('registro_previo');
  }
  if (idiomaPorConfirmar(idioma)) {
    datos.push('idioma');
  }
  if (modalidadPorConfirmar(oferta, modalidadPedida)) {
    datos.push('modalidad');
  }
  return datos;
}

/**
 * Entre dos cursos que valen igual, va antes aquel del que consta todo. El orden de la entrega se conserva dentro de
 * cada grupo, porque es el único orden que tienen hoy las ofertas.
 */
export function primeroLoQueConsta<T>(elementos: readonly T[], pendientes: (elemento: T) => number): T[] {
  const completos = elementos.filter((elemento) => pendientes(elemento) === 0);
  const conPendientes = elementos.filter((elemento) => pendientes(elemento) > 0);
  return [...completos, ...conPendientes];
}
