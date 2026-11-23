// Categorías compartidas por la política de moderación y las reglas locales del recorrido.

/**
 * Categorías que paran el proceso y ofrecen ayuda (la línea 024 de atención a la conducta suicida): la intención o
 * las instrucciones de autolesión.
 */
export const PIDEN_AYUDA = ['self-harm/intent', 'self-harm/instructions'] as const;
/** Categorías que bloquean con cualquier puntuación, salvo la prioridad de PIDEN_AYUDA. */
export const BLOQUEAN_SIEMPRE = ['sexual/minors'] as const;
/** Categorías que bloquean con puntuación alta, según la política (seguridad/moderacion.ts). */
export const BLOQUEAN_SI_ALTA = ['hate', 'hate/threatening', 'harassment/threatening', 'illicit/violent'] as const;
