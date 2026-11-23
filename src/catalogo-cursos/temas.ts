/** Clasificación propia de Faro para navegar, sin atribuir nivel, marca, requisitos ni correspondencia oficial. */
import { temasRevisados } from './clasificacion.ts';
import { sugerirTemasPorTitulo } from './inferir-temas.ts';
import type { TemaCurso } from './temario.ts';

export { TEMAS_CURSOS, type TemaCurso } from './temario.ts';

/** La API histórica consulta primero la revisión; el respaldo comparte el tesauro público del filtro. */
export function temasDelCurso(tituloPublicado: string): readonly TemaCurso[] {
  const revisados = temasRevisados(tituloPublicado);
  if (revisados) {
    return revisados;
  }
  const temas = sugerirTemasPorTitulo(tituloPublicado);
  return temas.length ? temas : ['no-indicado'];
}
