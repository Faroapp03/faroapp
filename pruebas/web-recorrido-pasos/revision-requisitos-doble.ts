/** Revisión de requisitos que fija cada prueba de pantalla, en lugar de la publicada con el motor. */
import type { Revision } from '../../src/seleccion-formacion/requisitos.ts';
import type { DecisionRequisito } from '../../src/seleccion-formacion/requisitos-revisados.ts';

export const REVISION_REQUISITOS: Record<string, DecisionRequisito> = {};

export function fijarRevision(revision: Revision): void {
  for (const id of Object.keys(REVISION_REQUISITOS)) {
    Reflect.deleteProperty(REVISION_REQUISITOS, id);
  }
  Object.assign(REVISION_REQUISITOS, revision);
}
