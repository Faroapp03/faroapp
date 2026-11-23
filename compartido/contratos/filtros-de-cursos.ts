// Contrato de los filtros de la sección «Cursos» (GET /api/cursos): las opciones que admite cada filtro y las fuentes
// de la bolsa de cursos. Es contrato puro, compartido por la app y el motor de cursos (motores/cursos/), que lo
// reexporta: la ruta valida sus filtros y OpenAPI los describe sin cargar el motor. No importa nada de motores/ ni de
// src/.

/** Las opciones de cada filtro que no son una lista abierta (la familia y la fuente salen de los datos). */
export const OPCIONES_DE_CURSOS = {
  cuando: ['con-fecha', 'sin-fecha'],
  modalidad: ['a-distancia', 'presencial'],
  nivel: ['1', '2', '3'],
  quien: ['personas-ocupadas', 'en-busqueda-de-empleo'],
} as const;

/** Las fuentes de la bolsa, en el orden de la sección «Cursos». */
export const FUENTES_DE_CURSOS = ['soc', 'consorci', 'fundae', 'citilab', 'cibernarium', 'abierta'] as const;
