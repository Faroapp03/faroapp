/**
 * El principal llama por su único binding `CURSOS` a su propio Worker de Cursos, que tiene otro nombre. La regla es
 * la misma para la publicación a mano y para la activación: con el nombre del principal en la configuración de
 * Cursos, subir Cursos sustituiría la web.
 */
export function cursosDelPrincipal(principal: Record<string, unknown>, cursos: Record<string, unknown>): boolean {
  const enlaces = Array.isArray(principal.services)
    ? principal.services.filter(
        (s: unknown) => typeof s === 'object' && s !== null && 'binding' in s && s.binding === 'CURSOS',
      )
    : [];
  return (
    enlaces.length === 1 &&
    typeof cursos.name === 'string' &&
    cursos.name !== principal.name &&
    (enlaces[0] as Record<string, unknown>).service === cursos.name
  );
}
