// Contrato de la formación del informe que la app usa sin cargar el motor de cursos: dos datos fijos, la dirección del
// buscador del catálogo del SEPE y la antigüedad máxima de una copia de cursos. El motor de cursos (motores/cursos/)
// reexporta los dos datos. No importa nada de motores/ ni de src/.

/** El buscador del Catálogo de Especialidades Formativas del SEPE, en su sede electrónica. */
export const CATALOGO_SEPE = 'https://sede.sepe.gob.es/FOET_CATALOGO_EEFF_SEDE/flows/main';

/**
 * Días que puede tener una copia de cursos antes de que el informe avise de que puede haber quedado atrás.
 */
export const MAX_DIAS_COPIA_CURSOS = 30;
