// El contrato de la oferta de formación vive en compartido/contratos/oferta-de-formacion.ts: la app lo usa sin cargar
// este motor. Los archivos del motor lo siguen importando desde aquí.

export type { ModoFormacionAbierta, OfertaDeFormacion } from '../../../compartido/contratos/oferta-de-formacion.ts';
export {
  descripcionDeLaOferta,
  MODOS_FORMACION_ABIERTA,
  OFERTA_POR_DEFECTO,
} from '../../../compartido/contratos/oferta-de-formacion.ts';
