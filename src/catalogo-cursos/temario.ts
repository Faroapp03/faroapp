/** Opciones públicas del filtro de materia. */
export const TEMAS_CURSOS = [
  'ia',
  'digital',
  'ofimatica',
  'datos',
  'seguridad',
  'empresa',
  'oficio',
  'diseno',
  'web',
  'comunicacion',
  'empleo',
  'ciudadania',
  'educacion',
  'sistemas',
  'no-indicado',
] as const;
export type TemaCurso = (typeof TEMAS_CURSOS)[number];
