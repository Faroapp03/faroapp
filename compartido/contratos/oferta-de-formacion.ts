// Contrato de la formación de fuera del catálogo oficial: modos admitidos, oferta por defecto y descripción para
// el registro de arranque. La configuración del despliegue interpreta los interruptores y los consumidores aplican
// la oferta; este módulo no lee variables de entorno ni selecciona cursos. Es contrato puro, compartido por la app y el
// motor de cursos (motores/cursos/): la app lo usa sin cargar el motor. No importa nada de motores/ ni de src/.

/** Los valores que admite FARO_FORMACION_ABIERTA, en una sola lista: el tipo sale de aquí. */
export const MODOS_FORMACION_ABIERTA = Object.freeze(['no', 'publica', 'gratis'] as const);

/** El valor de FARO_FORMACION_ABIERTA, ya interpretado. */
export type ModoFormacionAbierta = (typeof MODOS_FORMACION_ABIERTA)[number];

/** Cada modo de la formación abierta, en palabras, para el registro de arranque; el tipo exige que estén todos. */
const DESCRIPCION_DEL_MODO: Readonly<Record<ModoFormacionAbierta, string>> = Object.freeze({
  no: 'apagada',
  publica: 'solo pública',
  gratis: 'pública y gratuita de otras entidades',
});

/** La configuración de la oferta del despliegue. */
export interface OfertaDeFormacion {
  readonly formacionAbierta: ModoFormacionAbierta;
  readonly citilabDePago: boolean;
}

/** Sin configuración: la formación abierta de titular público y, de Citilab, solo los cursos gratuitos. */
export const OFERTA_POR_DEFECTO: OfertaDeFormacion = Object.freeze({
  formacionAbierta: 'publica',
  citilabDePago: false,
});

/**
 * Describe la oferta en una línea, para el registro de arranque: qué enseña el informe además de la formación oficial.
 *
 * @param oferta - Configuración de la oferta del despliegue.
 * @param oferta.formacionAbierta - Modo de la formación abierta.
 * @param oferta.citilabDePago - Si se enseñan los cursos de pago de Citilab.
 * @returns La descripción, en castellano y sin datos de la persona.
 */
export function descripcionDeLaOferta({ formacionAbierta, citilabDePago }: OfertaDeFormacion): string {
  const deCitilab = citilabDePago ? 'con' : 'sin';
  return `formación abierta ${DESCRIPCION_DEL_MODO[formacionAbierta]} · Citilab ${deCitilab} cursos de pago`;
}
